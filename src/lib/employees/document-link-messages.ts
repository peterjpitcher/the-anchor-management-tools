/**
 * What staff are told when an employee document cannot be opened or downloaded. Shared by the
 * server actions that make the signed links and the browser code that follows them, so a failed
 * Download never reads "Could not open". Storage's own text goes to the log, never here.
 */
export const DOCUMENT_OPEN_FAILED = 'Could not open the document. Please try again.'
export const DOCUMENT_DOWNLOAD_FAILED = 'Could not download the document. Please try again.'

export function documentLinkFailedMessage(download: boolean | undefined): string {
  return download ? DOCUMENT_DOWNLOAD_FAILED : DOCUMENT_OPEN_FAILED
}
