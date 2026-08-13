'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageLayout,
  Spinner,
  Textarea,
  toast,
} from '@/ds'
import {
  createMarketingCampaign,
  lintMarketingCampaignContent,
  scheduleMarketingCampaign,
} from '@/app/actions/marketing-campaigns'
import { previewMarketingAudience } from '@/app/actions/marketing-contacts'
import { londonLocalInputToUtcIso } from '@/lib/dateUtils'
import type { AudiencePreview, MarketingTagCount } from '@/types/marketing'

import { MARKETING_SECTION_NAV } from '../../_shared/marketing-ui'

interface NewCampaignClientProps {
  tags: MarketingTagCount[]
  canSend: boolean
}

interface ContentIssue {
  index: number | null
  type: string | null
  message: string
}

/**
 * The server flattens content problems into one sentence before returning them, so the
 * structure has to be recovered here to list them one per line. The shape it produces is
 * `Campaign content is invalid. block 3 (hero_image): url: Required; block 5 (x): ...`, built
 * by `parseCampaignContent` in `src/services/marketing-campaigns.ts`. Anything that does not
 * match falls through as a single unstructured issue rather than being dropped, so a message
 * in a shape this does not expect is still shown to the person who has to fix it.
 */
function parseContentIssues(message: string): ContentIssue[] {
  const prefix = 'Campaign content is invalid.'
  if (!message.startsWith(prefix)) {
    return [{ index: null, type: null, message }]
  }

  const body = message.slice(prefix.length).trim()
  if (!body) return [{ index: null, type: null, message }]

  return body.split('; ').map((part) => {
    const match = part.match(/^block (\d+|\?) \((.+?)\): (.*)$/)
    if (!match) return { index: null, type: null, message: part }

    const [, rawIndex, type, detail] = match
    const index = rawIndex === '?' ? null : Number.parseInt(rawIndex ?? '', 10)
    return {
      index: Number.isFinite(index) ? (index as number) : null,
      type: type ?? null,
      message: detail ?? part,
    }
  })
}

