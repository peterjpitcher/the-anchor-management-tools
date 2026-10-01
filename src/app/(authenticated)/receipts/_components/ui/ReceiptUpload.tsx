'use client'

import { useState, useTransition, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Select, Card, CardBody, CardHeader, Field, FileButton, FormFooter, Icon, toast } from '@/ds'
import { importReceiptStatement } from '@/app/actions/receipts'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatDateInLondon } from '@/lib/dateUtils'
import { RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL } from '@/lib/receipts/upload-constraints'
import type { ReceiptBatch } from '@/types/database'

// The upload time is an instant, so it is shown on the London clock. It used to be read as UTC,
// which put an upload made just after midnight in summer on the day before.
function formatDate(value: string) {
  if (!value) return ''
  return formatDateInLondon(value)
}

interface ReceiptUploadProps {
  lastImport?: ReceiptBatch | null
}

type RejectedRecord = { record: number; reason: string; message: string; excerpt: string }

/** What the last upload did, kept on screen until the next one. */
type ImportOutcome = {
  fileName: string
  inserted: number
  alreadyHeld: number
  recordsInFile: number | null
  rejected: RejectedRecord[]
  repeatedInFile: number
  autoApplied: number
  autoClassified: number
  alreadyImported: boolean
  warning: string | null
  followupStatus: string | null
}

const REJECTED_PREVIEW = 20

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

