'use client'

import { Card, CardBody, CardHeader, Textarea } from '@/ds'
import { parseKeywords } from '@/lib/keywords'

interface KeywordStrategyCardProps {
  primaryKeywords: string
  secondaryKeywords: string
  localSeoKeywords: string
  onPrimaryChange: (value: string) => void
  onSecondaryChange: (value: string) => void
  onLocalChange: (value: string) => void
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
}: KeywordStrategyCardProps) {
  return (
    <Card>
      <CardHeader title="Keyword Strategy" />
      <CardBody className="space-y-4">
      <p className="text-sm text-text-muted">
        Paste your researched keywords here: these drive all AI-generated content. Accepts
        comma-separated or one per line.
      </p>

      <KeywordField
        id="primary-keywords"
        label="Primary Keywords"
        helpText="High-intent terms that appear in titles, headings, and meta descriptions."
        value={primaryKeywords}
        rows={2}
        placeholder={'pub quiz Heathrow\nquiz night near airport'}
        onChange={onPrimaryChange}
      />

      <KeywordField
        id="secondary-keywords"
        label="Secondary Keywords"
        helpText="Supporting terms woven into body copy, event descriptions, and social posts."
        value={secondaryKeywords}
        rows={3}
        placeholder={'Wednesday quiz night\nteam quiz evening\npub trivia prizes'}
        onChange={onSecondaryChange}
      />

      <KeywordField
        id="local-seo-keywords"
        label="Local SEO Keywords"
        helpText="Location-specific phrases for Google Maps, local landing pages, and nearby searches."
        value={localSeoKeywords}
        rows={3}
        placeholder={'things to do Sipson\nWest Drayton evening out\nnear Heathrow pubs'}
        onChange={onLocalChange}
      />
      </CardBody>
    </Card>
  )
}
