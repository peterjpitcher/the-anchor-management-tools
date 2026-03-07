import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Must match src/app/actions/receipts.ts line 35
const MAX_RECEIPT_UPLOAD_SIZE = 15 * 1024 * 1024; // 15 MB

// Mirror of fileSchema from src/app/actions/receipts.ts (lines 369–376).
// fileSchema is not exported (it lives in a 'use server' file), so we replicate
// the constraint logic here to verify correctness. If the production constraints
// change, this mirror must be updated to match.
const testFileSchema = z.instanceof(File, { message: 'Please attach a CSV file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'CSV file is too large. Please keep bank statements under 15 MB.',
  })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported',
  });

describe('fileSchema — CSV upload validation', () => {
  it('should reject an empty file', () => {
    const file = new File([''], 'empty.csv', { type: 'text/csv' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('File is empty');
  });

  it('should reject a file over 15 MB', () => {
    const oversizedContent = new Uint8Array(MAX_RECEIPT_UPLOAD_SIZE + 1);
    const file = new File([oversizedContent], 'big.csv', { type: 'text/csv' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('too large');
  });

  it('should accept a valid CSV file under 15 MB', () => {
    const content = 'Date,Description,Amount\n2026-01-01,Test transaction,100.00\n';
    const file = new File([content], 'statement.csv', { type: 'text/csv' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('should accept a file at exactly 15 MB (boundary)', () => {
    const boundaryContent = new Uint8Array(MAX_RECEIPT_UPLOAD_SIZE);
    const file = new File([boundaryContent], 'boundary.csv', { type: 'text/csv' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('should reject a non-CSV MIME type without a .csv extension', () => {
    const content = 'some content';
    const file = new File([content], 'document.pdf', { type: 'application/pdf' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Only CSV bank statements are supported');
  });

  it('should accept a file with .csv extension even if MIME type is application/octet-stream', () => {
    // Some browsers/OS report CSV as application/octet-stream; the production schema
    // allows this via the file.name.endsWith('.csv') branch.
    const content = 'Date,Description,Amount\n2026-01-01,Test,50.00\n';
    const file = new File([content], 'export.csv', { type: 'application/octet-stream' });
    const result = testFileSchema.safeParse(file);
    expect(result.success).toBe(true);
  });
});
