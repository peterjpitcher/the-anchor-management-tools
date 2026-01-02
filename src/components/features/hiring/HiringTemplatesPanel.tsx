'use client'

import { useState, useTransition } from 'react'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import toast from 'react-hot-toast'
import type { HiringJobTemplate } from '@/types/database'
import {
  listJobTemplatesAction,
  createJobTemplateAction,
  updateJobTemplateAction,
  deleteJobTemplateAction,
} from '@/actions/hiring-templates'

type TemplateFormState = {
  title: string
  description: string
  essentials_text: string
  positive_signals_text: string
  red_flags_text: string
  clarify_questions_text: string
  screening_questions: string
  interview_questions: string
  message_templates: string
  compliance_lines: string
}

type TemplateFormErrors = Partial<Record<keyof TemplateFormState, string>>

const EMPTY_FORM: TemplateFormState = {
  title: '',
  description: '',
  essentials_text: '',
  positive_signals_text: '',
  red_flags_text: '',
  clarify_questions_text: '',
  screening_questions: '[]',
  interview_questions: '[]',
  message_templates: '{}',
  compliance_lines: '[]',
}

const JSON_FIELDS: Array<{
  key: keyof TemplateFormState
  label: string
  expected: 'array' | 'object'
  help: string
  allowPlainText?: boolean
}> = [
  {
    key: 'screening_questions',
    label: 'Screening Questions (JSON)',
    expected: 'array',
    help: 'Candidate-facing questions; answers are stored on applications and used in screening. Array of strings or objects (question/label/prompt/key). Example: ["Right to work in the UK?", {"key":"availability","question":"What shifts can you cover?"}].',
  },
  {
    key: 'interview_questions',
    label: 'Interview Questions (JSON)',
    expected: 'array',
    help: 'Used in interview packs. Array of strings or objects (question/label/prompt). Example: ["Tell us about a busy service.", {"question":"What does great service mean to you?"}].',
  },
  {
    key: 'message_templates',
    label: 'Message Templates (JSON)',
    expected: 'object',
    help: 'Keys: invite, clarify, reject, feedback. Value can be a string body or object with subject/body. Variables: {{first_name}}, {{last_name}}, {{full_name}}, {{job_title}}, {{location}}, {{company}}. Example: {"invite":{"subject":"Next steps for {{job_title}}","body":"Hi {{first_name}}, ..."}}.',
  },
  {
    key: 'compliance_lines',
    label: 'Compliance Lines (JSON)',
    expected: 'array',
    help: 'Lines appended to outbound emails; write them exactly. Array of strings. Example: ["We can only proceed with candidates who have the right to work in the UK."].',
  },
]

function formatJson(value: unknown, fallback: unknown) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  try {
    if (value === null || value === undefined) {
      return JSON.stringify(fallback, null, 2)
    }
    return JSON.stringify(value, null, 2)
  } catch {
    return JSON.stringify(fallback, null, 2)
  }
}

function normalizeLineList(value: unknown) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n')
  return ''
}

function extractRubricTexts(rubric: unknown) {
  if (!rubric) {
    return { positive: '', redFlags: '', clarify: '', thresholds: undefined, notes: undefined }
  }
  if (typeof rubric === 'string') {
    return { positive: rubric, redFlags: '', clarify: '', thresholds: undefined, notes: undefined }
  }
  if (typeof rubric !== 'object' || Array.isArray(rubric)) {
    return { positive: '', redFlags: '', clarify: '', thresholds: undefined, notes: undefined }
  }

  const record = rubric as Record<string, any>
  const positive = record.positive_signals_text
    ?? (Array.isArray(record.positive_signals) ? record.positive_signals.join('\n') : '')
  const redFlags = record.red_flags_text
    ?? (Array.isArray(record.red_flags) ? record.red_flags.join('\n') : '')
  const clarify = record.clarify_questions_text
    ?? (Array.isArray(record.clarify_questions) ? record.clarify_questions.join('\n') : '')
  const fromItems = !positive && Array.isArray(record.items)
    ? record.items.map((item: any) => (item?.label || item?.key || item || '').toString()).filter(Boolean).join('\n')
    : ''

  return {
    positive: positive || fromItems,
    redFlags,
    clarify,
    thresholds: record.score_thresholds,
    notes: record.notes,
  }
}

