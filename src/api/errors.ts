export interface ProblemError {
  parameter: string;
  detail: string;
}

export interface Problem {
  title: string;
  status: number;
  detail?: string;
  errors?: ProblemError[];
  /** Response headers the status requires, such as Allow on a 405. */
  headers?: Record<string, string>;
}

const PROBLEM_MEDIA_TYPE = 'application/problem+json';

/** An error with a documented status, rendered as RFC 9457 problem+json. */
export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }

  static badRequest(errors: ProblemError[]): ApiError {
    return new ApiError({
      title: 'Invalid request',
      status: 400,
      detail: errors.length === 1 ? errors[0].detail : `${errors.length} parameters were rejected`,
      errors,
    });
  }

  static notFound(detail: string): ApiError {
    return new ApiError({ title: 'Not found', status: 404, detail });
  }

  static forbidden(operation: string): ApiError {
    return new ApiError({
      title: 'Forbidden',
      status: 403,
      detail: `This request may not ${operation === 'list' || operation === 'get' ? 'read' : operation} here`,
    });
  }

  static conflict(detail: string): ApiError {
    return new ApiError({ title: 'Conflict', status: 409, detail });
  }

  static unprocessable(detail: string): ApiError {
    return new ApiError({ title: 'Unprocessable content', status: 422, detail });
  }

  static unsupportedMediaType(detail: string): ApiError {
    return new ApiError({ title: 'Unsupported media type', status: 415, detail });
  }

  static methodNotAllowed(method: string, allow: string): ApiError {
    return new ApiError({
      title: 'Method not allowed',
      status: 405,
      detail: `${method} is not supported here`,
      headers: { allow },
    });
  }
}

export function problemResponse(problem: Problem): Response {
  const { headers, ...body } = problem;
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { 'content-type': PROBLEM_MEDIA_TYPE, ...headers },
  });
}

/** A constraint the database refused to let the write break. */
export type ConstraintViolation = 'unique' | 'foreignKey' | 'notNull';

/**
 * Recognises a constraint violation across the three drivers, which report one
 * in three different ways: postgres by SQLSTATE, mysql by its own code, sqlite
 * only in the message.
 */
export function constraintViolation(error: unknown): ConstraintViolation | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, errno, message } = error as {
    code?: string | number;
    errno?: number;
    message?: string;
  };

  switch (code) {
    case '23505':
    case 'ER_DUP_ENTRY':
      return 'unique';
    case '23503':
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_ROW_IS_REFERENCED_2':
      return 'foreignKey';
    case '23502':
    case 'ER_BAD_NULL_ERROR':
      return 'notNull';
  }

  switch (errno) {
    case 1062:
      return 'unique';
    case 1451:
    case 1452:
      return 'foreignKey';
    case 1048:
      return 'notNull';
  }

  if (typeof message === 'string') {
    if (/unique constraint failed|duplicate key/i.test(message)) return 'unique';
    if (/foreign key constraint (failed|violation)/i.test(message)) return 'foreignKey';
    if (/not null constraint failed/i.test(message)) return 'notNull';
  }

  return undefined;
}

/**
 * Turns a refused write into the status that describes it, without repeating the
 * driver's message, which names columns and constraints the client may not know
 * about.
 */
export function writeError(error: unknown): ApiError | undefined {
  switch (constraintViolation(error)) {
    case 'unique':
      return ApiError.conflict('A row with these values already exists');
    case 'foreignKey':
      return ApiError.unprocessable('A referenced row does not exist, or is still referenced');
    case 'notNull':
      return ApiError.unprocessable('A required column was not given a value');
    default:
      return undefined;
  }
}

/**
 * Renders any thrown value as a problem document. Only ApiError details reach
 * the client; anything else is a bug or a database failure, whose message could
 * describe the schema, so it is logged and reported as a bare 500.
 */
export function errorResponse(error: unknown, onError?: (error: unknown) => void): Response {
  if (error instanceof ApiError) return problemResponse(error.problem);
  onError?.(error);
  return problemResponse({ title: 'Internal server error', status: 500 });
}
