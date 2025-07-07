'use client';

import React from 'react';

interface StatusIndicatorProps {
  status: 'active' | 'inactive' | 'pending' | 'error' | 'success' | 'warning';
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string; // Custom label override
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ 
  status,
  showLabel = true,
  size = 'md',
  className = '',
  label
}) => {
  // Status configurations
  const statusConfig = {
    active: {
      label: 'Active',
      dotColor: 'bg-green-500',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800'
    },
    inactive: {
      label: 'Inactive',
      dotColor: 'bg-gray-400',
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-800'
    },
    pending: {
      label: 'Pending',
      dotColor: 'bg-yellow-500',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800'
    },
    error: {
      label: 'Error',
      dotColor: 'bg-red-500',
      bgColor: 'bg-red-100',
      textColor: 'text-red-800'
    },
    success: {
      label: 'Success',
      dotColor: 'bg-green-500',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800'
    },
    warning: {
      label: 'Warning',
      dotColor: 'bg-yellow-500',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800'
    }
  };
  
  const config = statusConfig[status];
  const displayLabel = label || config.label;
  
  // Size styles
  let sizeStyles = {
    dot: '',
    text: '',
    padding: ''
  };
  
  switch (size) {
    case 'sm':
      sizeStyles = {
        dot: 'h-2 w-2',
        text: 'text-xs',
        padding: 'px-2 py-0.5'
      };
      break;
    case 'md':
      sizeStyles = {
        dot: 'h-2.5 w-2.5',
        text: 'text-sm',
        padding: 'px-2.5 py-0.5'
      };
      break;
    case 'lg':
      sizeStyles = {
        dot: 'h-3 w-3',
        text: 'text-base',
        padding: 'px-3 py-1'
      };
      break;
  }
  
  if (!showLabel) {
    return (
      <span 
        className={`inline-flex items-center justify-center ${className}`}
        aria-label={displayLabel}
      >
        <span className={`${sizeStyles.dot} ${config.dotColor} rounded-full`} />
      </span>
    );
  }
  
  return (
    <span 
      className={`inline-flex items-center ${sizeStyles.padding} rounded-full ${config.bgColor} ${className}`}
    >
      <span className={`${sizeStyles.dot} ${config.dotColor} rounded-full mr-1.5`} />
      <span className={`${sizeStyles.text} font-medium ${config.textColor}`}>
        {displayLabel}
      </span>
    </span>
  );
};

StatusIndicator.displayName = 'StatusIndicator';

export { StatusIndicator };
export type { StatusIndicatorProps };