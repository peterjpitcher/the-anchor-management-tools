// src/types/actions.ts

// A generic type for form state handled by useActionState
// It can be null for the initial state.
// It can be a success or error object.
// The `errors` property is compatible with Zod's `flatten().fieldErrors`
export type ActionFormState = {
  type: 'success' | 'error';
  message: string;
  employeeId?: string; // Optional employeeId for success responses
  errors?: {
    [key: string]: string[] | undefined;
  } | null;
} | null;


// More specific state for the Note form
export type NoteFormState = {
  type: 'success' | 'error';
  message: string;
  errors?: {
    general?: string[];
    note_text?: string[];
    employee_id?: string[];
  } | null;
} | null;


// More specific state for the Attachment form
export type AttachmentFormState = {
  type: 'success' | 'error';
  message: string;
  errors?: Record<string, string[]>;
} | null;


// A simple state for actions that just succeed or fail, like deletion.
export type DeleteState = {
  type: 'success' | 'error';
  message: string;
  errors?: Record<string, unknown>;
} | null; 