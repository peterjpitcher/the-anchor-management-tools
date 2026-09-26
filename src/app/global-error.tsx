'use client';

import { useEffect } from 'react';
import {
  isChunkLoadFailure,
  recoverFromChunkFailure,
  retryPendingNavigation,
} from '@/components/features/shared/ChunkErrorReloader';
import { STAFF } from '@/lib/brand/palette';

/*
 * This page replaces the root layout, so the app stylesheet (and every Tailwind class) may not
 * be loaded when it shows, and the chunk-failure case is exactly when a stylesheet can fail to
 * arrive. It is styled inline instead, with the literal token values from STAFF in
 * src/lib/brand/palette.ts (pinned to src/app/globals.css by tests/ds/brand-palette.test.ts), and
 * drawn as the sign-in card (src/app/auth/_components/AuthCard.tsx): same card, title and
 * full-width primary button, so a crash looks like the rest of the standalone screens.
 */
const page: React.CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  margin: 0,
  background: STAFF.bg,
  color: STAFF.text,
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 384,
  padding: 36,
  boxSizing: 'border-box',
  background: STAFF.surface,
  border: `1px solid ${STAFF.border}`,
  borderRadius: 14,
  boxShadow: '0 12px 28px -8px rgba(15, 23, 42, 0.18)',
};

const heading: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '-0.015em',
  color: STAFF.textStrong,
};
const body: React.CSSProperties = { margin: '0 0 20px', fontSize: 13, color: STAFF.textMuted, lineHeight: 1.5 };

const button: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 16px',
  border: `1px solid ${STAFF.primary}`,
  borderRadius: 8,
  background: STAFF.primary,
  color: STAFF.primaryFg,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

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
      <html lang="en">
        <body style={{ margin: 0 }}>
          <div style={page}>
            <div style={{ ...card, textAlign: 'center' }}>
              <h1 style={heading}>Page Update Available</h1>
              <p style={body}>
                A new version of this page has been deployed. Please reload to continue.
              </p>
              <button type="button" style={button} onClick={retryPendingNavigation}>
                Reload Page
              </button>
            </div>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div style={page}>
          <div style={card}>
            <h1 style={heading}>Something Went Wrong</h1>
            <p style={body}>An unexpected error occurred. Please try again.</p>
            <button type="button" style={button} onClick={() => reset()}>
              Try Again
            </button>
            {process.env.NODE_ENV === 'development' && (
              <details style={{ marginTop: 24 }}>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: STAFF.textMuted }}>
                  Error details
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 8,
                    overflow: 'auto',
                    fontSize: 12,
                    background: STAFF.surface2,
                    borderRadius: 6,
                  }}
                >
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
