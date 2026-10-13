/** An error with an HTTP status and a message that is safe to show users. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what)
export const forbidden = (why = 'You can’t do that.') => new HttpError(403, why)
export const badRequest = (why: string) => new HttpError(400, why)
export const conflict = (why: string) => new HttpError(409, why)
export const unauthorized = () => new HttpError(401, 'Sign in first.')
