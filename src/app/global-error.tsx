'use client';

import { useEffect } from 'react';
import {
  isChunkLoadFailure,
  recoverFromChunkFailure,
  retryPendingNavigation,
} from '@/components/features/shared/ChunkErrorReloader';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkErrorMessage = `${error?.name || ''}: ${error?.message || ''}`;
  const isChunkError = isChunkLoadFailure(chunkErrorMessage);

  useEffect(() => {
    if (isChunkError) {
      recoverFromChunkFailure(chunkErrorMessage);
    }
  }, [chunkErrorMessage, isChunkError]);

  if (isChunkError) {
    return (
      <html>
        <body>
          <div className="flex min-h-screen items-center justify-center bg-bg p-4">
            <div className="bg-surface p-8 rounded-sm shadow-sm max-w-md w-full text-center">
              <h2 className="text-2xl font-bold text-text mb-4">Page update available</h2>
              <p className="text-text-muted mb-6">
                A new version of this page has been deployed. Please reload to continue.
              </p>
              <button
                type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded-sm"
                onClick={retryPendingNavigation}
              >
                Reload page
              </button>
            </div>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center bg-bg p-4">
          <div className="bg-surface p-8 rounded-sm shadow-sm max-w-md w-full">
            <h2 className="text-2xl font-bold text-danger mb-4">Something went wrong!</h2>
            <p className="text-text-muted mb-6">An unexpected error occurred. Please try again.</p>
            <div className="flex gap-4">
              <button type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded-sm"
                onClick={() => reset()}
              >
                Try again
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-text-muted">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-surface-hover p-2 rounded-sm overflow-auto">
                  {error?.stack || 'No stack trace'}
                </pre>
              </details>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
