/**
 * Opening and downloading employee documents through short-lived signed links, shared by the
 * documents list and the right to work tab. Each link is fetched on the click, so it is never
 * minutes old (the links last five minutes).
 */

type SignedUrlResult = { url: string | null; error: string | null }

const OPEN_FAILED = 'Could not open the document. Please try again.'
const DOWNLOAD_FAILED = 'Could not download the document. Please try again.'

/**
 * Opens the document in a new tab. The tab is opened before the link is fetched, while the click
 * still counts as the user's own action: a tab opened after the await was blocked as a popup.
 * Returns an error message to show, or null when the document opened.
 */
export async function viewSignedDocument(fetchUrl: () => Promise<SignedUrlResult>): Promise<string | null> {
  const newTab = window.open('', '_blank')
  try {
    const result = await fetchUrl()
    if (!result.url) {
      newTab?.close()
      return result.error || OPEN_FAILED
    }
    if (newTab) {
      newTab.opener = null
      newTab.location.href = result.url
    } else {
      window.open(result.url, '_blank', 'noopener')
    }
    return null
  } catch {
    newTab?.close()
    return OPEN_FAILED
  }
}

/**
 * Downloads the document. The signed link itself names the file (the server asks storage for a
 * download link), because a page cannot set the name of a file from another site: the browser
 * ignores the `download` attribute on a cross-origin link.
 */
export async function downloadSignedDocument(fetchUrl: () => Promise<SignedUrlResult>): Promise<string | null> {
  try {
    const result = await fetchUrl()
    if (!result.url) {
      return result.error || DOWNLOAD_FAILED
    }
    const link = document.createElement('a')
    link.href = result.url
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    return null
  } catch {
    return DOWNLOAD_FAILED
  }
}
