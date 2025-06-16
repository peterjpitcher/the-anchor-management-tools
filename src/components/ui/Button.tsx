'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  asChild?: boolean; // For using with Next.js Link or other wrapper components
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, asChild = false, ...props }, ref) => {
    const Comp = asChild ? 'span' : 'button'; // Render a span if asChild is true, button otherwise

    // Base styles
    const baseStyles = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background whitespace-nowrap';

    // Variant styles
    let variantStyles = '';
    switch (variant) {
      case 'primary':
        variantStyles = 'bg-primary text-primary-foreground hover:bg-primary/90';
        break;
      case 'secondary':
        variantStyles = 'bg-gray-200 text-gray-800 hover:bg-gray-300/90';
        break;
      case 'outline':
        variantStyles = 'border border-input hover:bg-accent hover:text-accent-foreground';
        break;
      case 'ghost':
        variantStyles = 'hover:bg-accent hover:text-accent-foreground';
        break;
      case 'link':
        variantStyles = 'underline-offset-4 hover:underline text-primary';
        break;
    }

    // Size styles
    let sizeStyles = '';
    switch (size) {
      case 'sm':
        sizeStyles = 'h-9 px-3 rounded-md';
        break;
      case 'md':
        sizeStyles = 'h-10 py-2 px-4';
        break;
      case 'lg':
        sizeStyles = 'h-11 px-8 rounded-md';
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