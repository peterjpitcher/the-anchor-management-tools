'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { createJobAction, updateJobAction } from '@/actions/hiring'
import type { HiringJob, HiringJobTemplate } from '@/types/database'
import { buildRubricConfig } from '@/lib/hiring/scoring-logic'

const JSON_FIELDS = [
    {
        name: 'screening_questions',
        label: 'Screening Questions (JSON)',
        expected: 'array',
        allowPlainText: false,
        help: 'Candidate-facing questions; answers are stored on applications and used in screening. Array of strings or objects (question/label/prompt/key). Example: ["Right to work in the UK?", {"key":"availability","question":"What shifts can you cover?"}].',
    },
    {
        name: 'interview_questions',
        label: 'Interview Questions (JSON)',
        expected: 'array',
        allowPlainText: false,
        help: 'Used in interview packs. Array of strings or objects (question/label/prompt). Example: ["Tell us about a busy service.", {"question":"What does great service mean to you?"}].',
    },
    {
        name: 'message_templates',
        label: 'Message Templates (JSON)',
        expected: 'object',
        allowPlainText: false,
        help: 'Keys: invite, clarify, reject, feedback. Value can be a string body or object with subject/body. Variables: {{first_name}}, {{last_name}}, {{full_name}}, {{job_title}}, {{location}}, {{company}}. Example: {"invite":{"subject":"Next steps for {{job_title}}","body":"Hi {{first_name}}, ..."}}.',
    },
    {
        name: 'compliance_lines',
        label: 'Compliance Lines (JSON)',
        expected: 'array',
        allowPlainText: false,
        help: 'Lines appended to outbound emails; write them exactly. Array of strings. Example: ["We can only proceed with candidates who have the right to work in the UK."].',
    },
] as const

type JsonFieldName = typeof JSON_FIELDS[number]['name']

function formatJsonValue(value: unknown, fallback: unknown) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value)
            return JSON.stringify(parsed, null, 2)
        } catch {
            return value
        }
    }
    return JSON.stringify(value ?? fallback, null, 2)
}

function parseJsonField(raw: string | undefined, expected: 'array' | 'object', allowPlainText?: boolean) {
    const trimmed = (raw ?? '').trim()
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

function formatDateTimeLocal(value?: string | null) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 16)
}

const JobSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be kebab-case'),
    status: z.enum(['draft', 'open', 'closed', 'archived', 'expired']),
    location: z.string().optional(),
    employment_type: z.string().optional(),
    salary_range: z.string().optional(),
    description: z.string().optional(),
    // requirements handled as comma separated string for simple UI, converted to array
    requirements: z.string().optional(),
    template_id: z.string().optional(),
    essentials_text: z.string().optional(),
    screening_questions: z.string().optional(),
    interview_questions: z.string().optional(),
    positive_signals_text: z.string().optional(),
    red_flags_text: z.string().optional(),
    clarify_questions_text: z.string().optional(),
    message_templates: z.string().optional(),
    compliance_lines: z.string().optional(),
    posting_date: z.string().optional(),
    closing_date: z.string().optional(),
})

type JobFormData = z.infer<typeof JobSchema>

interface JobFormProps {
    initialData?: HiringJob
    mode?: 'create' | 'edit'
    templates?: HiringJobTemplate[]
}

