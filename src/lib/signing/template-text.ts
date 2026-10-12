/**
 * The text side of templates: markers, merge fields and the conversion to HTML. Pure functions
 * with no server-only imports, so the settings page can use them in the browser. Building the
 * whole PDF document, which reads the logo files from disk, is in template-render.ts.
 */

/**
 * Template wording is plain text with three markers, so the owner can edit it in a text box
 * without learning anything:
 *
 *   ## A heading
 *   - a bullet
 *   {{merge_field}}
 *
 * A blank line starts a new paragraph. Everything else is printed exactly as typed, escaped.
 *
 * `[[TO CONFIRM: ...]]` marks a gap the owner must fill before the template can be switched on.
 */

export const DRAFT_MARKER_PATTERN = /\[\[[^\]]*\]\]/g
const MERGE_FIELD_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** The gaps still marked in a template, so the settings page can list them and refuse to activate. */
export function findDraftMarkers(body: string): string[] {
  return body.match(DRAFT_MARKER_PATTERN) ?? []
}

/** The merge fields a template uses, in the order they first appear. */
export function findMergeFields(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(MERGE_FIELD_PATTERN)) {
    seen.add(match[1])
  }
  return [...seen]
}

export class TemplateMergeError extends Error {
  constructor(public readonly missingFields: string[]) {
    super(`Template needs values that were not supplied: ${missingFields.join(', ')}`)
    this.name = 'TemplateMergeError'
  }
}

/**
 * Fill the merge fields. A field with no value is an error, never a blank: a contract that
 * reaches someone with a gap where the pay rate should be is worse than one that is not sent.
 */
export function mergeTemplateText(text: string, values: Record<string, string | null | undefined>): string {
  const missing = findMergeFields(text).filter((field) => {
    const value = values[field]
    return value === null || value === undefined || String(value).trim() === ''
  })
  if (missing.length > 0) {
    throw new TemplateMergeError(missing)
  }
  return text.replace(MERGE_FIELD_PATTERN, (_match, field: string) => String(values[field]).trim())
}

/** Turn merged template text into body HTML. All text is escaped; only our own tags are emitted. */
export function templateBodyToHtml(mergedBody: string): string {
  const lines = mergedBody.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`)
      paragraph = []
    }
  }
  const flushBullets = (): void => {
    if (bullets.length > 0) {
      html.push(`<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
      bullets = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      flushBullets()
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      flushBullets()
      html.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`)
      continue
    }
    if (line.startsWith('- ')) {
      flushParagraph()
      bullets.push(line.slice(2).trim())
      continue
    }
    flushBullets()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushBullets()

  return html.join('\n')
}
