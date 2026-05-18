'use client'

import { useState, useTransition } from 'react'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Button, Alert, FileUpload, ProgressBar } from '@/ds'
import Papa from 'papaparse'
import { importCashupHistoryAction, ImportRow } from '@/app/actions/cashing-up-import'

interface ImportResultState {
  total: number
  succeeded: number
  failed: number
  errors: string[]
}

const DENOMINATIONS = [
  { value: 50, label: '£50' },
  { value: 20, label: '£20' },
  { value: 10, label: '£10' },
  { value: 5, label: '£5' },
  { value: 2, label: '£2' },
  { value: 1, label: '£1' },
  { value: 0.5, label: '50p' },
  { value: 0.2, label: '20p' },
  { value: 0.1, label: '10p' },
  { value: 0.05, label: '5p' },
  { value: 0.02, label: '2p' },
  { value: 0.01, label: '1p' },
]

export function ImportClient() {
  const [previewData, setPreviewData] = useState<ImportRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportResultState | null>(null)
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)

  const handleFiles = (files: File[]) => {
    const file = files[0]
    if (!file) return
    setError(null)
    setResult(null)
    setProgress(null)
    setPreviewData([])

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError('Error parsing CSV: ' + results.errors[0].message)
          return
        }

        const rows: ImportRow[] = []
        const data = results.data as Record<string, string>[]
        const firstRow = data[0]
        const hasCounted = firstRow && ('Cash' in firstRow || 'Actual Cash' in firstRow)

        if (!firstRow || !('Date' in firstRow) || !hasCounted) {
          setError('Invalid CSV format. Missing required columns: Date, Cash (or Actual Cash), Card, Stripe')
          return
        }

        for (const row of data) {
          const cashCounts: Record<number, number> = {}
          let hasCounts = false
          DENOMINATIONS.forEach((d) => {
            if (row[d.label]) {
              const totalAmount = parseFloat(row[d.label])
              if (!isNaN(totalAmount) && totalAmount > 0) {
                cashCounts[d.value] = totalAmount
                hasCounts = true
              }
            }
          })

          const counted = parseFloat(row['Cash'] || row['Actual Cash']) || 0
          const expectedRaw = row['Z Report Cash'] || row['Expected Cash']
          const expected = expectedRaw !== undefined && expectedRaw !== '' ? parseFloat(expectedRaw) : undefined

          rows.push({
            date: row['Date'],
            siteName: row['Site'] || '',
            cashCounted: counted,
            cashExpected: expected,
            card: parseFloat(row['Card']) || 0,
            stripe: parseFloat(row['Stripe']) || 0,
            notes: row['Notes'] || '',
            cashCounts: hasCounts ? cashCounts : undefined,
          })
        }

        setPreviewData(rows)
      },
      error: (err) => {
        setError('Failed to read file: ' + err.message)
      },
    })
  }

  const handleImport = () => {
    if (!previewData.length) return

    startTransition(async () => {
      const BATCH_SIZE = 50
      const total = previewData.length
      const currentResult: ImportResultState = { total, succeeded: 0, failed: 0, errors: [] }
      let processed = 0

      setProgress({ processed: 0, total })

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = previewData.slice(i, i + BATCH_SIZE)
        try {
          const res = await importCashupHistoryAction(batch)
          if (res.success) {
            currentResult.succeeded += res.summary.succeeded
            currentResult.failed += res.summary.failed
            if (res.errors?.length) currentResult.errors.push(...res.errors)
          } else {
            currentResult.failed += batch.length
            currentResult.errors.push(`Batch failed: ${res.errors.join(', ')}`)
          }
          setResult({ ...currentResult })
          processed += batch.length
          setProgress({ processed: Math.min(processed, total), total })
        } catch (err: unknown) {
          currentResult.failed += batch.length
          currentResult.errors.push(`Batch error: ${err instanceof Error ? err.message : 'Unknown error'}`)
          setResult({ ...currentResult })
        }
      }

      setProgress(null)
    })
  }

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader title="Import Historic Cashing Up" subtitle="Upload CSV files with historic cash-up data" />
        <CardBody>
          <div className="text-sm text-text-muted space-y-2">
            <p>Use this tool to import historic cashing up data from spreadsheets or previous systems.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Required columns: <strong>Date</strong> (YYYY-MM-DD), <strong>Actual Cash</strong>, <strong>Card</strong>, <strong>Stripe</strong></li>
              <li>Optional: <strong>Z Report Cash</strong>, <strong>Site</strong>, <strong>Notes</strong>, denomination totals</li>
            </ul>
          </div>
        </CardBody>
      </Card>

      {/* File upload */}
      <Card>
        <CardHeader title="Upload Data" />
        <CardBody>
          <FileUpload
            accept=".csv"
            onFiles={handleFiles}
            hint="CSV files only. Drag and drop or click to browse."
          />

          {error && (
            <Alert tone="danger" className="mt-4">
              {error}
            </Alert>
          )}

          {progress && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm text-text-muted">
                <span>Importing...</span>
                <span>{Math.round((progress.processed / progress.total) * 100)}%</span>
              </div>
              <ProgressBar value={(progress.processed / progress.total) * 100} tone="primary" size="md" />
              <p className="text-xs text-text-subtle text-center">
                Processed {progress.processed} of {progress.total} rows
              </p>
            </div>
          )}

          {result && !progress && (
            <Alert tone={result.failed === 0 ? 'success' : 'warning'} className="mt-4" title={result.failed === 0 ? 'Import Successful!' : 'Import Status'}>
              <p>Total: {result.total} | Succeeded: {result.succeeded} | Failed: {result.failed}</p>
              {result.errors.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  <ul className="list-disc pl-5 text-xs font-mono">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </Alert>
          )}
        </CardBody>
      </Card>

      {/* Preview table */}
      {previewData.length > 0 && !progress && (
        <Card>
          <CardHeader
            title={`Preview (${previewData.length} rows)`}
            action={
              <Button variant="primary" onClick={handleImport} loading={isPending}>
                Import {previewData.length} Rows
              </Button>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Site</TableHead>
                <TableHead align="right">Cash</TableHead>
                <TableHead align="right">Z Report</TableHead>
                <TableHead align="right">Card</TableHead>
                <TableHead align="right">Stripe</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.slice(0, 10).map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="text-text-muted">{row.siteName || '-'}</TableCell>
                  <TableCell align="right" className="font-mono">
                    {'£'}{row.cashCounted?.toFixed(2)}
                  </TableCell>
                  <TableCell align="right" className="font-mono text-text-muted">
                    {row.cashExpected !== undefined ? `£${row.cashExpected.toFixed(2)}` : '-'}
                  </TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{row.card.toFixed(2)}</TableCell>
                  <TableCell align="right" className="font-mono">{'£'}{row.stripe.toFixed(2)}</TableCell>
                  <TableCell className="text-text-muted truncate max-w-[150px]">{row.notes || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {previewData.length > 10 && (
            <div className="px-4 py-2 text-xs text-text-subtle bg-surface-2 text-center border-t border-border">
              ...and {previewData.length - 10} more rows
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
