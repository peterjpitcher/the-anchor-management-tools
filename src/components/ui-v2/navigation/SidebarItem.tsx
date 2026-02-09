'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SidebarItemProps {
  href?: string;
  onClick?: () => void;
  icon?: React.ElementType;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  badge?: React.ReactNode;
}

export function SidebarItem({
  href,
  onClick,
  icon: Icon,
  children,
  active = false,
  disabled = false,
  className,
  badge,
}: SidebarItemProps) {
  const baseClasses = cn(
    'sidebar-item group flex w-full min-h-10 items-center justify-start rounded-md px-2 py-1 text-left text-sm font-medium transition-colors duration-150',
    active
      ? 'bg-green-700 text-white'
      : 'text-gray-100 hover:bg-green-700 hover:text-white',
    disabled && 'opacity-50 cursor-not-allowed',
    className
  );

  const iconClasses = cn(
    'mr-3 h-6 w-6',
    active ? 'text-white' : 'text-green-200 group-hover:text-white'
  );

  const content = (
    <>
      {Icon && <Icon className={iconClasses} aria-hidden="true" />}
      <span className="flex-1 truncate whitespace-nowrap">{children}</span>
      {badge}
    </>
  );

  const commonProps = {
    className: baseClasses,
    title: typeof children === 'string' ? children : undefined,
    'aria-disabled': disabled,
    'aria-current': active ? 'page' as const : undefined,
  };

  if (href && !disabled) {
    return (
      <Link href={href} {...commonProps}>
        {content}
      </Link>
    );
  }

  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} {...commonProps}>
        {content}
      </button>
    );
  }

  return (
    <div {...commonProps} role="button" aria-disabled="true">
      {content}
    </div>
  );
}
