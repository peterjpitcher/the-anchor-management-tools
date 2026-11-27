'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Badge, Button, Card, Checkbox, ConfirmDialog, DateTimePicker, Drawer, Empty, Field,
  FormFooter, Input, Modal, PageLoading, Select, SubHeading, Textarea, toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { formatDateInLondon, shiftIsoDate } from '@/lib/dateUtils'
import {
  describeSeriesSchedule,
  formatSeriesTime,
  isSeriesWeekday,
  isoWeekdayName,
  resolveSeriesOccurrences,
  type EventSeriesStatus,
  type SeriesSpecialHoursDay,
} from '@/lib/events/series'
import {
  createEventSeries,
  endEventSeries,
  listEventSeries,
  setEventSeriesPaused,
  skipEventSeriesDate,
  unskipEventSeriesDate,
  updateEventSeries,
  type EventSeriesInput,
  type EventSeriesListItem,
} from '@/app/actions/event-series'
import type { EventCategory } from '@/types/event-categories'
import { parseKeywords, keywordsToDisplay } from '@/lib/keywords'
import { KeywordStrategyCard } from '@/components/features/events/KeywordStrategyCard'
import { suggestFocusPhrase } from '@/lib/event-seo/keyword-match'
import { SeriesImagePanel } from './SeriesImagePanel'
import { generateEventSeoContent } from '@/app/actions/event-content'

