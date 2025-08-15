'use client';

import React from 'react';

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export function PageWrapper({ children, className = '' }: PageWrapperProps) {
  return (
    <div className={`-mx-2 sm:-mx-6 -mt-2 sm:-mt-6 ${className}`}>
      {children}
    </div>
  );
}

export function PageContent({ children, className = '' }: PageWrapperProps) {
  return (
    <div className={`px-2 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 ${className}`}>
      {children}
    </div>
  );
}