'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useCallback, useMemo, useState, useTransition } from 'react'

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Empty,
  Icon,
  IconButton,
  Input,
  LinkButton,
  Modal,
  PageLayout,
  PageLoading,
  SearchInput,
  Select,
  SubHeading,
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
  getBusinessContactEngagement,
  resubscribeBusinessContact,
  unsubscribeBusinessContact,
  updateBusinessContact,
} from '@/app/actions/marketing-contacts'
import type {
  BusinessContact,
  BusinessContactEngagement,
  BusinessContactWithClicks,
  EligibilityStatus,
  MarketingClusterCount,
  MarketingStatus,
  MarketingTagCount,
} from '@/types/marketing'

import {
  EligibilityBadge,
  MarketingStatusBadge,
  formatDateOnlyInLondon,
  formatDateTimeInLondon,
} from '../_shared/marketing-ui'
import { marketingLayout } from '../_shared/nav'
import { suggestSubscriberType } from '@/lib/email/marketing/subscriber-type'
import { EligibilityModal } from './EligibilityModal'
import { ImportModal } from './ImportModal'

export interface ContactFilters {
  search: string
  tag: string
  cluster: string
  eligibility: string
  status: string
}

interface ContactsClientProps {
  initialContacts: BusinessContactWithClicks[]
  initialTotal: number
  initialPage: number
  pageSize: number
  initialFilters: ContactFilters
  tags: MarketingTagCount[]
  clusters: MarketingClusterCount[]
  pendingReviewCount: number
  canEdit: boolean
  canCreate: boolean
  /** Whether the Settings tab shows (marketing:manage, the permission its page checks). */
  canManageSettings: boolean
}

/** Loaded on demand when a row is opened, so the list itself stays one query per page. */
type EngagementState =
  | { status: 'loading' }
  | { status: 'ready'; data: BusinessContactEngagement }
  | { status: 'error'; message: string }

