import { downloadBlob } from '@/lib/download-file'

type InvoicePdfDownloadTarget = {
  id: string
  invoiceNumber: string
}

export const getInvoicePdfDownloadHref = (invoiceId: string) =>
  `/api/invoices/${encodeURIComponent(invoiceId)}/pdf?download=1`

export const getInvoicePdfFilename = (invoiceNumber: string) =>
  `invoice-${invoiceNumber}.pdf`

export async function downloadInvoicePdf({
  id,
  invoiceNumber,
}: InvoicePdfDownloadTarget) {
  const response = await fetch(getInvoicePdfDownloadHref(id), {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || 'Failed to download invoice PDF')
  }

  const blob = await response.blob()
  downloadBlob(blob, getInvoicePdfFilename(invoiceNumber))
}
