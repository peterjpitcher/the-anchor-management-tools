/**
 * Safely extracts an error message from an unknown error value.
 * Use this in catch blocks with `catch (error: unknown)` to maintain type safety.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}

/**
 * Safely extracts an error code from an unknown error value.
 * Works with Google API errors, Supabase errors, and other libraries
 * that attach a `code` property to Error objects.
 */
export function getErrorCode(error: unknown): string | number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code: string | number }).code;
  }
  return undefined;
}

/**
 * Safely extracts a status code from an unknown error value.
 * Works with HTTP client errors that attach `statusCode` or `status`.
 */
export function getErrorStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    if ('statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number') {
      return (error as { statusCode: number }).statusCode;
    }
    if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
      return (error as { status: number }).status;
    }
  }
  return undefined;
}

/**
 * Type guard to check if an error is a Zod-like validation error with an `errors` array.
 */
export function isValidationError(error: unknown): error is { errors: Array<{ message: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors)
  );
}

/**
 * Safely extracts error details array from an unknown error value.
 * Works with Google API errors and other libraries that attach an `errors` array.
 */
export function getErrorDetails(error: unknown): unknown[] | undefined {
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const val = (error as { errors: unknown }).errors;
    if (Array.isArray(val)) return val;
  }
  return undefined;
}