/** "Thursday 24 December". The day name is derived from the date, never typed. */
export function formatSeriesDate(isoDate: string): string {
  return formatDateInLondon(`${isoDate}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })
}

const STATUS_BADGE: Record<EventSeriesStatus, { tone: 'success' | 'warning' | 'neutral'; label: string }> = {
  active: { tone: 'success', label: 'Running' },
  paused: { tone: 'warning', label: 'Paused' },
  ended: { tone: 'neutral', label: 'Ended' },
}

const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: isoWeekdayName(d) }))

export interface MakeFullEventRequest {
  series: EventSeriesListItem
  date: string
}

interface RepeatingEventsPanelProps {
  categories: EventCategory[]
  canManage: boolean
  onMakeFullEvent: (request: MakeFullEventRequest) => void
  /** Bumped by the parent after a full event is made, so the list reloads. */
  refreshKey?: number
  /** The repeating event to open on: its dates start expanded. Set when its night is clicked on the calendar. */
  focusSeriesId?: string | null
  /** Called after every saved change (create, edit, skip, undo, pause, end), so the calendar reloads its nights. */
  onSeriesChanged?: () => void
}

function showResult(result: { error?: string; data?: { warning?: string } }, success: string): boolean {
  if (result.error) {
    toast.error(result.error)
    return false
  }
  toast.success(success)
  if (result.data?.warning) toast.warning(result.data.warning)
  return true
}

export function RepeatingEventsPanel({ categories, canManage, onMakeFullEvent, refreshKey = 0, focusSeriesId = null, onSeriesChanged }: RepeatingEventsPanelProps) {
  const [series, setSeries] = useState<EventSeriesListItem[] | null>(null)
  const [closedDays, setClosedDays] = useState<SeriesSpecialHoursDay[]>([])
  const [today, setToday] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EventSeriesListItem | 'new' | null>(null)
  const [skipping, setSkipping] = useState<EventSeriesListItem | null>(null)
  const [ending, setEnding] = useState<EventSeriesListItem | null>(null)
  const [pausing, setPausing] = useState<EventSeriesListItem | null>(null)
  const [expanded, setExpanded] = useState<string | null>(focusSeriesId)

  const load = useCallback(async () => {
    const result = await listEventSeries()
    if (result.error || !result.data) {
      setLoadError(result.error ?? 'Repeating events could not be loaded')
      return
    }
    setLoadError(null)
    setSeries(result.data.series)
    setClosedDays(result.data.closedDays)
    setToday(result.data.today)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function reloadAfterChange() {
    onSeriesChanged?.()
    await load()
  }

  async function undoSkip(item: EventSeriesListItem, date: string) {
    const result = await unskipEventSeriesDate({ seriesId: item.id, date })
    if (showResult(result, `${formatSeriesDate(date)} is back on`)) await reloadAfterChange()
  }

  if (loadError) {
    return (
      <Alert
        tone="danger"
        title="Repeating events could not be loaded"
        actions={<Button type="button" variant="secondary" size="sm" onClick={() => void load()}>Try Again</Button>}
      >
        {loadError}
      </Alert>
    )
  }
  if (!series) return <PageLoading inline label="Loading repeating events" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          A night that runs every week. It has no bookings, tickets, texts or checklist. Make one date a full event when it needs them.
        </p>
        {canManage && (
          <Button type="button" variant="primary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => setEditing('new')}>
            New repeating event
          </Button>
        )}
      </div>

      {series.length === 0 ? (
        <Empty title="No repeating events yet" description="Set up a night that runs on the same day every week." />
      ) : (
        <ul className="space-y-3">
          {series.map((item) => {
            const badge = STATUS_BADGE[item.status]
            const isOpen = expanded === item.id
            const dates = [
              ...item.upcoming.map((o) => ({ date: o.date, skip: null as null | (typeof item.upcomingSkipped)[number] })),
              ...item.upcomingSkipped.map((s) => ({ date: s.date, skip: s })),
            ]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 12)
            return (
              <li key={item.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SubHeading as="h3">{item.name}</SubHeading>
                        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                      </div>
                      <p className="text-sm text-text">{describeSeriesSchedule(item)}</p>
                      <p className="text-sm text-text-muted">
                        {item.status === 'active'
                          ? item.nextOccurrence
                            ? `Next: ${formatSeriesDate(item.nextOccurrence.date)}`
                            : 'No dates ahead'
                          : item.status === 'paused'
                            ? 'Hidden from the website and calendar until resumed'
                            : `Ended${item.endsOn ? ` after ${formatSeriesDate(item.endsOn)}` : ''}`}
                        {item.status !== 'ended' && item.endsOn ? `. Last date ${formatSeriesDate(item.endsOn)}` : ''}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(item)}>Edit</Button>
                        {item.status === 'active' && (
                          <Button type="button" variant="secondary" size="sm" onClick={() => setSkipping(item)}>Skip a date</Button>
                        )}
                        {item.status !== 'ended' && (
                          <Button type="button" variant="secondary" size="sm" onClick={() => setPausing(item)}>
                            {item.status === 'paused' ? 'Resume' : 'Pause'}
                          </Button>
                        )}
                        <Button type="button" variant="secondary" size="sm" onClick={() => setEnding(item)}>
                          {item.status === 'ended' ? 'Restart' : 'End the run'}
                        </Button>
                      </div>
                    )}
                  </div>

                  {item.status !== 'ended' && dates.length > 0 && (
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : item.id)}
                      >
                        {isOpen ? 'Hide dates' : 'Show the next 12 dates'}
                      </Button>
                      {isOpen && (
                        <ul className="mt-2 divide-y divide-border rounded-default border border-border">
                          {dates.map(({ date, skip }) => (
                            <li key={date} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                              <span className={skip ? 'text-text-muted line-through' : 'text-text'}>
                                {formatSeriesDate(date)}
                              </span>
                              <span className="flex flex-wrap items-center gap-2">
                                {skip?.kind === 'manual' && (
                                  <span className="text-xs text-text-muted">Skipped{skip.reason ? `: ${skip.reason}` : ''}</span>
                                )}
                                {skip?.kind === 'closed' && <span className="text-xs text-text-muted">Pub closed (special hours)</span>}
                                {skip?.kind === 'replaced' && <span className="text-xs text-text-muted">A full event this week</span>}
                                {canManage && skip?.kind === 'manual' && (
                                  <Button type="button" variant="ghost" size="sm" onClick={() => void undoSkip(item, date)}>Undo</Button>
                                )}
                                {canManage && !skip && item.status === 'active' && (
                                  <Button type="button" variant="ghost" size="sm" onClick={() => onMakeFullEvent({ series: item, date })}>
                                    Make this date a full event
                                  </Button>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <SeriesDrawer
        open={editing !== null}
        series={editing === 'new' ? null : editing}
        categories={categories}
        closedDays={closedDays}
        today={today}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await reloadAfterChange()
        }}
        onImagesChanged={load}
      />

      <SkipDateModal
        series={skipping}
        onClose={() => setSkipping(null)}
        onSaved={async () => {
          setSkipping(null)
          await reloadAfterChange()
        }}
      />

      <EndRunModal
        series={ending}
        onClose={() => setEnding(null)}
        onSaved={async () => {
          setEnding(null)
          await reloadAfterChange()
        }}
      />

      <ConfirmDialog
        open={pausing !== null}
        onClose={() => setPausing(null)}
        title={pausing?.status === 'paused' ? `Resume ${pausing?.name}?` : `Pause ${pausing?.name ?? ''}?`}
        message={
          pausing?.status === 'paused'
            ? 'It will show on the website and the Pub Ops calendar again.'
            : 'It will be hidden from the website and the Pub Ops calendar until you resume it. Nothing is deleted.'
        }
        confirmLabel={pausing?.status === 'paused' ? 'Resume' : 'Pause'}
        onConfirm={async () => {
          if (!pausing) return
          const result = await setEventSeriesPaused({ seriesId: pausing.id, paused: pausing.status !== 'paused' })
          if (showResult(result, pausing.status === 'paused' ? 'Resumed' : 'Paused')) {
            setPausing(null)
            await reloadAfterChange()
          }
        }}
      />
    </div>
  )
}

interface SeriesFormState {
  name: string
  slug: string
  categoryId: string
  weekday: string
  startTime: string
  endTime: string
  startsOn: string
  endsOn: string
  shortDescription: string
  pagePath: string
  isFree: boolean
  audienceNote: string
  skipWhenClosed: boolean
  price: string
  brief: string
  performerName: string
  performerType: string
  metaTitle: string
  metaDescription: string
  longDescription: string
  /** One per line. */
  highlights: string
  primaryKeywords: string
  secondaryKeywords: string
  localSeoKeywords: string
  imageAltText: string
  accessibilityNotes: string
  facebookEventName: string
  facebookEventDescription: string
  gbpEventTitle: string
  gbpEventDescription: string
  socialCopyWhatsapp: string
}

const EMPTY_DETAILS = {
  price: '', brief: '', performerName: '', performerType: '', metaTitle: '', metaDescription: '', longDescription: '',
  highlights: '', primaryKeywords: '', secondaryKeywords: '', localSeoKeywords: '', imageAltText: '', accessibilityNotes: '',
  facebookEventName: '', facebookEventDescription: '', gbpEventTitle: '', gbpEventDescription: '', socialCopyWhatsapp: '',
} satisfies Partial<SeriesFormState>

function emptyForm(today: string): SeriesFormState {
  return {
    name: '', slug: '', categoryId: '', weekday: '4', startTime: '19:00', endTime: '22:00',
    startsOn: today, endsOn: '', shortDescription: '', pagePath: '', isFree: true, audienceNote: '', skipWhenClosed: true,
    ...EMPTY_DETAILS,
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function toSeriesInput(form: SeriesFormState): EventSeriesInput {
  return {
    name: form.name,
    slug: form.slug,
    categoryId: form.categoryId || null,
    weekday: Number(form.weekday),
    startTime: form.startTime.slice(0, 5),
    endTime: form.endTime.slice(0, 5),
    startsOn: form.startsOn,
    endsOn: form.endsOn || null,
    shortDescription: form.shortDescription,
    pagePath: form.pagePath || null,
    isFree: form.isFree,
    audienceNote: form.audienceNote || null,
    skipWhenClosed: form.skipWhenClosed,
    details: {
      price: form.isFree || !form.price.trim() ? null : Number(form.price),
      brief: form.brief || null,
      performerName: form.performerName || null,
      performerType: form.performerType || null,
      metaTitle: form.metaTitle || null,
      metaDescription: form.metaDescription || null,
      longDescription: form.longDescription || null,
      highlights: form.highlights.split('\n').map((h) => h.trim()).filter(Boolean),
      primaryKeywords: parseKeywords(form.primaryKeywords),
      secondaryKeywords: parseKeywords(form.secondaryKeywords),
      localSeoKeywords: parseKeywords(form.localSeoKeywords),
      imageAltText: form.imageAltText || null,
      accessibilityNotes: form.accessibilityNotes || null,
      facebookEventName: form.facebookEventName || null,
      facebookEventDescription: form.facebookEventDescription || null,
      gbpEventTitle: form.gbpEventTitle || null,
      gbpEventDescription: form.gbpEventDescription || null,
      socialCopyWhatsapp: form.socialCopyWhatsapp || null,
    },
  }
}

/** The form's values for a saved repeating event. */
export function seriesToForm(series: EventSeriesListItem): SeriesFormState {
  const d = series.details
  return {
    name: series.name, slug: series.slug, categoryId: series.categoryId ?? '', weekday: String(series.weekday),
    startTime: series.startTime, endTime: series.endTime, startsOn: series.startsOn, endsOn: series.endsOn ?? '',
    shortDescription: series.shortDescription, pagePath: series.pagePath ?? '', isFree: series.isFree,
    audienceNote: series.audienceNote ?? '', skipWhenClosed: series.skipWhenClosed,
    price: d.price === null ? '' : d.price.toFixed(2),
    brief: d.brief ?? '', performerName: d.performerName ?? '', performerType: d.performerType ?? '',
    metaTitle: d.metaTitle ?? '', metaDescription: d.metaDescription ?? '', longDescription: d.longDescription ?? '',
    highlights: d.highlights.join('\n'),
    primaryKeywords: keywordsToDisplay(d.primaryKeywords),
    secondaryKeywords: keywordsToDisplay(d.secondaryKeywords),
    localSeoKeywords: keywordsToDisplay(d.localSeoKeywords),
    imageAltText: d.imageAltText ?? '', accessibilityNotes: d.accessibilityNotes ?? '',
    facebookEventName: d.facebookEventName ?? '', facebookEventDescription: d.facebookEventDescription ?? '',
    gbpEventTitle: d.gbpEventTitle ?? '', gbpEventDescription: d.gbpEventDescription ?? '',
    socialCopyWhatsapp: d.socialCopyWhatsapp ?? '',
  }
}

function SeriesDrawer({
  open, series, categories, closedDays, today, onClose, onSaved, onImagesChanged,
}: {
  open: boolean
  series: EventSeriesListItem | null
  categories: EventCategory[]
  closedDays: SeriesSpecialHoursDay[]
  today: string
  onClose: () => void
  onSaved: () => Promise<void>
  /** Pictures save on their own; this reloads the list without closing the drawer. */
  onImagesChanged: () => Promise<void>
}) {
  const [form, setForm] = useState<SeriesFormState>(() => emptyForm(today))
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!open) return
    setSlugTouched(Boolean(series))
    setForm(series ? seriesToForm(series) : emptyForm(today))
  }, [open, series, today])

  function set<K extends keyof SeriesFormState>(key: K, value: SeriesFormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'name' && !slugTouched) next.slug = slugify(String(value))
      return next
    })
  }

  // The same resolver as the website and calendar, run on the unsaved values.
  const preview = useMemo(() => {
    const weekday = Number(form.weekday)
    if (!form.startsOn || !/^\d{2}:\d{2}/.test(form.startTime) || !/^\d{2}:\d{2}/.test(form.endTime)) return []
    const from = today > form.startsOn ? today : form.startsOn
    const rule = {
      id: series?.id ?? 'draft', weekday, startTime: form.startTime, endTime: form.endTime, startsOn: form.startsOn,
      endsOn: form.endsOn || null, status: 'active' as const, skipWhenClosed: form.skipWhenClosed,
    }
    const skips = series?.weekday === weekday ? series.skips : []
    const to = shiftIsoDate(from, 7 * 12)
    if (!to) return []
    const { occurrences, skipped } = resolveSeriesOccurrences(rule, skips, closedDays, from, to)
    return [
      ...occurrences.map((o) => ({ date: o.date, skipped: false })),
      ...skipped.map((s) => ({ date: s.date, skipped: true })),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6)
  }, [form, closedDays, today, series])

  /** The same generator and checks as a normal event, in weekly mode: it names the day, never a date. */
  async function generateSeo() {
    if (!form.name.trim()) {
      toast.error('Add a name first')
      return
    }
    if (parseKeywords(form.primaryKeywords).length === 0) {
      toast.error('Add a focus phrase: the one search this page should be found for')
      return
    }
    setGenerating(true)
    try {
      const category = categories.find((c) => c.id === form.categoryId)
      const result = await generateEventSeoContent({
        eventId: null,
        name: form.name.trim(),
        date: null,
        time: form.startTime.slice(0, 5),
        endTime: form.endTime.slice(0, 5),
        weekly: { weekday: Number(form.weekday) },
        categoryName: category?.name ?? null,
        capacity: null,
        brief: [form.brief, form.audienceNote ? `Who it is for: ${form.audienceNote}` : ''].filter(Boolean).join('\n\n') || null,
        performerName: form.performerName || null,
        performerType: form.performerType || null,
        price: form.isFree || !form.price ? null : Number(form.price),
        isFree: form.isFree,
        bookingUrl: null,
        // A repeating event takes no bookings, so the copy never mentions a booking form.
        bookingsEnabled: false,
        existingShortDescription: form.shortDescription || null,
        existingLongDescription: form.longDescription || null,
        existingMetaTitle: form.metaTitle || null,
        existingMetaDescription: form.metaDescription || null,
        existingHighlights: form.highlights.split('\n').map((h) => h.trim()).filter(Boolean),
        primaryKeywords: parseKeywords(form.primaryKeywords),
        secondaryKeywords: parseKeywords(form.secondaryKeywords),
        localSeoKeywords: parseKeywords(form.localSeoKeywords),
      })
      if (!result.success) {
        toast.error(result.error ?? 'The copy could not be written')
        return
      }
      const d = result.data
      setForm((prev) => ({
        ...prev,
        metaTitle: d.metaTitle ?? prev.metaTitle,
        metaDescription: d.metaDescription ?? prev.metaDescription,
        shortDescription: d.shortDescription ?? prev.shortDescription,
        longDescription: d.longDescription ?? prev.longDescription,
        highlights: d.highlights?.length ? d.highlights.join('\n') : prev.highlights,
        imageAltText: d.imageAltText ?? prev.imageAltText,
        accessibilityNotes: d.accessibilityNotes ?? prev.accessibilityNotes,
      }))
      toast.success('SEO copy drafted. Read it through, then save.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The copy could not be written')
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const input = toSeriesInput(form)
      const result = series ? await updateEventSeries(series.id, input) : await createEventSeries(input)
      if (showResult(result, series ? 'Repeating event saved' : 'Repeating event created')) await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const categoryOptions = [{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]

  return (
    <Drawer open={open} onClose={onClose} title={series ? `Edit ${series.name}` : 'New repeating event'} description="Repeats weekly">
      <div className="space-y-4">
        <Field label="Name" required hint="Customer-facing, as on the website.">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Slug" required hint="Lower case and hyphens. Used to match the website page.">
          <Input
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true)
              set('slug', e.target.value)
            }}
          />
        </Field>
        <Select label="Category" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} options={categoryOptions} />
        <Select label="Day" value={form.weekday} onChange={(e) => set('weekday', e.target.value)} options={WEEKDAY_OPTIONS} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start time" required>
            <DateTimePicker type="time" value={form.startTime} onChange={(v: string) => set('startTime', v)} />
          </Field>
          <Field label="End time" required hint="Earlier than the start means after midnight.">
            <DateTimePicker type="time" value={form.endTime} onChange={(v: string) => set('endTime', v)} />
          </Field>
          <Field label="First date" required>
            <DateTimePicker type="date" value={form.startsOn} onChange={(v: string) => set('startsOn', v)} />
          </Field>
          <Field label="Last date" hint="Leave empty to carry on.">
            <DateTimePicker type="date" value={form.endsOn} onChange={(v: string) => set('endsOn', v)} />
          </Field>
        </div>
        <Field label="Short description" required hint="One or two sentences for cards and the calendar.">
          <Textarea rows={3} value={form.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} />
        </Field>
        <Field label="Who it is for" hint="For example: Women only. Under-18s need a parent with them.">
          <Input value={form.audienceNote} onChange={(e) => set('audienceNote', e.target.value)} />
        </Field>
        <Field label="Website page" hint='Starts with "/", for example /ladies-darts-night.'>
          <Input value={form.pagePath} onChange={(e) => set('pagePath', e.target.value)} />
        </Field>
        <Checkbox label="Free" description="Untick for a paid night, and give the ticket price." checked={form.isFree} onChange={(v) => set('isFree', v)} />
        {!form.isFree && (
          <Input
            label="Standard ticket price (£)"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        )}
        <Checkbox
          label="Skip any date the pub is closed"
          description="Reads special hours. A kitchen-only closure does not skip it."
          checked={form.skipWhenClosed}
          onChange={(v) => set('skipWhenClosed', v)}
        />

        <DrawerSection title="Details">
          <Field label="Brief" hint="Staff notes on what happens on the night. Feeds the SEO copy; not shown to customers.">
            <Textarea rows={4} value={form.brief} onChange={(e) => set('brief', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Host or performer" value={form.performerName} onChange={(e) => set('performerName', e.target.value)} />
            <Input label="Host or performer type" placeholder="Host, band, DJ" value={form.performerType} onChange={(e) => set('performerType', e.target.value)} />
          </div>
        </DrawerSection>

        <KeywordStrategyCard
          primaryKeywords={form.primaryKeywords}
          secondaryKeywords={form.secondaryKeywords}
          localSeoKeywords={form.localSeoKeywords}
          focusSuggestion={suggestFocusPhrase(form.name)}
          onPrimaryChange={(v) => set('primaryKeywords', v)}
          onSecondaryChange={(v) => set('secondaryKeywords', v)}
          onLocalChange={(v) => set('localSeoKeywords', v)}
        />

        <DrawerSection title="SEO and content">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-text-muted">
              Writes the search title and description, short and long descriptions, highlights and alt text from the brief and keywords. Weekly copy: it names the day, never a date.
            </p>
            <Button type="button" variant="secondary" size="sm" loading={generating} onClick={() => void generateSeo()} icon={<Icon name="edit" size={14} />}>
              Generate
            </Button>
          </div>
          <Input
            label={`Meta title (${form.metaTitle.length}/47)`}
            hint='The search title, before " | The Anchor". Say it runs weekly, and never give a date.'
            warning={form.metaTitle.length > 47 ? 'Keep it to 47 characters so search shows it whole.' : undefined}
            value={form.metaTitle}
            onChange={(e) => set('metaTitle', e.target.value)}
          />
          <Textarea
            label={`Meta description (${form.metaDescription.length}/155)`}
            hint="What it is, the day and time, where, the price."
            rows={2}
            value={form.metaDescription}
            onChange={(e) => set('metaDescription', e.target.value)}
          />
          <Textarea
            label="Long description"
            hint="The main copy on the website page. Paragraphs separated by a blank line."
            rows={6}
            value={form.longDescription}
            onChange={(e) => set('longDescription', e.target.value)}
          />
          <Textarea label="Highlights" hint="One per line, three to five." rows={4} value={form.highlights} onChange={(e) => set('highlights', e.target.value)} />
          <Input label="Image alt text" hint="What the poster shows, for someone who cannot see it." value={form.imageAltText} onChange={(e) => set('imageAltText', e.target.value)} />
          <Textarea label="Accessibility notes" rows={3} value={form.accessibilityNotes} onChange={(e) => set('accessibilityNotes', e.target.value)} />
        </DrawerSection>

        <DrawerSection title="Promotion copy">
          <Input label="Facebook event name" value={form.facebookEventName} onChange={(e) => set('facebookEventName', e.target.value)} />
          <Textarea label="Facebook event description" rows={4} value={form.facebookEventDescription} onChange={(e) => set('facebookEventDescription', e.target.value)} />
          <Input label="Google Business Profile title" value={form.gbpEventTitle} onChange={(e) => set('gbpEventTitle', e.target.value)} />
          <Textarea label="Google Business Profile description" rows={3} value={form.gbpEventDescription} onChange={(e) => set('gbpEventDescription', e.target.value)} />
          <Textarea
            label={`WhatsApp message (${form.socialCopyWhatsapp.length}/300)`}
            rows={3}
            value={form.socialCopyWhatsapp}
            onChange={(e) => set('socialCopyWhatsapp', e.target.value)}
          />
        </DrawerSection>

        <DrawerSection title="Pictures">
          <SeriesImagePanel
            key={series?.id ?? 'new'}
            seriesId={series?.id ?? null}
            images={series?.images ?? { square: null, landscape: null, social: null, story: null, printPoster: null }}
            onChanged={onImagesChanged}
          />
        </DrawerSection>

        <div className="rounded-default border border-border p-3">
          <p className="text-sm font-medium text-text-strong">
            {describeSeriesSchedule({ weekday: Number(form.weekday), startTime: form.startTime || '00:00', endTime: form.endTime || '00:00' })}
          </p>
          {preview.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">No dates ahead.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Next six dates">
              {preview.map((p) => (
                <li key={p.date} className={p.skipped ? 'text-text-muted line-through' : 'text-text'}>
                  {formatSeriesDate(p.date)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <FormFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" loading={saving} onClick={() => void save()}>
            {series ? 'Save' : 'Create'}
          </Button>
        </FormFooter>
      </div>
    </Drawer>
  )
}

function SkipDateModal({
  series, onClose, onSaved,
}: { series: EventSeriesListItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [picked, setPicked] = useState('')
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPicked('')
    setTyped('')
    setReason('')
  }, [series])

  if (!series) return null
  const options = [
    { value: '', label: 'Pick a date' },
    ...series.upcoming.slice(0, 12).map((o) => ({ value: o.date, label: formatSeriesDate(o.date) })),
  ]
  const date = typed || picked
  const wrongDay = Boolean(typed) && !isSeriesWeekday(series, typed)

  async function save() {
    if (!series || !date) return
    setSaving(true)
    try {
      const result = await skipEventSeriesDate({ seriesId: series.id, date, reason: reason || null })
      if (showResult(result, `${formatSeriesDate(date)} skipped`)) await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Skip a date: ${series.name}`}
      description={`Runs ${describeSeriesSchedule(series).replace(/^Every/, 'every')}`}
      footer={
        <FormFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" loading={saving} disabled={!date || wrongDay} onClick={() => void save()}>
            Skip this date
          </Button>
        </FormFooter>
      }
    >
      <div className="space-y-4">
        <Select label="Next twelve dates" value={picked} onChange={(e) => setPicked(e.target.value)} options={options} />
        <Field
          label="Or type a date"
          error={wrongDay ? `That is not a ${isoWeekdayName(series.weekday)}` : undefined}
        >
          <DateTimePicker type="date" value={typed} onChange={(v: string) => setTyped(v)} />
        </Field>
        <Field label="Reason (staff only)" hint="Not shown to customers.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function EndRunModal({
  series, onClose, onSaved,
}: { series: EventSeriesListItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [lastDate, setLastDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLastDate(series?.endsOn ?? '')
  }, [series])

  if (!series) return null
  const restarting = series.status === 'ended'

  async function save(value: string | null) {
    if (!series) return
    setSaving(true)
    try {
      const result = await endEventSeries({ seriesId: series.id, lastDate: value })
      if (showResult(result, value ? `Runs until ${formatSeriesDate(value)}` : 'Carries on with no last date')) await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={restarting ? `Restart ${series.name}` : `End the run: ${series.name}`}
      description={
        restarting
          ? 'Set a new last date, or carry on with none.'
          : `It still runs on the last date, then shows as ended. Runs ${formatSeriesTime(series.startTime)} to ${formatSeriesTime(series.endTime)}.`
      }
      footer={
        <FormFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          {(series.endsOn || restarting) && (
            <Button type="button" variant="secondary" loading={saving} onClick={() => void save(null)}>
              Carry on with no last date
            </Button>
          )}
          <Button type="button" variant="primary" loading={saving} disabled={!lastDate} onClick={() => void save(lastDate)}>
            Set last date
          </Button>
        </FormFooter>
      }
    >
      <Field label="Last date">
        <DateTimePicker type="date" value={lastDate} onChange={(v: string) => setLastDate(v)} />
      </Field>
    </Modal>
  )
}

/** A titled part of the drawer's form, as in the event drawer. */
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 border-t border-border pt-4">
      <SubHeading as="h3">{title}</SubHeading>
      {children}
    </section>
  )
}
