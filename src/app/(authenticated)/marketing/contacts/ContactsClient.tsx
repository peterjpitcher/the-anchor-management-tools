'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Input,
  LinkButton,
  Modal,
  PageLayout,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  toast,
} from '@/ds'
import {
  resubscribeBusinessContact,
  unsubscribeBusinessContact,
  updateBusinessContact,
} from '@/app/actions/marketing-contacts'
import type {
  BusinessContact,
  EligibilityStatus,
  MarketingStatus,
  MarketingTagCount,
} from '@/types/marketing'

import {
  EligibilityBadge,
  MARKETING_SECTION_NAV,
  MarketingStatusBadge,
  formatDateOnlyInLondon,
} from '../_shared/marketing-ui'
import { EligibilityModal } from './EligibilityModal'
import { ImportModal } from './ImportModal'

export interface ContactFilters {
  search: string
  tag: string
  eligibility: string
  status: string
}

interface ContactsClientProps {
  initialContacts: BusinessContact[]
  initialTotal: number
  initialPage: number
  pageSize: number
  initialFilters: ContactFilters
  tags: MarketingTagCount[]
  pendingReviewCount: number
  canEdit: boolean
  canCreate: boolean
}

const ELIGIBILITY_OPTIONS = [
  { value: '', label: 'Any eligibility' },
  { value: 'pending_review', label: 'Waiting for review' },
  { value: 'eligible', label: 'Eligible' },
  { value: 'excluded', label: 'Excluded' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Any marketing status' },
  { value: 'subscribed', label: 'Subscribed' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'complained', label: 'Complained' },
]

function buildHref(filters: ContactFilters, page: number): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.eligibility) params.set('eligibility', filters.eligibility)
  if (filters.status) params.set('status', filters.status)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/marketing/contacts?${qs}` : '/marketing/contacts'
}

export function ContactsClient({
  initialContacts,
  initialTotal,
  initialPage,
  pageSize,
  initialFilters,
  tags,
  pendingReviewCount,
  canEdit,
  canCreate,
}: ContactsClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [filters, setFilters] = useState<ContactFilters>(initialFilters)
  const [eligibilityTarget, setEligibilityTarget] = useState<BusinessContact | null>(null)
  const [editTarget, setEditTarget] = useState<BusinessContact | null>(null)
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<BusinessContact | null>(null)
  const [resubscribeTarget, setResubscribeTarget] = useState<BusinessContact | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const totalPages = Math.max(1, Math.ceil(initialTotal / pageSize))

  const applyFilters = useCallback(
    (next: ContactFilters) => {
      setFilters(next)
      startTransition(() => {
        router.push(buildHref(next, 1))
      })
    },
    [router],
  )

  const goToPage = useCallback(
    (page: number) => {
      startTransition(() => {
        router.push(buildHref(filters, page))
      })
    },
    [filters, router],
  )

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  const tagOptions = useMemo(
    () => [
      { value: '', label: 'Any tag' },
      ...tags.map((tag) => ({ value: tag.tag, label: `${tag.tag} (${tag.count})` })),
    ],
    [tags],
  )

  const hasFilters = Boolean(
    filters.search || filters.tag || filters.eligibility || filters.status,
  )

  async function handleUnsubscribe(contact: BusinessContact) {
    const result = await unsubscribeBusinessContact(contact.id, {
      reason: 'manual',
      source: 'marketing_contacts_ui',
    })
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(`${contact.email} will no longer receive marketing email.`)
    refresh()
  }

  async function handleResubscribe(contact: BusinessContact) {
    const result = await resubscribeBusinessContact(contact.id, {
      note: 'Resubscribed by a member of staff after the contact asked to be added back.',
    })
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(`${contact.email} is subscribed again.`)
    refresh()
  }

  return (
    <PageLayout
      title="Marketing"
      subtitle="Business contacts for email campaigns"
      navItems={MARKETING_SECTION_NAV}
      headerActions={
        canCreate ? (
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import contacts
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {pendingReviewCount > 0 && (
          <Alert tone="warning" title="Eligibility review needed">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0">
                {pendingReviewCount === 1
                  ? '1 contact is waiting for eligibility review. It cannot be emailed until someone reviews it.'
                  : `${pendingReviewCount} contacts are waiting for eligibility review. They cannot be emailed until someone reviews them.`}
              </p>
              <LinkButton
                href="/marketing/contacts?eligibility=pending_review"
                variant="secondary"
                size="sm"
              >
                Review them
              </LinkButton>
            </div>
          </Alert>
        )}

        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              {/* SearchInput fires `onChange ?? onSearch`, never both, so the search handler
                  goes on onChange. debounceDelay makes it hold a draft while typing. */}
              <SearchInput
                value={filters.search}
                debounceDelay={400}
                onChange={(value) => applyFilters({ ...filters, search: value })}
                placeholder="Search name, email or company"
              />
            </div>
            <div className="min-w-0">
              <Select
                aria-label="Filter by tag"
                options={tagOptions}
                value={filters.tag}
                onChange={(event) => applyFilters({ ...filters, tag: event.target.value })}
                fullWidth
              />
            </div>
            <div className="min-w-0">
              <Select
                aria-label="Filter by eligibility"
                options={ELIGIBILITY_OPTIONS}
                value={filters.eligibility}
                onChange={(event) => applyFilters({ ...filters, eligibility: event.target.value })}
                fullWidth
              />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="Filter by marketing status"
                  options={STATUS_OPTIONS}
                  value={filters.status}
                  onChange={(event) => applyFilters({ ...filters, status: event.target.value })}
                  fullWidth
                />
              </div>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    applyFilters({ search: '', tag: '', eligibility: '', status: '' })
                  }
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          {initialContacts.length === 0 ? (
            <Empty
              icon="users"
              title={hasFilters ? 'No contacts match these filters' : 'No contacts yet'}
              description={
                hasFilters
                  ? 'Try a wider search, or clear the filters to see everyone.'
                  : 'Import a CSV of business contacts to get started. Everyone arrives waiting for eligibility review, and nobody can be emailed until that review is done.'
              }
              action={
                canCreate && !hasFilters ? (
                  <Button variant="primary" onClick={() => setImportOpen(true)}>
                    Import contacts
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Eligibility</TableHead>
                      <TableHead>Marketing</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {initialContacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <span className="font-medium text-text">
                            {contact.companyName || 'Not given'}
                          </span>
                          {contact.jobTitle && (
                            <div className="text-xs text-text-muted">{contact.jobTitle}</div>
                          )}
                        </TableCell>
                        <TableCell>{contact.contactName || 'Not given'}</TableCell>
                        <TableCell>
                          <span className="break-all">{contact.email}</span>
                          {contact.isFreemail && (
                            <div className="mt-1">
                              <Badge tone="neutral">Free-mail address</Badge>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {contact.tags.length === 0 ? (
                            <span className="text-text-muted">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {contact.tags.map((tag) => (
                                <Badge key={tag} tone="info">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <EligibilityBadge status={contact.eligibilityStatus} />
                          {contact.eligibilityReviewedAt && (
                            <div className="mt-1 text-xs text-text-muted">
                              Reviewed {formatDateOnlyInLondon(contact.eligibilityReviewedAt)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <MarketingStatusBadge status={contact.marketingStatus} />
                        </TableCell>
                        <TableCell align="right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {canEdit && (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setEditTarget(contact)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setEligibilityTarget(contact)}
                                >
                                  Set eligibility
                                </Button>
                                {contact.marketingStatus === 'subscribed' ? (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => setUnsubscribeTarget(contact)}
                                  >
                                    Unsubscribe
                                  </Button>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setResubscribeTarget(contact)}
                                  >
                                    Resubscribe
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <TablePagination
                    page={initialPage}
                    totalPages={totalPages}
                    onPageChange={goToPage}
                    pageSize={pageSize}
                    totalItems={initialTotal}
                  />
                </div>
              )}
            </>
          )}
        </Card>

        {isPending && <p className="text-sm text-text-muted">Loading…</p>}

        <p className="text-sm text-text-muted">
          Contacts are business addresses only.{' '}
          <Link href="/marketing/settings" className="underline underline-offset-2">
            Sending is controlled in Settings.
          </Link>
        </p>
      </div>

      {eligibilityTarget && (
        <EligibilityModal
          contact={eligibilityTarget}
          onClose={() => setEligibilityTarget(null)}
          onSaved={() => {
            setEligibilityTarget(null)
            refresh()
          }}
        />
      )}

      {editTarget && (
        <EditContactModal
          contact={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(unsubscribeTarget)}
        onClose={() => setUnsubscribeTarget(null)}
        onConfirm={async () => {
          if (unsubscribeTarget) await handleUnsubscribe(unsubscribeTarget)
          setUnsubscribeTarget(null)
        }}
        title="Stop marketing email to this contact?"
        message={
          <span>
            {unsubscribeTarget?.email} will be added to the do-not-contact list. That record
            outlives the contact, so a future import cannot bring them back by accident.
          </span>
        }
        confirmLabel="Unsubscribe"
        tone="danger"
      />

      <ConfirmDialog
        open={Boolean(resubscribeTarget)}
        onClose={() => setResubscribeTarget(null)}
        onConfirm={async () => {
          if (resubscribeTarget) await handleResubscribe(resubscribeTarget)
          setResubscribeTarget(null)
        }}
        title="Add this contact back to marketing email?"
        message={
          <span>
            Only do this if {resubscribeTarget?.email} has asked to hear from us again. Their
            objection will be removed from the do-not-contact list.
          </span>
        }
        confirmLabel="Resubscribe"
        tone="warning"
      />

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false)
            refresh()
          }}
        />
      )}
    </PageLayout>
  )
}

function EditContactModal({
  contact,
  onClose,
  onSaved,
}: {
  contact: BusinessContact
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    contactName: contact.contactName ?? '',
    companyName: contact.companyName ?? '',
    jobTitle: contact.jobTitle ?? '',
    tags: contact.tags.join(', '),
  })

  async function handleSave() {
    setSaving(true)
    const result = await updateBusinessContact(contact.id, {
      contactName: form.contactName.trim() || null,
      companyName: form.companyName.trim() || null,
      jobTitle: form.jobTitle.trim() || null,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Contact updated.')
    onSaved()
  }

  return (
    <ContactModalShell
      title="Edit contact"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted break-all">{contact.email}</p>
        <Input
          label="Contact name"
          value={form.contactName}
          onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
          fullWidth
        />
        <Input
          label="Company name"
          value={form.companyName}
          onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
          fullWidth
        />
        <Input
          label="Job title"
          value={form.jobTitle}
          onChange={(event) => setForm((prev) => ({ ...prev, jobTitle: event.target.value }))}
          fullWidth
        />
        <Input
          label="Tags"
          hint="Separate tags with commas. Tags decide who a campaign goes to."
          value={form.tags}
          onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
          fullWidth
        />
      </div>
    </ContactModalShell>
  )
}

/** Small wrapper so the local modals share the same Modal props. */
function ContactModalShell({
  title,
  onClose,
  footer,
  children,
}: {
  title: string
  onClose: () => void
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Modal open onClose={onClose} title={title} width="lg" footer={footer}>
      {children}
    </Modal>
  )
}