function buildFormState(template?: HiringJobTemplate | null): TemplateFormState {
  if (!template) return { ...EMPTY_FORM }
  const rubricTexts = extractRubricTexts(template.screening_rubric)
  return {
    title: template.title || '',
    description: template.description || '',
    essentials_text: normalizeLineList(template.prerequisites),
    positive_signals_text: rubricTexts.positive || '',
    red_flags_text: rubricTexts.redFlags || '',
    clarify_questions_text: rubricTexts.clarify || '',
    screening_questions: formatJson(template.screening_questions, []),
    interview_questions: formatJson(template.interview_questions, []),
    message_templates: formatJson(template.message_templates, {}),
    compliance_lines: formatJson(template.compliance_lines, []),
  }
}

function parseJsonField(raw: string, expected: 'array' | 'object', allowPlainText?: boolean) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { value: expected === 'array' ? [] : {}, error: null }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (expected === 'array' && !Array.isArray(parsed)) {
      return { value: null, error: 'Expected a JSON array' }
    }
    if (expected === 'object' && (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null)) {
      return { value: null, error: 'Expected a JSON object' }
    }
    return { value: parsed, error: null }
  } catch {
    if (allowPlainText) {
      return { value: trimmed, error: null }
    }
    return { value: null, error: 'Invalid JSON' }
  }
}

function countLineList(value: unknown) {
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .length
  }
  return Array.isArray(value) ? value.length : 0
}

function countObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  return Object.keys(value as Record<string, unknown>).length
}

interface HiringTemplatesPanelProps {
  initialTemplates: HiringJobTemplate[]
}

