'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  LinkButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import {
  TRAINING_COURSE_KIND_BADGE,
  TRAINING_COURSE_STATUS_BADGE,
  formatTrainingDate,
  formatTrainingVersion,
  trainingGroupsText,
} from '@/lib/training/labels'
import type { CourseListItem, UploadCourseDraftResult } from '@/lib/training/types'
import { CourseUploadButton, UploadResult } from './CourseUpload'
import { NewExternalCourseDialog } from './NewExternalCourseDialog'
import { TrainingEmailsSwitch } from './TrainingEmailsSwitch'
import { useTrainingPermissions } from './use-training-permissions'
import { trainingCourseHref } from './views'

/** The preview page opens the draft when no version is named. */
function draftPreviewHref(slug: string): string {
  return `${trainingCourseHref(slug)}/preview`
}

interface TrainingCoursesViewProps {
  courses: CourseListItem[] | null
  error: string | null
  emails: { enabled: boolean | null; error: string | null }
}

function versionText(course: CourseListItem): string {
  if (!course.currentVersion) return 'Not published'
  return formatTrainingVersion(course.currentVersion.major, course.currentVersion.minor)
}

function draftText(course: CourseListItem): string | null {
  if (!course.hasDraft) return null
  return course.draftUploadedAt ? `Draft uploaded ${formatTrainingDate(course.draftUploadedAt)}` : 'Draft waiting'
}

function refresherText(course: CourseListItem): string {
  if (course.refresherMonths === null) return 'Never'
  return course.refresherMonths === 1 ? 'Every month' : `Every ${course.refresherMonths} months`
}

function CourseBadges({ course }: { course: CourseListItem }): React.JSX.Element {
  const status = TRAINING_COURSE_STATUS_BADGE[course.status]
  const kind = TRAINING_COURSE_KIND_BADGE[course.kind]
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={status.tone}>{status.label}</Badge>
      <Badge tone={kind.tone}>{kind.label}</Badge>
      {course.isEssentials ? <Badge tone="primary">Essentials</Badge> : null}
    </div>
  )
}

/**
 * The Courses view: every course with its status, version and counts. Holders of training
 * publish upload drafts here and add external qualification types; each course's own page holds
 * the preview, publishing, downloads and retiring.
 */
export function TrainingCoursesView({ courses, error, emails }: TrainingCoursesViewProps): React.JSX.Element {
  const router = useRouter()
  const { canPublish } = useTrainingPermissions()
  const [uploadResult, setUploadResult] = useState<UploadCourseDraftResult | null>(null)
  const [creatingExternal, setCreatingExternal] = useState(false)

  const onUploaded = (result: UploadCourseDraftResult): void => {
    setUploadResult(result)
    if (result.saved) router.refresh()
  }

  return (
    <>
      <Card padding="none">
        <CardHeader
          title="Courses"
          subtitle="Online courses, practical sign-offs and external qualifications"
          action={
            canPublish ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setCreatingExternal(true)}>
                  New External Qualification
                </Button>
                <CourseUploadButton label="Upload Course" onResult={onUploaded} />
              </div>
            ) : undefined
          }
        />
        {uploadResult ? (
          <div className="border-b border-border p-pad-card">
            <UploadResult result={uploadResult} />
          </div>
        ) : null}
        {error || !courses ? (
          <div className="p-pad-card">
            <Alert tone="danger" title="The courses could not be loaded">
              {error ?? 'Try again in a moment.'}
            </Alert>
          </div>
        ) : courses.length === 0 ? (
          <Empty
            size="sm"
            title="No courses yet"
            description={
              canPublish
                ? 'Upload a course file (course.json and its images, or a zip) to add the first one.'
                : 'Courses appear here once someone who can publish them uploads one.'
            }
          />
        ) : (
          <>
            {/* Phones: one entry per course */}
            <ul className="divide-y divide-border shell:hidden" aria-label="Courses">
              {courses.map((course) => (
                <li key={course.id} className="space-y-2 px-pad-card py-3">
                  <Link href={trainingCourseHref(course.slug)} className="font-semibold text-primary hover:underline">
                    {course.title}
                  </Link>
                  <CourseBadges course={course} />
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-text-muted">Version</dt>
                    <dd className="text-text">{versionText(course)}</dd>
                    <dt className="text-text-muted">For</dt>
                    <dd className="text-text">{trainingGroupsText(course.audienceGroups)}</dd>
                    <dt className="text-text-muted">Open</dt>
                    <dd className="text-text">{course.assignedCount}</dd>
                    <dt className="text-text-muted">Done</dt>
                    <dd className="text-text">{course.completedCount}</dd>
                  </dl>
                  {draftText(course) ? <p className="text-xs text-text-muted">{draftText(course)}</p> : null}
                  {canPublish && course.hasDraft ? (
                    <LinkButton href={draftPreviewHref(course.slug)} size="sm" variant="secondary">
                      Preview Draft
                    </LinkButton>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* Desktop: the table */}
            <div className="hidden shell:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Course</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead>Refresher</TableHead>
                    <TableHead align="right">Open</TableHead>
                    <TableHead align="right">Done</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((course) => (
                    <TableRow key={course.id}>
                      <TableCell className="whitespace-normal">
                        <Link href={trainingCourseHref(course.slug)} className="font-semibold text-primary hover:underline">
                          {course.title}
                        </Link>
                        {course.prerequisite ? (
                          <div className="text-xs text-text-muted">After {course.prerequisite.title}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <CourseBadges course={course} />
                      </TableCell>
                      <TableCell>
                        <div>{versionText(course)}</div>
                        {draftText(course) ? <div className="text-xs text-text-muted">{draftText(course)}</div> : null}
                        {canPublish && course.hasDraft ? (
                          <LinkButton href={draftPreviewHref(course.slug)} size="sm" variant="ghost">
                            Preview Draft
                          </LinkButton>
                        ) : null}
                      </TableCell>
                      <TableCell>{trainingGroupsText(course.audienceGroups)}</TableCell>
                      <TableCell>{refresherText(course)}</TableCell>
                      <TableCell align="right">{course.assignedCount}</TableCell>
                      <TableCell align="right">{course.completedCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <TrainingEmailsSwitch enabled={emails.enabled} loadError={emails.error} />

      <NewExternalCourseDialog
        open={creatingExternal}
        onClose={() => setCreatingExternal(false)}
        onCreated={(slug) => {
          setCreatingExternal(false)
          router.push(trainingCourseHref(slug))
        }}
      />
    </>
  )
}
