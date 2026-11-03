'use client'

/**
 * The course player, shared by the staff portal and the manager preview (build contract
 * section 7).
 *
 * Props (`CoursePlayerProps`):
 * - `mode`: `'live'` in the staff portal (`/portal/training/[assignmentId]`): saves progress on
 *   every Next and runs checks through the portal actions in src/app/actions/training-portal.ts.
 *   `'preview'` on the manager preview page: draws and marks checks with `previewDraw` and
 *   `previewScore` (src/app/actions/training-courses.ts) and records nothing. Preview mode never
 *   calls a portal action. A preview never locks a section: whoever checks the course may retry
 *   as often as they like.
 * - `assignmentId`: required in live mode (the cycle being taken); ignored in preview.
 * - `versionId`: the version previewed; defaults to `course.versionId`. Ignored in live mode.
 * - `course`: the `PlayerCourseView` from `getMyAssignment(...).data.course` (live) or
 *   `getCoursePreview(versionId).data` (preview). Cards and objectives only, never questions.
 * - `progress`: live only, where this person has got to: `progress`, `sectionStates`,
 *   `lockedSection`, `confirmation` and `status` from `getMyAssignment` (a `MyAssignmentView` can
 *   be passed whole). Leave it out in preview mode, which always starts fresh.
 * - `exitHref` and `exitLabel`: where the "leave" links on the locked and finish screens point.
 *   Defaults: `/portal/training` "Back to My Training" (live) and
 *   `/employees/training/courses/<slug>` "Back to the course" (preview).
 *
 * The screens: an overview (summary, sections with their state, Start or Continue), the intro
 * cards, one card per screen in each section with Back and Next, the section check (radio options
 * and Submit), the results with every explanation and what to do next (next section, go back
 * through the section, locked, or finish), the closing cards, and the finish screen ("Confirm your
 * training" in live mode, "Preview finished" in preview). Every card has a read-aloud button where
 * the device can speak. No timers and no scroll gates.
 *
 * A practical course (a manager watches the person at work) has no sections: the overview says how
 * it is signed off and offers "Read the notes", which opens its intro cards. Reading them is never
 * saved, in either mode; the last card goes back to the overview.
 *
 * Accessibility: 16px text and 44px tap targets throughout, labelled radios in a fieldset per
 * question, focus moved to the new screen's heading on every move (so a screen reader starts
 * there), and the check results announced through a live region. Works from 320px wide.
 *
 * Live writes fail closed: if a save or a check cannot be sent, the learner stays where they are
 * and is told, never moved on as if it had been saved.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, Icon, LinkButton, PageLoading, ProgressBar, SubHeading } from '@/ds'
import {
  prepareMyConfirmation,
  saveTrainingProgress,
  startTrainingCheck,
  submitTrainingCheck,
} from '@/app/actions/training-portal'
import { previewDraw, previewScore } from '@/app/actions/training-courses'
import { sectionStatesFor } from '@/lib/training/states'
import {
  TRAINING_INTRO_KEY,
  type AssignmentProgress,
  type CheckNext,
  type CheckQuestionView,
  type CheckResultView,
  type CourseCard,
  type MyAssignmentView,
  type PlayerCourseView,
  type PlayerSectionContent,
  type PlayerSectionState,
  type SectionProgress,
  type ServedQuestion,
} from '@/lib/training/types'
import { cardScreenSpeech, cardTitle, checkSpeech, resultsSpeech } from './card-text'
import { CheckForm } from './CheckForm'
import { CheckResults, resultSummary } from './CheckResults'
import { CourseCardView } from './CourseCardView'
import { ReadAloudButton, useReadAloud } from './read-aloud'

type CoursePlayerMode = 'live' | 'preview'

/** Where a live learner has got to: the matching fields of `getMyAssignment`'s view. */
export type CoursePlayerProgress = Pick<MyAssignmentView, 'progress' | 'sectionStates' | 'lockedSection' | 'confirmation' | 'status'>

export interface CoursePlayerProps {
  mode: CoursePlayerMode
  /** Live: the cycle being taken. Required in live mode. */
  assignmentId?: string
  /** Preview: the version being previewed. Defaults to `course.versionId`. */
  versionId?: string
  course: PlayerCourseView
  /** Live: saved progress. Left out in preview mode. */
  progress?: CoursePlayerProgress
  /** Where the locked and finish screens send the person when they leave. */
  exitHref?: string
  exitLabel?: string
}

type Screen =
  | { kind: 'overview' }
  | { kind: 'intro'; index: number }
  | { kind: 'section'; key: string; index: number }
  | { kind: 'check'; key: string }
  | { kind: 'results'; key: string }
  | { kind: 'locked'; key: string }
  | { kind: 'closing'; index: number }
  | { kind: 'finish' }

type Confirmation = MyAssignmentView['confirmation']

