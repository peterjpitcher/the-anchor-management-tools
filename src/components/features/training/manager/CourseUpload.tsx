'use client'

import { useTransition } from 'react'
import { Alert, FileButton, LinkButton, toast } from '@/ds'
import { uploadCourseDraft } from '@/app/actions/training-courses'
import type { UploadCourseDraftResult } from '@/lib/training/types'
import { COURSE_UPLOAD_MAX_BYTES } from '@/lib/training/upload-limits'
import { runTrainingAction } from './run-action'
import { trainingCourseHref } from './views'

const ACCEPT = '.json,.zip,application/json,application/zip,image/png,image/jpeg,image/webp,image/gif'

interface CourseUploadButtonProps {
  label: string
  onResult: (result: UploadCourseDraftResult) => void
  variant?: 'primary' | 'secondary'
}

/**
 * Upload a course: `course.json` with its images (several files), or one zip holding them. The
 * server checks it in draft mode; any error means nothing was saved.
 */
export function CourseUploadButton({ label, onResult, variant = 'primary' }: CourseUploadButtonProps): React.JSX.Element {
  const [pending, startTransition] = useTransition()

  const upload = (files: File[]): void => {
    if (files.length === 0) return
    // The files go through a server action, and Vercel refuses a request body over about 4.49 MB
    // before the action runs, so they are checked here first (src/lib/training/upload-limits.ts).
    const bytes = files.reduce((sum, file) => sum + file.size, 0)
    if (bytes > COURSE_UPLOAD_MAX_BYTES) {
      toast.error('Those files are over 4 MB together. Make the images smaller and try again.')
      return
    }
    const formData = new FormData()
    for (const file of files) formData.append('files', file)
    startTransition(async () => {
      const result = await runTrainingAction(() => uploadCourseDraft(formData), 'The course could not be uploaded. Try again.')
      if (result.error || !result.data) {
        toast.error(result.error ?? 'The course could not be uploaded. Try again.')
        return
      }
      if (result.data.saved) toast.success('Draft saved.')
      else toast.error('Nothing was saved. The problems are listed on the page.')
      onResult(result.data)
    })
  }

  return (
    <FileButton size="sm" variant={variant} accept={ACCEPT} multiple loading={pending} onFiles={upload}>
      {label}
    </FileButton>
  )
}

function IssueList({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  )
}

interface CourseIssuesProps {
  errors: string[]
  warnings: string[]
  gaps: string[]
  /** What the errors stop: "Nothing was saved" after an upload, "It cannot be published" on a draft. */
  errorTitle: string
}

/** Errors, warnings and gaps from checking a course file, each in its own alert. */
export function CourseIssues({ errors, warnings, gaps, errorTitle }: CourseIssuesProps): React.JSX.Element | null {
  if (errors.length === 0 && warnings.length === 0 && gaps.length === 0) return null
  return (
    <div className="space-y-3">
      {errors.length > 0 ? (
        <Alert tone="danger" title={errorTitle}>
          {errors.length === 1 ? 'One problem needs fixing in the course file:' : `${errors.length} problems need fixing in the course file:`}
          <IssueList items={errors} />
        </Alert>
      ) : null}
      {gaps.length > 0 ? (
        <Alert tone="warning" title="Gaps To Fill Before Publishing">
          Each [[TO CONFIRM]] marker needs the real wording before the course can be published:
          <IssueList items={gaps} />
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert tone="info" title="Worth a Look">
          These do not stop the course, but are worth checking:
          <IssueList items={warnings} />
        </Alert>
      ) : null}
    </div>
  )
}

interface UploadResultProps {
  result: UploadCourseDraftResult
  /** Hide the link when the page already shows that course. */
  currentSlug?: string
}

/** What an upload did: saved with any warnings and gaps, or nothing saved with the errors. */
export function UploadResult({ result, currentSlug }: UploadResultProps): React.JSX.Element {
  const showLink = result.saved && result.slug && result.slug !== currentSlug
  return (
    <div className="space-y-3">
      {result.saved ? (
        <Alert
          tone="success"
          title="Draft Saved"
          actions={
            showLink && result.slug ? (
              <LinkButton href={trainingCourseHref(result.slug)} size="sm" variant="secondary">
                Open Course
              </LinkButton>
            ) : undefined
          }
        >
          {result.slug && result.slug !== currentSlug && currentSlug
            ? `This file is for the course "${result.slug}", so it was saved there, not on this course.`
            : 'Preview it, then publish it when it is ready.'}
        </Alert>
      ) : null}
      <CourseIssues errors={result.errors} warnings={result.warnings} gaps={result.gaps} errorTitle="Nothing Was Saved" />
    </div>
  )
}
