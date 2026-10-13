export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, 'bad_request', message);
}

export function notFound(message: string): AppError {
  return new AppError(404, 'not_found', message);
}

export function conflict(message: string): AppError {
  return new AppError(409, 'conflict', message);
}
