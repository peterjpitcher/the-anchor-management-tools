'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <nav className={cn('space-y-0 px-1', className)} aria-label="Sidebar">
      {children}
    </nav>
  );
}
