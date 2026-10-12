'use client'

import { useMemo, useState, useTransition } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Input, PageLayout, Textarea, toast } from '@/ds'
import { saveSigningTemplate, setSigningTemplateActive } from '@/app/actions/signing'
import { SIGNING_KIND_DEFINITIONS } from '@/lib/signing/kinds'
import { TEMPLATE_MERGE_FIELDS } from '@/lib/signing/template-fields'
import { findDraftMarkers } from '@/lib/signing/template-render'
import type { SigningTemplateRow } from '@/lib/signing/types'

interface SigningTemplatesManagerProps {
  initialTemplates: SigningTemplateRow[]
  loadError: string | null
}

/**
 * Wording for the documents that have no generator of their own, and one template per staff
 * policy. A template cannot be sent until it is switched on, and cannot be switched on while it
 * still has a gap marked [[TO CONFIRM: ...]].
 */
export default function SigningTemplatesManager({ initialTemplates, loadError }: SigningTemplatesManagerProps): React.JSX.Element {
  const [templates, setTemplates] = useState(initialTemplates)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()

  const selected = templates.find((template) => template.id === selectedId) ?? null
  const gaps = useMemo(() => [...findDraftMarkers(title), ...findDraftMarkers(body)], [title, body])
  const mergeFields = selected ? TEMPLATE_MERGE_FIELDS[selected.kind] : []
  const dirty = selected !== null && (selected.title !== title || selected.body !== body)

  const open = (template: SigningTemplateRow): void => {
    if (dirty) {
      toast.error('Save your changes, or discard them, before opening another template.')
      return
    }
    setSelectedId(template.id)
    setTitle(template.title)
    setBody(template.body)
  }

  const replace = (updated: SigningTemplateRow): void => {
    setTemplates((current) => current.map((template) => (template.id === updated.id ? updated : template)))
    setTitle(updated.title)
    setBody(updated.body)
  }

  const save = (): void => {
    if (!selected) return
    startTransition(async () => {
      const result = await saveSigningTemplate({ id: selected.id, title, body })
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not save the template.')
        return
      }
      replace(result.data)
      toast.success(
        selected.is_active && !result.data.is_active
          ? 'Saved. The template was switched off because it now has gaps to fill.'
          : 'Template saved.'
      )
    })
  }

  const toggle = (template: SigningTemplateRow): void => {
    startTransition(async () => {
      const result = await setSigningTemplateActive({ id: template.id, active: !template.is_active })
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Could not change the template.')
        return
      }
      setTemplates((current) => current.map((row) => (row.id === template.id ? result.data as SigningTemplateRow : row)))
      toast.success(result.data.is_active ? 'Switched on. This document can now be sent.' : 'Switched off. This document can no longer be sent.')
    })
  }

  return (
    <PageLayout
      title="Signing templates"
      subtitle="Wording for documents sent for signature"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        {loadError ? <Alert tone="danger" title="The templates could not be loaded">{loadError}</Alert> : null}

        <Alert tone="info" title="How templates work">
          A template can only be sent once it is switched on. Starter wording is a draft: read it, change it to match
          what you actually do, and fill every gap marked [[TO CONFIRM: ...]] before switching it on. Changing a
          template never changes a document that has already been sent or signed.
        </Alert>

        <Card>
          <CardHeader title="Templates" />
          <CardBody>
            {templates.length === 0 && !loadError ? (
              <Empty title="No templates yet" description="Templates appear here once the signing database update has been applied." />
            ) : (
              <ul className="divide-y divide-border">
                {templates.map((template) => {
                  const templateGaps = findDraftMarkers(`${template.title}\n${template.body}`).length
                  return (
                    <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium text-text-strong">{template.title}</p>
                        <p className="text-xs text-text-muted">
                          {SIGNING_KIND_DEFINITIONS[template.kind].label}, version {template.version}
                          {templateGaps > 0 ? `, ${templateGaps} ${templateGaps === 1 ? 'gap' : 'gaps'} to fill` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={template.is_active ? 'success' : 'neutral'}>{template.is_active ? 'On' : 'Off'}</Badge>
                        <Button size="sm" variant="secondary" disabled={pending} onClick={() => open(template)}>
                          Edit wording
                        </Button>
                        <Button size="sm" variant={template.is_active ? 'ghost' : 'primary'} disabled={pending} onClick={() => toggle(template)}>
                          {template.is_active ? 'Switch off' : 'Switch on'}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {selected ? (
          <Card>
            <CardHeader title={`Edit: ${selected.title}`} subtitle={`Version ${selected.version}`} />
            <CardBody>
              <div className="space-y-4">
                <Input label="Title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
                <Textarea
                  label="Wording"
                  hint="Start a line with ## for a heading or - for a bullet. Leave a blank line between paragraphs."
                  rows={24}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                {mergeFields.length > 0 ? (
                  <p className="text-sm text-text-muted">
                    You can use these, and they are filled in when the document is sent: {mergeFields.map((field) => `{{${field}}}`).join(', ')}.
                  </p>
                ) : null}
                {gaps.length > 0 ? (
                  <Alert tone="warning" title={`${gaps.length} ${gaps.length === 1 ? 'gap' : 'gaps'} still to fill`}>
                    {gaps.slice(0, 8).join(' ')}
                    {gaps.length > 8 ? ' ...' : ''}
                  </Alert>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" loading={pending} disabled={!dirty} onClick={save}>
                    Save wording
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setSelectedId(null)}
                  >
                    {dirty ? 'Discard changes' : 'Close'}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </PageLayout>
  )
}
