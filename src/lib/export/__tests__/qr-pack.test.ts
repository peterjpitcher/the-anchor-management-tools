import { describe, expect, it } from 'vitest'
import { datedFolderName, sanitizeFilename } from '@/lib/export/filenames'
import { buildBriefMarkdown, qrFileStem, type BriefEvent } from '@/lib/export/qr-pack'
import type { EventMarketingLink } from '@/services/event-marketing'

const FULL_EVENT: BriefEvent = {
  id: '3f2a9c11-0000-4000-8000-000000000001',
  name: 'End of Summer Cash Bingo',
  date: '2026-09-02',
  time: '19:00',
  end_time: '21:30',
  doors_time: '18:30',
  last_entry_time: null,
  capacity: 50,
  price: 10,
  is_free: false,
  short_description: 'Ten games, a rollover Snowball and a cash jackpot.',
  brief: '# Cash Bingo\r\n\r\nA lively, feel-good night.\r\n',
  image_alt_text: 'Cash Bingo cards at The Anchor',
  accessibility_notes: 'Step-free access throughout.',
  slug: 'cash-bingo-2026-09-02',
  performer_name: 'Peter Pitcher',
  performer_type: 'Person',
  category: { name: 'Cash Bingo' },
}

const BARE_EVENT: BriefEvent = {
  id: '3f2a9c11-0000-4000-8000-000000000002',
  name: 'Quiz Night',
  date: '2026-09-16',
  time: null,
  end_time: null,
  doors_time: null,
  last_entry_time: null,
  capacity: null,
  price: null,
  is_free: true,
  short_description: null,
  brief: null,
  image_alt_text: null,
  accessibility_notes: null,
  slug: null,
  performer_name: null,
  performer_type: null,
  category: null,
}

function link(channel: string, label: string, type: 'print' | 'screen'): EventMarketingLink {
  return {
    id: `id-${channel}`,
    channel: channel as EventMarketingLink['channel'],
    label,
    type,
    shortCode: `sc-${channel}`,
    shortUrl: `https://l.the-anchor.pub/sc-${channel}`,
    destinationUrl: 'https://www.the-anchor.pub/events/x',
    utm: {},
    clickCount: 0,
  }
}

describe('sanitizeFilename', () => {
  it('strips path separators so a name cannot create folders', () => {
    expect(sanitizeFilename('a/b\\c', 'x')).toBe('a-b-c')
  })

  it('collapses punctuation runs', () => {
    expect(sanitizeFilename('Sleigh My Name: Festive Music Bingo', 'x')).toBe(
      'Sleigh-My-Name-Festive-Music-Bingo',
    )
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFilename('!!!', 'fallback')).toBe('fallback')
    expect(sanitizeFilename('   ', 'fallback')).toBe('fallback')
  })

  it('removes a trailing dot, which Windows cannot open', () => {
    expect(sanitizeFilename('event.', 'x')).toBe('event')
  })

  it('escapes reserved Windows device names', () => {
    expect(sanitizeFilename('CON', 'x')).toBe('CON-x')
    expect(sanitizeFilename('lpt1', 'x')).toBe('lpt1-x')
  })

  it('caps the length', () => {
    expect(sanitizeFilename('a'.repeat(400), 'x')).toHaveLength(120)
  })

  it('keeps unicode word characters', () => {
    expect(sanitizeFilename('Café Night', 'x')).toBe('Caf-Night')
  })
})

describe('datedFolderName', () => {
  it('leads with the date so a file browser sorts chronologically', () => {
    expect(datedFolderName('2026-09-02', 'Cash Bingo', 'abcd1234')).toBe('2026-09-02 - Cash-Bingo - abcd')
  })

  // Two events, same day, same name. Without the suffix these merge into one
  // folder and the second event's files silently replace the first's.
  it('separates two events that share a date and a name', () => {
    const a = datedFolderName('2026-09-02', 'Quiz Night', 'aaaa1111')
    const b = datedFolderName('2026-09-02', 'Quiz Night', 'bbbb2222')
    expect(a).not.toBe(b)
  })

  it('separates names that sanitise identically', () => {
    const a = datedFolderName('2026-09-02', 'Quiz: Night', 'aaaa1111')
    const b = datedFolderName('2026-09-02', 'Quiz Night', 'bbbb2222')
    expect(a).not.toBe(b)
  })
})

describe('buildBriefMarkdown', () => {
  const links = [link('poster', 'Poster', 'print'), link('venue_screen', 'Venue Screen', 'screen')]

  it('includes the details a designer needs', () => {
    const md = buildBriefMarkdown(FULL_EVENT, links)
    expect(md).toContain('# End of Summer Cash Bingo')
    expect(md).toContain('Wednesday, 2 September 2026')
    expect(md).toContain('| Doors | 6:30pm |')
    expect(md).toContain('| Starts | 7pm |')
    expect(md).toContain('| Price | £10 |')
    expect(md).toContain('| Host | Peter Pitcher |')
    expect(md).toContain('Cash Bingo cards at The Anchor')
    expect(md).toContain('Step-free access throughout.')
    expect(md).toContain('https://www.the-anchor.pub/events/cash-bingo-2026-09-02')
  })

  it('normalises the CRLF line endings the brief column carries', () => {
    const md = buildBriefMarkdown(FULL_EVENT, links)
    expect(md).not.toContain('\r')
  })

  it('lists every code with its placement and short link', () => {
    const md = buildBriefMarkdown(FULL_EVENT, links)
    expect(md).toContain('| Poster |')
    expect(md).toContain('| Venue Screen |')
    expect(md).toContain('https://l.the-anchor.pub/sc-poster')
  })

  it('omits rows with no value rather than printing blanks', () => {
    const md = buildBriefMarkdown(BARE_EVENT, [])
    expect(md).toContain('# Quiz Night')
    expect(md).not.toContain('| Doors |')
    expect(md).not.toContain('| Capacity |')
    expect(md).not.toContain('## Full brief')
    expect(md).not.toContain('## QR codes')
  })

  it('shows a free event as free rather than as no price', () => {
    expect(buildBriefMarkdown(BARE_EVENT, [])).toContain('| Price | Free |')
  })
})

describe('qrFileStem', () => {
  it('numbers files so they sort in catalogue order', () => {
    expect(qrFileStem(link('poster', 'Poster', 'print'), 0)).toBe('01-poster')
    expect(qrFileStem(link('table_talker', 'Table Talker', 'print'), 11)).toBe('12-table_talker')
  })

  it('uses the channel key, never the stored label, which has drifted', () => {
    // Older rows say "Poster QR" where newer ones say "Poster".
    expect(qrFileStem(link('poster', 'Poster QR', 'print'))).toBe('poster')
  })
})
