'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  asChild?: boolean; // For using with Next.js Link or other wrapper components
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, asChild = false, ...props }, ref) => {
    const Comp = asChild ? 'span' : 'button'; // Render a span if asChild is true, button otherwise

    // Base styles with standard focus states and minimum touch target
    const baseStyles = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-h-[44px] active:scale-95 active:transition-transform';

    // Variant styles using standard Tailwind classes
    let variantStyles = '';
    switch (variant) {
      case 'primary':
        variantStyles = 'bg-green-600 text-white shadow-sm hover:bg-green-700 focus:ring-green-500';
        break;
      case 'secondary':
        variantStyles = 'bg-white text-gray-700 border border-gray-300 shadow-sm hover:bg-gray-50 focus:ring-green-500';
        break;
      case 'outline':
        variantStyles = 'border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:ring-green-500';
        break;
      case 'ghost':
        variantStyles = 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 focus:ring-green-500';
        break;
      case 'link':
        variantStyles = 'text-blue-600 underline-offset-4 hover:text-blue-900 hover:underline focus:ring-green-500';
        break;
      case 'destructive':
        variantStyles = 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus:ring-red-500';
        break;
    }

    // Size styles with proper padding
    let sizeStyles = '';
    switch (size) {
      case 'sm':
        sizeStyles = 'px-4 py-2.5 sm:py-2 text-sm min-w-[80px]';
        break;
      case 'md':
        sizeStyles = 'px-6 py-3 md:py-2.5 text-base md:text-sm min-w-[100px]';
        break;
      case 'lg':
        sizeStyles = 'px-8 py-3.5 md:py-3 text-base min-w-[120px]';
        break;
    }
    
    return (
      <Comp
        className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps }; 