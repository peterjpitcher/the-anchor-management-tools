'use client'

import Papa from 'papaparse'
import { useRef, useState } from 'react'

import {
  Alert,
  Badge,
  Button,
  Input,
  Modal,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds'
import {
  importBusinessContacts,
  listBusinessContacts,
} from '@/app/actions/marketing-contacts'
import type { ImportContactsResult } from '@/services/marketing-contacts'

interface ImportModalProps {
  onClose: () => void
  onImported: () => void
}

const TEMPLATE_HEADERS = ['email', 'contact_name', 'company_name', 'job_title', 'tags']

const TEMPLATE_CSV = [
  TEMPLATE_HEADERS.join(','),
  'orders@exampleltd.co.uk,Jane Smith,Example Ltd,Office Manager,"christmas,corporate"',
  'hello@anotherfirm.co.uk,Sam Patel,Another Firm,Director,corporate',
].join('\n')

/**
 * Mirrors `FREEMAIL_LABELS` in `src/services/marketing-contacts.ts`. Duplicated because that
 * module pulls in the service-role client and must never reach the browser bundle. This copy
 * only powers a review hint, never a decision: a free-mail domain has no effect on whether a
 * contact can be emailed, so the two lists drifting apart is cosmetic rather than a bug.
 */
const FREEMAIL_LABELS = new Set([
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'yahoo',
  'ymail',
  'icloud',
  'me',
  'aol',
  'btinternet',
  'sky',
  'talktalk',
  'virginmedia',
  'msn',
])

/** Deliberately loose, matching the service. A bounce is what really proves an address. */
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

interface PreviewRow {
  rowNumber: number
  email: string
  contactName: string | null
  companyName: string | null
  jobTitle: string | null
  tags: string[]
  problem: string | null
  isFreemail: boolean
  duplicateInFile: boolean
  alreadyExists: boolean
}

function normalise(value: string | undefined | null): string {
  return (value ?? '').trim()
}

function isFreemail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1]
  if (!domain) return false
  return FREEMAIL_LABELS.has(domain.split('.')[0] ?? '')
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40)
}

