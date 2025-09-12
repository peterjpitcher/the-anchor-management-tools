'use client';

import { Card, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';

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
        <div className="flex min-h-screen items-center justify-center bg-sidebar">
          <Card variant="elevated" className="max-w-md w-full">
            <div>
              <CardTitle className="text-2xl font-bold text-red-600 mb-4">
                Something went wrong!
              </CardTitle>
              <CardDescription className="text-gray-600 mb-6">
                We&apos;ve encountered an unexpected error. Please try again or contact support if the issue persists.
              </CardDescription>
              <div className="flex gap-4">
                <Button
                  variant="primary"
                  onClick={() => reset()}
                >
                  Try again
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => window.location.href = '/'}
                >
                  Go home
                </Button>
              </div>
              {process.env.NODE_ENV === 'development' && (
                <details className="mt-6">
                  <summary className="cursor-pointer text-sm text-gray-500">
                    Error details (development only)
                  </summary>
                  <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                    {error.stack}
                  </pre>
                </details>
              )}
            </div>
          </Card>
        </div>
      </body>
    </html>
  );
}
