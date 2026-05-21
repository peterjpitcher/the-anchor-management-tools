export async function downloadQrPng(fullUrl: string, filename: string): Promise<void> {
  const QRCode = await import('qrcode')
  const dataUrl = await QRCode.toDataURL(fullUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 640,
  })

  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

export function safeQrFilename(shortCode: string, suffix?: string): string {
  const safeCode = shortCode.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const safeSuffix = suffix?.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  return safeSuffix ? `qr-${safeCode}-${safeSuffix}.png` : `qr-${safeCode}.png`
}
