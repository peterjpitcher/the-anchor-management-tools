export function withIncrementedModificationCount<T extends Record<string, unknown>>(
  updates: T,
  currentCount?: number | null,
) {
  const nextCount = (currentCount ?? 0) + 1;
  return {
    ...updates,
    modification_count: nextCount,
  };
}

