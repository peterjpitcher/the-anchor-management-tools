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
}

export function NavLink({ 
  href, 
  onClick, 
  children, 
  className,
  active = false,
  disabled = false,
  title,
}: NavLinkProps) {
  const baseClasses = cn(
    'inline-flex items-center gap-2 text-white transition-colors duration-200',
    'border-b-2 border-transparent pb-0.5',
    !disabled && 'cursor-pointer hover:text-white/80 hover:border-white/60',
    disabled && 'opacity-50 cursor-not-allowed',
    active && 'border-white/80 text-white font-medium',
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