export function JobForm({ initialData, mode = 'create', templates = [] }: JobFormProps) {
    const router = useRouter()
    const rubricTexts = extractRubricTexts(initialData?.screening_rubric)
    const { register, handleSubmit, watch, setValue, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<JobFormData>({
        resolver: zodResolver(JobSchema),
        defaultValues: {
            title: initialData?.title || '',
            slug: initialData?.slug || '',
            status: initialData?.status || 'draft',
            location: initialData?.location || 'The Anchor, London',
            employment_type: initialData?.employment_type || 'Full-time',
            salary_range: initialData?.salary_range || '',
            description: initialData?.description || '',
            // flattened array to string for edit
            requirements: Array.isArray(initialData?.requirements) ? initialData?.requirements.join('\n') : '',
            template_id: initialData?.template_id || '',
            essentials_text: normalizeLineList(initialData?.prerequisites),
            positive_signals_text: rubricTexts.positive || '',
            red_flags_text: rubricTexts.redFlags || '',
            clarify_questions_text: rubricTexts.clarify || '',
            screening_questions: formatJsonValue(initialData?.screening_questions, []),
            interview_questions: formatJsonValue(initialData?.interview_questions, []),
            message_templates: formatJsonValue(initialData?.message_templates, {}),
            compliance_lines: formatJsonValue(initialData?.compliance_lines, []),
            posting_date: formatDateTimeLocal(initialData?.posting_date ?? null),
            closing_date: formatDateTimeLocal(initialData?.closing_date ?? null),
        }
    })

    // Auto-generate slug from title if in create mode and slug is empty
    const title = watch('title')
    const essentialsText = watch('essentials_text') || ''
    const positiveSignalsText = watch('positive_signals_text') || ''
    const redFlagsText = watch('red_flags_text') || ''
    const clarifyQuestionsText = watch('clarify_questions_text') || ''

    const rubricPreview = React.useMemo(() => {
        return buildRubricConfig({
            prerequisites: essentialsText,
            screening_rubric: {
                score_thresholds: rubricTexts.thresholds ?? undefined,
                notes: rubricTexts.notes ?? undefined,
                positive_signals_text: positiveSignalsText,
                red_flags_text: redFlagsText,
                clarify_questions_text: clarifyQuestionsText,
            }
        })
    }, [essentialsText, positiveSignalsText, redFlagsText, clarifyQuestionsText, rubricTexts.thresholds, rubricTexts.notes])
    React.useEffect(() => {
        if (mode === 'create' && title) {
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
            const currentSlug = watch('slug')
            if (!currentSlug || currentSlug === slug.slice(0, -1)) { // weak check if user hasn't heavily modified it
                setValue('slug', slug)
            }
        }
    }, [title, mode, setValue, watch])

    const onSubmit = async (data: JobFormData) => {
        clearErrors(JSON_FIELDS.map((field) => field.name))
        const jsonErrors: Partial<Record<JsonFieldName, string>> = {}
        const parsedJson: Record<string, unknown> = {}

        JSON_FIELDS.forEach((field) => {
            const parsed = parseJsonField(data[field.name], field.expected, field.allowPlainText)
            if (parsed.error) {
                jsonErrors[field.name] = parsed.error
            } else {
                parsedJson[field.name] = parsed.value
            }
        })

        if (Object.keys(jsonErrors).length > 0) {
            Object.entries(jsonErrors).forEach(([field, message]) => {
                if (message) {
                    setError(field as keyof JobFormData, { type: 'manual', message })
                }
            })
            toast.error('Fix the JSON fields before saving.')
            return
        }

        const { essentials_text, positive_signals_text, red_flags_text, clarify_questions_text, ...rest } = data
        const rubricMeta = initialData?.screening_rubric && typeof initialData.screening_rubric === 'object' && !Array.isArray(initialData.screening_rubric)
            ? initialData.screening_rubric
            : null
        const rubricPayload = {
            score_thresholds: rubricTexts.thresholds ?? (rubricMeta as any)?.score_thresholds ?? undefined,
            notes: rubricTexts.notes ?? (rubricMeta as any)?.notes ?? undefined,
            positive_signals_text: (positive_signals_text || '').trim(),
            red_flags_text: (red_flags_text || '').trim(),
            clarify_questions_text: (clarify_questions_text || '').trim(),
        }

        const payload = {
            ...rest,
            template_id: data.template_id || null,
            requirements: data.requirements ? data.requirements.split('\n').filter(Boolean) : [],
            prerequisites: (essentials_text || '').trim(),
            screening_rubric: rubricPayload,
            ...parsedJson,
            posting_date: data.posting_date ? new Date(data.posting_date).toISOString() : null,
            closing_date: data.closing_date ? new Date(data.closing_date).toISOString() : null,
        }

        try {
            let result
            if (mode === 'create') {
                result = await createJobAction(payload)
            } else {
                if (!initialData?.id) throw new Error('Missing ID for update')
                result = await updateJobAction(initialData.id, payload)
            }

            if (result.success) {
                toast.success(mode === 'create' ? 'Job created successfully' : 'Job updated successfully')
                router.push('/hiring')
                router.refresh()
            } else {
                toast.error(result.error || 'Something went wrong')
            }
        } catch (error) {
            console.error(error)
            toast.error('An unexpected error occurred')
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormGroup label="Job Title" error={errors.title?.message} required>
                    <Input {...register('title')} placeholder="e.g. Bar Staff" error={!!errors.title} />
                </FormGroup>

                <FormGroup label="Slug (URL)" error={errors.slug?.message} required>
                    <Input {...register('slug')} placeholder="e.g. bar-staff" error={!!errors.slug} />
                </FormGroup>

                <FormGroup label="Employment Type" error={errors.employment_type?.message}>
                    <Select {...register('employment_type')} error={!!errors.employment_type}>
                        <option value="Full-time">Full-time</option>
                        <option value="Part-time">Part-time</option>
                        <option value="Casual">Casual</option>
                        <option value="Contract">Contract</option>
                    </Select>
                </FormGroup>

                <FormGroup label="Status" error={errors.status?.message} required>
                    <Select {...register('status')} error={!!errors.status}>
                        <option value="draft">Draft</option>
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="expired">Expired</option>
                        <option value="archived">Archived</option>
                    </Select>
                </FormGroup>

                <FormGroup
                    label="Template"
                    help={templates.length ? 'Optional: base template for prerequisites, screeners, and messages.' : 'No templates yet. Create one to reuse job configs.'}
                    error={errors.template_id?.message}
                >
                    <Select {...register('template_id')} error={!!errors.template_id}>
                        <option value="">No template</option>
                        {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                                {template.title}
                            </option>
                        ))}
                    </Select>
                </FormGroup>

                <FormGroup label="Location" error={errors.location?.message}>
                    <Input {...register('location')} error={!!errors.location} />
                </FormGroup>

                <FormGroup label="Salary Range" error={errors.salary_range?.message}>
                    <Input {...register('salary_range')} placeholder="e.g. £12 - £14 per hour" error={!!errors.salary_range} />
                </FormGroup>

                <FormGroup label="Posting Date" error={errors.posting_date?.message}>
                    <Input {...register('posting_date')} type="datetime-local" error={!!errors.posting_date} />
                </FormGroup>

                <FormGroup label="Closing Date" error={errors.closing_date?.message}>
                    <Input {...register('closing_date')} type="datetime-local" error={!!errors.closing_date} />
                </FormGroup>
            </div>

            <FormGroup label="Description" error={errors.description?.message}>
                <Textarea {...register('description')} rows={5} placeholder="Job description..." error={!!errors.description} />
            </FormGroup>

            <FormGroup label="Requirements" help="Enter each requirement on a new line" error={errors.requirements?.message}>
                <Textarea {...register('requirements')} rows={5} placeholder="- Experience required..." error={!!errors.requirements} />
            </FormGroup>

            <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Screening criteria (plain text)</h3>
                    <p className="text-xs text-gray-500">One item per line. These are compiled into the internal screening rubric.</p>
                </div>
                <FormGroup label="Essentials (non-negotiables)" help="Only mark NO when explicitly contradicted. Missing info should be Clarify." error={errors.essentials_text?.message}>
                    <Textarea {...register('essentials_text')} rows={5} placeholder="Lives within 15 minutes of TW19 6AQ" error={!!errors.essentials_text} />
                </FormGroup>
                <FormGroup label="Positive signals (nice-to-have)" help="Used for fit scoring and ordering." error={errors.positive_signals_text?.message}>
                    <Textarea {...register('positive_signals_text')} rows={5} placeholder="Solo shifts, cellar work, stock handling" error={!!errors.positive_signals_text} />
                </FormGroup>
                <FormGroup label="Red flags (do not auto-reject)" help="If present, flag for review or clarify." error={errors.red_flags_text?.message}>
                    <Textarea {...register('red_flags_text')} rows={4} placeholder="Only weekdays, looking for temporary work" error={!!errors.red_flags_text} />
                </FormGroup>
                <FormGroup label="Clarify questions" help="Shown when essentials are unclear." error={errors.clarify_questions_text?.message}>
                    <Textarea {...register('clarify_questions_text')} rows={4} placeholder="Can you prove right to work in the UK before a trial shift?" error={!!errors.clarify_questions_text} />
                </FormGroup>
                <div className="text-xs text-gray-600 space-y-1">
                    <div className="font-semibold text-gray-700">Rubric preview</div>
                    {rubricPreview.items.length ? (
                        <div className="space-y-1">
                            {rubricPreview.items.map((item) => (
                                <div key={item.key}>
                                    {item.essential ? 'Essential' : 'Signal'}: {item.label}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div>No rubric items yet.</div>
                    )}
                </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Advanced configuration (optional)</h3>
                    <p className="text-xs text-gray-500">Override template defaults for interview packs or message drafts.</p>
                    <div className="mt-2 space-y-2 text-xs text-gray-500">
                        <p>Use this section only when you need to fine-tune screening, interview packs, or message drafts for this specific job.</p>
                        <p>Each field must be valid JSON (double quotes, no trailing commas). Leave a field empty or keep []/{} to inherit the template defaults.</p>
                        <p>Arrays can be strings or objects. Objects can include key, label, question, prompt, essential, type, and weight to give the AI more structure.</p>
                        <p>Screening questions guide candidate answers. Interview questions appear in interview packs. Message templates and compliance lines shape candidate emails.</p>
                        <p>
                            Message template keys: invite, clarify, reject, feedback. Variables:{' '}
                            {'{{first_name}}'}, {'{{last_name}}'}, {'{{full_name}}'}, {'{{job_title}}'}, {'{{location}}'}, {'{{company}}'}.
                        </p>
                        <p>Tip: Each field below includes a copy/paste example.</p>
                    </div>
                </div>
                {JSON_FIELDS.map((field) => (
                    <FormGroup
                        key={field.name}
                        label={field.label}
                        help={field.help}
                        error={errors[field.name]?.message}
                    >
                        <Textarea
                            {...register(field.name)}
                            rows={6}
                            className="font-mono text-sm"
                            error={Boolean(errors[field.name])}
                        />
                    </FormGroup>
                ))}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button variant="secondary" onClick={() => router.back()} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" loading={isSubmitting}>
                    {mode === 'create' ? 'Create Job' : 'Save Changes'}
                </Button>
            </div>
        </form>
    )
}
