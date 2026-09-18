'use client';

import { useEffect } from 'react';
import {
  isChunkLoadFailure,
  recoverFromChunkFailure,
  retryPendingNavigation,
} from '@/components/features/shared/ChunkErrorReloader';

/*
 * This page replaces the root layout, so the app stylesheet (and every Tailwind class) may not
 * be loaded when it shows, and the chunk-failure case is exactly when a stylesheet can fail to
 * arrive. It is styled inline with the design-token values from src/app/globals.css instead,
 * so it always renders in the app's colours. Keep these in step with the tokens.
 */
const TOKEN = {
  bg: '#fafaf9',
  surface: '#ffffff',
  border: '#ececea',
  text: '#1c1917',
  textMuted: '#57534e',
  primary: '#006A4E',
  primaryFg: '#ffffff',
  dangerFg: '#991b1b',
  surfaceHover: '#f5f5f4',
} as const;

const page: React.CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  margin: 0,
  background: TOKEN.bg,
  color: TOKEN.text,
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 448,
  padding: 32,
  background: TOKEN.surface,
  border: `1px solid ${TOKEN.border}`,
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 1px rgba(15, 23, 42, 0.04)',
};

const heading: React.CSSProperties = { margin: '0 0 16px', fontSize: 24, fontWeight: 700 };
const body: React.CSSProperties = { margin: '0 0 24px', color: TOKEN.textMuted, lineHeight: 1.5 };

const button: React.CSSProperties = {
  padding: '8px 16px',
  border: 0,
  borderRadius: 8,
  background: TOKEN.primary,
  color: TOKEN.primaryFg,
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
              <h2 style={heading}>Page update available</h2>
              <p style={body}>
                A new version of this page has been deployed. Please reload to continue.
              </p>
              <button type="button" style={button} onClick={retryPendingNavigation}>
                Reload page
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
            <h2 style={{ ...heading, color: TOKEN.dangerFg }}>Something went wrong!</h2>
            <p style={body}>An unexpected error occurred. Please try again.</p>
            <button type="button" style={button} onClick={() => reset()}>
              Try again
            </button>
            {process.env.NODE_ENV === 'development' && (
              <details style={{ marginTop: 24 }}>
                <summary style={{ cursor: 'pointer', fontSize: 14, color: TOKEN.textMuted }}>
                  Error details
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 8,
                    overflow: 'auto',
                    fontSize: 12,
                    background: TOKEN.surfaceHover,
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
