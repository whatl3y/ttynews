#!/bin/bash
set -e

# tty.news - Heroku Container Deployment Script
#
# Deploys tty.news to Heroku as a Docker container, exactly like the pulse and
# jeffreyepstein backends (heroku container:push/release, container stack):
#   - web: Express server (node dist/webServer.js)
#
# tty.news is a single web process. It has no workers, scheduler, or database
# migrations, so this script builds one image and releases the `web` dyno.
#
# The image bakes in the geo data files (data/) at build time. If a local
# MaxMind GeoLite2 database (data/GeoLite2-City.mmdb) is present it is baked in
# too; otherwise the app falls back to the ipwho.is API for IP -> location.
#
# Prerequisites:
#   - Docker installed and running
#   - Heroku CLI installed and logged in (heroku login + heroku container:login)
#
# Usage:
#   ./deploy.sh [APP_NAME] [OPTIONS]
#
# Options:
#   --skip-build      Skip building the image (push/release an existing local image)
#   --host=<url>      Canonical https:// origin to set as HOST
#                     (default: the app's real Heroku web URL, read from
#                     `heroku apps:info` - not guessed from the app name)
#
# If APP_NAME is not provided, it defaults to 'tty-news'.

APP_NAME="${1:-tty-news}"

# Check if first arg is an option (starts with --)
if [[ "$APP_NAME" == --* ]]; then
    APP_NAME="tty-news"
fi

# Parse options
SKIP_BUILD=false
HOST_OVERRIDE=""

for arg in "$@"; do
    case $arg in
        --skip-build)
            SKIP_BUILD=true
            ;;
        --host=*)
            HOST_OVERRIDE="${arg#*=}"
            ;;
    esac
done

