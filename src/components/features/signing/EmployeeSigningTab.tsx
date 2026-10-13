'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Dropdown, DropdownItem, Input, Modal, Textarea, toast } from '@/ds'
import { sendEmploymentAgreement, sendStaffTemplateDocument, type SendResult } from '@/app/actions/signing-staff'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import { SignaturePanel } from './SignaturePanel'

type StaffKind = 'employment_agreement' | 'terms_variation' | 'deduction_consent' | 'working_time_opt_out' | 'guardian_consent'

const KIND_COPY: Record<StaffKind, { menu: string; title: string; description: string; confirm: string }> = {
  employment_agreement: {
    menu: 'Worker Agreement',
    title: 'Send the Worker Agreement',
    description: 'The zero-hours casual worker agreement, built from this record as it stands now.',
    confirm: 'Send Agreement',
  },
  terms_variation: {
    menu: 'Change to Terms',
    title: 'Send a Change to Terms',
    description: 'A pay rise, a new role or a change of hours, for the worker to agree.',
    confirm: 'Send Change',
  },
  deduction_consent: {
    menu: 'Wage Deduction Consent',
    title: 'Ask for Consent to a Wage Deduction',
    description: 'The law needs this agreed in writing before anything is taken from wages.',
    confirm: 'Send for Consent',
  },
  working_time_opt_out: {
    menu: '48-Hour Week Opt-Out',
    title: 'Offer the 48-Hour Week Opt-Out',
    description: 'The worker chooses whether to give up the 48-hour average weekly limit. They can say no.',
    confirm: 'Send Opt-Out',
  },
  guardian_consent: {
    menu: 'Parent or Guardian Consent',
    title: 'Ask a Parent or Guardian for Consent',
    description: 'For a worker under 18. The link goes to the parent or guardian, not the worker.',
    confirm: 'Send for Consent',
  },
}

export interface EmployeeSigningTabProps {
  employeeId: string
  /** True, false, or null when we hold no date of birth. */
  isUnder18: boolean | null
  hasEmail: boolean
  documents: SigningDocumentSummary[]
  canSend: boolean
  /** Why the list could not be loaded, if it could not. */
  loadError?: string | null
}

/**
 * The employee page's signing tab: what has been sent and where it has got to, and the send
 * options for the five staff document kinds. Policies are sent to everyone at once from the
 * policies page, and listed here once sent.
 */