/** One section's check while it is on screen: the questions served and the answers so far. */
interface CheckState {
  key: string
  loading: boolean
  loadError: string | null
  /** Live: the open attempt. */
  attemptId: string | null
  /** Preview: what was drawn, sent back to previewScore. */
  served: ServedQuestion[] | null
  questions: CheckQuestionView[]
  answers: Record<string, number>
  submitting: boolean
  submitError: string | null
  result: CheckResultView | null
}

const EMPTY_PROGRESS: AssignmentProgress = { sections: {}, current: null, introSeen: false }

/** How each section's state shows in the overview list. Kept here: these are player words only. */
const SECTION_STATE_BADGE: Record<PlayerSectionState, { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' }> = {
  passed: { label: 'Passed', tone: 'success' },
  open: { label: 'Open', tone: 'info' },
  locked: { label: 'Locked', tone: 'danger' },
  not_open: { label: 'Not open yet', tone: 'neutral' },
}

const NOT_SENT = 'Something went wrong and this was not saved. Check your connection and try again.'

function sectionProgress(progress: AssignmentProgress, key: string): SectionProgress {
  const existing = progress.sections[key]
  return {
    card: existing?.card ?? 0,
    fails: existing?.fails ?? 0,
    passedAt: existing?.passedAt ?? null,
    lastAttemptQuestionIds: existing?.lastAttemptQuestionIds ?? [],
  }
}

/** The local copy of progress after one section changes (the server holds the real record). */
function withLocalSection(progress: AssignmentProgress, key: string, patch: Partial<SectionProgress>, current?: string): AssignmentProgress {
  return {
    ...progress,
    current: current ?? progress.current,
    sections: { ...progress.sections, [key]: { ...sectionProgress(progress, key), ...patch } },
  }
}

/**
 * Preview: every section can be opened in any order, so a manager can look at any part. Passed
 * and locked sections still show as such, exactly as staff would see them.
 */
function previewSectionStates(progress: AssignmentProgress, keys: readonly string[], lockedSection: string | null): Record<string, PlayerSectionState> {
  return Object.fromEntries(
    keys.map((key) => [key, progress.sections[key]?.passedAt ? 'passed' : key === lockedSection ? 'locked' : 'open']),
  )
}

/** A stable id for each screen, so focus moves only when the screen really changes. */
function screenId(screen: Screen): string {
  switch (screen.kind) {
    case 'intro':
    case 'closing':
      return `${screen.kind}:${screen.index}`
    case 'section':
      return `section:${screen.key}:${screen.index}`
    case 'check':
    case 'results':
    case 'locked':
      return `${screen.kind}:${screen.key}`
    default:
      return screen.kind
  }
}

/** The screen's heading. Focus moves to it on every move so a screen reader starts reading there. */
function ScreenHeading({ text, headingRef }: { text: string; headingRef: React.RefObject<HTMLSpanElement | null> }): React.JSX.Element {
  return (
    <SubHeading as="h3" className="text-lg leading-snug">
      <span ref={headingRef} tabIndex={-1} className="inline-block scroll-mt-28 outline-hidden">
        {text}
      </span>
    </SubHeading>
  )
}

/** The line above a card heading saying where in the course it is. */
function Position({ where, count }: { where: string; count?: string }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-text-muted">
      <span>{where}</span>
      {count ? <span>{count}</span> : null}
    </div>
  )
}

