export function filenameFromContentDisposition(
  contentDisposition: string | null,
  fallback: string
) {
  if (!contentDisposition) return fallback

  const quoted = contentDisposition.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1]

  const unquoted = contentDisposition.match(/filename=([^;]+)/i)
  if (unquoted?.[1]) return unquoted[1].trim()

  return fallback
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.style.display = 'none'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url)
  }, 0)
}
