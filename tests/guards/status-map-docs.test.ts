import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * docs/standards/UI_UX.md lists every named status map (the "Status" bullets and the table under
 * them), so nobody picks a tone inline because they could not find the map. The list drifted:
 * maps were added without a row and removed maps stayed listed. This guard holds the two
 * together in both directions:
 *
 * - every name the Status section lists is exported by the file it names;
 * - every export of a status file (status-ui.ts and the few other files that hold status maps)
 *   is listed, apart from the plain helpers in NOT_STATUS_IN_STATUS_FILES;
 * - every export anywhere in src whose name reads as a status map (…_TONE, …_TONES, …_CLASSES,
 *   …_LABEL, …_LABELS, …Tone, …Tones) is listed, apart from NOT_STATUS_ELSEWHERE.
 *
 * Adding a status map? Add it to its file's row in UI_UX.md. Adding something that only looks
 * like one? Add it to the right allowlist with the reason.
 */

const ROOT = process.cwd()
const DOC = join(ROOT, 'docs/standards/UI_UX.md')
const AUTHENTICATED = 'src/app/(authenticated)/'

/** Files that hold status maps without being called status-ui. */
const OTHER_STATUS_FILES = [
  'src/app/(authenticated)/vouchers/_shared/voucher-ui.tsx',
  'src/app/(authenticated)/marketing/_shared/marketing-ui.tsx',
  'src/app/(authenticated)/vouchers/foh/components/voucher-status.ts',
  'src/components/features/invoices/RefundHistoryTable.tsx',
  'src/lib/table-bookings/ui.ts',
]

/** Exports of status files that are not status maps. */
const NOT_STATUS_IN_STATUS_FILES: Record<string, string> = {
  formatPercent: 'marketing formatter',
  formatGbp: 'money formatter (marketing, table bookings)',
  formatCountWithRate: 'marketing formatter',
  formatDateTimeInLondon: 'marketing formatter',
  formatDateOnlyInLondon: 'marketing formatter',
  formatSendDays: 'marketing formatter',
  formatHour: 'marketing formatter',
  ISO_DAY_OPTIONS: 'marketing select options',
  HOUR_OPTIONS: 'marketing select options',
  formatPence: 'voucher money formatter',
  newIdempotencyKey: 'voucher request key',
  ledgerHref: 'voucher ledger link',
  RefundHistoryTable: 'the component the refund map belongs to',
  FEEDBACK_STATUS_OPTIONS: 'the feedback inbox filter options, worded from FEEDBACK_STATUS_LABEL',
}

/** Exports elsewhere in src whose names read as status maps but are not. */
const NOT_STATUS_ELSEWHERE: Record<string, string> = {
  resolveConfirmDialogTone: 'the ConfirmDialog button colour, a DS prop resolver',
  CUSTOMERS_BACK_LABEL: 'a back button label',
  MISSING_VENDOR_LABEL: 'the receipts group heading for no vendor',
  GUEST_MARKETING_EMAIL_LABEL: 'consent wording',
  GUEST_MARKETING_SMS_LABEL: 'consent wording',
  GUEST_WHATSAPP_SERVICE_LABEL: 'consent wording',
  GUEST_MARKETING_WHATSAPP_LABEL: 'consent wording',
  GUEST_MARKETING_SMS_STOP_LABEL: 'consent wording',
  QR_STRIP_LABEL: 'artwork text',
  DRIVER_BASIS_LABELS: 'mileage report column words',
  VENDOR_SERVICE_TYPE_LABELS: 'private booking item categories',
  GROUP_LABELS: 'private booking item groups',
  RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL: 'an upload limit',
  RECEIPT_FILE_UPLOAD_LIMIT_LABEL: 'an upload limit',
  LEGACY_REPORT_LOCATION_LABELS: 'legacy link survey answers',
  PERIOD_KIND_LABELS: 'table booking period kinds',
  MENU_COURSE_LABELS: 'menu course names',
  MENU_COURSE_PICKER_LABELS: 'menu course names',
  PREORDER_COURSE_LABELS: 'menu course names',
  PREORDER_SELECTION_COURSE_LABELS: 'menu course names',
  CONTENT_GAP_LABELS: 'calendar filter names',
}

const STATUS_NAME = /(_TONES?|_CLASSES|_LABELS?)$|Tones?$/
const IDENTIFIER = /`([A-Za-z_$][A-Za-z0-9_$]*)`/g
const PATH = /`((?:src\/)?[^`\s]*\/[^`\s]*\.tsx?)`/g

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !path.includes('__tests__')) {
      found.push(relative(ROOT, path))
    }
  }
  return found
}

