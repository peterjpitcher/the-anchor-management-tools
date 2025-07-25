import React from 'react';
import { cn } from '@/lib/utils';

interface PageContentProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContent({ children, className }: PageContentProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)}>
      <div className="container mx-auto p-6">
        {children}
      </div>
    </div>
  );
}