function downloadTemplate(): void {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'marketing-contacts-template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportContactsResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const importable = rows.filter((row) => !row.problem && !row.duplicateInFile)
  const problemCount = rows.length - importable.length
  const freemailCount = importable.filter((row) => row.isFreemail).length
  const existingCount = importable.filter((row) => row.alreadyExists).length

  async function handleFile(file: File) {
    setParsing(true)
    setParseError(null)
    setResult(null)
    setFilename(file.name)

    const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
        complete: resolve,
      })
    })

    const parsedRows = parsed.data ?? []
    if (parsedRows.length === 0) {
      setRows([])
      setParsing(false)
      setParseError('That file has no rows. Check it has a header row and at least one contact.')
      return
    }

    if (!Object.prototype.hasOwnProperty.call(parsedRows[0] ?? {}, 'email')) {
      setRows([])
      setParsing(false)
      setParseError('That file has no "email" column. Download the template to see the format.')
      return
    }

    // One pass over the existing contacts so duplicates are flagged before anything is
    // written, rather than after. The do-not-contact list cannot be checked from here, so a
    // suppressed address only shows up in the result once the import has run.
    const existingEmails = new Set<string>()
    for (let page = 1; page <= 25; page += 1) {
      const batch = await listBusinessContacts({ page, pageSize: 200 })
      if (batch.error || !batch.data) break
      for (const contact of batch.data.contacts) existingEmails.add(contact.email.toLowerCase())
      if (existingEmails.size >= batch.data.total || batch.data.contacts.length < 200) break
    }

    const seenInFile = new Set<string>()
    const preview: PreviewRow[] = parsedRows.map((raw, index) => {
      const email = normalise(raw.email).toLowerCase()
      const tags = parseTags(normalise(raw.tags))

      let problem: string | null = null
      if (!email) problem = 'No email address'
      else if (!EMAIL_PATTERN.test(email)) problem = 'That does not look like an email address'
      else if (email.length > 320) problem = 'Email address is too long'

      const duplicateInFile = !problem && seenInFile.has(email)
      if (!problem && email) seenInFile.add(email)

      return {
        rowNumber: index + 2, // +2 so the number matches the spreadsheet, header included
        email,
        contactName: normalise(raw.contact_name) || null,
        companyName: normalise(raw.company_name) || null,
        jobTitle: normalise(raw.job_title) || null,
        tags,
        problem,
        isFreemail: Boolean(email) && isFreemail(email),
        duplicateInFile,
        alreadyExists: Boolean(email) && existingEmails.has(email),
      }
    })

    setRows(preview)
    setParsing(false)
  }

  async function handleImport() {
    if (importable.length === 0) return

    setImporting(true)
    const response = await importBusinessContacts({
      filename,
      rows: importable.map((row) => ({
        rowNumber: row.rowNumber,
        email: row.email,
        contactName: row.contactName,
        companyName: row.companyName,
        jobTitle: row.jobTitle,
        tags: row.tags,
      })),
    })
    setImporting(false)

    if (response.error || !response.data) {
      toast.error(response.error ?? 'The import failed')
      return
    }

    setResult(response.data)
    toast.success(`${response.data.imported} contacts imported.`)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import contacts"
      width="xl"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {result ? (
            <Button variant="primary" onClick={onImported}>
              Review the new contacts
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleImport}
              loading={importing}
              disabled={importable.length === 0 || parsing}
            >
              {importable.length > 0
                ? `Import ${importable.length} contacts`
                : 'Import contacts'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {result ? (
          <div className="space-y-3">
            <Alert tone="success" title="Import finished">
              {result.imported} imported, {result.skipped} skipped.
            </Alert>
            <p className="text-sm text-text">
              Everyone imported is waiting for eligibility review and cannot be emailed until
              someone reviews them.
            </p>
            {result.rows.some((row) => row.decision === 'skipped_do_not_contact') && (
              <Alert tone="warning" title="Some addresses were on the do-not-contact list">
                These were skipped because someone previously asked us to stop emailing them.
                That objection outlives the contact record on purpose.
              </Alert>
            )}
            <div className="max-h-64 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>What happened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.email ?? ''}`}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>
                        <span className="break-all">{row.email ?? ''}</span>
                      </TableCell>
                      <TableCell>{row.reason ?? row.decision.replace(/_/g, ' ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  label="CSV file"
                  hint="Columns: email, contact_name, company_name, job_title, tags"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleFile(file)
                  }}
                  fullWidth
                />
              </div>
              <Button variant="secondary" onClick={downloadTemplate}>
                Download template
              </Button>
            </div>

            {parseError && (
              <Alert tone="danger" title="Could not read that file">
                {parseError}
              </Alert>
            )}

            {parsing && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Spinner size="sm" />
                Checking the file against the contacts we already have…
              </div>
            )}

            {rows.length > 0 && !parsing && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="success">{importable.length} ready to import</Badge>
                  {problemCount > 0 && (
                    <Badge tone="danger">{problemCount} will be left out</Badge>
                  )}
                  {existingCount > 0 && (
                    <Badge tone="info">{existingCount} already on the list</Badge>
                  )}
                  {freemailCount > 0 && (
                    <Badge tone="warning">{freemailCount} free-mail addresses</Badge>
                  )}
                </div>

                <Alert tone="info" title="What happens next">
                  Contacts already on the list have their details updated rather than being
                  added twice. Everything imported arrives waiting for eligibility review, so
                  nobody can be emailed straight away. Addresses on the do-not-contact list are
                  skipped during the import and shown in the result.
                </Alert>

                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Tags</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={`${row.rowNumber}-${row.email}`}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>
                            <span className="break-all">{row.email || 'Missing'}</span>
                          </TableCell>
                          <TableCell>{row.companyName ?? ''}</TableCell>
                          <TableCell>{row.contactName ?? ''}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {row.tags.map((tag) => (
                                <Badge key={tag} tone="neutral">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {row.problem && <Badge tone="danger">{row.problem}</Badge>}
                              {row.duplicateInFile && (
                                <Badge tone="danger">Repeated in this file</Badge>
                              )}
                              {row.alreadyExists && (
                                <Badge tone="info">Already on the list</Badge>
                              )}
                              {row.isFreemail && <Badge tone="warning">Free-mail</Badge>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
