'use client'

import { Button, Card, CardBody, CardHeader, Textarea } from '@/ds'
import { parseKeywords } from '@/lib/keywords'
import { EVENT_SEO_LIMITS as L } from '@/lib/event-seo/limits'

interface KeywordStrategyCardProps {
  primaryKeywords: string
  secondaryKeywords: string
  localSeoKeywords: string
  onPrimaryChange: (value: string) => void
  onSecondaryChange: (value: string) => void
  onLocalChange: (value: string) => void
  /** A focus phrase worked out from the event name, offered while the Focus field is empty. */
  focusSuggestion?: string | null
  /** On a category the tiers are defaults for new events, and Focus is left for each event. */
  forCategory?: boolean
}

interface KeywordFieldProps {
  id: string
  label: string
  helpText: string
  value: string
  rows: number
  placeholder: string
  onChange: (value: string) => void
}

function KeywordField({
  id,
  label,
  helpText,
  value,
  rows,
  placeholder,
  onChange,
}: KeywordFieldProps) {
  const count = parseKeywords(value).length

  return (
    <div className="space-y-1.5">
      <Textarea
        id={id}
        label={label}
        hint={helpText}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-text-muted">
        {count === 0 ? 'No keywords entered' : `${count} keyword${count === 1 ? '' : 's'} entered`}
      </p>
    </div>
  )
}

export function KeywordStrategyCard({
  primaryKeywords,
  secondaryKeywords,
  localSeoKeywords,
  onPrimaryChange,
  onSecondaryChange,
  onLocalChange,
  focusSuggestion,
  forCategory = false,
}: KeywordStrategyCardProps) {
  const offerSuggestion = Boolean(focusSuggestion) && parseKeywords(primaryKeywords).length === 0

  return (
    <Card>
      <CardHeader title="Keyword Strategy" />
      <CardBody className="space-y-4">
      <p className="text-sm text-text-muted">
        Keywords from the keyword research. One per line, or separated by commas. An event page is
        found for its own night, so its Focus phrase is the theme or season plus the format; the
        format on its own belongs to the main page for that format.
      </p>

      <KeywordField
        id="primary-keywords"
        label="Focus"
        helpText={
          forCategory
            ? 'Usually left empty here. Each event sets its own focus phrase, the theme or season plus the format, and the event drawer suggests one from the event name.'
            : `The one search this page should be found for: theme or season plus format, such as "christmas music bingo" or "halloween party". It goes word for word into the meta description, the first paragraph and one FAQ. One phrase, plus up to ${L.focusKeywords.max - 1} variants.`
        }
        value={primaryKeywords}
        rows={2}
        placeholder={'christmas music bingo'}
        onChange={onPrimaryChange}
      />
      {offerSuggestion && focusSuggestion ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span>From the event name: &ldquo;{focusSuggestion}&rdquo;</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => onPrimaryChange(focusSuggestion)}>
            Use this
          </Button>
        </div>
      ) : null}

      <KeywordField
        id="secondary-keywords"
        label="Supporting"
        helpText={`Format and audience terms from the keyword research, such as "drag bingo", "snowball bingo" or "family friendly pub quiz". Used in the description where true and natural. Up to ${L.supportingKeywords.max}.`}
        value={secondaryKeywords}
        rows={3}
        placeholder={'music bingo\ndrag bingo\nmusical bingo'}
        onChange={onSecondaryChange}
      />

      <KeywordField
        id="local-seo-keywords"
        label="Local"
        helpText={`Place names only: Stanwell Moor, then nearby places such as Staines, Heathrow, Ashford or Feltham. Used where the description says where the pub is, and in one FAQ. Up to ${L.localKeywords.max}.`}
        value={localSeoKeywords}
        rows={2}
        placeholder={'Stanwell Moor\nStaines\nHeathrow'}
        onChange={onLocalChange}
      />
      </CardBody>
    </Card>
  )
}