export function CoursePlayer({
  mode,
  assignmentId,
  versionId: versionIdProp,
  course,
  progress: initial,
  exitHref,
  exitLabel,
}: CoursePlayerProps): React.JSX.Element {
  const live = mode === 'live'
  const versionId = versionIdProp ?? course.versionId
  const sections = course.sections
  const sectionKeys = useMemo(() => sections.map((section) => section.key), [sections])
  const leaveHref = exitHref ?? (live ? '/portal/training' : `/employees/training/courses/${course.slug}`)
  const leaveLabel = exitLabel ?? (live ? 'Back to My Training' : 'Back to the course')

  const [progress, setProgress] = useState<AssignmentProgress>(live && initial ? initial.progress : EMPTY_PROGRESS)
  const [lockedSection, setLockedSection] = useState<string | null>(live && initial ? initial.lockedSection : null)
  const [sectionStates, setSectionStates] = useState<Record<string, PlayerSectionState>>(() =>
    live
      ? initial?.sectionStates ?? sectionStatesFor(EMPTY_PROGRESS, sectionKeys, null)
      : previewSectionStates(EMPTY_PROGRESS, sectionKeys, null),
  )
  const [confirmation, setConfirmation] = useState<Confirmation>(
    live && initial ? initial.confirmation : { state: 'not_ready', confirmUrl: null },
  )
  const status = live ? initial?.status ?? 'assigned' : 'assigned'

  const [screen, setScreen] = useState<Screen>({ kind: 'overview' })
  const [check, setCheck] = useState<CheckState | null>(null)
  const [busy, setBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const readAloud = useReadAloud()
  const headingRef = useRef<HTMLSpanElement | null>(null)
  const currentScreenId = screenId(screen)
  // The screen focus was last placed for. Starts as the first screen, so opening the page does
  // not move focus; only a move by the learner does.
  const focusedScreenId = useRef(currentScreenId)

  // Every move: stop any reading, clear the last move's error, and put focus on the new heading.
  useEffect(() => {
    if (focusedScreenId.current === currentScreenId) return
    focusedScreenId.current = currentScreenId
    readAloud.stop()
    setMoveError(null)
    headingRef.current?.focus()
  }, [currentScreenId])

  if (live && !assignmentId) {
    return <Alert tone="danger">This training could not be opened. Go back to My Training and try again.</Alert>
  }

  const sectionByKey = (key: string): PlayerSectionContent | undefined => sections.find((section) => section.key === key)
  const sectionNumber = (key: string): number => sectionKeys.indexOf(key) + 1
  const passedCount = sectionKeys.filter((key) => sectionStates[key] === 'passed').length
  const allPassed = sectionKeys.length > 0 && passedCount === sectionKeys.length
  const blocked = live && status === 'waiting'
  const isPractical = course.kind === 'practical' || sectionKeys.length === 0

  const applyProgress = (next: AssignmentProgress, locked: string | null): void => {
    setProgress(next)
    setLockedSection(locked)
    setSectionStates(live ? sectionStatesFor(next, sectionKeys, locked) : previewSectionStates(next, sectionKeys, locked))
  }

  /** The card a section opens on: where the learner got to, within the section. */
  const resumeCard = (key: string): number => {
    const section = sectionByKey(key)
    if (!section) return 0
    return Math.min(Math.max(sectionProgress(progress, key).card, 0), Math.max(section.cards.length - 1, 0))
  }

  /** Where Start or Continue goes. */
  const resumeScreen = (): Screen => {
    if (course.intro.length > 0 && !progress.introSeen && !allPassed) return { kind: 'intro', index: 0 }
    const locked = sectionKeys.find((key) => sectionStates[key] === 'locked')
    if (locked) return { kind: 'locked', key: locked }
    const open = sectionKeys.find((key) => sectionStates[key] === 'open')
    if (open) return { kind: 'section', key: open, index: resumeCard(open) }
    if (allPassed) return course.closing.length > 0 ? { kind: 'closing', index: 0 } : { kind: 'finish' }
    return { kind: 'overview' }
  }

  /** Live only: saves the card reached. Returns false (and says so) when it was not saved. */
  const save = async (sectionKey: string, card: number): Promise<boolean> => {
    if (!live || !assignmentId) return true
    setBusy(true)
    try {
      const result = await saveTrainingProgress({ assignmentId, sectionKey, card })
      if (result.error) {
        setMoveError(result.error)
        return false
      }
      return true
    } catch {
      setMoveError(NOT_SENT)
      return false
    } finally {
      setBusy(false)
    }
  }

  const loadCheck = async (key: string): Promise<void> => {
    setCheck({
      key,
      loading: true,
      loadError: null,
      attemptId: null,
      served: null,
      questions: [],
      answers: {},
      submitting: false,
      submitError: null,
      result: null,
    })
    try {
      if (live) {
        const result = await startTrainingCheck({ assignmentId: assignmentId ?? '', sectionKey: key })
        if (!result.data) throw new Error(result.error ?? 'The check could not be started.')
        const data = result.data
        setCheck((current) =>
          current && current.key === key
            ? { ...current, loading: false, attemptId: data.attemptId, questions: data.questions }
            : current,
        )
      } else {
        const result = await previewDraw({
          versionId,
          sectionKey: key,
          previousQuestionIds: sectionProgress(progress, key).lastAttemptQuestionIds,
        })
        if (!result.data) throw new Error(result.error ?? 'The check could not be drawn.')
        const data = result.data
        setCheck((current) =>
          current && current.key === key
            ? { ...current, loading: false, served: data.served, questions: data.questions }
            : current,
        )
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'The check could not be started.'
      setCheck((current) => (current && current.key === key ? { ...current, loading: false, loadError: message } : current))
    }
  }

  const goToCheck = (key: string): void => {
    setScreen({ kind: 'check', key })
    // The same unsubmitted check comes back (live, the server returns the open attempt anyway).
    if (check && check.key === key && !check.result && !check.loadError && (check.loading || check.questions.length > 0)) return
    void loadCheck(key)
  }

  const submitCheck = async (): Promise<void> => {
    if (!check || check.submitting || check.result) return
    const key = check.key
    setCheck({ ...check, submitting: true, submitError: null })

    let result: CheckResultView
    try {
      if (live) {
        const response = await submitTrainingCheck({ attemptId: check.attemptId ?? '', answers: check.answers })
        if (!response.data) throw new Error(response.error ?? NOT_SENT)
        result = response.data
      } else {
        const response = await previewScore({ versionId, sectionKey: key, served: check.served ?? [], answers: check.answers })
        if (!response.data) throw new Error(response.error ?? 'The check could not be marked.')
        result = response.data
      }
    } catch (error) {
      // Not marked: the learner stays on the check with their answers, and is told.
      const message = error instanceof Error && error.message ? error.message : NOT_SENT
      setCheck((current) => (current && current.key === key ? { ...current, submitting: false, submitError: message } : current))
      return
    }

    // Marked. From here on the player only updates its own copy of the progress (the server has
    // already recorded the attempt in live mode), so nothing below can report a failed send.
    const questionIds = check.questions.map((question) => question.id)
    const before = sectionProgress(progress, key)
    let next: CheckNext = result.next
    if (result.passed) {
      const remaining = sectionKeys.filter((sectionKey) => sectionKey !== key && !progress.sections[sectionKey]?.passedAt)
      // Preview has no record to read, so the player works out what comes next itself.
      if (!live) next = remaining.length === 0 ? 'confirm' : 'next_section'
      const passed = withLocalSection(
        progress,
        key,
        { passedAt: new Date().toISOString(), lastAttemptQuestionIds: questionIds },
        remaining[0] ?? key,
      )
      applyProgress(passed, lockedSection === key ? null : lockedSection)
    } else {
      const fails = before.fails + 1
      // A preview never locks (previewScore's rule): whoever checks the course may retry freely.
      if (!live) next = 'retry'
      const failed = withLocalSection(progress, key, { fails, card: 0, lastAttemptQuestionIds: questionIds }, key)
      applyProgress(failed, next === 'locked' ? key : lockedSection)
    }

    if (live && next === 'confirm') {
      setConfirmation(result.confirmUrl ? { state: 'ready', confirmUrl: result.confirmUrl } : { state: 'retry', confirmUrl: null })
    } else if (live && next === 'confirm_retry') {
      setConfirmation({ state: 'retry', confirmUrl: null })
    }

    setCheck((current) => (current && current.key === key ? { ...current, submitting: false, result: { ...result, next } } : current))
    setScreen({ kind: 'results', key })
  }

  const prepareConfirmationAgain = async (): Promise<void> => {
    if (!live || !assignmentId) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      const result = await prepareMyConfirmation({ assignmentId })
      if (!result.data) {
        setConfirmError(result.error ?? 'We still could not get your confirmation ready. Please try again later.')
        return
      }
      setConfirmation({ state: 'ready', confirmUrl: result.data.confirmUrl })
    } catch {
      setConfirmError('We still could not get your confirmation ready. Please try again later.')
    } finally {
      setConfirmBusy(false)
    }
  }

  const restartPreview = (): void => {
    applyProgress(EMPTY_PROGRESS, null)
    setCheck(null)
    setScreen({ kind: 'overview' })
  }

  // ---------------------------------------------------------------------------------------------
  // Moving between cards
  // ---------------------------------------------------------------------------------------------

  const goNext = async (): Promise<void> => {
    if (busy) return
    if (screen.kind === 'intro') {
      if (screen.index < course.intro.length - 1) {
        setScreen({ kind: 'intro', index: screen.index + 1 })
        return
      }
      // A practical course's intro cards are notes to read before the sign-off. There is no
      // progress to record (the server only saves progress on an online course), so the last
      // card goes back to the overview without saving anything.
      if (isPractical) {
        setScreen({ kind: 'overview' })
        return
      }
      // The last intro card: record the intro as seen, then on to the first open section.
      if (!(await save(TRAINING_INTRO_KEY, course.intro.length - 1))) return
      const seen = { ...progress, introSeen: true }
      setProgress(seen)
      const open = sectionKeys.find((key) => sectionStates[key] === 'open')
      setScreen(open ? { kind: 'section', key: open, index: resumeCard(open) } : { kind: 'overview' })
      return
    }
    if (screen.kind === 'section') {
      const section = sectionByKey(screen.key)
      if (!section) return
      const reviewing = sectionStates[screen.key] === 'passed'
      const last = section.cards.length - 1
      if (screen.index < last) {
        const nextIndex = screen.index + 1
        if (!reviewing) {
          if (!(await save(screen.key, nextIndex))) return
          setProgress((current) =>
            withLocalSection(current, screen.key, { card: Math.max(sectionProgress(current, screen.key).card, nextIndex) }, screen.key),
          )
        }
        setScreen({ kind: 'section', key: screen.key, index: nextIndex })
        return
      }
      if (reviewing) {
        setScreen({ kind: 'overview' })
        return
      }
      goToCheck(screen.key)
      return
    }
    if (screen.kind === 'closing') {
      setScreen(screen.index < course.closing.length - 1 ? { kind: 'closing', index: screen.index + 1 } : { kind: 'finish' })
    }
  }

  const goBack = (): void => {
    if (screen.kind === 'intro' || screen.kind === 'closing') {
      setScreen(screen.index > 0 ? { ...screen, index: screen.index - 1 } : { kind: 'overview' })
      return
    }
    if (screen.kind === 'section') {
      setScreen(screen.index > 0 ? { kind: 'section', key: screen.key, index: screen.index - 1 } : { kind: 'overview' })
      return
    }
    if (screen.kind === 'check') {
      const section = sectionByKey(screen.key)
      setScreen({ kind: 'section', key: screen.key, index: Math.max((section?.cards.length ?? 1) - 1, 0) })
      return
    }
    setScreen({ kind: 'overview' })
  }

  /** After the results: the next section, the same section again, or on to the finish. */
  const continueAfterResults = (next: CheckNext, key: string): void => {
    setCheck(null)
    if (next === 'next_section') {
      const open = sectionKeys.find((sectionKey) => sectionStates[sectionKey] === 'open' && sectionKey !== key)
      setScreen(open ? { kind: 'section', key: open, index: resumeCard(open) } : { kind: 'overview' })
      return
    }
    if (next === 'retry') {
      setScreen({ kind: 'section', key, index: 0 })
      return
    }
    if (next === 'confirm' || next === 'confirm_retry') {
      setScreen(course.closing.length > 0 ? { kind: 'closing', index: 0 } : { kind: 'finish' })
      return
    }
    setScreen({ kind: 'locked', key })
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------

  const backNext = (nextLabel: string, options: { showBack?: boolean } = {}): React.JSX.Element => (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {options.showBack === false ? (
        <span />
      ) : (
        <Button type="button" variant="secondary" size="lg" className="min-h-touch" icon={<Icon name="chevronLeft" />} onClick={goBack}>
          Back
        </Button>
      )}
      <Button
        type="button"
        variant="primary"
        size="lg"
        className="min-h-touch"
        iconRight={<Icon name="chevronRight" />}
        loading={busy}
        onClick={() => void goNext()}
      >
        {nextLabel}
      </Button>
    </div>
  )

  const cardScreen = (input: {
    where: string
    count: string
    card: CourseCard
    fallbackHeading: string
    nextLabel: string
    before?: React.ReactNode
  }): React.JSX.Element => {
    const heading = cardTitle(input.card) ?? input.fallbackHeading
    return (
      <Card>
        <CardBody className="space-y-4">
          <Position where={input.where} count={input.count} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ScreenHeading text={heading} headingRef={headingRef} />
            <ReadAloudButton readAloud={readAloud} text={cardScreenSpeech(heading, input.card)} />
          </div>
          {input.before}
          {/* Keyed by the screen, so a card never inherits the one before it (two check-yourself
              cards in a row would otherwise share one answer). */}
          <CourseCardView key={currentScreenId} card={input.card} imageBaseUrl={course.imageBaseUrl} />
          {moveError ? <Alert tone="danger">{moveError}</Alert> : null}
          {backNext(input.nextLabel)}
        </CardBody>
      </Card>
    )
  }

  const previewBanner = live ? null : (
    <Alert tone="info" role="status" title="Preview">
      Nothing you do here is recorded and no certificate is made. Checks are drawn and marked exactly as staff would get them.
    </Alert>
  )

  let body: React.JSX.Element

  switch (screen.kind) {
    case 'intro': {
      const card = course.intro[screen.index]
      body = card
        ? cardScreen({
            where: isPractical ? 'Before your sign-off' : 'Before you start',
            count: `Card ${screen.index + 1} of ${course.intro.length}`,
            card,
            fallbackHeading: course.title,
            nextLabel: isPractical && screen.index === course.intro.length - 1 ? 'Done' : 'Next',
          })
        : <Alert tone="danger">This card could not be shown.</Alert>
      break
    }

    case 'section': {
      const section = sectionByKey(screen.key)
      const card = section?.cards[screen.index]
      if (!section || !card) {
        body = <Alert tone="danger">This card could not be shown.</Alert>
        break
      }
      const reviewing = sectionStates[screen.key] === 'passed'
      const last = screen.index === section.cards.length - 1
      const fails = sectionProgress(progress, screen.key).fails
      const resit =
        screen.index === 0 && fails > 0 && !reviewing ? (
          <div role="note" className="rounded-default border-l-4 border-l-info bg-info-soft p-4 text-info-fg">
            <p className="text-base font-semibold">Before you try the check again</p>
            <p className="mt-1 whitespace-pre-line text-base">
              {section.resitNote ?? 'Read through this section again. You will get different questions next time.'}
            </p>
          </div>
        ) : null
      body = cardScreen({
        where: `Section ${sectionNumber(section.key)} of ${sectionKeys.length}: ${section.title}`,
        count: `Card ${screen.index + 1} of ${section.cards.length}`,
        card,
        fallbackHeading: section.title,
        nextLabel: last ? (reviewing ? 'Back to sections' : 'Go to the check') : 'Next',
        before: resit,
      })
      break
    }

    case 'check': {
      const section = sectionByKey(screen.key)
      const state = check && check.key === screen.key ? check : null
      const rule =
        section && section.maxWrong === 0
          ? 'You need every answer right.'
          : `You can get ${section?.maxWrong ?? 1} wrong. Some questions are must-know: you need all of those right.`
      body = (
        <Card>
          <CardBody className="space-y-4">
            <Position where={`Section ${sectionNumber(screen.key)} of ${sectionKeys.length}: ${section?.title ?? ''}`} count="Check" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <ScreenHeading text={`Check: ${section?.title ?? ''}`} headingRef={headingRef} />
              {state && state.questions.length > 0 ? (
                <ReadAloudButton readAloud={readAloud} text={checkSpeech(state.questions)} what="the questions" />
              ) : null}
            </div>
            <p className="text-base text-text">
              Answer all {section?.questionsPerAttempt ?? state?.questions.length ?? 4} questions. {rule} There is no time limit.
            </p>
            {!state || state.loading ? <PageLoading inline label="Getting your questions" /> : null}
            {state && state.loadError ? (
              <div className="space-y-3">
                <Alert tone="danger">{state.loadError}</Alert>
                <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={() => void loadCheck(screen.key)}>
                  Try again
                </Button>
              </div>
            ) : null}
            {state && !state.loading && !state.loadError && state.questions.length > 0 ? (
              <CheckForm
                questions={state.questions}
                answers={state.answers}
                submitting={state.submitting}
                submitError={state.submitError}
                onAnswer={(questionId, index) =>
                  setCheck((current) =>
                    current && current.key === screen.key ? { ...current, answers: { ...current.answers, [questionId]: index } } : current,
                  )
                }
                onSubmit={() => void submitCheck()}
              />
            ) : null}
            <div>
              <Button type="button" variant="ghost" size="lg" className="min-h-touch" icon={<Icon name="chevronLeft" />} onClick={goBack}>
                Back to the cards
              </Button>
            </div>
          </CardBody>
        </Card>
      )
      break
    }

    case 'results': {
      const section = sectionByKey(screen.key)
      const result = check && check.key === screen.key ? check.result : null
      if (!result) {
        body = <Alert tone="danger">These results could not be shown.</Alert>
        break
      }
      const summary = resultSummary(result)
      let action: React.ReactNode
      switch (result.next) {
        case 'next_section':
          action = (
            <Button type="button" variant="primary" size="lg" className="min-h-touch" iconRight={<Icon name="chevronRight" />} onClick={() => continueAfterResults('next_section', screen.key)}>
              Go to the next section
            </Button>
          )
          break
        case 'retry':
          action = (
            <div className="space-y-3">
              <p className="text-base text-text">
                Go back through this section, then try the check again. You will get different questions.
              </p>
              <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={() => continueAfterResults('retry', screen.key)}>
                Go back through the section
              </Button>
            </div>
          )
          break
        case 'locked':
          action = (
            <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={() => continueAfterResults('locked', screen.key)}>
              What happens now
            </Button>
          )
          break
        default:
          action = (
            <Button type="button" variant="primary" size="lg" className="min-h-touch" iconRight={<Icon name="chevronRight" />} onClick={() => continueAfterResults(result.next, screen.key)}>
              Finish
            </Button>
          )
      }
      body = (
        <Card>
          <CardBody className="space-y-4">
            <Position where={`Section ${sectionNumber(screen.key)} of ${sectionKeys.length}: ${section?.title ?? ''}`} count="Results" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <ScreenHeading text="Your results" headingRef={headingRef} />
              <ReadAloudButton readAloud={readAloud} text={resultsSpeech(summary, result.results)} what="your results" />
            </div>
            <CheckResults result={result} />
            {action}
          </CardBody>
        </Card>
      )
      break
    }

    case 'locked': {
      const section = sectionByKey(screen.key)
      body = (
        <Card>
          <CardBody className="space-y-4">
            <Position where={`Section ${sectionNumber(screen.key)} of ${sectionKeys.length}: ${section?.title ?? ''}`} />
            <ScreenHeading text="This section is locked" headingRef={headingRef} />
            <div className="flex items-start gap-2 text-base text-text">
              <Icon name="lock" size={20} className="mt-0.5 shrink-0 text-danger" />
              <p>
                You have tried this check 3 times. That is fine: some things take longer to sink in. Talk to your manager. They will
                go through it with you and unlock it. Then you can try again.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {live ? (
                <LinkButton href={leaveHref} variant="primary" size="lg" className="min-h-touch">
                  {leaveLabel}
                </LinkButton>
              ) : (
                <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={restartPreview}>
                  Start the preview again
                </Button>
              )}
              <Button type="button" variant="secondary" size="lg" className="min-h-touch" onClick={() => setScreen({ kind: 'overview' })}>
                See all sections
              </Button>
            </div>
          </CardBody>
        </Card>
      )
      break
    }

    case 'closing': {
      const card = course.closing[screen.index]
      body = card
        ? cardScreen({
            where: 'To finish',
            count: `Card ${screen.index + 1} of ${course.closing.length}`,
            card,
            fallbackHeading: course.title,
            nextLabel: screen.index === course.closing.length - 1 ? 'Finish' : 'Next',
          })
        : <Alert tone="danger">This card could not be shown.</Alert>
      break
    }

    case 'finish': {
      body = (
        <Card>
          <CardBody className="space-y-4">
            {live ? (
              <FinishLive
                confirmation={confirmation}
                headingRef={headingRef}
                busy={confirmBusy}
                error={confirmError}
                onTryAgain={() => void prepareConfirmationAgain()}
                onSections={() => setScreen({ kind: 'overview' })}
                leaveHref={leaveHref}
                leaveLabel={leaveLabel}
              />
            ) : (
              <>
                <ScreenHeading text="Preview finished" headingRef={headingRef} />
                <p className="text-base text-text">
                  Nothing was recorded. Staff would now see &quot;Confirm your training&quot;, which opens their training confirmation
                  in My Documents.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={restartPreview}>
                    Start the preview again
                  </Button>
                  <LinkButton href={leaveHref} variant="secondary" size="lg" className="min-h-touch">
                    {leaveLabel}
                  </LinkButton>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )
      break
    }

    default: {
      // The overview: the course, the sections and where to go next.
      const resume = resumeScreen()
      const started =
        passedCount > 0 ||
        progress.introSeen ||
        Object.values(progress.sections).some((section) => section.card > 0 || section.fails > 0)
      const lockedKey = sectionKeys.find((key) => sectionStates[key] === 'locked')
      let mainAction: React.ReactNode = null
      if (isPractical) {
        // Nothing to take online: the notes (intro cards) are there to read before the manager
        // watches. Reading them is never recorded, so they are offered whatever the status.
        mainAction =
          course.intro.length > 0 ? (
            <Button type="button" variant="primary" size="lg" className="min-h-touch" iconRight={<Icon name="chevronRight" />} onClick={() => setScreen({ kind: 'intro', index: 0 })}>
              Read the notes
            </Button>
          ) : null
      } else if (blocked) {
        mainAction = null
      } else if (allPassed && live && confirmation.state === 'ready' && confirmation.confirmUrl) {
        mainAction = (
          <LinkButton href={confirmation.confirmUrl} variant="primary" size="lg" className="min-h-touch">
            Confirm your training
          </LinkButton>
        )
      } else if (allPassed) {
        mainAction = (
          <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={() => setScreen(resume)}>
            {live ? (confirmation.state === 'done' ? 'See your confirmation' : 'Finish') : 'Finish the preview'}
          </Button>
        )
      } else if (!lockedKey) {
        mainAction = (
          <Button type="button" variant="primary" size="lg" className="min-h-touch" iconRight={<Icon name="chevronRight" />} onClick={() => setScreen(resume)}>
            {started ? 'Continue' : 'Start'}
          </Button>
        )
      }

      body = (
        <Card>
          <CardBody className="space-y-5">
            <ScreenHeading
              text={isPractical ? 'How this is signed off' : allPassed ? 'Every section passed' : 'Your sections'}
              headingRef={headingRef}
            />
            {course.summary ? <p className="text-base text-text">{course.summary}</p> : null}
            {isPractical ? (
              <Alert tone="info" role="status">
                This is a practical sign-off. A manager will watch you do each task at work, then sign it off with you in person.
              </Alert>
            ) : null}
            {blocked ? (
              <Alert tone="info" role="status">
                {isPractical
                  ? `The sign-off opens once you have finished the course that comes before it.${course.intro.length > 0 ? ' You can read the notes now.' : ''}`
                  : 'This training opens once you have finished the course that comes before it.'}
              </Alert>
            ) : null}
            {lockedKey ? (
              <Alert tone="warning" role="status" title="A section is locked">
                You have tried a check 3 times. Talk to your manager. They will go through it with you and unlock it.
              </Alert>
            ) : null}
            {live && confirmation.state === 'declined' ? (
              <Alert tone="warning" role="status">
                You did not confirm this training. Your manager will talk it through with you and send it again.
              </Alert>
            ) : null}
            {live && confirmation.state === 'done' ? (
              <Alert tone="success" role="status">
                Training complete. Your certificate is in My Documents.
              </Alert>
            ) : null}

            {!isPractical ? (
              <>
                <div className="space-y-2">
                  <ProgressBar value={sectionKeys.length > 0 ? (passedCount / sectionKeys.length) * 100 : 0} size="md" label="Sections passed" />
                  <p className="text-sm text-text-muted">
                    {passedCount} of {sectionKeys.length} {sectionKeys.length === 1 ? 'section' : 'sections'} passed. About{' '}
                    {course.estimatedMinutes} minutes in all.
                  </p>
                </div>
                <ol className="divide-y divide-border rounded-default border border-border">
                  {sections.map((section, index) => {
                    const state = sectionStates[section.key] ?? 'not_open'
                    const badge = SECTION_STATE_BADGE[state]
                    return (
                      <li key={section.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div className="min-w-0 grow basis-48">
                          <p className="text-base font-semibold text-text-strong">
                            {index + 1}. {section.title}
                          </p>
                          <div className="mt-1">
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                          </div>
                        </div>
                        {blocked ? null : state === 'passed' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="lg"
                            className="min-h-touch"
                            onClick={() => setScreen({ kind: 'section', key: section.key, index: 0 })}
                          >
                            Read again<span className="sr-only">: {section.title}</span>
                          </Button>
                        ) : state === 'open' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            className="min-h-touch"
                            onClick={() =>
                              setScreen(
                                course.intro.length > 0 && !progress.introSeen && live
                                  ? { kind: 'intro', index: 0 }
                                  : { kind: 'section', key: section.key, index: resumeCard(section.key) },
                              )
                            }
                          >
                            {sectionProgress(progress, section.key).card > 0 ? 'Continue' : 'Open'}
                            <span className="sr-only">: {section.title}</span>
                          </Button>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              </>
            ) : null}

            {mainAction || (!live && started) ? (
              <div className="flex flex-wrap gap-3">
                {mainAction}
                {!live && started ? (
                  <Button type="button" variant="secondary" size="lg" className="min-h-touch" onClick={restartPreview}>
                    Start the preview again
                  </Button>
                ) : null}
              </div>
            ) : null}
            {live ? (
              <p className="text-sm text-text-muted">
                Training is paid working time. Do it on shift, or ask your manager for a training shift.
              </p>
            ) : null}
          </CardBody>
        </Card>
      )
    }
  }

  return (
    <div data-touch-targets="" lang="en-GB" className="space-y-4">
      {previewBanner}
      {body}
    </div>
  )
}

interface FinishLiveProps {
  confirmation: Confirmation
  headingRef: React.RefObject<HTMLSpanElement | null>
  busy: boolean
  error: string | null
  onTryAgain: () => void
  onSections: () => void
  leaveHref: string
  leaveLabel: string
}

/** The last screen in the portal: confirm the training (through the signing feature), or why not yet. */
function FinishLive({ confirmation, headingRef, busy, error, onTryAgain, onSections, leaveHref, leaveLabel }: FinishLiveProps): React.JSX.Element {
  if (confirmation.state === 'ready' && confirmation.confirmUrl) {
    return (
      <>
        <ScreenHeading text="Last step: confirm your training" headingRef={headingRef} />
        <p className="text-base text-text">
          You have passed every section. Now confirm that you have read and understood the training. It opens in My Documents and
          takes a minute.
        </p>
        <div>
          <LinkButton href={confirmation.confirmUrl} variant="primary" size="lg" className="min-h-touch">
            Confirm your training
          </LinkButton>
        </div>
      </>
    )
  }
  if (confirmation.state === 'retry' || (confirmation.state === 'ready' && !confirmation.confirmUrl)) {
    return (
      <>
        <ScreenHeading text="Last step: confirm your training" headingRef={headingRef} />
        <p className="text-base text-text">You have passed every section, and that is saved.</p>
        <Alert tone="warning">We could not get your confirmation ready. Please try again.</Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div>
          <Button type="button" variant="primary" size="lg" className="min-h-touch" loading={busy} onClick={onTryAgain}>
            Try again
          </Button>
        </div>
      </>
    )
  }
  if (confirmation.state === 'declined') {
    return (
      <>
        <ScreenHeading text="You did not confirm this training" headingRef={headingRef} />
        <p className="text-base text-text">Your manager will talk it through with you and send it again.</p>
        <div>
          <LinkButton href={leaveHref} variant="primary" size="lg" className="min-h-touch">
            {leaveLabel}
          </LinkButton>
        </div>
      </>
    )
  }
  if (confirmation.state === 'done') {
    return (
      <>
        <ScreenHeading text="Training complete" headingRef={headingRef} />
        <p className="text-base text-text">Thank you. Your certificate is in My Documents.</p>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/portal/documents" variant="primary" size="lg" className="min-h-touch">
            Go to My Documents
          </LinkButton>
          <LinkButton href={leaveHref} variant="secondary" size="lg" className="min-h-touch">
            {leaveLabel}
          </LinkButton>
        </div>
      </>
    )
  }
  return (
    <>
      <ScreenHeading text="Not finished yet" headingRef={headingRef} />
      <p className="text-base text-text">Pass every section first. Then you can confirm your training.</p>
      <div>
        <Button type="button" variant="primary" size="lg" className="min-h-touch" onClick={onSections}>
          See all sections
        </Button>
      </div>
    </>
  )
}
