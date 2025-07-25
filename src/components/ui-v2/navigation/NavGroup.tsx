'use client';

import React from 'react';

interface NavGroupProps {
  children: React.ReactNode;
  separator?: React.ReactNode;
}

export function NavGroup({ children, separator = <span className="text-white/40">|</span> }: NavGroupProps) {
  const items = React.Children.toArray(children).filter(Boolean);
  
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {child}
          {index < items.length - 1 && (
            <span className="text-white/40 hidden sm:inline" aria-hidden="true">
              {separator}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}