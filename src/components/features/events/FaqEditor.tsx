'use client'

import { Button, Card, Empty, Input, SubHeading, Textarea } from '@/ds'

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
        <SubHeading>
          FAQs{faqs.length > 0 ? ` (${faqs.length})` : ''}
        </SubHeading>
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
        <Empty size="sm" title="No FAQs Yet" description="Generate with AI or add manually." />
      )}

      {/* FAQ cards */}
      <div className="space-y-3">
        {faqs.map((faq, index) => (
          <Card key={index}>
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
                className="shrink-0 text-danger-fg"
              >
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
