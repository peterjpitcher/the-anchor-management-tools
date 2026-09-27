'use client';

import { Button, Input, Spinner } from '@/ds';
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
          <span className="text-sm text-text-muted">£</span>
          <Input
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
            className="w-24"
            aria-label={`Edit ${fieldLabel} for ${entityName}`}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="xs" variant="primary" onClick={() => void saveValue()}>
            Save
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={cancelEditing}>
            Cancel
          </Button>
        </div>
        {error && (
          <span className="text-xs text-danger-fg">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* A compact ghost button showing the price: clicking it opens the inline editor. */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={startEditing}
        className="h-auto justify-start self-start px-1 py-0.5 text-sm font-normal"
        aria-label={`Edit ${fieldLabel} for ${entityName}`}
      >
        £{value.toFixed(2)}
      </Button>
      {error && (
        <span className="text-xs text-danger-fg">{error}</span>
      )}
    </div>
  );
}
