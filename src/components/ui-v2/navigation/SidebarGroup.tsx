'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SidebarGroupProps {
  children: React.ReactNode;
  className?: string;
  showDivider?: boolean;
  title?: string;
}

export function SidebarGroup({
  children,
  className,
  showDivider = false,
  title,
}: SidebarGroupProps) {
  if (React.Children.count(children) === 0) {
    return null;
  }

  return (
    <div className={cn(showDivider && 'pt-0.5', className)}>
      {showDivider && (
        <hr className="mx-1.5 mb-0.5 border-t border-green-600 opacity-75" />
      )}
      {title && (
        <h3 className="mb-0.5 px-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {title}
        </h3>
      )}
      <div className="space-y-0">
        {children}
      </div>
    </div>
  );
}
