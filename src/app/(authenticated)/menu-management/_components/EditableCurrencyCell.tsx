'use client';

import { Spinner } from '@/components/ui-v2';
import { useInlineEdit } from './useInlineEdit';

interface EditableCurrencyCellProps {
  value: number;
  entityName: string;
  fieldLabel: string;
  onSave: (value: number) => Promise<{ success?: boolean; error?: string }>;
  onSaved?: () => void;
}

export function EditableCurrencyCell({
  value,
  entityName,
  fieldLabel,
  onSave,
  onSaved,
}: EditableCurrencyCellProps): React.ReactElement {
  const {
    isEditing,
    isSaving,
    editValue,
    error,
    startEditing,
    cancelEditing,
    setEditValue,
    saveValue,
    inputRef,
  } = useInlineEdit<number>({
    initialValue: value,
    onSave,
    onSaved,
  });

  if (isSaving) {
    return <Spinner size="sm" />;
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">£</span>
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            min="0"
            value={editValue}
            onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void saveValue();
              } else if (e.key === 'Escape') {
                cancelEditing();
              }
            }}
            onBlur={() => void saveValue()}
            className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
            aria-label={`Edit ${fieldLabel} for ${entityName}`}
          />
        </div>
        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={startEditing}
        className="rounded px-1 py-0.5 text-left text-sm hover:bg-muted transition-colors"
        aria-label={`Edit ${fieldLabel} for ${entityName}`}
      >
        £{value.toFixed(2)}
      </button>
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
