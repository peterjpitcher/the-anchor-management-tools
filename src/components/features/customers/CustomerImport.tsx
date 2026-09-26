import { useState } from 'react'
import Papa from 'papaparse'
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Empty, FileButton, FormFooter, Icon, toast } from '@/ds'
import { Customer } from '@/types/database'
import { cn, formatPhoneForStorage } from '@/lib/utils'
import {
  CUSTOMER_IMPORT_ROW_LABEL,
  CUSTOMER_IMPORT_ROW_TINT,
  CUSTOMER_IMPORT_ROW_TONE,
  type CustomerImportRowStatus,
} from '@/app/(authenticated)/customers/_shared/status-ui'

/** What the parent actually managed to do with the rows we handed it. */
export interface CustomerImportOutcome {
  success: boolean
  /** Customers written to the database */
  created?: number
  /** Rows the server refused (invalid, duplicate in file, or already on record) */
  skipped?: number
  error?: string
}

interface CustomerImportProps {
  onImportComplete: (customers: Omit<Customer, 'id' | 'created_at'>[]) => Promise<CustomerImportOutcome>
  onCancel: () => void
  existingCustomers: Customer[]
}

const REQUIRED_HEADERS = ['first_name', 'mobile_number']

interface ParsedCustomer {
  first_name: string
  last_name?: string
  email?: string
  mobile_number: string
  isValid: boolean
  isDuplicate?: boolean
  errors: string[]
}

function rowStatus(row: ParsedCustomer): CustomerImportRowStatus {
  if (row.isValid) return 'valid'
  return row.isDuplicate ? 'duplicate' : 'invalid'
}

