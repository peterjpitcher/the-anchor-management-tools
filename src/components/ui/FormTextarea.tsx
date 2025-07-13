'use client';

import React from 'react';

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, helpText, id, className = '', rows = 4, ...props }, ref) => {
    // Generate ID if not provided
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    
    return (
      <div>
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className={label ? 'mt-1' : ''}>
          <textarea
            ref={ref}
            id={textareaId}
            rows={rows}
            className={`block w-full rounded-lg border ${
              error ? 'border-red-300' : 'border-gray-300'
            } px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 ${
              props.disabled ? 'bg-gray-50 cursor-not-allowed' : ''
            } ${className}`}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${textareaId}-error` : helpText ? `${textareaId}-help` : undefined}
            {...props}
          />
        </div>
        {helpText && !error && (
          <p id={`${textareaId}-help`} className="mt-1 text-xs text-gray-500">
            {helpText}
          </p>
        )}
        {error && (
          <p id={`${textareaId}-error`} className="mt-1 text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    );
  }
);

FormTextarea.displayName = 'FormTextarea';

export { FormTextarea };
export type { FormTextareaProps };