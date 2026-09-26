'use client';

import { useEffect } from 'react';
import { Button, Empty } from '@/ds';
import {
  isChunkLoadFailure,
  recoverFromChunkFailure,
  retryPendingNavigation,
} from '@/components/features/shared/ChunkErrorReloader';

export default function AuthenticatedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkErrorMessage = `${error.name || ''}: ${error.message || ''}`;
  const isChunkError = isChunkLoadFailure(chunkErrorMessage);

  useEffect(() => {
    if (isChunkError) {
      recoverFromChunkFailure(chunkErrorMessage);
    }
  }, [chunkErrorMessage, isChunkError]);

  // min-h-[50vh] centres the message in the page area, as the route loading state does.
  if (isChunkError) {
    return (
      <Empty
        className="min-h-[50vh]"
        title="Page update available"
        description="A new version of this page has been deployed. Please reload to continue."
        action={
          <Button type="button" onClick={retryPendingNavigation}>
            Reload Page
          </Button>
        }
      />
    );
  }

  return (
    <Empty
      className="min-h-[50vh]"
      title="Something went wrong"
      description="An error occurred while loading this page. Please try again."
      action={
        <Button type="button" onClick={reset}>
          Try Again
        </Button>
      }
    >
      {error.digest && (
        <p className="mt-3 text-xs text-text-muted">Error ID: {error.digest}</p>
      )}
    </Empty>
  );
}
