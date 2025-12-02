'use client';

import React from 'react';

interface NavGroupProps {
  children: React.ReactNode;
  separator?: React.ReactNode;
  variant?: 'dark' | 'light';
}

export function NavGroup({ children, separator, variant = 'light' }: NavGroupProps) {
  const items = React.Children.toArray(children).filter(Boolean);
  const defaultSeparator = variant === 'dark' 
    ? <span className="text-white/40">|</span> 
    : <span className="text-gray-300">|</span>;
  
  const sep = separator || defaultSeparator;
  
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {child}
          {index < items.length - 1 && (
            <span className="hidden sm:inline" aria-hidden="true">
              {sep}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}