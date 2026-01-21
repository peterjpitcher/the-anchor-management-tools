'use client';

// import { Card, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
// import { Button } from '@/components/ui-v2/forms/Button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
          <div className="bg-white p-8 rounded shadow max-w-md w-full">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong!</h2>
            <p className="text-gray-600 mb-6">Global Error Handler</p>
            <div className="flex gap-4">
              <button
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
                  {/* Accessing error.stack might be risky if error is null, but usually ok */}
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