export function ReceiptUpload({ lastImport }: ReceiptUploadProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [sourceType, setSourceType] = useState<'bank' | 'amex'>('bank')
  const [isStatementPending, startStatementTransition] = useTransition()
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [failure, setFailure] = useState<{ message: string; rejected: RejectedRecord[] } | null>(null)

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
    const fileName = statementFile.name
    const formData = new FormData()
    formData.append('statement', statementFile)
    formData.append('sourceType', sourceType)

    startStatementTransition(async () => {
      setOutcome(null)
      setFailure(null)

      let result: Awaited<ReturnType<typeof importReceiptStatement>>
      try {
        result = await importReceiptStatement(formData)
      } catch (error) {
        // A request that never came back (too large, timed out, signed out) used to leave the
        // button spinning down and nothing said.
        console.error('Statement upload failed', error)
        setFailure({
          message: `The upload did not complete. Check the file is under ${RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL} and try again. If transactions were stored, uploading the same file again is safe.`,
          rejected: [],
        })
        return
      }

      if (!result || 'error' in result && result.error) {
        const rejected = result && 'rejected' in result && Array.isArray(result.rejected) ? result.rejected : []
        setFailure({ message: result?.error ?? 'The statement could not be imported.', rejected })
        return
      }

      const summary: ImportOutcome = {
        fileName,
        inserted: result.inserted ?? 0,
        alreadyHeld: result.skipped ?? 0,
        recordsInFile: result.recordsInFile ?? null,
        rejected: result.rejected ?? [],
        repeatedInFile: result.repeatedInFile ?? 0,
        autoApplied: result.autoApplied ?? 0,
        autoClassified: result.autoClassified ?? 0,
        alreadyImported: Boolean(result.alreadyImported),
        warning: result.warning ?? null,
        followupStatus: result.followupStatus ?? null,
      }
      setOutcome(summary)

      // A repeat upload that adds nothing is not a success, and is not said in green.
      if (summary.alreadyImported && summary.inserted === 0) {
        toast.warning('This file has already been imported. Nothing was added.')
      } else if (summary.rejected.length > 0 || summary.warning) {
        toast.warning(`Imported ${plural(summary.inserted, 'transaction', 'transactions')}, with something to check below.`)
      } else {
        toast.success(`Imported ${plural(summary.inserted, 'new transaction', 'new transactions')}`)
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

  const lastImportUnfinished = lastImport?.followup_status && lastImport.followup_status !== 'done'

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
          <Field label="CSV file" hint={statementFile ? statementFile.name : `No file chosen. Up to ${RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL}.`}>
            <FileButton
              accept=".csv,.CSV,text/csv"
              icon={<Icon name="upload" size={16} />}
              onFiles={(files) => setStatementFile(files[0] ?? null)}
              disabled={isStatementPending}
              className="self-start"
            >
              {statementFile ? 'Choose Another File' : 'Choose CSV File'}
            </FileButton>
          </Field>

          {failure && (
            <Alert tone="danger" title="Nothing was imported" closable onClose={() => setFailure(null)}>
              <p>{failure.message}</p>
              <RejectedRecords records={failure.rejected} />
            </Alert>
          )}

          {outcome && <ImportOutcomePanel outcome={outcome} onClose={() => setOutcome(null)} />}

          {!outcome && lastImportUnfinished && (
            <Alert
              tone={lastImport?.followup_status === 'failed' ? 'warning' : 'info'}
              size="sm"
              role="status"
              title={lastImport?.followup_status === 'failed' ? 'The last import is not fully processed' : 'The last import is still being processed'}
            >
              {lastImport?.followup_status === 'failed'
                ? `Its transactions are stored, but rules, AI classification or invoice matching did not finish${lastImport.followup_error ? ` (${lastImport.followup_error})` : ''}. It is retried automatically; refresh in a few minutes.`
                : 'Its transactions are stored. Rules, AI classification and invoice matching are running in the background.'}
            </Alert>
          )}

          <FormFooter
            start={lastImport ? `Last: ${formatDate(lastImport.uploaded_at)} · ${lastImport.original_filename}` : undefined}
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

function RejectedRecords({ records }: { records: RejectedRecord[] }) {
  if (!records.length) return null
  const shown = records.slice(0, REJECTED_PREVIEW)
  return (
    <div className="mt-2">
      <p className="font-medium">Records that could not be read</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {shown.map((record) => (
          <li key={record.record}>
            Record {record.record}: {record.message}
            {record.excerpt ? <span className="block break-words text-text-muted">{record.excerpt}</span> : null}
          </li>
        ))}
      </ul>
      {records.length > shown.length && (
        <p className="mt-1">and {records.length - shown.length} more. Fix the file and upload it again; records already imported are not duplicated.</p>
      )}
    </div>
  )
}

function ImportOutcomePanel({ outcome, onClose }: { outcome: ImportOutcome; onClose: () => void }) {
  const needsAttention = outcome.rejected.length > 0 || Boolean(outcome.warning) || (outcome.alreadyImported && outcome.inserted === 0)
  const title = outcome.alreadyImported
    ? outcome.inserted > 0
      ? `${outcome.fileName} was imported before: ${plural(outcome.inserted, 'record that was missed then has', 'records that were missed then have')} now been added`
      : `${outcome.fileName} has already been imported`
    : `${outcome.fileName} imported`

  return (
    <Alert tone={needsAttention ? 'warning' : 'success'} title={title} role="status" closable onClose={onClose}>
      <ul className="list-disc space-y-1 pl-5">
        {outcome.recordsInFile !== null && <li>{plural(outcome.recordsInFile, 'record', 'records')} in the file</li>}
        <li>{plural(outcome.inserted, 'new transaction', 'new transactions')} added</li>
        <li>{outcome.alreadyHeld} already held, so not added again</li>
        <li>{outcome.rejected.length} could not be read</li>
        {outcome.repeatedInFile > 0 && (
          <li>{plural(outcome.repeatedInFile, 'record was', 'records were')} identical to an earlier one in the file and kept as a separate transaction</li>
        )}
        {(outcome.autoApplied > 0 || outcome.autoClassified > 0) && (
          <li>Rules classified {outcome.autoClassified} and set the status of {outcome.autoApplied}</li>
        )}
      </ul>
      {outcome.warning && <p className="mt-2">{outcome.warning}</p>}
      <RejectedRecords records={outcome.rejected} />
    </Alert>
  )
}
