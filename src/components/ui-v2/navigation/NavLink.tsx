'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface NavLinkProps {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  variant?: 'dark' | 'light';
}

export function NavLink({ 
  href, 
  onClick, 
  children, 
  className,
  active = false,
  disabled = false,
  title,
  variant = 'light',
}: NavLinkProps) {
  const isDark = variant === 'dark';

  const baseClasses = cn(
    'inline-flex items-center gap-2 transition-colors duration-200',
    'border-b-2 border-transparent pb-0.5',
    // Dark variant styles
    isDark && 'text-white',
    isDark && !disabled && 'cursor-pointer hover:text-white/80 hover:border-white/60',
    isDark && active && 'border-white/80 text-white font-medium',
    // Light variant styles
    !isDark && 'text-gray-600',
    !isDark && !disabled && 'cursor-pointer hover:text-gray-900 hover:border-gray-400',
    !isDark && active && 'border-gray-900 text-gray-900 font-medium',
    // Disabled state
    disabled && 'opacity-50 cursor-not-allowed',
    className
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={baseClasses} title={title}>
        {children}
      </Link>
    );
  }

  if (onClick && !disabled) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClasses}
        title={title}
      >
        {children}
      </button>
    );
  }

  return (
    <span className={baseClasses} title={title} aria-disabled={disabled || undefined}>
      {children}
    </span>
  );
}
