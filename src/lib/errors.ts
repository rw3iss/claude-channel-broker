export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id?: string) {
    super(
      'not_found',
      id ? `${what} not found: ${id}` : `${what} not found`,
      404,
    );
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'unauthorized') {
    super('unauthorized', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class TimeoutError extends DomainError {
  constructor(message = 'timeout') {
    super('timeout', message, 504);
    this.name = 'TimeoutError';
  }
}
