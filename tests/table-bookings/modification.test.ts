import { describe, expect, it } from 'vitest';
import { withIncrementedModificationCount } from '@/lib/table-bookings/modification';

describe('withIncrementedModificationCount', () => {
  it('increments from zero when current count is undefined', () => {
    const result = withIncrementedModificationCount({}, undefined);
    expect(result.modification_count).toBe(1);
  });

  it('increments existing count', () => {
    const result = withIncrementedModificationCount({}, 3);
    expect(result.modification_count).toBe(4);
  });

  it('preserves original update fields', () => {
    const payload = { party_size: 6, special_requirements: 'Window seat' };
    const result = withIncrementedModificationCount(payload, 1);
    expect(result.party_size).toBe(6);
    expect(result.special_requirements).toBe('Window seat');
  });
});

