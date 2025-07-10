'use client';

import { useState } from 'react';
import { BugAntIcon } from '@heroicons/react/24/outline';
import { BugReporter } from './BugReporter';

export function BugReporterButton() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-3 bg-red-600 text-white rounded-full shadow-lg hover:bg-red-700 transition-colors z-40"
        title="Report a bug"
      >
        <BugAntIcon className="h-6 w-6" />
      </button>
      
      <BugReporter isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}