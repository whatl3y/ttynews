(function () {
  "use strict";

  // ── Ticking clock in the zip's timezone ─────────────────────────────────
  var clock = document.getElementById("clock");
  if (clock && clock.dataset.tz && window.Intl) {
    try {
      var timeFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: clock.dataset.tz,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      var tick = function () {
        clock.textContent = timeFmt.format(new Date());
      };
      tick();
      setInterval(tick, 1000);
    } catch (e) {
      /* unknown timezone - keep the server-rendered time */
    }
  }

  // ── Relative-time refresh every 60s ─────────────────────────────────────
  function formatRel(iso) {
    var seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.round(hours / 24) + "d ago";
  }
  function refreshRelTimes() {
    var nodes = document.querySelectorAll("time[data-reltime]");
    for (var i = 0; i < nodes.length; i++) {
      var iso = nodes[i].getAttribute("datetime");
      if (iso) nodes[i].textContent = formatRel(iso);
    }
  }
  setInterval(refreshRelTimes, 60000);

  // The location input accepts a zip OR "city, state"; the server resolves it,
  // so no client-side filtering is needed (Enter submits natively).

  // ── Reload stale pages when the tab returns to focus ────────────────────
  var loadedAt = Date.now();
  var STALE_MS = 15 * 60 * 1000;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - loadedAt > STALE_MS) {
      location.reload();
    }
  });
})();