export function HiringTemplatesPanel({ initialTemplates }: HiringTemplatesPanelProps) {
  const [templates, setTemplates] = useState<HiringJobTemplate[]>(initialTemplates)
  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<HiringJobTemplate | null>(null)
  const [formData, setFormData] = useState<TemplateFormState>({ ...EMPTY_FORM })
  const [formErrors, setFormErrors] = useState<TemplateFormErrors>({})
  const [deleteTarget, setDeleteTarget] = useState<HiringJobTemplate | null>(null)
  const [isPending, startTransition] = useTransition()

  const refreshTemplates = async () => {
    const result = await listJobTemplatesAction()
    if (!result.success) {
      toast.error(result.error || 'Failed to refresh templates')
      return
    }
    setTemplates(result.templates ?? [])
  }

  const openCreate = () => {
    setEditingTemplate(null)
    setFormData(buildFormState(null))
    setFormErrors({})
    setShowForm(true)
  }

  const openEdit = (template: HiringJobTemplate) => {
    setEditingTemplate(template)
    setFormData(buildFormState(template))
    setFormErrors({})
    setShowForm(true)
  }

  const handleSave = () => {
    const errors: TemplateFormErrors = {}
    const title = formData.title.trim()

    if (!title) {
      errors.title = 'Title is required'
    }

    const parsed: Record<string, unknown> = {}
    JSON_FIELDS.forEach((field) => {
      const rawValue = formData[field.key]
      const { value, error } = parseJsonField(rawValue, field.expected, field.allowPlainText)
      if (error) {
        errors[field.key] = error
      } else {
        parsed[field.key] = value
      }
    })

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    const rubricMeta = editingTemplate?.screening_rubric && typeof editingTemplate.screening_rubric === 'object' && !Array.isArray(editingTemplate.screening_rubric)
      ? editingTemplate.screening_rubric
      : null
    const rubricPayload = {
      score_thresholds: (rubricMeta as any)?.score_thresholds ?? undefined,
      notes: (rubricMeta as any)?.notes ?? undefined,
      positive_signals_text: formData.positive_signals_text.trim(),
      red_flags_text: formData.red_flags_text.trim(),
      clarify_questions_text: formData.clarify_questions_text.trim(),
    }

    const payload = {
      title,
      description: formData.description.trim() || null,
      prerequisites: formData.essentials_text.trim(),
      screening_questions: parsed.screening_questions,
      interview_questions: parsed.interview_questions,
      screening_rubric: rubricPayload,
      message_templates: parsed.message_templates,
      compliance_lines: parsed.compliance_lines,
    }

    startTransition(async () => {
      const result = editingTemplate
        ? await updateJobTemplateAction(editingTemplate.id, payload)
        : await createJobTemplateAction(payload)

      if (!result.success) {
        toast.error(result.error || 'Failed to save template')
        return
      }

      await refreshTemplates()
      toast.success(editingTemplate ? 'Template updated' : 'Template created')
      setShowForm(false)
    })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const result = await deleteJobTemplateAction(deleteTarget.id)
    if (!result.success) {
      toast.error(result.error || 'Failed to delete template')
      return
    }
    await refreshTemplates()
    toast.success('Template deleted')
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Job templates</h2>
          <p className="text-sm text-gray-500">
            Reuse prerequisites, screening rubrics, and message drafts across roles.
          </p>
        </div>
        <Button variant="primary" leftIcon={<PlusIcon className="h-5 w-5" />} onClick={openCreate}>
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon="document"
          title="No templates yet"
          description="Create a template to speed up new job postings."
          action={
            <Button variant="secondary" onClick={openCreate}>
              Create template
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id} variant="bordered">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-gray-900">{template.title}</div>
                  <p className="text-sm text-gray-600">
                    {template.description || 'No description'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">Prereqs: {countLineList(template.prerequisites)}</Badge>
                    <Badge variant="secondary">Screeners: {countLineList(template.screening_questions)}</Badge>
                    <Badge variant="secondary">Rubric: {countObject(template.screening_rubric)}</Badge>
                    <Badge variant="secondary">Messages: {countObject(template.message_templates)}</Badge>
                    <Badge variant="secondary">Compliance: {countLineList(template.compliance_lines)}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<PencilIcon className="h-4 w-4" />}
                    onClick={() => openEdit(template)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                    onClick={() => setDeleteTarget(template)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingTemplate ? 'Edit template' : 'New template'}
        size="xl"
        footer={
          <ModalActions>
            <Button variant="secondary" onClick={() => setShowForm(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={isPending}>
              {editingTemplate ? 'Save changes' : 'Create template'}
            </Button>
          </ModalActions>
        }
      >
        <div className="space-y-5">
          <Alert
            variant="info"
            title="How template defaults work"
            description="Templates provide defaults for jobs that select them. Jobs can override any field in the job's Advanced configuration."
          >
            <div className="space-y-2">
              <p>Use plain text lists for screening criteria. Each item should be on its own line.</p>
              <p>JSON fields are still used for interview questions and message templates.</p>
              <p>
                Message template keys: invite, clarify, reject, feedback. Variables:{' '}
                {'{{first_name}}'}, {'{{last_name}}'}, {'{{full_name}}'}, {'{{job_title}}'}, {'{{location}}'}, {'{{company}}'}.
              </p>
              <p>Tip: Keep criteria short and specific so the AI can quote them verbatim.</p>
            </div>
          </Alert>

          <FormGroup label="Template title" error={formErrors.title} required>
            <Input
              value={formData.title}
              onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="e.g. Part-time Bartender"
            />
          </FormGroup>

          <FormGroup label="Description" error={formErrors.description}>
            <Textarea
              value={formData.description}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              placeholder="Short summary of when to use this template."
            />
          </FormGroup>

          <FormGroup label="Essentials (one per line)" error={formErrors.essentials_text}>
            <Textarea
              value={formData.essentials_text}
              onChange={(event) => setFormData((prev) => ({ ...prev, essentials_text: event.target.value }))}
              rows={5}
              placeholder="Lives within 15 minutes of TW19 6AQ"
            />
          </FormGroup>

          <FormGroup label="Positive signals (one per line)" error={formErrors.positive_signals_text}>
            <Textarea
              value={formData.positive_signals_text}
              onChange={(event) => setFormData((prev) => ({ ...prev, positive_signals_text: event.target.value }))}
              rows={5}
              placeholder="Solo shifts, cellar work, stock handling"
            />
          </FormGroup>

          <FormGroup label="Red flags (one per line)" error={formErrors.red_flags_text}>
            <Textarea
              value={formData.red_flags_text}
              onChange={(event) => setFormData((prev) => ({ ...prev, red_flags_text: event.target.value }))}
              rows={4}
              placeholder="Only weekdays, looking for temporary work"
            />
          </FormGroup>

          <FormGroup label="Clarify questions" error={formErrors.clarify_questions_text}>
            <Textarea
              value={formData.clarify_questions_text}
              onChange={(event) => setFormData((prev) => ({ ...prev, clarify_questions_text: event.target.value }))}
              rows={4}
              placeholder="Can you prove right to work in the UK before a trial shift?"
            />
          </FormGroup>

          {JSON_FIELDS.map((field) => (
            <FormGroup
              key={field.key}
              label={field.label}
              help={field.help}
              error={formErrors[field.key]}
            >
              <Textarea
                value={formData[field.key]}
                onChange={(event) => setFormData((prev) => ({ ...prev, [field.key]: event.target.value }))}
                rows={6}
                className="font-mono text-sm"
              />
            </FormGroup>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete template"
        message="This removes the template but does not change existing jobs."
        type="danger"
        confirmText="Delete"
        destructive
      />
    </div>
  )
}
