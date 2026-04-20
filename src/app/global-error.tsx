'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = error?.name === 'ChunkLoadError' ||
    error?.message?.includes('Loading chunk') ||
    error?.message?.includes('Failed to fetch dynamically imported module');

  useEffect(() => {
    if (isChunkError) {
      const key = 'chunk-reload-attempted';
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    }
  }, [isChunkError]);

  if (isChunkError) {
    return (
      <html>
        <body>
          <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
            <div className="bg-white p-8 rounded shadow max-w-md w-full text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Page update available</h2>
              <p className="text-gray-600 mb-6">
                A new version of this page has been deployed. Please reload to continue.
              </p>
              <button
                type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={() => window.location.reload()}
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
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
          <div className="bg-white p-8 rounded shadow max-w-md w-full">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong!</h2>
            <p className="text-gray-600 mb-6">An unexpected error occurred. Please try again.</p>
            <div className="flex gap-4">
              <button type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={() => reset()}
              >
                Try again
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-gray-500">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
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
