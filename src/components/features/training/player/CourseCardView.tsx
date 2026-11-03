'use client'

import { useId, useState } from 'react'
import { Button, Icon, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type IconName } from '@/ds'
import { cn } from '@/lib/utils'
import type {
  CalloutCard,
  CalloutTone,
  CheckYourselfCard,
  CourseCard,
  DoDontCard,
  ImageCard,
  StepsCard,
  TableCard,
} from '@/lib/training/types'
import { AnswerOptions } from './AnswerOptions'

/**
 * The body of one course card, by type (build contract section 1). The screen around it (the
 * heading, read-aloud, Back and Next) belongs to CoursePlayer, so nothing here draws the card's
 * title. Text is 16px or larger and plain text only: course content is never rendered as HTML.
 */

const BODY_TEXT = 'text-base text-text'

/** Paragraph text keeps the line breaks the author wrote. */
function Paragraphs({ text }: { text: string }): React.JSX.Element {
  return <p className={cn(BODY_TEXT, 'whitespace-pre-line')}>{text}</p>
}

function BulletList({ items }: { items: readonly string[] }): React.JSX.Element {
  return (
    <ul className={cn(BODY_TEXT, 'list-disc space-y-2 pl-6')}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

function DoDontBody({ card }: { card: DoDontCard }): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-default border border-success-border bg-success-soft p-3">
        <p className="flex items-center gap-1.5 text-base font-semibold text-success-fg">
          <Icon name="checkCircle" size={18} />
          Do
        </p>
        <ul className={cn(BODY_TEXT, 'mt-2 list-disc space-y-1.5 pl-6')}>
          {card.do.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-default border border-danger-border bg-danger-soft p-3">
        <p className="flex items-center gap-1.5 text-base font-semibold text-danger-fg">
          <Icon name="xCircle" size={18} />
          Don&apos;t
        </p>
        <ul className={cn(BODY_TEXT, 'mt-2 list-disc space-y-1.5 pl-6')}>
          {card.dont.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** How each callout tone looks, with a word that says what kind of note it is. */
const CALLOUT_LOOK: Record<CalloutTone, { classes: string; icon: IconName; label: string }> = {
  info: { classes: 'border-l-info bg-info-soft text-info-fg', icon: 'info', label: 'Good to know' },
  warning: { classes: 'border-l-warning bg-warning-soft text-warning-fg', icon: 'alertTriangle', label: 'Important' },
  manager: { classes: 'border-l-primary bg-primary-soft text-primary-soft-fg', icon: 'briefcase', label: 'Ask a manager' },
}

function CalloutBody({ card }: { card: CalloutCard }): React.JSX.Element {
  const look = CALLOUT_LOOK[card.tone]
  return (
    // A note, not an alert: it is part of the course and must not be announced as urgent.
    <div role="note" className={cn('rounded-default border-l-4 p-4', look.classes)}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon name={look.icon} size={16} />
        {look.label}
      </p>
      <p className="mt-2 whitespace-pre-line text-base">{card.text}</p>
    </div>
  )
}

/**
 * A table card. Phones get one block per row, each cell under its column name, because a table
 * is at least 560px wide below the shell breakpoint (globals.css) and would make the learner
 * swipe sideways inside a 288px card. Wider screens get the table. Only one of the two is ever
 * displayed, so a screen reader reads the card once.
 */
function TableCardBody({ card }: { card: TableCard }): React.JSX.Element {
  return (
    <>
      <ul className="space-y-3 shell:hidden">
        {card.rows.map((row, rowIndex) => (
          <li key={rowIndex} className="rounded-default border border-border bg-surface-2 p-3">
            <dl className="space-y-2">
              {card.columns.map((column, cellIndex) => (
                <div key={cellIndex} className="min-w-0">
                  <dt className="text-base font-semibold text-text-strong">{column}</dt>
                  <dd className={cn(BODY_TEXT, 'whitespace-pre-line break-words')}>{row[cellIndex] ?? ''}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden shell:block">
        <Table>
          <TableHeader>
            <TableRow>
              {card.columns.map((column, index) => (
                <TableHead key={index} className="text-sm">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {card.columns.map((_, cellIndex) => (
                  <TableCell key={cellIndex} className="align-top text-base whitespace-normal">
                    {row[cellIndex] ?? ''}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function StepsBody({ card }: { card: StepsCard }): React.JSX.Element {
  return (
    <ol className="space-y-4">
      {card.steps.map((step, index) => (
        <li key={index} className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-sm font-semibold text-primary-fg"
          >
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-text-strong">{step.title}</p>
            <p className={cn(BODY_TEXT, 'mt-1 whitespace-pre-line')}>{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function ImageBody({ card, imageBaseUrl }: { card: ImageCard; imageBaseUrl: string }): React.JSX.Element {
  return (
    <figure>
      <img
        src={`${imageBaseUrl}${card.src}`}
        alt={card.alt}
        className="h-auto w-full rounded-default border border-border bg-surface-2"
        loading="lazy"
      />
      {card.caption ? <figcaption className="mt-2 text-base text-text-muted">{card.caption}</figcaption> : null}
    </figure>
  )
}

/**
 * An unscored question in the middle of a section, so the learner can test themselves. Nothing
 * is recorded, in live or preview mode; they can change their answer and check again.
 */
function CheckYourselfBody({ card }: { card: CheckYourselfCard }): React.JSX.Element {
  const name = `check-yourself-${useId().replace(/:/g, '')}`
  const [chosen, setChosen] = useState<number | null>(null)
  const [checked, setChecked] = useState<number | null>(null)
  const [needsAnswer, setNeedsAnswer] = useState(false)
  const right = checked !== null && checked === card.answer

  return (
    <div className="space-y-3">
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-base font-semibold text-text-strong">{card.prompt}</legend>
        <AnswerOptions
          name={name}
          options={card.options}
          value={chosen}
          onChange={(index) => {
            setChosen(index)
            setNeedsAnswer(false)
          }}
        />
      </fieldset>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="min-h-touch"
        onClick={() => {
          if (chosen === null) {
            setNeedsAnswer(true)
            return
          }
          setChecked(chosen)
        }}
      >
        Check my answer
      </Button>
      <div aria-live="polite" role="status">
        {needsAnswer ? <p className="text-base text-warning-fg">Choose an answer first.</p> : null}
        {checked !== null ? (
          <div
            className={cn(
              'rounded-default border p-3',
              right ? 'border-success-border bg-success-soft text-success-fg' : 'border-warning-border bg-warning-soft text-warning-fg',
            )}
          >
            <p className="flex items-center gap-1.5 text-base font-semibold">
              <Icon name={right ? 'checkCircle' : 'alertCircle'} size={18} />
              {right ? 'Yes, that is right.' : `Not quite. The answer is: ${card.options[card.answer] ?? ''}`}
            </p>
            <p className="mt-1 whitespace-pre-line text-base">{card.explanation}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface CourseCardViewProps {
  card: CourseCard
  /** Prefix for image cards (`PlayerCourseView.imageBaseUrl`). */
  imageBaseUrl: string
}

/** One card's content. Key it by its place in the course so a check-yourself card starts fresh. */
export function CourseCardView({ card, imageBaseUrl }: CourseCardViewProps): React.JSX.Element {
  switch (card.type) {
    case 'paragraph':
      return <Paragraphs text={card.text} />
    case 'bullets':
      return <BulletList items={card.items} />
    case 'do_dont':
      return <DoDontBody card={card} />
    case 'callout':
      return <CalloutBody card={card} />
    case 'table':
      return <TableCardBody card={card} />
    case 'steps':
      return <StepsBody card={card} />
    case 'image':
      return <ImageBody card={card} imageBaseUrl={imageBaseUrl} />
    case 'check_yourself':
      return <CheckYourselfBody card={card} />
  }
}