export function NewCampaignClient({ tags, canSend }: NewCampaignClientProps) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [contentJson, setContentJson] = useState('')

  const [includeTags, setIncludeTags] = useState<string[]>([])
  const [excludeTags, setExcludeTags] = useState<string[]>([])
  const [scheduledLocal, setScheduledLocal] = useState('')

  const [issues, setIssues] = useState<ContentIssue[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [checked, setChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)

  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // The preview is the number a human approves before a send, so it is refreshed whenever the
  // tags change rather than only on save.
  useEffect(() => {
    let cancelled = false
    setPreviewLoading(true)

    const timer = setTimeout(async () => {
      const result = await previewMarketingAudience({ includeTags, excludeTags })
      if (cancelled) return

      setPreviewLoading(false)
      if (result.error || !result.data) {
        setPreview(null)
        setPreviewError(result.error ?? 'Could not work out who this would reach')
        return
      }
      setPreviewError(null)
      setPreview(result.data)
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [includeTags, excludeTags])

  const parseJson = useCallback((): unknown | null => {
    try {
      return JSON.parse(contentJson)
    } catch (error) {
      setIssues([
        {
          index: null,
          type: null,
          message: `That is not valid JSON. ${
            error instanceof Error ? error.message : 'Check the brackets and commas.'
          }`,
        },
      ])
      setWarnings([])
      setChecked(false)
      return null
    }
  }, [contentJson])

  async function handleCheckContent() {
    const parsed = parseJson()
    if (parsed === null) return

    setChecking(true)
    const result = await lintMarketingCampaignContent(parsed)
    setChecking(false)

    if (result.error) {
      setIssues(parseContentIssues(result.error))
      setWarnings([])
      setChecked(false)
      return
    }

    setIssues([])
    setWarnings(result.data ?? [])
    setChecked(true)
    toast.success('Content looks valid.')
  }

  async function createDraft(): Promise<string | null> {
    if (!name.trim() || !subject.trim() || !preheader.trim()) {
      toast.error('Give the campaign a name, a subject and a preheader.')
      return null
    }

    const parsed = parseJson()
    if (parsed === null) return null

    const result = await createMarketingCampaign({
      name: name.trim(),
      subject: subject.trim(),
      preheader: preheader.trim(),
      content: parsed,
      audience: { includeTags, excludeTags },
    })

    if (result.error || !result.data) {
      setIssues(parseContentIssues(result.error ?? 'Could not save the campaign'))
      setChecked(false)
      toast.error('The campaign was not saved. See the problems listed below.')
      return null
    }

    setIssues([])
    return result.data.id
  }

  async function handleSaveDraft() {
    setSaving(true)
    const id = await createDraft()
    setSaving(false)
    if (!id) return

    toast.success('Draft saved.')
    router.push(`/marketing/campaigns/${id}`)
  }

  async function handleSaveAndSchedule() {
    if (!scheduledLocal) {
      toast.error('Pick a date and time to send it.')
      return
    }

    const scheduledFor = londonLocalInputToUtcIso(scheduledLocal)
    if (!scheduledFor) {
      toast.error('That send time is not a valid date.')
      return
    }

    setSaving(true)
    const id = await createDraft()
    if (!id) {
      setSaving(false)
      return
    }

    const result = await scheduleMarketingCampaign(id, { scheduledFor })
    setSaving(false)

    if (result.error) {
      toast.error(`Saved as a draft, but not scheduled: ${result.error}`)
      router.push(`/marketing/campaigns/${id}`)
      return
    }

    toast.success('Campaign scheduled.')
    router.push(`/marketing/campaigns/${id}`)
  }

  function toggleTag(list: string[], setList: (next: string[]) => void, tag: string) {
    setList(list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag])
  }

  async function handleJsonFile(file: File) {
    const text = await file.text()
    setContentJson(text)
    setChecked(false)
    setIssues([])
    setWarnings([])
  }

  return (
    <PageLayout
      title="New campaign"
      subtitle="Paste the content, choose who it goes to, then save or schedule"
      navItems={MARKETING_SECTION_NAV}
      backButton={{ label: 'Campaigns', href: '/marketing' }}
    >
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="The basics"
            subtitle="The subject and preheader are what people see in their inbox"
          />
          <CardBody>
            <div className="space-y-4">
              <Input
                label="Campaign name"
                hint="For staff only. Nobody outside sees this."
                value={name}
                onChange={(event) => setName(event.target.value)}
                fullWidth
              />
              <Input
                label="Subject line"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                fullWidth
              />
              <Input
                label="Preheader"
                hint="The preview line after the subject. Around 85 characters reads best."
                value={preheader}
                onChange={(event) => setPreheader(event.target.value)}
                fullWidth
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Content"
            subtitle="Written as a JSON content file, then pasted or uploaded here"
          />
          <CardBody>
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Input
                    type="file"
                    accept=".json,application/json"
                    label="Upload a .json file"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void handleJsonFile(file)
                    }}
                    fullWidth
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={handleCheckContent}
                  loading={checking}
                  disabled={!contentJson.trim()}
                >
                  Check content
                </Button>
              </div>

              <Field
                label="Or paste the JSON here"
                hint="The blocks are fixed layouts. Anything the renderer does not recognise is listed below rather than silently dropped."
              >
                <Textarea
                  value={contentJson}
                  onChange={(event) => {
                    setContentJson(event.target.value)
                    setChecked(false)
                  }}
                  rows={14}
                  className="font-mono text-xs"
                  spellCheck={false}
                  fullWidth
                />
              </Field>

              {issues.length > 0 && (
                <Alert tone="danger" title="This content cannot be used yet">
                  <ul className="space-y-2">
                    {issues.map((issue, position) => (
                      <li key={`${issue.index ?? 'x'}-${position}`} className="min-w-0">
                        <span className="font-medium">
                          {issue.index === null ? 'Content' : `Block ${issue.index}`}
                          {issue.type ? ` (${issue.type})` : ''}
                        </span>
                        {': '}
                        <span className="break-words">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              {checked && warnings.length > 0 && (
                <Alert tone="warning" title="Worth a second look">
                  <ul className="list-disc space-y-1 pl-5">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">None of these stop you sending.</p>
                </Alert>
              )}

              {checked && warnings.length === 0 && (
                <Alert tone="success" title="Content is valid">
                  Every block is recognised and its details are complete.
                </Alert>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Who it goes to"
            subtitle="Pick tags to include. Leave them all unpicked to reach every eligible contact."
          />
          <CardBody>
            <div className="space-y-5">
              <Field label="Include these tags">
                {tags.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No tags yet. Add tags to contacts first, or leave this empty to reach
                    everyone who is eligible.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Button
                        key={`include-${tag.tag}`}
                        type="button"
                        size="sm"
                        variant={includeTags.includes(tag.tag) ? 'primary' : 'secondary'}
                        aria-pressed={includeTags.includes(tag.tag)}
                        onClick={() => toggleTag(includeTags, setIncludeTags, tag.tag)}
                      >
                        {tag.tag} ({tag.count})
                      </Button>
                    ))}
                  </div>
                )}
              </Field>

              <Field
                label="Leave out these tags"
                hint="Anyone with one of these tags is removed, even if an include tag matched."
              >
                {tags.length === 0 ? (
                  <p className="text-sm text-text-muted">No tags yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <Button
                        key={`exclude-${tag.tag}`}
                        type="button"
                        size="sm"
                        variant={excludeTags.includes(tag.tag) ? 'danger' : 'secondary'}
                        aria-pressed={excludeTags.includes(tag.tag)}
                        onClick={() => toggleTag(excludeTags, setExcludeTags, tag.tag)}
                      >
                        {tag.tag}
                      </Button>
                    ))}
                  </div>
                )}
              </Field>

              <div className="rounded-lg border border-border bg-surface-2 p-4">
                {previewLoading ? (
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Spinner size="sm" />
                    Working out who this reaches…
                  </div>
                ) : previewError ? (
                  <Alert tone="warning" title="Could not count the audience">
                    {previewError}
                  </Alert>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-3xl font-semibold text-text">
                        {preview.eligibleCount}
                      </span>
                      <span className="text-sm text-text-muted">
                        {preview.eligibleCount === 1 ? 'contact would get this' : 'contacts would get this'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="neutral">
                        Not marked eligible: {preview.excludedCounts.notEligible}
                      </Badge>
                      <Badge tone="neutral">
                        Unsubscribed: {preview.excludedCounts.unsubscribed}
                      </Badge>
                      <Badge tone="neutral">
                        Do not contact: {preview.excludedCounts.doNotContact}
                      </Badge>
                      <Badge tone="neutral">
                        Suppressed: {preview.excludedCounts.suppressed}
                      </Badge>
                    </div>
                    {preview.eligibleCount === 0 && (
                      <Alert tone="warning" title="Nobody would get this">
                        Either no contact carries these tags, or the ones who do are not marked
                        eligible yet.
                      </Alert>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="When it goes out"
            subtitle="London time. It still waits for the send window and the send switch."
          />
          <CardBody>
            <div className="space-y-4">
              <Input
                type="datetime-local"
                label="Send at"
                value={scheduledLocal}
                onChange={(event) => setScheduledLocal(event.target.value)}
                fullWidth
              />

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={handleSaveDraft} loading={saving}>
                  Save as draft
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSaveAndSchedule}
                  loading={saving}
                  disabled={!canSend || !scheduledLocal}
                >
                  Save and schedule
                </Button>
              </div>

              {!canSend && (
                <p className="text-sm text-text-muted">
                  You can save a draft, but scheduling needs the marketing send permission.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </PageLayout>
  )
}
