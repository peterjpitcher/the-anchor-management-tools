'use client';

import { useState, useCallback } from 'react';
import { Spinner, StatusBadge } from '@/components/ui-v2';

interface StatusToggleCellProps {
  isActive: boolean;
  entityName: string;
  onToggle: () => Promise<{ success?: boolean; error?: string; data?: { is_active: boolean } }>;
  onToggled?: () => void;
}

export function StatusToggleCell({
  isActive,
  entityName,
  onToggle,
  onToggled,
}: StatusToggleCellProps): React.ReactElement {
  const [optimisticActive, setOptimisticActive] = useState(isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with external prop when not saving
  // Using a ref to track previous isActive to avoid unnecessary state updates
  const syncedRef = useState({ prev: isActive })[0];
  if (!isSaving && syncedRef.prev !== isActive) {
    syncedRef.prev = isActive;
    // This is safe because we only set state when the prop actually changed
    // and we're not in a saving state
    setOptimisticActive(isActive);
    setError(null);
  }

  const handleToggle = useCallback(async () => {
    if (isSaving) return;

    const previousValue = optimisticActive;
    setOptimisticActive(!previousValue);
    setIsSaving(true);
    setError(null);

    try {
      const result = await onToggle();
      if (result.error) {
        // Roll back on error
        setOptimisticActive(previousValue);
        setError(result.error);
      } else {
        // Use server-returned value if available, otherwise keep optimistic
        if (result.data !== undefined) {
          setOptimisticActive(result.data.is_active);
        }
        onToggled?.();
      }
    } catch {
      setOptimisticActive(previousValue);
      setError('An unexpected error occurred');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, optimisticActive, onToggle, onToggled]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={isSaving}
        className="inline-flex items-center gap-2 rounded transition-colors hover:bg-muted px-1 py-0.5 disabled:opacity-50"
        aria-label={`Toggle ${entityName} ${optimisticActive ? 'active' : 'inactive'}`}
      >
        <StatusBadge status={optimisticActive ? 'active' : 'inactive'} />
        {isSaving && <Spinner size="sm" />}
      </button>
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
