import { describe, expect, it } from 'vitest'
import { renderDocumentHead } from '@/lib/pdf/document-chrome'

const base = { titleHtml: 'Title', metaClass: '.meta', numberClass: '.number', bodyCss: '' }

describe('renderDocumentHead', () => {
  it('renders exactly as before when no extra head markup is given', () => {
    expect(renderDocumentHead(base)).toBe(renderDocumentHead({ ...base, headExtraHtml: '' }))
    expect(renderDocumentHead(base)).toContain('<meta charset="UTF-8">\n')
  })

  it('places extra head markup straight after the charset', () => {
    expect(renderDocumentHead({ ...base, headExtraHtml: '<meta name="robots" content="none">' })).toContain(
      '<meta charset="UTF-8"><meta name="robots" content="none">\n'
    )
  })
})
