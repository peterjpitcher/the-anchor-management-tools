'use client';

import { useState } from 'react';
import * as Sentry from '@sentry/nextjs';

export function SentryTestButton() {
  const [isLoading, setIsLoading] = useState(false);

  const testSentry = async () => {
    setIsLoading(true);
    try {
      // Test different types of errors
      const errorType = Math.random();
      
      if (errorType < 0.33) {
        // Test unhandled error
        throw new Error('Test error: This is a test error from Sentry test button');
      } else if (errorType < 0.66) {
        // Test handled error with context
        const error = new Error('Test error: Handled error with extra context');
        Sentry.captureException(error, {
          tags: {
            section: 'sentry-test',
            test_type: 'manual',
          },
          extra: {
            timestamp: new Date().toISOString(),
            user_action: 'clicked_test_button',
          },
        });
        alert('Handled error sent to Sentry!');
      } else {
        // Test message
        Sentry.captureMessage('Test message: Sentry integration is working!', 'info');
        alert('Test message sent to Sentry!');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={testSentry}
      disabled={isLoading}
      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-red-300 transition-colors"
    >
      {isLoading ? 'Sending...' : 'Test Sentry Integration'}
    </button>
  );
}