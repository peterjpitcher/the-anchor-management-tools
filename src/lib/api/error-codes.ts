// Standard error codes for API responses
export const API_ERROR_CODES = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_MENU_ITEMS: 'INVALID_MENU_ITEMS',
  INVALID_MEAL_SELECTION: 'INVALID_MEAL_SELECTION',
  INVALID_DATE_TIME: 'INVALID_DATE_TIME',
  
  // Availability errors
  NO_AVAILABILITY: 'NO_AVAILABILITY',
  KITCHEN_CLOSED: 'KITCHEN_CLOSED',
  BOOKING_CUTOFF_PASSED: 'BOOKING_CUTOFF_PASSED',
  
  // Capacity errors
  INSUFFICIENT_CAPACITY: 'INSUFFICIENT_CAPACITY',
  OVERBOOKED: 'OVERBOOKED',
  
  // Payment errors
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_TIMEOUT: 'PAYMENT_TIMEOUT',
  
  // Policy violations
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  MINIMUM_NOTICE_REQUIRED: 'MINIMUM_NOTICE_REQUIRED',
  MAXIMUM_ADVANCE_EXCEEDED: 'MAXIMUM_ADVANCE_EXCEEDED',
  
  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  
  // General errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];

// Standard error response structure
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: any;
    correlation_id?: string;
    timestamp: string;
  };
}

// Helper to create consistent error responses
export function createApiError(
  code: ApiErrorCode,
  message: string,
  details?: any,
  correlationId?: string
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      details,
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
    }
  };
}