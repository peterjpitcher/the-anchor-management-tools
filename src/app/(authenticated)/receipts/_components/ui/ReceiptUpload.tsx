'use client'

import { useState, useTransition, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Select, Card, CardBody, CardHeader, Field, FileButton, FormFooter, Icon, toast } from '@/ds'
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
      // A repeat upload adds nothing. Saying "Imported 0" in green made it look like a success.
      if (result?.alreadyImported) {
        toast.warning('This file has already been imported. Nothing was added.')
        setStatementFile(null)
        return
      }
      const autoApplied = result?.autoApplied ?? 0
      const autoClassified = result?.autoClassified ?? 0
      const skipped = result?.skipped ?? 0
      const parts = [`Imported ${result?.inserted ?? 0} new transactions`]
      if (skipped > 0) parts.push(`${skipped} already held`)
      if (autoApplied > 0) parts.push(`${autoApplied} auto-matched`)
      if (autoClassified > 0) parts.push(`${autoClassified} auto-classified`)
      if (result?.warning) {
        // The import went in, but something after it did not. Keep it on screen long enough to read.
        toast.warning(`${parts.join(' · ')}. ${result.warning}`, { duration: 12000 })
      } else {
        toast.success(parts.join(' · '))
      }
      setStatementFile(null)
      router.refresh()
    })
  }

  if (!canManageReceipts) {
    return (
      <Card>
        <CardHeader title="Upload Bank Statement" subtitle="You have view-only access. Ask a receipts manager to upload statements" />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Upload Bank Statement" subtitle="Import CSV and auto-match recurring items" />
      <CardBody>
        <form onSubmit={handleStatementSubmit} className="space-y-4">
          <Select
            label="Statement type"
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
          {/* The picked file lives in state only, so Clear and a finished upload really do empty it
              (a plain file input kept showing the old file name after both). */}
          <Field label="CSV file" hint={statementFile ? statementFile.name : 'No file chosen'}>
            <FileButton
              accept=".csv"
              icon={<Icon name="upload" size={16} />}
              onFiles={(files) => setStatementFile(files[0] ?? null)}
              disabled={isStatementPending}
              className="self-start"
            >
              {statementFile ? 'Choose Another File' : 'Choose CSV File'}
            </FileButton>
          </Field>
          <FormFooter
            start={lastImport ? `Last: ${formatDate(lastImport.uploaded_at)} \u00b7 ${lastImport.original_filename}` : undefined}
          >
            <Button type="button" variant="secondary" onClick={() => setStatementFile(null)} disabled={!statementFile || isStatementPending || !canManageReceipts}>
              Clear
            </Button>
            <Button type="submit" loading={isStatementPending} disabled={isStatementPending || !canManageReceipts}>
              Upload
            </Button>
          </FormFooter>
        </form>
      </CardBody>
    </Card>
  )
}