export function CustomerImport({ onImportComplete, onCancel, existingCustomers }: CustomerImportProps) {
  const [parsedData, setParsedData] = useState<ParsedCustomer[]>([])
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const downloadTemplate = () => {
    const headers = ['first_name', 'last_name', 'email', 'mobile_number']
    const sampleData = ['John', 'Doe', 'john@example.com', '07123456789']
    const csvContent = [
      headers.join(','),
      sampleData.join(',')
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'customer_import_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const normalizePhoneNumber = (number: string): string => {
    return formatPhoneForStorage(number, {
      defaultCountryCode: '44'
    })
  }

  const validateCustomer = (customer: Partial<Customer>, allCustomersInFile: Partial<Customer>[]): { errors: string[], customer: ParsedCustomer } => {
    const errors: string[] = []
    let isDuplicate = false
    
    if (!customer.first_name?.trim()) {
      errors.push('First name is required')
    }

    let formattedNumber = ''
    if (customer.mobile_number) {
      try {
        formattedNumber = normalizePhoneNumber(customer.mobile_number)
      } catch {
        errors.push('Invalid phone number format')
      }
    }
    if (!formattedNumber) {
      errors.push('Mobile number is required')
    } else {
      const isDuplicateInFile =
        allCustomersInFile.filter((c) => {
          if (!c.mobile_number) return false
          try {
            return normalizePhoneNumber(c.mobile_number) === formattedNumber
          } catch {
            return false
          }
        }).length > 1
      const isDuplicateInDb = existingCustomers.some((c) => {
        if (!c.mobile_number) return false
        try {
          return normalizePhoneNumber(c.mobile_number) === formattedNumber
        } catch {
          return false
        }
      })

      if (isDuplicateInFile) {
        errors.push('Duplicate mobile number within this file')
        isDuplicate = true
      }
      if (isDuplicateInDb) {
        errors.push('Mobile number already exists in the database')
        isDuplicate = true
      }
    }

    const email = customer.email?.trim() ?? ''
    if (email) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailPattern.test(email.toLowerCase())) {
        errors.push('Invalid email address')
      }
    }

    return {
      errors,
      customer: {
        first_name: customer.first_name?.trim() ?? '',
        last_name: customer.last_name?.trim(),
        email: email ? email.toLowerCase() : undefined,
        mobile_number: formattedNumber,
        isValid: errors.length === 0,
        isDuplicate,
        errors: [], // This will be populated later
      }
    }
  }

  // FileButton clears its input after every pick, so the same file can be picked again.
  const handleFileUpload = (files: File[]) => {
    const file = files[0]
    if (!file) return

    // Browsers disagree about the MIME type of a .csv file: Excel on Windows
    // reports application/vnd.ms-excel and some report nothing at all, so a
    // strict text/csv check rejected perfectly valid files. Trust the extension.
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file')
      return
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Headers are lower-cased so exports that title-case them (First_Name)
      // still line up with the template.
      transformHeader: (header) => header.trim().toLowerCase(),
      transform: (value) => value.trim(),
      complete: (results) => {
        // A ragged row is a row-level problem: the preview already flags it as
        // invalid, so only structural failures (unreadable quoting or delimiter)
        // should reject the whole file.
        const fatalErrors = results.errors.filter(error => error.type !== 'FieldMismatch')
        if (fatalErrors.length > 0) {
          toast.error(`Could not read that CSV: ${fatalErrors[0].message}`)
          return
        }

        const headers = results.meta.fields ?? []
        const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h))
        if (missingHeaders.length > 0) {
          toast.error(`Missing required headers: ${missingHeaders.join(', ')}`)
          return
        }

        const rows = results.data.filter(row => Object.values(row).some(value => Boolean(value)))
        if (rows.length === 0) {
          toast.error('CSV file is empty or contains only headers.')
          return
        }

        const fileCustomers: Partial<Customer>[] = rows.map(row => ({
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          mobile_number: row.mobile_number,
        }))

        const validatedCustomers = fileCustomers.map(c => {
          const { errors, customer } = validateCustomer(c, fileCustomers)
          customer.errors = errors
          customer.isValid = errors.length === 0
          return customer
        })

        setParsedData(validatedCustomers)
        setIsPreviewMode(true)
      },
      error: (error) => {
        console.error('Error reading CSV file:', error)
        toast.error('Could not read that CSV file')
      },
    })
  }

  const handleImport = async () => {
    setIsImporting(true)
    const validCustomers = parsedData.filter(c => c.isValid)
    if (validCustomers.length === 0) {
      toast.error("No valid customers to import.")
      setIsImporting(false)
      return
    }

    try {
      const customersToImport = validCustomers.map(({ first_name, last_name, email, mobile_number }) => ({
        first_name,
        last_name: last_name || '',
        email: email || undefined,
        mobile_number,
      }))
      const outcome = await onImportComplete(customersToImport)

      if (!outcome.success) {
        // Stay on the preview so the file can be corrected and retried.
        toast.error(outcome.error || 'Failed to import customers')
        return
      }

      const created = outcome.created ?? 0
      // Rows we never sent (failed the preview checks) plus rows the server
      // refused, so the message accounts for every row in the file.
      const skipped = parsedData.length - validCustomers.length + (outcome.skipped ?? 0)

      if (created === 0) {
        toast.error(`No customers imported. All ${parsedData.length} rows were skipped.`)
        return
      }

      if (skipped > 0) {
        toast.success(`Imported ${created} of ${parsedData.length} rows, ${skipped} skipped.`)
      } else {
        toast.success(`Imported ${created} customer${created === 1 ? '' : 's'}.`)
      }
    } catch (error) {
      console.error('Error importing customers:', error)
      toast.error('Failed to import customers')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClose = () => {
    setParsedData([])
    setIsPreviewMode(false)
    onCancel()
  }

  const validCount = parsedData.filter(c => c.isValid).length

  const statusBadge = (c: ParsedCustomer) => {
    const status = rowStatus(c)
    return (
      <Badge tone={CUSTOMER_IMPORT_ROW_TONE[status]} title={status === 'valid' ? undefined : (c.errors || []).join(', ')}>
        {CUSTOMER_IMPORT_ROW_LABEL[status]}
      </Badge>
    )
  }

  // A fragment, so the card and the footer are separate blocks in the page's own spacing.
  return (
    <>
      <Card>
        <CardHeader
          title={isPreviewMode ? 'Preview Import' : 'CSV File'}
          subtitle={
            isPreviewMode
              ? 'Review the data before importing. Invalid records will be skipped'
              : 'Columns: first_name, last_name, email, mobile_number'
          }
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" size="sm" icon={<Icon name="download" size={14} />} onClick={downloadTemplate}>
                Download Template
              </Button>
              {!isPreviewMode && (
                // Primary, as the hand-built upload label it replaces was: picking the file is
                // this card's main action, with Download Template the secondary one beside it.
                <FileButton
                  variant="primary"
                  size="sm"
                  accept=".csv"
                  icon={<Icon name="upload" size={14} />}
                  onFiles={handleFileUpload}
                >
                  Upload CSV
                </FileButton>
              )}
            </div>
          }
        />

        {isPreviewMode ? (
          <DataTable<ParsedCustomer>
            data={parsedData}
            getRowKey={(row: ParsedCustomer) => parsedData.indexOf(row)}
            emptyMessage="No rows to preview"
            bordered={false}
            className="max-shell:p-4"
            columns={[
              { key: 'first_name', header: 'First Name', cell: (c: ParsedCustomer) => <span className="text-sm text-text">{c.first_name}</span> },
              { key: 'last_name', header: 'Last Name', cell: (c: ParsedCustomer) => <span className="text-sm text-text">{c.last_name || '-'}</span> },
              { key: 'email', header: 'Email', cell: (c: ParsedCustomer) => <span className="text-sm text-text">{c.email || '-'}</span> },
              { key: 'mobile_number', header: 'Mobile Number', cell: (c: ParsedCustomer) => <span className="text-sm text-text">{c.mobile_number}</span> },
              { key: 'status', header: 'Status', cell: statusBadge },
            ]}
            renderMobileCard={(c: ParsedCustomer) => (
              <div className={cn('p-3', CUSTOMER_IMPORT_ROW_TINT[rowStatus(c)])}>
                <div className="font-medium text-sm">{c.first_name} {c.last_name || '-'}</div>
                <div className="text-sm text-text-muted">{c.mobile_number}</div>
                {c.email && <div className="text-sm text-text-muted">{c.email}</div>}
                <div className="mt-2">{statusBadge(c)}</div>
              </div>
            )}
          />
        ) : (
          <CardBody>
            <Empty
              size="sm"
              icon="document"
              title="No file uploaded"
              description="Upload a CSV file to begin importing customers."
            />
          </CardBody>
        )}
      </Card>

      {isPreviewMode && (
        <FormFooter>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={validCount === 0 || isImporting}
            loading={isImporting}
          >
            {isImporting ? 'Importing...' : `Import ${validCount} Customers`}
          </Button>
        </FormFooter>
      )}
    </>
  )
}