function exportsOf(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const names = [...source.matchAll(/^export (?:async )?(?:const|let|function|class) ([A-Za-z_$][A-Za-z0-9_$]*)/gm)].map(
    (match) => match[1],
  )
  for (const list of source.matchAll(/^export \{([^}]+)\}/gm)) {
    for (const part of list[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name && !name.startsWith('type ')) names.push(name)
    }
  }
  return names
}

/** A path as the doc writes it: src/... as is, anything else under src/app/(authenticated)/. */
function resolveDocPath(path: string): string {
  return path.startsWith('src/') ? path : `${AUTHENTICATED}${path}`
}

function statusSection(): string {
  const doc = readFileSync(DOC, 'utf8')
  const start = doc.indexOf('- **Status:**')
  const end = doc.indexOf('Paths without `src/`', start)
  expect(start, 'UI_UX.md must keep its Status section').toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return doc.slice(start, end)
}

/** Each listed name with the files it may live in: its row's file, or a file named beside it. */
function listedNames(): Array<{ name: string; files: string[]; where: string }> {
  const listed: Array<{ name: string; files: string[]; where: string }> = []
  for (const line of statusSection().split('\n')) {
    const row = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*(.+)\|\s*$/)
    if (row && !row[1].startsWith('Area') && !row[1].startsWith('---')) {
      const [, area, file, maps] = row
      const files = [resolveDocPath(file), ...[...maps.matchAll(PATH)].map((match) => resolveDocPath(match[1]))]
      for (const match of maps.matchAll(IDENTIFIER)) listed.push({ name: match[1], files, where: area })
      continue
    }
    const bullet = line.match(/^ {2}- (.+)$/)
    if (bullet) {
      const files = [...bullet[1].matchAll(PATH)].map((match) => resolveDocPath(match[1]))
      if (files.length === 0) continue
      for (const match of bullet[1].matchAll(IDENTIFIER)) listed.push({ name: match[1], files, where: bullet[1].slice(0, 40) })
    }
  }
  return listed
}

function statusFiles(): string[] {
  const named = sourceFiles(join(ROOT, 'src')).filter((file) => /\/status-ui\.tsx?$/.test(file))
  return [...named, ...OTHER_STATUS_FILES].sort()
}

describe('UI_UX.md status maps', () => {
  const listed = listedNames()
  const listedSet = new Set(listed.map((entry) => entry.name))

  it('reads the Status section', () => {
    expect(listed.length).toBeGreaterThan(250)
  })

  it('names only maps that exist, in the file it gives for them', () => {
    const missing = listed
      .filter(({ files }) => files.every((file) => existsSync(join(ROOT, file))))
      .filter(({ name, files }) => !files.some((file) => exportsOf(file).includes(name)))
      .map(({ name, files, where }) => `${name} (${where}: ${files.join(', ')})`)
    const badFiles = [...new Set(listed.flatMap(({ files }) => files))].filter((file) => !existsSync(join(ROOT, file)))

    expect(badFiles, 'files the Status section names that do not exist').toEqual([])
    expect(missing, 'names the Status section lists that their file does not export').toEqual([])
  })

  it('lists every export of every status file', () => {
    const unlisted = statusFiles().flatMap((file) =>
      exportsOf(file)
        .filter((name) => !listedSet.has(name) && !(name in NOT_STATUS_IN_STATUS_FILES))
        .map((name) => `${name} (${file})`),
    )

    expect(unlisted, 'status file exports missing from UI_UX.md').toEqual([])
  })

  it('lists every export in src whose name reads as a status map', () => {
    const inStatusFiles = new Set(statusFiles())
    const unlisted = sourceFiles(join(ROOT, 'src'))
      .filter((file) => !inStatusFiles.has(file))
      .flatMap((file) =>
        exportsOf(file)
          .filter((name) => STATUS_NAME.test(name))
          .filter((name) => !listedSet.has(name) && !(name in NOT_STATUS_ELSEWHERE))
          .map((name) => `${name} (${file})`),
      )

    expect(unlisted, 'status maps missing from UI_UX.md (or add them to NOT_STATUS_ELSEWHERE)').toEqual([])
  })

  it('keeps each allowlist entry real, so it cannot hide a renamed map', () => {
    const everyExport = new Set(sourceFiles(join(ROOT, 'src')).flatMap(exportsOf))
    const stale = [...Object.keys(NOT_STATUS_IN_STATUS_FILES), ...Object.keys(NOT_STATUS_ELSEWHERE)].filter(
      (name) => !everyExport.has(name),
    )

    expect(stale).toEqual([])
  })
})
