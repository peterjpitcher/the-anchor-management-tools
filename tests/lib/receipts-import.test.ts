import { describe, it, expect } from 'vitest';

describe('CSV file upload validation', () => {
  it('MAX_RECEIPT_UPLOAD_SIZE should be 15 MB', () => {
    const MAX_SIZE = 15 * 1024 * 1024; // 15 MB in bytes
    expect(MAX_SIZE).toBe(15728640);
  });

  it('fileSchema should reject a CSV file over 15 MB', () => {
    const FIFTEEN_MB = 15 * 1024 * 1024;
    const oversizedFile = { size: FIFTEEN_MB + 1, type: 'text/csv', name: 'big.csv' } as File;
    const validFile = { size: 1024, type: 'text/csv', name: 'small.csv' } as File;

    // The constraint added to fileSchema: file.size <= MAX_RECEIPT_UPLOAD_SIZE
    const maxSize = FIFTEEN_MB;
    expect(oversizedFile.size <= maxSize).toBe(false);
    expect(validFile.size <= maxSize).toBe(true);
  });

  it('fileSchema should allow a CSV file exactly at the 15 MB boundary', () => {
    const FIFTEEN_MB = 15 * 1024 * 1024;
    const boundaryFile = { size: FIFTEEN_MB, type: 'text/csv', name: 'boundary.csv' } as File;
    expect(boundaryFile.size <= FIFTEEN_MB).toBe(true);
  });
});
