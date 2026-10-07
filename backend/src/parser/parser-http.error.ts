/**
 * A non-2xx answer from a supplier, carrying the status so callers can tell
 * "try again later" from "this product is gone".
 *
 * Parsers used to throw a plain `Error("Failed to fetch …: 404")`, which made
 * every failure look the same: a removed product stayed FAILED forever while
 * its card kept its old price and in-stock flag on the storefront.
 */
export class ParserHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Failed to fetch ${url}: ${status}`);
    this.name = 'ParserHttpError';
  }

  /** The supplier says this URL no longer exists — delist, don't retry. */
  get isGone() {
    return this.status === 404 || this.status === 410;
  }
}

export function isGoneError(error: unknown): error is ParserHttpError {
  return error instanceof ParserHttpError && error.isGone;
}
