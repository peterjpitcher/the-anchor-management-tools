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
}

export function NavLink({ 
  href, 
  onClick, 
  children, 
  className,
  active = false 
}: NavLinkProps) {
  const baseClasses = cn(
    'text-white hover:text-white/80 cursor-pointer transition-colors duration-200',
    'border-b-2 border-transparent hover:border-white/60 pb-0.5',
    active && 'border-white/80 text-white font-medium',
    className
  );

  if (href) {
    return (
      <Link href={href} className={baseClasses}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={baseClasses}
    >
      {children}
    </button>
  );
}