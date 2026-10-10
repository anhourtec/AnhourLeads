/** Errors services throw; `route()` maps them to HTTP responses with a plain message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, message);
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, message);
/** Out-of-scope ids are reported as not found, never as forbidden, so other tenants' ids don't leak. */
export const notFound = (message = "Not found.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const tooManyRequests = (message = "Too many requests. Try again shortly.") => new HttpError(429, message);
