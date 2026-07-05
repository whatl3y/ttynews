import zlib from "zlib";
import { Request, Response, NextFunction } from "express";

// Below ~1 MTU there is nothing to gain - the gzip header/overhead can exceed
// the savings, so leave tiny payloads (redirects, small JSON errors) alone.
const MIN_BYTES = 860;

/**
 * Zero-dependency gzip for text responses. We wrap res.send - which res.render
 * and res.json both funnel through - instead of pulling in the `compression`
 * package, so this relies only on Node's built-in zlib. Static assets (fonts,
 * favicon) are streamed by express.static and bypass this entirely; the woff
 * is already compressed and the CSS is inlined into the HTML we do gzip.
 *
 * NOTE: siteUrl (hence canonical/og:url) is derived from config, never from the
 * request Host header, so compressing cached responses carries no cache-poison
 * risk.
 */
export function compression(req: Request, res: Response, next: NextFunction): void {
  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  const originalSend = res.send.bind(res);

  res.send = function (body?: unknown): Response {
    if (
      acceptsGzip &&
      !res.headersSent &&
      !res.getHeader("Content-Encoding") &&
      (typeof body === "string" || Buffer.isBuffer(body))
    ) {
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(body as string, "utf8");
      if (raw.length >= MIN_BYTES) {
        try {
          // Preserve the Content-Type express would infer for a string body
          // (HTML by default). We hand express a Buffer, which it would
          // otherwise label application/octet-stream - so pin the type first.
          if (typeof body === "string" && !res.getHeader("Content-Type")) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
          }
          const gz = zlib.gzipSync(raw);
          res.setHeader("Content-Encoding", "gzip");
          res.vary("Accept-Encoding");
          // Let express recompute Content-Length/ETag from the gzipped buffer.
          return originalSend(gz);
        } catch {
          /* fall through and send uncompressed */
        }
      }
    }
    return originalSend(body as never);
  } as Response["send"];

  next();
}
