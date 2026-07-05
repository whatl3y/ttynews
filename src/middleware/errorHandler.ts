import { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from "express";
import log from "../logger";
import { errorViewModel } from "../libs/presenter";

/** Wrap an async handler so thrown/rejected errors funnel to the terminal error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Terminal error handler - HTML error page for site routes, JSON for /api. Mounted LAST. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  log.error({ err, path: req.path }, "unhandled error");
  if (res.headersSent) return;
  if (req.path.startsWith("/api/")) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
  // errorViewModel supplies the metaTitle/metaDesc/canonicalPath locals that
  // layout.pug references - passing only { statusCode } would throw a pug
  // ReferenceError and cascade into a broken response from the terminal handler.
  res.status(500).render("error", errorViewModel(500));
};
