'use client'

import { useState, useTransition, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button, Input, Select, Card, CardBody, CardHeader, Spinner } from '@/ds'
import { importReceiptStatement } from '@/app/actions/receipts'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ReceiptBatch } from '@/types/database'

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

interface ReceiptUploadProps {
  lastImport?: ReceiptBatch | null
}

export function ReceiptUpload({ lastImport }: ReceiptUploadProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [sourceType, setSourceType] = useState<'bank' | 'amex'>('bank')
  const [isStatementPending, startStatementTransition] = useTransition()

  async function handleStatementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageReceipts) {
      toast.error('You do not have permission to manage receipts.')
      return
    }
    if (!statementFile) {
      toast.error('Please choose a CSV bank statement to upload.')
      return
    }
    const formData = new FormData()
    formData.append('statement', statementFile)
    formData.append('sourceType', sourceType)

    startStatementTransition(async () => {
      const result = await importReceiptStatement(formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      const autoApplied = result?.autoApplied ?? 0
      const autoClassified = result?.autoClassified ?? 0
      const parts = [`Imported ${result?.inserted ?? 0} new transactions`]
      if (autoApplied > 0) parts.push(`${autoApplied} auto-matched`)
      if (autoClassified > 0) parts.push(`${autoClassified} auto-classified`)
      toast.success(parts.join(' · '))
      setStatementFile(null)
      router.refresh()
    })
  }

  if (!canManageReceipts) {
    return (
      <Card className="md:col-span-3">
        <CardHeader title="Upload bank statement" subtitle="You have view-only access. Ask a receipts manager to upload statements." />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Upload bank statement" subtitle="Import CSV and auto-match recurring items." />
      <CardBody>
        <form onSubmit={handleStatementSubmit} className="space-y-3">
          <Select
            value={sourceType}
            onChange={(event) => {
              setSourceType(event.target.value as 'bank' | 'amex')
              setStatementFile(null)
            }}
            options={[
              { value: 'bank', label: 'Bank statement' },
              { value: 'amex', label: 'American Express statement' },
            ]}
          />
          <Input
            type="file"
            accept=".csv"
            onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={isStatementPending || !canManageReceipts}>
              {isStatementPending && <Spinner className="mr-2 h-4 w-4" />}Upload
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setStatementFile(null)} disabled={!statementFile || isStatementPending || !canManageReceipts}>
              Clear
            </Button>
          </div>
          {lastImport && (
            <p className="text-xs text-text-muted">
              Last: {formatDate(lastImport.uploaded_at)} · {lastImport.original_filename}
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  )
}
