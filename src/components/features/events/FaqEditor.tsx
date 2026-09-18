'use client'

import { Button, Input, Textarea } from '@/ds'

interface FaqItem {
  question: string
  answer: string
  sort_order?: number
}

interface FaqEditorProps {
  faqs: FaqItem[]
  onChange: (faqs: FaqItem[]) => void
  onModified: () => void
}

const MAX_FAQS = 8

export function FaqEditor({ faqs, onChange, onModified }: FaqEditorProps) {
  function handleQuestionChange(index: number, value: string) {
    const updated = faqs.map((faq, i) =>
      i === index ? { ...faq, question: value } : faq
    )
    onChange(updated)
    onModified()
  }

  function handleAnswerChange(index: number, value: string) {
    const updated = faqs.map((faq, i) =>
      i === index ? { ...faq, answer: value } : faq
    )
    onChange(updated)
    onModified()
  }

  function handleAdd() {
    if (faqs.length >= MAX_FAQS) return
    const updated: FaqItem[] = [
      ...faqs,
      { question: '', answer: '', sort_order: faqs.length },
    ]
    onChange(updated)
    onModified()
  }

  function handleRemove(index: number) {
    const updated = faqs
      .filter((_, i) => i !== index)
      .map((faq, i) => ({ ...faq, sort_order: i }))
    onChange(updated)
    onModified()
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">
          FAQs{faqs.length > 0 ? ` (${faqs.length})` : ''}
        </span>
        <Button
          type="button"
          variant="link"
          onClick={handleAdd}
          disabled={faqs.length >= MAX_FAQS}
        >
          + Add FAQ
        </Button>
      </div>

      {/* Empty state */}
      {faqs.length === 0 && (
        <p className="text-sm italic text-text-soft">
          No FAQs yet. Generate with AI or add manually.
        </p>
      )}

      {/* FAQ cards */}
      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="rounded-lg border border-border bg-surface p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-medium text-text-muted mt-0.5 shrink-0">
                Q{index + 1}
              </span>
              <div className="flex-1 space-y-2">
                <Input
                  type="text"
                  value={faq.question}
                  onChange={(e) => handleQuestionChange(index, e.target.value)}
                  placeholder="Question"
                  aria-label={`FAQ ${index + 1} question`}
                />
                <Textarea
                  value={faq.answer}
                  onChange={(e) => handleAnswerChange(index, e.target.value)}
                  placeholder="Answer"
                  rows={2}
                  aria-label={`FAQ ${index + 1} answer`}
                />
              </div>
              <Button
                type="button"
                variant="link"
                onClick={() => handleRemove(index)}
                aria-label={`Remove FAQ ${index + 1}`}
                className="shrink-0 text-danger"
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