# HOST must be an absolute https:// origin. webServer.ts refuses to boot in
# production otherwise (it becomes the <link rel=canonical>/og:url origin), so
# reject a bad --host now rather than crash-looping the dyno after a full build.
if [ -n "$HOST_OVERRIDE" ] && [[ "$HOST_OVERRIDE" != https://* ]]; then
    echo "Error: --host must be an absolute https:// origin (got '$HOST_OVERRIDE')."
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="registry.heroku.com/$APP_NAME/web"

echo "========================================"
echo "tty.news"
echo "Heroku Container Deployment"
echo "========================================"
echo ""
echo "App: $APP_NAME"
echo "Process: web (Express server)"
echo ""

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo "Error: Docker is not running. Please start Docker first."
        exit 1
    fi

    if ! command -v heroku &> /dev/null; then
        echo "Error: Heroku CLI is not installed."
        echo "Install it with: brew install heroku/brew/heroku"
        exit 1
    fi

    if ! heroku auth:whoami &> /dev/null; then
        echo "Error: Not logged in to Heroku. Please run: heroku login"
        exit 1
    fi

    # Login to Heroku Container Registry
    echo "Logging in to Heroku Container Registry..."
    heroku container:login

    echo "All prerequisites met."
    echo ""
}

# Create or verify Heroku app
setup_heroku_app() {
    echo "Setting up Heroku app: $APP_NAME"

    # Check if app exists
    if heroku apps:info -a "$APP_NAME" &> /dev/null; then
        echo "App '$APP_NAME' already exists."
    else
        echo "Creating new Heroku app: $APP_NAME"
        heroku create "$APP_NAME" || {
            echo ""
            echo "Could not create app with name '$APP_NAME'."
            echo "The name might be taken. Please provide a unique name:"
            read -p "App name: " NEW_APP_NAME
            APP_NAME="$NEW_APP_NAME"
            IMAGE="registry.heroku.com/$APP_NAME/web"
            heroku create "$APP_NAME"
        }
    fi

    # Set stack to container
    echo "Setting stack to container..."
    heroku stack:set container -a "$APP_NAME"

    echo ""
}

# The app's real https origin. Heroku assigns newly created apps a randomized
# "<name>-<hash>.herokuapp.com" URL, so this is READ from Heroku, never guessed
# from the app name - a wrong canonical/og:url origin deindexes the whole site.
APP_URL=""

resolve_app_url() {
    # `apps:info -s` prints shell-parseable "key=value" lines incl. web_url; the
    # sed trims the trailing slash Heroku appends. Empty if it can't be read.
    APP_URL="$(heroku apps:info -s -a "$APP_NAME" 2>/dev/null | grep '^web_url=' | cut -d= -f2- | sed 's:/*$::')"
}

# Configure required runtime config vars.
#
# HOST is CRITICAL: webServer.ts refuses to boot in production unless HOST is an
# absolute https:// origin (it is emitted verbatim as <link rel=canonical> and
# og:url on every page). Without it the web dyno crash-loops on startup.
configure_app() {
    echo "Configuring app..."

    resolve_app_url

    # NODE_ENV=production enables the strict HOST validation + production behavior.
    heroku config:set NODE_ENV=production -a "$APP_NAME"

    # Only set HOST if it isn't already configured, so a custom domain set on a
    # previous deploy isn't clobbered back to the herokuapp.com default.
    local current_host
    current_host="$(heroku config:get HOST -a "$APP_NAME")"
    if [ -n "$HOST_OVERRIDE" ]; then
        echo "Setting HOST=$HOST_OVERRIDE"
        heroku config:set HOST="$HOST_OVERRIDE" -a "$APP_NAME"
    elif [ -n "$current_host" ]; then
        echo "HOST already set to $current_host (leaving as-is)."
    elif [ -n "$APP_URL" ]; then
        echo "Setting HOST=$APP_URL"
        echo "  (pass --host=https://your-domain to use a custom domain)"
        heroku config:set HOST="$APP_URL" -a "$APP_NAME"
    else
        echo "Error: could not read the app's web URL from Heroku to set HOST."
        echo "       Re-run with --host=https://your-domain (or your *.herokuapp.com URL)."
        exit 1
    fi

    echo ""
}

# Build Docker image
build_image() {
    if [ "$SKIP_BUILD" = true ]; then
        echo "Skipping build (--skip-build specified)"
        return 0
    fi

    echo "Building web Docker image..."
    cd "$PROJECT_DIR"

    if [ ! -f "$PROJECT_DIR/data/GeoLite2-City.mmdb" ]; then
        echo "  Note: data/GeoLite2-City.mmdb not found - the image will use the"
        echo "        ipwho.is API fallback for IP -> location. To bake in local"
        echo "        GeoLite2 lookups, run 'pnpm download-geolite' (needs MaxMind"
        echo "        creds) before deploying."
    fi

    # Heroku dynos run linux/amd64; force the platform so this builds correctly
    # on Apple Silicon too.
    docker buildx build --platform linux/amd64 \
        -t "$IMAGE" \
        .

    echo ""
    echo "Image built successfully."
    echo ""
}

# Push image to Heroku
push_image() {
    echo "Pushing image to Heroku Container Registry..."
    docker push "$IMAGE"
    echo ""
}

# Release container
release_container() {
    echo "Releasing container: web"
    heroku container:release --app "$APP_NAME" web
    echo ""
}

# Deploy to Heroku
deploy() {
    build_image
    push_image
    release_container

    echo "========================================"
    echo "Deployment complete!"
    echo "========================================"
    echo ""
    echo "Your app is available at:"
    echo "  ${APP_URL:-https://$APP_NAME.herokuapp.com}"
    echo ""
    echo "Recommended add-on (the app degrades to direct fetches without it):"
    echo "  heroku addons:create heroku-redis:mini -a $APP_NAME   # sets REDIS_URL (rediss:// TLS handled)"
    echo ""
    echo "Optional enhancement keys (each widget hides itself when its key is absent):"
    echo "  heroku config:set -a $APP_NAME \\"
    echo "    MAXMIND_ACCOUNT_ID=... MAXMIND_LICENSE_KEY=... \\"
    echo "    AIRNOW_API_KEY=... TICKETMASTER_API_KEY=... SEATGEEK_CLIENT_ID=... \\"
    echo "    FOURSQUARE_API_KEY=... NPS_API_KEY=... RIDB_API_KEY=... \\"
    echo "    GOOGLE_POLLEN_API_KEY=... GOOGLE_CIVIC_API_KEY=... ANTHROPIC_API_KEY=..."
    echo ""
    echo "Health check:"
    echo "  curl -L ${APP_URL:-https://$APP_NAME.herokuapp.com}/healthz   # { ok, zips, mmdb, redis }"
    echo ""
    echo "View logs with:"
    echo "  heroku logs --tail -a $APP_NAME"
    echo ""
    echo "Scale the web dyno with:"
    echo "  heroku ps:scale web=1 -a $APP_NAME"
    echo ""
}

# Main
main() {
    check_prerequisites
    setup_heroku_app
    configure_app
    deploy
}

main
