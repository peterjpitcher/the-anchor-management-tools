'use client';

import React from 'react';

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export function PageWrapper({ children, className = '' }: PageWrapperProps) {
  return (
    <div className={`-mx-6 -mt-6 ${className}`}>
      {children}
    </div>
  );
}

export function PageContent({ children, className = '' }: PageWrapperProps) {
  return (
    <div className={`px-6 sm:px-8 lg:px-12 py-8 ${className}`}>
      {children}
    </div>
  );
}