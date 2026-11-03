'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  Empty,
  Fieldset,
  LinkButton,
  PageLayout,
  Radio,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@/ds'
import { getCourseVersionJson, publishCourseDraft, retireTrainingCourse } from '@/app/actions/training-courses'
import { downloadBlob } from '@/lib/download-file'
import {
  TRAINING_AUDIENCE_AGE_BADGE,
  TRAINING_COURSE_KIND_BADGE,
  TRAINING_COURSE_STATUS_BADGE,
  formatTrainingDate,
  formatTrainingVersion,
  trainingGroupsText,
} from '@/lib/training/labels'
import type { CourseDetailView, PublishChange, TrainingCourseVersionMeta, UploadCourseDraftResult } from '@/lib/training/types'
import { CourseIssues, CourseUploadButton, UploadResult } from './CourseUpload'
import { TrainingEmailsSwitch } from './TrainingEmailsSwitch'
import { runTrainingAction } from './run-action'
import { useTrainingPermissions } from './use-training-permissions'
import { COURSE_BACK_BUTTON, trainingPreviewHref } from './views'

interface CourseDetailClientProps {
  detail: CourseDetailView
  emails: { enabled: boolean | null; error: string | null }
}

const PUBLISH_FORM_ID = 'publish-course-form'

function daysText(days: number | null, none: string): string {
  if (days === null) return none
  if (days === 0) return 'On the start date'
  return days === 1 ? 'Within 1 day' : `Within ${days} days`
}

function versionNumber(version: Pick<TrainingCourseVersionMeta, 'major' | 'minor'>): string {
  return version.major === null || version.minor === null ? 'Draft' : formatTrainingVersion(version.major, version.minor)
}

/** The number the next publish will get, for the button. */
function nextVersion(current: TrainingCourseVersionMeta | null, change: PublishChange): string {
  if (!current || current.major === null || current.minor === null) return '1.0'
  return change === 'redo' ? formatTrainingVersion(current.major + 1, 0) : formatTrainingVersion(current.major, current.minor + 1)
}

function byLine(at: string | null, name: string | null): string {
  if (!at) return ''
  return name ? `${formatTrainingDate(at)} by ${name}` : formatTrainingDate(at)
}

/**
 * One course: what it is, how it is doing, the draft waiting to be published (with what still
 * blocks it), every published version, and the publish and retire controls for holders of
 * training publish. Published versions are frozen; a change is always a new upload.
 */
