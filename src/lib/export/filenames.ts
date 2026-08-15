// src/lib/export/filenames.ts
// Filename and archive-path helpers shared by the export routes.
//
// Extracted from the events CSV export, where it was module-private and could not
// be reused. Two exports sanitising names two different ways is how you end up
// with one archive that opens on Windows and another that does not.

/** Windows refuses these device names even with an extension. */
const RESERVED_WINDOWS_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/**
 * A filename-safe version of `value`, or `fallback` when nothing usable is left.
 *
 * Strips anything outside word characters, dots and hyphens, which also removes
 * the path separators that would otherwise let a name create nested folders in an
 * archive.
 */
export function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback

  const cleaned = trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    // A trailing dot is legal in a zip and unopenable on Windows.
    .replaceAll(/\.+$/g, '')
    .slice(0, 120)

  if (!cleaned) return fallback
  if (RESERVED_WINDOWS_NAMES.has(cleaned.toLowerCase())) return `${cleaned}-${fallback}`
  return cleaned
}

/**
 * A folder name for one dated record, unique even when two share a date and a
 * name.
 *
 * Date first so a file browser sorts chronologically, which is how a designer
 * works through a run of events. The id suffix is not decoration: two events on
 * the same day called "Quiz Night", or two names that sanitise identically, would
 * otherwise merge into one folder and silently lose files, because a zip is
 * happy to hold two entries with the same path and most tools keep the last.
 */
export function datedFolderName(isoDate: string, name: string, id: string): string {
  const safeName = sanitizeFilename(name, 'event')
  return `${isoDate} - ${safeName} - ${id.slice(0, 4)}`
}
