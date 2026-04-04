export class HttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message, "bad_request");
}

export function unauthorized(message = "unauthorized"): HttpError {
  return new HttpError(401, message, "unauthorized");
}

export function serviceUnavailable(message: string): HttpError {
  return new HttpError(503, message, "service_unavailable");
}