/** Number of columns in the contacts table, so the expanded panel spans all of them. */
const CONTACT_TABLE_COLUMNS = 10

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
  if (filters.cluster) params.set('cluster', filters.cluster)
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
  clusters,
  pendingReviewCount,
  canEdit,
  canCreate,
  canManageSettings,
}: ContactsClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [filters, setFilters] = useState<ContactFilters>(initialFilters)
  const [eligibilityTarget, setEligibilityTarget] = useState<BusinessContact[] | null>(null)
  const [editTarget, setEditTarget] = useState<BusinessContact | null>(null)
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<BusinessContact | null>(null)
  const [resubscribeTarget, setResubscribeTarget] = useState<BusinessContact | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [engagement, setEngagement] = useState<Record<string, EngagementState>>({})

  /**
   * Opens one row at a time and fetches its engagement the first time it is opened.
   *
   * Loaded here rather than with the list because it costs several queries per contact, and
   * the answer only matters for the one row someone is actually looking at. A failed load is
   * not cached, so closing and reopening retries.
   */
  async function toggleExpanded(contactId: string) {
    const next = expandedId === contactId ? null : contactId
    setExpandedId(next)
    if (next === null) return

    const existing = engagement[contactId]
    if (existing && existing.status !== 'error') return

    setEngagement((prev) => ({ ...prev, [contactId]: { status: 'loading' } }))
    const result = await getBusinessContactEngagement(contactId)
    setEngagement((prev) => ({
      ...prev,
      [contactId]: result.data
        ? { status: 'ready', data: result.data }
        : { status: 'error', message: result.error ?? 'Could not load engagement' },
    }))
  }

  const allOnPageSelected =
    initialContacts.length > 0 && initialContacts.every((contact) => selectedIds.has(contact.id))

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        initialContacts.forEach((contact) => next.delete(contact.id))
      } else {
        initialContacts.forEach((contact) => next.add(contact.id))
      }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedContacts = initialContacts.filter((contact) => selectedIds.has(contact.id))

  // A suggestion, never a decision. It exists so reviewing a long list is a matter of
  // confirming rather than typing, and it only ever proposes 'corporate' where the evidence
  // is an incorporation suffix or a public body.
  const suggestions = new Map(
    initialContacts.map((contact) => [
      contact.id,
      suggestSubscriberType({
        companyName: contact.companyName,
        email: contact.email,
        isFreemail: contact.isFreemail,
      }),
    ]),
  )

  const clearCorporate = initialContacts.filter(
    (contact) =>
      contact.eligibilityStatus === 'pending_review' &&
      suggestions.get(contact.id)?.suggestion === 'corporate' &&
      suggestions.get(contact.id)?.confidence === 'high',
  )

  function selectClearCorporate() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      clearCorporate.forEach((contact) => next.add(contact.id))
      return next
    })
  }

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

  // Only clusters that actually have contacts are offered. Most of the list has none, so a
  // full list of possible labels would mostly be dead ends.
  const clusterOptions = useMemo(
    () => [
      { value: '', label: 'Any area' },
      ...clusters.map((entry) => ({
        value: entry.cluster,
        label: `${entry.cluster} (${entry.count})`,
      })),
    ],
    [clusters],
  )

  const hasFilters = Boolean(
    filters.search || filters.tag || filters.cluster || filters.eligibility || filters.status,
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
      {...marketingLayout('contacts', { canManageSettings })}
      headerActions={
        canCreate ? (
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            Import Contacts
          </Button>
        ) : undefined
      }
    >
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
                Review Them
              </LinkButton>
            </div>
          </Alert>
        )}

        {/* Filters sit directly above the list they filter. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            {/* SearchInput fires `onChange ?? onSearch`, never both, so the search handler
                goes on onChange. debounceDelay makes it hold a draft while typing. */}
            <SearchInput
              value={filters.search}
              debounceDelay={400}
              onChange={(value) => applyFilters({ ...filters, search: value })}
              placeholder="Search name, email or company"
              aria-label="Search contacts"
              className="w-full sm:w-72"
            />
            <div className="w-full sm:w-48">
              <Select
                aria-label="Filter by tag"
                options={tagOptions}
                value={filters.tag}
                onChange={(event) => applyFilters({ ...filters, tag: event.target.value })}
                fullWidth
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                aria-label="Filter by area"
                options={clusterOptions}
                value={filters.cluster}
                onChange={(event) => applyFilters({ ...filters, cluster: event.target.value })}
                fullWidth
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                aria-label="Filter by eligibility"
                options={ELIGIBILITY_OPTIONS}
                value={filters.eligibility}
                onChange={(event) => applyFilters({ ...filters, eligibility: event.target.value })}
                fullWidth
              />
            </div>
            <div className="w-full sm:w-48">
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
                onClick={() =>
                  applyFilters({ search: '', tag: '', cluster: '', eligibility: '', status: '' })
                }
              >
                Clear
              </Button>
            )}
          </div>
          {filters.cluster && (
            <p className="text-sm text-text-muted">
              Areas group businesses into a walkable round, so this is the list for one morning
              of visits.
            </p>
          )}
        </div>

        <Card padding="none">
          {initialContacts.length === 0 ? (
            <Empty
              size="sm"
              icon="users"
              title={hasFilters ? 'No contacts match these filters' : 'No contacts yet'}
              description={
                hasFilters
                  ? 'Try a wider search, or clear the filters to see everyone.'
                  : 'Import a CSV of business contacts to get started. Everyone arrives waiting for eligibility review, and nobody can be emailed until that review is done.'
              }
              action={
                canCreate && !hasFilters ? (
                  <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
                    Import Contacts
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {clearCorporate.length > 0 && (
                <div className="flex flex-col gap-2 border-b border-border px-pad-card py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-sm text-text">
                    {clearCorporate.length} on this page look like limited companies or public
                    bodies, which can be emailed without asking first. You still confirm them.
                  </p>
                  <Button size="sm" variant="secondary" onClick={selectClearCorporate}>
                    Select Those {clearCorporate.length}
                  </Button>
                </div>
              )}

              {selectedContacts.length > 0 && (
                <div className="flex flex-col gap-2 border-b border-border bg-surface-2 px-pad-card py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-sm text-text">
                    {selectedContacts.length} selected on this page
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setSelectedIds(new Set())}>
                      Clear Selection
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setEligibilityTarget(selectedContacts)}>
                      Set Eligibility Together
                    </Button>
                  </div>
                </div>
              )}

              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Checkbox
                          aria-label="Select all contacts on this page"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                        />
                      </TableHead>
                      <TableHead>
                        <span className="sr-only">Show details</span>
                      </TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead align="right">Clicks</TableHead>
                      <TableHead>Eligibility</TableHead>
                      <TableHead>Marketing</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {initialContacts.map((contact) => (
                      <Fragment key={contact.id}>
                      <TableRow>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${contact.email}`}
                            checked={selectedIds.has(contact.id)}
                            onChange={() => toggleOne(contact.id)}
                          />
                        </TableCell>
                        <TableCell>
                          {/* Its own control rather than a clickable row: the row already
                              carries a checkbox and four buttons, and on an iPad a row-wide
                              tap target swallows all of them. */}
                          <IconButton
                            type="button"
                            variant="ghost"
                            aria-expanded={expandedId === contact.id}
                            label={
                              expandedId === contact.id
                                ? `Hide details for ${contact.email}`
                                : `Show details for ${contact.email}`
                            }
                            icon={
                              <Icon
                                name={expandedId === contact.id ? 'chevronDown' : 'chevronRight'}
                                size={18}
                              />
                            }
                            // Inset ring: the table scrolls sideways and would clip an outer one.
                            className="h-11 w-11 text-text-muted hover:text-text focus-visible:shadow-ring-inset"
                            onClick={() => toggleExpanded(contact.id)}
                          />
                        </TableCell>
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
                        <TableCell align="right">
                          {contact.clicks > 0 ? (
                            <span className="font-medium text-text">{contact.clicks}</span>
                          ) : (
                            <span className="text-text-muted">-</span>
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
                                  onClick={() => setEligibilityTarget([contact])}
                                >
                                  Set Eligibility
                                </Button>
                                {contact.marketingStatus === 'subscribed' ? (
                                  // Secondary, not danger: Resubscribe undoes it from this screen.
                                  <Button
                                    variant="secondary"
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

                      {expandedId === contact.id && (
                        <TableRow>
                          <TableCell
                            colSpan={CONTACT_TABLE_COLUMNS}
                            className="whitespace-normal bg-surface-2 align-top"
                          >
                            <ContactDetailPanel
                              contact={contact}
                              engagement={engagement[contact.id]}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>

              {totalPages > 1 && (
                <TablePagination
                  page={initialPage}
                  totalPages={totalPages}
                  onPageChange={goToPage}
                  pageSize={pageSize}
                  totalItems={initialTotal}
                />
              )}
            </>
          )}
        </Card>

        {isPending && <PageLoading inline label="Loading contacts" className="py-4" />}

        {/* No link to Settings: it is a tab in the row above. That tab only shows with
            marketing:manage, so only those users are pointed at it (as on the Campaigns tab). */}
        <p className="text-sm text-text-muted">
          Contacts are business addresses only.{' '}
          {canManageSettings
            ? 'Sending is controlled in the Settings tab.'
            : 'Sending is controlled by whoever manages marketing settings.'}
        </p>

      {eligibilityTarget && eligibilityTarget.length > 0 && (
        <EligibilityModal
          contacts={eligibilityTarget}
          onClose={() => setEligibilityTarget(null)}
          onSaved={() => {
            setEligibilityTarget(null)
            setSelectedIds(new Set())
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
        title="Unsubscribe Contact"
        message={
          <span>
            Stop marketing email to {unsubscribeTarget?.email}? They will be added to the
            do-not-contact list. That record outlives the contact, so a future import cannot bring
            them back by accident.
          </span>
        }
        confirmLabel="Unsubscribe"
        tone="primary"
      />

      <ConfirmDialog
        open={Boolean(resubscribeTarget)}
        onClose={() => setResubscribeTarget(null)}
        onConfirm={async () => {
          if (resubscribeTarget) await handleResubscribe(resubscribeTarget)
          setResubscribeTarget(null)
        }}
        title="Resubscribe Contact"
        message={
          <span>
            Add {resubscribeTarget?.email} back to marketing email? Only do this if they have
            asked to hear from us again. Their objection will be removed from the do-not-contact
            list.
          </span>
        }
        confirmLabel="Resubscribe"
        tone="primary"
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

/**
 * One researched fact, as a label and its value inside a <dl>. Renders nothing at all when
 * there is nothing to say. `note` adds a line of help under the value.
 */
function DetailFact({ label, value, note }: { label: string; value: string | null; note?: string }) {
  if (!value) return null

  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-text break-words">{value}</dd>
      {note && <dd className="mt-1 text-xs text-text-muted">{note}</dd>}
    </div>
  )
}

/**
 * The researched context behind a contact, plus what they have done with our email.
 *
 * The two prose fields lead, because they are what the owner actually reads before writing to
 * somebody. The short facts sit underneath as a row of labels, and engagement comes last: it
 * answers a different question and only exists once a campaign has gone out.
 */
function ContactDetailPanel({
  contact,
  engagement,
}: {
  contact: BusinessContactWithClicks
  engagement: EngagementState | undefined
}) {
  const hasResearch = Boolean(
    contact.angle ||
      contact.openingLine ||
      contact.roomFit ||
      contact.roomFitNote ||
      contact.distanceNote ||
      contact.staffEstimate ||
      contact.sendTiming ||
      contact.cluster ||
      contact.notes,
  )

  const roomFit = [contact.roomFit, contact.roomFitNote].filter(Boolean).join(' - ')

  return (
    <div className="space-y-5 py-2">
      {hasResearch ? (
        <>
          <dl className="grid gap-4 md:grid-cols-2">
            <DetailFact label="Why they should care" value={contact.angle} />
            <DetailFact
              label="Opening line"
              value={contact.openingLine}
              note="Written for a one-to-one approach. It is never merged into a campaign email."
            />
          </dl>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <DetailFact label="Fits our room" value={roomFit || null} />
            <DetailFact label="Distance" value={contact.distanceNote} />
            <DetailFact label="Staff" value={contact.staffEstimate} />
            <DetailFact label="Best time to contact" value={contact.sendTiming} />
            <DetailFact label="Area" value={contact.cluster} />
          </dl>

          {contact.notes && (
            <dl>
              <DetailFact label="Notes" value={contact.notes} />
            </dl>
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted">
          No researched context for this contact yet.
        </p>
      )}

      <div className="border-t border-border pt-4">
        {/* h3: the contacts table sits in a Card with no CardHeader. */}
        <SubHeading as="h3">Engagement</SubHeading>
        {engagement === undefined || engagement.status === 'loading' ? (
          <PageLoading inline label="Loading engagement" className="py-4" />
        ) : engagement.status === 'error' ? (
          <Alert tone="danger" size="sm" title="Could not load engagement" className="mt-2">
            <span className="break-words">{engagement.message}</span>
          </Alert>
        ) : (
          <>
            <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <DetailFact label="Campaigns sent" value={String(engagement.data.campaignsSent)} />
              <DetailFact label="Delivered" value={String(engagement.data.delivered)} />
              <DetailFact label="Bounced" value={String(engagement.data.bounced)} />
              <DetailFact
                label="Link clicks"
                value={
                  engagement.data.lastClickedAt
                    ? `${engagement.data.clicks}, last ${formatDateTimeInLondon(engagement.data.lastClickedAt)}`
                    : String(engagement.data.clicks)
                }
              />
              <DetailFact label="Bookings" value={String(engagement.data.conversions.bookings)} />
              <DetailFact
                label="Enquiries"
                value={
                  engagement.data.lastConversionAt
                    ? `${engagement.data.conversions.enquiries}, last ${formatDateTimeInLondon(engagement.data.lastConversionAt)}`
                    : String(engagement.data.conversions.enquiries)
                }
              />
            </dl>
            <p className="mt-2 text-xs text-text-muted">
              Clicks, bookings and enquiries are counted through our own short links, across
              every campaign this contact has been sent. An enquiry is a question, not a
              booking.
            </p>
          </>
        )}
      </div>
    </div>
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
      title="Edit Contact"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save Changes
          </Button>
        </>
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
