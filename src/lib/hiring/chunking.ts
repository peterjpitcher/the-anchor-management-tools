const DEFAULT_CHUNK_SIZE = 8000
const MIN_CHUNK_BREAK = 0.6
const DEFAULT_OVERLAP_CHARS = 300

const HEADING_REGEX = /^(experience|employment|work history|work experience|education|skills|summary|profile|projects|certifications|training|qualifications|languages)\b/i
const DATE_RANGE_REGEX = /(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s+\d{4}\b)|(\b\d{4}\b\s*[-–]\s*(present|current|\b\d{4}\b))/i

export function splitTextIntoChunks(text: string, maxChars = DEFAULT_CHUNK_SIZE): string[] {
    const trimmed = text.trim()
    if (!trimmed) return []
    if (trimmed.length <= maxChars) return [trimmed]

    const chunks: string[] = []
    let cursor = 0

    while (cursor < trimmed.length) {
        const sliceEnd = Math.min(trimmed.length, cursor + maxChars)
        let end = sliceEnd

        if (sliceEnd < trimmed.length) {
            const lastBreak = trimmed.lastIndexOf('\n', sliceEnd)
            const minBreak = cursor + Math.floor(maxChars * MIN_CHUNK_BREAK)
            if (lastBreak > minBreak) {
                end = lastBreak
            }
        }

        const chunk = trimmed.slice(cursor, end).trim()
        if (chunk) {
            chunks.push(chunk)
        }

        cursor = end
        if (cursor === sliceEnd && cursor < trimmed.length) {
            cursor += 1
        }
    }

    return chunks
}

function splitLinesIntoBlocks(lines: string[]) {
    const blocks: string[] = []
    let current: string[] = []

    const flush = () => {
        if (!current.length) return
        blocks.push(current.join('\n').trim())
        current = []
    }

    lines.forEach((raw) => {
        const line = raw.trim()
        if (!line) {
            flush()
            return
        }

        if (HEADING_REGEX.test(line) && current.length) {
            flush()
        }

        if (DATE_RANGE_REGEX.test(line) && current.length) {
            flush()
        }

        current.push(line)
    })

    flush()
    return blocks.filter(Boolean)
}

export function splitResumePageIntoChunks(text: string, maxChars = DEFAULT_CHUNK_SIZE, overlapChars = DEFAULT_OVERLAP_CHARS): string[] {
    const trimmed = text.trim()
    if (!trimmed) return []

    const lines = trimmed.split(/\r?\n/)
    const blocks = splitLinesIntoBlocks(lines)
    if (!blocks.length) return []

    const chunks: string[] = []
    let current = ''

    blocks.forEach((block) => {
        if (!current) {
            current = block
            return
        }

        const candidate = `${current}\n\n${block}`
        if (candidate.length > maxChars) {
            chunks.push(current)
            const overlap = overlapChars > 0 ? current.slice(-Math.min(overlapChars, Math.floor(maxChars * 0.2))) : ''
            current = overlap ? `${overlap}\n\n${block}` : block
        } else {
            current = candidate
        }
    })

    if (current) {
        chunks.push(current)
    }

    return chunks
}
