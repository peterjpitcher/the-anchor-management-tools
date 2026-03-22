/**
 * Safely extracts an error message from an unknown error value.
 * Use this in catch blocks instead of `catch (error: any)` to maintain type safety.
 *
 * TODO: Migrate remaining ~140 `catch (error: any)` occurrences across the codebase
 * to use `catch (error: unknown)` with this utility. Priority files have been migrated;
 * the rest should be updated incrementally.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}
