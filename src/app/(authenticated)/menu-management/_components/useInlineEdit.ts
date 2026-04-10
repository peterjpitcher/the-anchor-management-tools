'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseInlineEditOptions<T> {
  initialValue: T;
  onSave: (value: T) => Promise<{ success?: boolean; error?: string }>;
  onSaved?: () => void;
}

interface UseInlineEditReturn<T> {
  isEditing: boolean;
  isSaving: boolean;
  editValue: T;
  error: string | null;
  startEditing: () => void;
  cancelEditing: () => void;
  setEditValue: (value: T) => void;
  saveValue: () => Promise<void>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function useInlineEdit<T>(options: UseInlineEditOptions<T>): UseInlineEditReturn<T> {
  const { initialValue, onSave, onSaved } = options;

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editValue, setEditValue] = useState<T>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync with external value changes when not editing
  useEffect(() => {
    if (!isEditing && !isSaving) {
      setEditValue(initialValue);
    }
  }, [initialValue, isEditing, isSaving]);

  const startEditing = useCallback(() => {
    setEditValue(initialValue);
    setError(null);
    setIsEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [initialValue]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValue(initialValue);
    setError(null);
  }, [initialValue]);

  const saveValue = useCallback(async () => {
    // Skip save if value unchanged
    if (editValue === initialValue) {
      setIsEditing(false);
      setError(null);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await onSave(editValue);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
        onSaved?.();
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsSaving(false);
    }
  }, [editValue, initialValue, onSave, onSaved]);

  return {
    isEditing,
    isSaving,
    editValue,
    error,
    startEditing,
    cancelEditing,
    setEditValue,
    saveValue,
    inputRef,
  };
}
