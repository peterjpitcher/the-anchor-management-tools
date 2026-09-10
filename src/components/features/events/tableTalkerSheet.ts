import toast from 'react-hot-toast'

/** Where the A4 table talker sheet for an event is drawn. */
export function tableTalkerSheetUrl(eventId: string): string {
  return `/api/events/${eventId}/artwork/table-talker-sheet`
}

/** The file name the route chose, from its Content-Disposition header. */
function fileNameFrom(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  return match?.[1] ?? 'table-talkers-a4.pdf'
}

/**
 * Fetch the sheet and save it, or say exactly why it could not be printed.
 *
 * Fetched rather than linked to, because the route refuses in ways a person can
 * act on (not branded yet, resolution too low), and a plain link would open
 * those refusals as a raw page instead of a message. Resolves to whether the
 * file was saved.
 */
export async function downloadTableTalkerSheet(eventId: string): Promise<boolean> {
  let response: Response
  try {
    response = await fetch(tableTalkerSheetUrl(eventId))
  } catch {
    toast.error('Could not reach the server to make the print sheet. Check your connection and try again.')
    return false
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    toast.error(
      typeof body?.error === 'string' ? body.error : 'Could not make the print sheet. Try again in a moment.'
    )
    return false
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileNameFrom(response)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Not revoked at once: some browsers, Safari among them, start the save
  // after the click returns and would find the object already gone.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)

  toast.success('Print sheet saved. Print it at actual size (100%), then cut on the marks.')
  return true
}
