'use client'

import { useState, useTransition, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
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
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Upload bank statement</h2>
          <p className="text-sm text-gray-500">You have view-only access. Ask a receipts manager to upload statements.</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="md:col-span-3" header={<div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Upload bank statement</h2>
        <p className="text-sm text-gray-500">Import CSV statements and auto-match recurring items.</p>
      </div>
    </div>}>
      <form onSubmit={handleStatementSubmit} className="space-y-4">
        <div>
          <Input
            type="file"
            accept=".csv"
            onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)}
          />
          {statementFile && (
            <p className="mt-2 text-sm text-gray-500">{statementFile.name}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isStatementPending || !canManageReceipts}>
            {isStatementPending && <Spinner className="mr-2 h-4 w-4" />}Upload statement
          </Button>
          <Button type="button" variant="secondary" onClick={() => setStatementFile(null)} disabled={!statementFile || isStatementPending || !canManageReceipts}>
            Clear selection
          </Button>
        </div>
        {lastImport && (
          <p className="text-sm text-gray-500">
            Last upload: {formatDate(lastImport.uploaded_at)} · {lastImport.original_filename}
          </p>
        )}
      </form>
    </Card>
  )
}
