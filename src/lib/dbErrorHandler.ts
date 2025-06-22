import { PostgrestError } from '@supabase/supabase-js';

/**
 * Maps database constraint errors to user-friendly messages
 */
export function getConstraintErrorMessage(error: PostgrestError): string {
  const { code, message } = error;

  // Check constraint violations
  if (code === '23514') {
    if (message.includes('chk_employee_email_format')) {
      return 'Please enter a valid email address';
    }
    if (message.includes('chk_customer_phone_format') || 
        message.includes('chk_employee_phone_format') || 
        message.includes('chk_emergency_phone_format')) {
      return 'Please enter a valid UK phone number (e.g., 07700900123 or +447700900123)';
    }
    if (message.includes('chk_employment_dates')) {
      return 'Employment end date must be after the start date';
    }
    if (message.includes('chk_date_of_birth')) {
      return 'Please enter a valid date of birth';
    }
    if (message.includes('chk_employee_status')) {
      return 'Employee status must be either "Active" or "Former"';
    }
    if (message.includes('chk_employee_name_length') || message.includes('chk_customer_name_length')) {
      return 'Names must be 100 characters or less';
    }
    if (message.includes('chk_email_length')) {
      return 'Email address must be 255 characters or less';
    }
    if (message.includes('chk_bank_details')) {
      return 'Please enter valid UK bank details (8-digit account number and 6-digit sort code)';
    }
    if (message.includes('chk_event_date_reasonable')) {
      return 'Event date cannot be more than 1 year in the past';
    }
    if (message.includes('chk_booking_seats')) {
      return 'Number of seats cannot be negative';
    }
    if (message.includes('chk_message_direction')) {
      return 'Invalid message direction';
    }
  }

  // Unique constraint violations
  if (code === '23505') {
    if (message.includes('email')) {
      return 'This email address is already in use';
    }
    if (message.includes('mobile_number')) {
      return 'This phone number is already registered';
    }
  }

  // Foreign key violations
  if (code === '23503') {
    return 'Related record not found';
  }

  // Not null violations
  if (code === '23502') {
    if (message.includes('first_name')) {
      return 'First name is required';
    }
    if (message.includes('last_name')) {
      return 'Last name is required';
    }
    if (message.includes('email_address')) {
      return 'Email address is required';
    }
  }

  // Default message
  return 'Invalid data provided. Please check your input and try again.';
}

/**
 * Checks if an error is a PostgreSQL error
 */
export function isPostgrestError(error: unknown): error is PostgrestError {
  return error !== null && typeof error === 'object' && 'code' in error && 'message' in error;
}