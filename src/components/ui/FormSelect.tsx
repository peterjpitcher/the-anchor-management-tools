'use client';

import React from 'react';

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helpText?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ label, error, helpText, options, placeholder, id, className = '', ...props }, ref) => {
    // Generate ID if not provided
    const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;
    
    return (
      <div>
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className={label ? 'mt-1' : ''}>
          <select
            ref={ref}
            id={selectId}
            className={`block w-full rounded-lg border ${
              error ? 'border-red-300' : 'border-gray-300'
            } px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px] ${
              props.disabled ? 'bg-gray-50 cursor-not-allowed' : ''
            } ${className}`}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? `${selectId}-error` : helpText ? `${selectId}-help` : undefined}
            {...props}
          >
            {placeholder && (
              <option value="">{placeholder}</option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {helpText && !error && (
          <p id={`${selectId}-help`} className="mt-1 text-xs text-gray-500">
            {helpText}
          </p>
        )}
        {error && (
          <p id={`${selectId}-error`} className="mt-1 text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    );
  }
);

FormSelect.displayName = 'FormSelect';

export { FormSelect };
export type { FormSelectProps };