'use client'

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
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-900">
          {label}
        </label>
        <p className="text-xs text-gray-500 mt-0.5">{helpText}</p>
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-y"
      />
      <p className="text-xs text-gray-500">
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
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-purple-700">Keyword Strategy</h2>
        <p className="mt-0.5 text-sm text-gray-600">
          Paste your researched keywords here — these drive all AI-generated content. Accepts
          comma-separated or one per line.
        </p>
      </div>

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
    </div>
  )
}