export function EmployeeSigningTab({ employeeId, isUnder18, hasEmail, documents, canSend, loadError }: EmployeeSigningTabProps): React.JSX.Element {
  const router = useRouter()
  const [kind, setKind] = useState<StaffKind | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [changeSummary, setChangeSummary] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [deductionDetails, setDeductionDetails] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')

  const close = (): void => {
    if (pending) return
    setKind(null)
    setError(null)
  }

  const reportSent = (result: SendResult): void => {
    const failed = result.deliveries.filter((delivery) => delivery.email_status === 'failed')
    const noEmail = result.deliveries.filter((delivery) => delivery.email_status === 'none')
    if (failed.length > 0) {
      toast.error(`Created, but the email to ${failed.map((delivery) => delivery.name).join(', ')} failed. Use "Send new link" or "Sign in person".`)
    } else if (noEmail.length > 0) {
      toast.success('Created. There is no email address, so use "Sign in person".')
    } else {
      toast.success('Sent for signature.')
    }
  }

  const send = (): void => {
    if (!kind) return
    setError(null)
    startTransition(async () => {
      const guardian = { guardianName: guardianName.trim(), guardianEmail: guardianEmail.trim() }
      const result =
        kind === 'employment_agreement'
          ? await sendEmploymentAgreement({ employeeId, ...(isUnder18 ? guardian : {}) })
          : kind === 'terms_variation'
            ? await sendStaffTemplateDocument({ kind, employeeId, changeSummary, effectiveDate })
            : kind === 'deduction_consent'
              ? await sendStaffTemplateDocument({ kind, employeeId, deductionDetails })
              : kind === 'working_time_opt_out'
                ? await sendStaffTemplateDocument({ kind, employeeId })
                : await sendStaffTemplateDocument({ kind, employeeId, ...guardian })
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not send the document.')
        return
      }
      reportSent(result.data)
      setKind(null)
      setChangeSummary('')
      setEffectiveDate('')
      setDeductionDetails('')
      setGuardianName('')
      setGuardianEmail('')
      router.refresh()
    })
  }

  const needsGuardian = kind === 'guardian_consent' || (kind === 'employment_agreement' && isUnder18 === true)
  // Held after the dialog closes so its title does not blank during the exit fade.
  const [lastKind, setLastKind] = useState<StaffKind>('employment_agreement')
  const copy = KIND_COPY[kind ?? lastKind]

  const sendActions = canSend ? (
    <Dropdown
      width="auto"
      align="right"
      trigger={
        <Button type="button" size="sm" variant="primary">
          Send for Signature
        </Button>
      }
    >
      {(Object.keys(KIND_COPY) as StaffKind[])
        // The opt-out is not open to a worker under 18, and guardian consent is only for one.
        .filter((option) => !(option === 'working_time_opt_out' && isUnder18 === true))
        .filter((option) => !(option === 'guardian_consent' && isUnder18 === false))
        .map((option) => (
          <DropdownItem
            key={option}
            onClick={() => {
              setKind(option)
              setLastKind(option)
            }}
          >
            {KIND_COPY[option].menu}
          </DropdownItem>
        ))}
    </Dropdown>
  ) : undefined

  // A failed load is never shown as "nothing sent yet", and nothing can be sent on top of it:
  // a document may already be out for signature that this screen cannot see.
  if (loadError) {
    return <Alert tone="danger" title="The signing records could not be loaded">{loadError}</Alert>
  }

  return (
    <div className="space-y-4">
      {!hasEmail ? (
        <Alert tone="info">
          There is no email address on this record, so nothing can be emailed. Send the document, then use &quot;Sign in person&quot;.
        </Alert>
      ) : null}

      <SignaturePanel
        documents={documents}
        canSend={canSend}
        sendActions={sendActions}
        emptyText="Nothing has been sent to this person for signature yet."
      />

      <Modal
        open={kind !== null}
        onClose={close}
        title={copy.title}
        description={copy.description}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={send}>
              {copy.confirm}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {kind === 'employment_agreement' ? (
            <p className="text-sm text-text-muted">
              Check the job title, start date, address and hourly rate on this record first. The agreement is built
              from them, and a signed agreement cannot be changed: a correction means sending a new version.
            </p>
          ) : null}
          {kind === 'terms_variation' ? (
            <>
              <Textarea
                label="What is changing"
                hint="Write it as the worker should read it. For example: Your hourly rate goes up from £12.21 to £12.71."
                rows={5}
                maxLength={4000}
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
              />
              <Input label="Starts on" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
            </>
          ) : null}
          {kind === 'deduction_consent' ? (
            <Textarea
              label="What may be deducted"
              hint="Say what for, how much or how it is worked out, and when. Only what is written here is covered."
              rows={6}
              maxLength={4000}
              value={deductionDetails}
              onChange={(event) => setDeductionDetails(event.target.value)}
            />
          ) : null}
          {kind === 'working_time_opt_out' && isUnder18 === null ? (
            <Alert tone="warning">Add a date of birth to this record first. A worker under 18 cannot opt out.</Alert>
          ) : null}
          {needsGuardian ? (
            <>
              {kind === 'employment_agreement' ? (
                <Alert tone="info">This worker is under 18, so a parent or guardian signs the agreement too.</Alert>
              ) : null}
              <Input label="Parent or guardian's full name" autoComplete="off" value={guardianName} onChange={(event) => setGuardianName(event.target.value)} />
              <Input label="Their email address" type="email" autoComplete="off" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} />
            </>
          ) : null}
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  )
}