export function CourseDetailClient({ detail, emails }: CourseDetailClientProps): React.JSX.Element {
  const router = useRouter()
  const { canPublish } = useTrainingPermissions()
  const { course, current, versions, draft, stats, prerequisite } = detail
  const isExternal = course.kind === 'external'
  const isFirstPublish = current === null

  const [uploadResult, setUploadResult] = useState<UploadCourseDraftResult | null>(null)
  const [change, setChange] = useState<PublishChange>(isFirstPublish ? 'first' : 'minor')
  const [changeNote, setChangeNote] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [confirmingPublish, setConfirmingPublish] = useState(false)
  const [confirmingRetire, setConfirmingRetire] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const effectiveChange: PublishChange = isFirstPublish ? 'first' : change === 'first' ? 'minor' : change
  const status = TRAINING_COURSE_STATUS_BADGE[course.status]
  const kind = TRAINING_COURSE_KIND_BADGE[course.kind]

  const onUploaded = (result: UploadCourseDraftResult): void => {
    setUploadResult(result)
    if (result.saved) router.refresh()
  }

  const askToPublish = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!isFirstPublish && changeNote.trim().length === 0) {
      setPublishError('Say what changed. Staff and the record show this note.')
      return
    }
    setPublishError(null)
    setConfirmingPublish(true)
  }

  const publish = (): void => {
    setConfirmingPublish(false)
    startTransition(async () => {
      const result = await runTrainingAction(
        // The draft this page shows: the server refuses the publish if it was replaced since.
        () =>
          publishCourseDraft({
            courseId: course.id,
            change: effectiveChange,
            changeNote: changeNote.trim(),
            draftUploadedAt: draft?.version.uploadedAt,
          }),
        'The course could not be published. Try again.',
      )
      if (result.error || !result.data) {
        setPublishError(result.error ?? 'The course could not be published. Try again.')
        return
      }
      const number = formatTrainingVersion(result.data.major, result.data.minor)
      const synced = result.data.sync ? ` ${result.data.sync.created} new training items assigned.` : ''
      toast.success(`Version ${number} published.${synced}`)
      setChangeNote('')
      setUploadResult(null)
      router.refresh()
    })
  }

  const retire = (): void => {
    setConfirmingRetire(false)
    startTransition(async () => {
      const result = await runTrainingAction(
        () => retireTrainingCourse({ courseId: course.id }),
        'The course could not be retired. Try again.',
      )
      if (result.error || !result.data) {
        toast.error(result.error ?? 'The course could not be retired. Try again.')
        return
      }
      toast.success(
        result.data.cancelled === 1
          ? 'Course retired. 1 open training item was cancelled.'
          : `Course retired. ${result.data.cancelled} open training items were cancelled.`,
      )
      router.refresh()
    })
  }

  const download = (version: TrainingCourseVersionMeta): void => {
    setDownloading(version.id)
    void runTrainingAction(() => getCourseVersionJson(version.id), 'The course file could not be downloaded.')
      .then((result) => {
        if (result.error || !result.data) {
          toast.error(result.error ?? 'The course file could not be downloaded.')
          return
        }
        downloadBlob(new Blob([result.data.json], { type: 'application/json' }), result.data.fileName)
      })
      .finally(() => setDownloading(null))
  }

  const headerActions =
    canPublish && course.status !== 'retired' ? (
      <>
        {draft ? (
          <LinkButton href={trainingPreviewHref(course.slug, draft.version.id)} size="sm" variant="secondary">
            Preview Draft
          </LinkButton>
        ) : null}
        {isExternal ? null : <CourseUploadButton label="Upload New Draft" variant="secondary" onResult={onUploaded} />}
        <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => setConfirmingRetire(true)}>
          Retire Course
        </Button>
      </>
    ) : undefined

  const about = [
    { key: 'kind', label: 'Type', value: kind.label },
    { key: 'for', label: 'For', value: trainingGroupsText(course.audienceGroups) },
    { key: 'age', label: 'Age', value: TRAINING_AUDIENCE_AGE_BADGE[course.audienceAge].label },
    { key: 'essentials', label: 'Essentials', value: course.isEssentials ? 'Yes, shown first and chased harder' : 'No' },
    { key: 'prerequisite', label: 'Comes After', value: prerequisite ? prerequisite.title : 'Nothing' },
    { key: 'new', label: 'New Starters', value: daysText(course.newStarterDueDays, 'No due date') },
    { key: 'existing', label: 'Existing Staff', value: daysText(course.existingStaffDueDays, 'No due date') },
    {
      key: 'refresher',
      label: 'Refresher',
      value:
        course.refresherMonths === null
          ? 'Never'
          : `Every ${course.refresherMonths} ${course.refresherMonths === 1 ? 'month' : 'months'}, opening ${course.windowDays} days before`,
    },
    { key: 'current', label: 'Current Version', value: current ? versionNumber(current) : 'Not published' },
    ...(course.kind === 'practical'
      ? [{ key: 'supervised', label: 'Under 18s', value: course.supervisedOnlyUnder18 ? 'Supervised only' : 'Can be cleared to work alone' }]
      : []),
  ]

  return (
    <PageLayout title={course.title} subtitle={kind.label} backButton={COURSE_BACK_BUTTON} headerActions={headerActions}>
      <Card>
        <CardHeader title="About This Course" action={<Badge tone={status.tone}>{status.label}</Badge>} />
        <CardBody className="space-y-4">
          {course.summary ? <p className="text-sm text-text">{course.summary}</p> : null}
          <DescriptionList items={about} columns={2} />
        </CardBody>
      </Card>

      <StatGrid columns={4}>
        <Stat label="Open" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : undefined} />
        <Stat label="Locked" value={stats.locked} tone={stats.locked > 0 ? 'danger' : undefined} />
        <Stat label="Awaiting confirmation" value={stats.awaitingConfirmation} />
        <Stat label="Declined" value={stats.declined} tone={stats.declined > 0 ? 'danger' : undefined} />
        <Stat label="Done" value={stats.completed} />
        <Stat label="Expired" value={stats.expired} tone={stats.expired > 0 ? 'warning' : undefined} />
        <Stat label="Waived" value={stats.waived} />
      </StatGrid>

      {uploadResult ? <UploadResult result={uploadResult} currentSlug={course.slug} /> : null}

      {isExternal ? (
        <Alert tone="info" title="External Qualification">
          Each person&apos;s certificate is recorded on their Training tab, with the file, the issuer and the expiry date.
        </Alert>
      ) : (
        <Card>
          <CardHeader
            title="Draft"
            subtitle={draft ? `Uploaded ${byLine(draft.version.uploadedAt, draft.version.uploadedByName)}` : undefined}
            action={
              draft && canPublish ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={downloading === draft.version.id}
                  onClick={() => download(draft.version)}
                >
                  Download JSON
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            {!draft ? (
              <Empty
                size="sm"
                title="No draft waiting"
                description={
                  canPublish
                    ? 'Upload a new course file to change this course. Staff keep the published version until you publish again.'
                    : 'Someone who can publish courses uploads changes here.'
                }
              />
            ) : (
              <>
                <CourseIssues
                  errors={draft.errors}
                  warnings={draft.warnings}
                  gaps={draft.gaps}
                  errorTitle="It Cannot Be Published Yet"
                />
                {draft.publishable && draft.errors.length === 0 ? (
                  <Alert tone="success" title="Ready To Publish">
                    Preview it first: it is exactly what staff will see.
                  </Alert>
                ) : null}
                {canPublish && course.status !== 'retired' ? (
                  <form id={PUBLISH_FORM_ID} onSubmit={askToPublish} className="space-y-4">
                    {publishError ? <Alert tone="danger">{publishError}</Alert> : null}
                    {isFirstPublish ? (
                      <p className="text-sm text-text">
                        Publishing makes the course live and gives it to everyone it applies to, with the due dates above.
                      </p>
                    ) : (
                      <Fieldset legend="What Changed" required>
                        <Radio
                          name="publish-change"
                          value="minor"
                          label="A small change"
                          description="Wording, a typo or a clearer example. Nobody redoes anything, and people part-way through keep their version."
                          checked={effectiveChange === 'minor'}
                          onChange={() => setChange('minor')}
                        />
                        <Radio
                          name="publish-change"
                          value="redo"
                          label="Ask everyone to redo it"
                          description="A change to what people do, check or approve. Everyone who has done it gets it again, due in 14 days. Their certificates stay valid until they expire."
                          checked={effectiveChange === 'redo'}
                          onChange={() => setChange('redo')}
                        />
                      </Fieldset>
                    )}
                    <Textarea
                      label="Change Note"
                      hint={isFirstPublish ? 'Optional for the first version.' : 'Required. Say what changed, in a sentence.'}
                      value={changeNote}
                      maxLength={500}
                      onChange={(event) => setChangeNote(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="primary"
                        loading={pending}
                        disabled={!draft.publishable}
                      >
                        {`Publish Version ${nextVersion(current, effectiveChange)}`}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>
      )}

      {isExternal ? null : (
        <Card padding="none">
          <CardHeader title="Published Versions" subtitle="Frozen once published. Staff take the version that was current when they started" />
          {versions.length === 0 ? (
            <Empty size="sm" title="Not published yet" description="The first publish makes the course live." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Change</TableHead>
                  {canPublish ? <TableHead align="right">Files</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => (
                  <TableRow key={version.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{versionNumber(version)}</span>
                        {current?.id === version.id ? <Badge tone="success">Current</Badge> : null}
                        {version.redoRequired ? <Badge tone="warning">Everyone redid it</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-text-muted">{byLine(version.publishedAt, version.publishedByName)}</TableCell>
                    <TableCell className="max-w-md whitespace-normal break-words">{version.changeNote ?? ''}</TableCell>
                    {canPublish ? (
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          <LinkButton href={trainingPreviewHref(course.slug, version.id)} size="sm" variant="ghost">
                            Preview
                          </LinkButton>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={downloading === version.id}
                            onClick={() => download(version)}
                            aria-label={`Download JSON for version ${versionNumber(version)}`}
                          >
                            Download JSON
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <TrainingEmailsSwitch enabled={emails.enabled} loadError={emails.error} />

      <ConfirmDialog
        open={confirmingPublish}
        onClose={() => setConfirmingPublish(false)}
        onConfirm={publish}
        title={`Publish Version ${nextVersion(current, effectiveChange)}`}
        message={
          effectiveChange === 'first'
            ? `"${course.title}" goes live and is given to everyone it applies to.`
            : effectiveChange === 'redo'
              ? `Everyone who has done "${course.title}" will be asked to do it again, due in 14 days.`
              : `Staff who start "${course.title}" from now get this version. Nobody redoes anything.`
        }
        confirmLabel="Publish"
        tone={effectiveChange === 'redo' ? 'warning' : undefined}
      />

      <ConfirmDialog
        open={confirmingRetire}
        onClose={() => setConfirmingRetire(false)}
        onConfirm={retire}
        title="Retire Course"
        message={`"${course.title}" stops being given to anyone, and every open item on it is cancelled. Completed records and certificates are kept. This cannot be undone here.`}
        confirmLabel="Retire Course"
        cancelLabel="Keep Course"
        tone="danger"
      />
    </PageLayout>
  )
}
