'use client';

import React from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'default';
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ 
  variant = 'default', 
  size = 'sm', 
  children, 
  className = '' 
}) => {
  // Base styles
  const baseStyles = 'inline-flex items-center font-medium rounded-full';
  
  // Size styles
  let sizeStyles = '';
  switch (size) {
    case 'sm':
      sizeStyles = 'px-2.5 py-0.5 text-xs';
      break;
    case 'md':
      sizeStyles = 'px-3 py-1 text-sm';
      break;
  }
  
  // Variant styles following UI standards
  let variantStyles = '';
  switch (variant) {
    case 'success':
      variantStyles = 'bg-green-100 text-green-800';
      break;
    case 'warning':
      variantStyles = 'bg-yellow-100 text-yellow-800';
      break;
    case 'error':
      variantStyles = 'bg-red-100 text-red-800';
      break;
    case 'info':
      variantStyles = 'bg-blue-100 text-blue-800';
      break;
    case 'neutral':
      variantStyles = 'bg-gray-100 text-gray-800';
      break;
    case 'default':
      variantStyles = 'bg-gray-100 text-gray-600';
      break;
  }
  
  return (
    <span className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}>
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';

export { Badge };
export type { BadgeProps };