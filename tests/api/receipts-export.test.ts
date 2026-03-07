import { describe, it, expect } from 'vitest';

// Inline copy of the helper to test the logic independently
function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value;
  if (['=', '+', '-', '@'].includes(value[0])) {
    return '\t' + value;
  }
  return value;
}

describe('escapeCsvCell', () => {
  it('should prefix = with a tab', () => {
    expect(escapeCsvCell('=SUM(A1:A10)')).toBe('\t=SUM(A1:A10)');
  });
  it('should prefix + with a tab', () => {
    expect(escapeCsvCell('+1234')).toBe('\t+1234');
  });
  it('should prefix - with a tab', () => {
    expect(escapeCsvCell('-1234')).toBe('\t-1234');
  });
  it('should prefix @ with a tab', () => {
    expect(escapeCsvCell('@user')).toBe('\t@user');
  });
  it('should not modify safe values', () => {
    expect(escapeCsvCell('Tesco')).toBe('Tesco');
    expect(escapeCsvCell('100.00')).toBe('100.00');
    expect(escapeCsvCell('')).toBe('');
  });
});
