export class TableBookingActionError extends Error {
  payload: Record<string, unknown> | null;

  constructor(message: string, payload: Record<string, unknown> | null) {
    super(message);
    this.payload = payload;
  }
}

type TableBookingActionOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  headers?: HeadersInit;
};

export async function requestTableBookingAction<T = Record<string, unknown> | null>(
  path: string,
  options: TableBookingActionOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    method: options.method || 'POST',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok) {
    const errorMessage = payload && typeof payload.error === 'string'
      ? payload.error
      : 'Action failed';
    throw new TableBookingActionError(errorMessage, payload);
  }

  return payload as T;
}

export function postTableBookingAction(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return requestTableBookingAction(path, { method: 'POST', body });
}
