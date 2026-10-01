import { describe, it, expect } from 'vitest'
import { fileSchema } from '@/services/receipts/receiptHelpers'
import {
  MAX_RECEIPT_STATEMENT_UPLOAD_BYTES,
  RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL,
} from '@/lib/receipts/upload-constraints'

/**
 * The statement upload check, tested on the real schema. This file used to test hand-made
 * copies of the schema and of the amount parser, so it kept passing whatever the real ones did.
 * The amount and date readers are covered in tests/services/receipts/statementParsing.test.ts.
 */

describe('fileSchema: statement upload validation', () => {
  it('rejects an empty file', () => {
    const file = new File([''], 'empty.csv', { type: 'text/csv' })
    const result = fileSchema.safeParse(file)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('File is empty')
  })

  it('rejects a file over the limit and names the limit', () => {
    const oversized = new Uint8Array(MAX_RECEIPT_STATEMENT_UPLOAD_BYTES + 1)
    const file = new File([oversized], 'big.csv', { type: 'text/csv' })
    const result = fileSchema.safeParse(file)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(
      `CSV file is too large. Please keep bank statements under ${RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL}.`
    )
  })

  it('accepts a file at exactly the limit', () => {
    const boundary = new Uint8Array(MAX_RECEIPT_STATEMENT_UPLOAD_BYTES)
    const file = new File([boundary], 'boundary.csv', { type: 'text/csv' })
    expect(fileSchema.safeParse(file).success).toBe(true)
  })

  it('keeps the limit under what a server action request can carry', () => {
    // The platform refuses request bodies over about 4.5 MB before the action runs, so a higher
    // limit here could never be reached and its message would be untrue.
    expect(MAX_RECEIPT_STATEMENT_UPLOAD_BYTES).toBeLessThanOrEqual(4.4 * 1024 * 1024)
  })

  it('accepts a CSV file', () => {
    const file = new File(['Date,Details,In,Out\n'], 'statement.csv', { type: 'text/csv' })
    expect(fileSchema.safeParse(file).success).toBe(true)
  })

  it('rejects a file that is not a CSV', () => {
    const file = new File(['some content'], 'document.pdf', { type: 'application/pdf' })
    const result = fileSchema.safeParse(file)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Only CSV bank statements are supported')
  })

  it('accepts a .csv file the browser reports as a generic download', () => {
    const file = new File(['Date,Details,In,Out\n'], 'export.csv', { type: 'application/octet-stream' })
    expect(fileSchema.safeParse(file).success).toBe(true)
  })

  it('accepts the extension in capitals', () => {
    const file = new File(['Date,Details,In,Out\n'], 'EXPORT.CSV', { type: 'application/octet-stream' })
    expect(fileSchema.safeParse(file).success).toBe(true)
  })

  it('rejects something that is not a file at all', () => {
    const result = fileSchema.safeParse('statement.csv')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('Please attach a CSV file')
  })
})
