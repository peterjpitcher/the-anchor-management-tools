import { NextRequest, NextResponse } from 'next/server'
import archiver, { type ArchiverError } from 'archiver'
import { PassThrough } from 'stream'
import path from 'path'
import { promises as fs } from 'fs'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { receiptQuarterExportSchema } from '@/lib/validation'
import type { ReceiptTransaction, ReceiptFile } from '@/types/database'

export const runtime = 'nodejs'

const RECEIPT_BUCKET = 'receipts'

type ReceiptTransactionRow = ReceiptTransaction & {
  receipt_files?: ReceiptFile[] | null
}

type QuarterRange = { startDate: string; endDate: string }

export async function GET(request: NextRequest) {
  try {
    await checkUserPermission('receipts', 'export')

    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year'))
    const quarter = Number(url.searchParams.get('quarter'))

    const parsed = receiptQuarterExportSchema.safeParse({ year, quarter })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid export parameters'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { startDate, endDate } = deriveQuarterRange(parsed.data.year, parsed.data.quarter)

    const supabase = createAdminClient()
    const { data: transactions, error } = await supabase
      .from('receipt_transactions')
      .select('*, receipt_files(*), receipt_rules!receipt_transactions_rule_applied_id_fkey(id, name)')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: true })
      .order('details', { ascending: true })

    if (error) {
      console.error('Failed to fetch receipt transactions for export:', error)
      return NextResponse.json({ error: 'Failed to load transactions for export.' }, { status: 500 })
    }

    const rows = (transactions ?? []) as ReceiptTransactionRow[]
    const pdfBuffer = await buildSummaryPdf(rows, parsed.data.year, parsed.data.quarter)

    const archive = archiver('zip', { zlib: { level: 9 } })
    const passthrough = new PassThrough()
    archive.pipe(passthrough)
    const chunks: Buffer[] = []

    const archiveFinished = new Promise<void>((resolve, reject) => {
      passthrough.on('data', (chunk) => chunks.push(chunk as Buffer))
      passthrough.on('end', resolve)
      passthrough.on('error', reject)
      archive.on('warning', (warning) => {
        const archiverWarning = warning as ArchiverError
        if (archiverWarning?.code === 'ENOENT') {
          console.warn('Archiver warning:', warning)
          return
        }
        reject(warning)
      })
      archive.on('error', (archiveError) => {
        reject(archiveError)
      })
    })

    archive.append(pdfBuffer, {
      name: `Receipts_Q${parsed.data.quarter}_${parsed.data.year}.pdf`,
    })

    for (const transaction of rows) {
      const files = transaction.receipt_files ?? []
      if (!files?.length) continue

      for (const file of files) {
        const download = await supabase.storage.from(RECEIPT_BUCKET).download(file.storage_path)
        if (download.error || !download.data) {
          console.warn(`Failed to download receipt ${file.storage_path}:`, download.error)
          continue
        }

        const buffer = await normaliseToBuffer(download.data)
        const name = buildReceiptFileName(transaction, file)

        archive.append(buffer, { name })
      }
    }

    if (!rows.length) {
      const placeholder = Buffer.from('No transactions found for this quarter.', 'utf-8')
      archive.append(placeholder, { name: 'README.txt' })
    }

    await archive.finalize()
    await archiveFinished

    const zipBuffer = Buffer.concat(chunks)

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="receipts_q${parsed.data.quarter}_${parsed.data.year}.zip"`,
        'Cache-Control': 'no-store',
        'Content-Length': zipBuffer.length.toString(),
      },
    })
  } catch (err) {
    console.error('Receipts export failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to generate receipts export.', details: message }, { status: 500 })
  }
}

async function buildSummaryPdf(
  transactions: ReceiptTransactionRow[],
  year: number,
  quarter: number
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const pageSize: [number, number] = [841.89, 595.28] // A4 landscape in points
  let page = pdfDoc.addPage(pageSize)
  const { width, height } = page.getSize()
  const margin = 48
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let cursorY = height - margin

  const logoImage = await loadLogoImage(pdfDoc)
  if (logoImage) {
    const logoWidth = 120
    const logoHeight = (logoImage.height / logoImage.width) * logoWidth
    page.drawImage(logoImage, {
      x: margin,
      y: cursorY - logoHeight,
      width: logoWidth,
      height: logoHeight,
    })
    cursorY -= logoHeight + 20
  }

  const drawText = (
    text: string,
    options: { x?: number; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> }
  ) => {
    const { x = margin, font = fontRegular, size = 12, color = rgb(0, 0, 0) } = options
    page.drawText(text, { x, y: cursorY, size, font, color })
  }

  const ensureSpace = (required: number) => {
    if (cursorY - required < margin) {
      page = pdfDoc.addPage(pageSize)
      cursorY = height - margin
      drawHeaderRow()
      cursorY -= 20
    }
  }

  drawText(`Receipts Summary — Q${quarter} ${year}`, { font: fontBold, size: 18 })
  cursorY -= 28

  const totals = transactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.status] = (acc[tx.status] || 0) + 1
    return acc
  }, {})

  const summaryLines = [
    `Total transactions: ${transactions.length}`,
    `Completed: ${totals['completed'] ?? 0}`,
    `Auto-completed: ${totals['auto_completed'] ?? 0}`,
    `No receipt required: ${totals['no_receipt_required'] ?? 0}`,
    `Outstanding: ${totals['pending'] ?? 0}`,
  ]

  summaryLines.forEach((line) => {
    ensureSpace(16)
    drawText(line, { size: 12 })
    cursorY -= 16
  })

  cursorY -= 12
  drawHeaderRow()
  cursorY -= 20

  if (!transactions.length) {
    drawText('No transactions recorded for this quarter.', { size: 12 })
    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
  }

  transactions.forEach((tx) => {
    const rowLines = buildRowLines(tx, fontRegular, fontBold, width - margin * 2)
    rowLines.forEach((segments) => {
      ensureSpace(18)
      let offsetX = margin
      segments.forEach((segment, index) => {
        const font = segment.bold ? fontBold : fontRegular
        const size = segment.size ?? 10
        drawText(segment.text, { x: offsetX, font, size })
        offsetX += segment.width
      })
      cursorY -= 14
    })

    cursorY -= 8
  })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)

  function drawHeaderRow() {
    const headers = [
      { label: 'Date', width: 70 },
      { label: 'Details', width: 200 },
      { label: 'Vendor', width: 110 },
      { label: 'Expense type', width: 120 },
      { label: 'In', width: 60 },
      { label: 'Out', width: 60 },
      { label: 'Status', width: 60 },
      { label: 'Marked By', width: 105 },
    ]

    let offsetX = margin
    headers.forEach((header) => {
      drawText(header.label, { x: offsetX, font: fontBold, size: 10 })
      offsetX += header.width
    })

    const lineY = cursorY - 10
    page.drawLine({
      start: { x: margin, y: lineY },
      end: { x: width - margin, y: lineY },
      color: rgb(0.75, 0.75, 0.75),
      thickness: 1,
    })
  }

  function buildRowLines(
    tx: ReceiptTransactionRow,
    regular: PDFFont,
    bold: PDFFont,
    maxWidth: number
  ): Array<Array<{ text: string; width: number; bold?: boolean; size?: number }>> {
    const columns = [
      { text: formatDate(tx.transaction_date), width: 70, bold: true },
      { text: tx.details ?? '', width: 200 },
      { text: tx.vendor_name ?? '', width: 110 },
      { text: tx.expense_category ?? '', width: 120 },
      { text: tx.amount_in ? formatCurrency(tx.amount_in) : '', width: 60 },
      { text: tx.amount_out ? formatCurrency(tx.amount_out) : '', width: 60 },
      { text: friendlyStatus(tx.status), width: 60 },
      {
        text: tx.marked_by_name || tx.marked_by_email || (tx.rule_applied_id ? 'Auto rule' : ''),
        width: 105,
      },
    ]

    const columnLines = columns.map((column) =>
      wrapText(column.text, column.bold ? bold : regular, 10, column.width)
    )

    const totalLines = Math.max(...columnLines.map((lines) => lines.length))
    const lines: Array<Array<{ text: string; width: number; bold?: boolean }>> = []

    for (let index = 0; index < totalLines; index += 1) {
      const segments = columnLines.map((lineGroup, columnIndex) => ({
        text: lineGroup[index] ?? '',
        width: columns[columnIndex].width,
        bold: Boolean(columns[columnIndex].bold),
      }))
      lines.push(segments)
    }

    const extraLines: string[] = []
    if (tx.transaction_type) {
      extraLines.push(`Type: ${tx.transaction_type}`)
    }
    const sourceParts: string[] = []
    if (tx.vendor_source) {
      sourceParts.push(`Vendor via ${tx.vendor_source}`)
    }
    if (tx.expense_category_source) {
      sourceParts.push(`Expense via ${tx.expense_category_source}`)
    }
    if (sourceParts.length) {
      extraLines.push(sourceParts.join(' · '))
    }
    const notes = tx.notes?.trim()
    if (notes) {
      extraLines.push(`Notes: ${notes}`)
    }

    extraLines.forEach((line) => {
      const wrapped = wrapText(line, regular, 10, maxWidth)
      wrapped.forEach((noteLine, idx) => {
        lines.push([
          {
            text: idx === 0 ? noteLine : `   ${noteLine}`,
            width: maxWidth,
          },
        ])
      })
    })

    return lines
  }

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine: string[] = []
  let lineWidth = 0

  words.forEach((word) => {
    const wordWidth = font.widthOfTextAtSize(`${word} `, size)
    if (lineWidth + wordWidth > maxWidth && currentLine.length > 0) {
      lines.push(currentLine.join(' '))
      currentLine = [word]
      lineWidth = wordWidth
    } else {
      currentLine.push(word)
      lineWidth += wordWidth
    }
  })

  if (currentLine.length > 0) {
    lines.push(currentLine.join(' '))
  }

  return lines.length ? lines : ['']
}
}

async function loadLogoImage(pdfDoc: PDFDocument) {
  const candidates = ['logo-oj.png', 'logo-oj.jpg', 'logo-oj.jpeg']
  for (const fileName of candidates) {
    try {
      const logoPath = path.join(process.cwd(), 'public', fileName)
      const logoBytes = await fs.readFile(logoPath)
      const ext = path.extname(fileName).toLowerCase()
      if (ext === '.png') {
        return await pdfDoc.embedPng(logoBytes)
      }
      return await pdfDoc.embedJpg(logoBytes)
    } catch (error) {
      // Try next candidate
      continue
    }
  }
  console.warn('Receipts export: logo image unavailable')
  return null
}

function deriveQuarterRange(year: number, quarter: number): QuarterRange {
  const startMonth = (quarter - 1) * 3 + 1
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const endMonth = startMonth + 2
  const endDate = new Date(Date.UTC(year, endMonth, 0))
  const endDateIso = endDate.toISOString().slice(0, 10)

  return { startDate, endDate: endDateIso }
}

function friendlyStatus(status: ReceiptTransaction['status']) {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'auto_completed':
      return 'Auto completed'
    case 'no_receipt_required':
      return 'No receipt req.'
    default:
      return 'Pending'
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function buildReceiptFileName(transaction: ReceiptTransaction, file: ReceiptFile) {
  const baseName = file.file_name?.trim()
  if (baseName) {
    return `receipts/${sanitizeZipFilename(baseName)}`
  }

  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const amountLabel = amount ? amount.toFixed(2) : '0.00'
  const description = sanitizeDescriptionForFilename(transaction.details ?? '').slice(0, 80) || 'Receipt'
  const extension = file.file_name?.split('.').pop()?.toLowerCase() || 'pdf'
  const fallback = `${transaction.transaction_date} - ${description} - ${amountLabel}.${extension}`

  return `receipts/${sanitizeZipFilename(fallback)}`
}

async function normaliseToBuffer(data: unknown): Promise<Buffer> {
  if (!data) {
    return Buffer.from('')
  }

  if (Buffer.isBuffer(data)) {
    return data
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data)
  }

  if (typeof (data as any).arrayBuffer === 'function') {
    const arrayBuffer = await (data as Blob).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  return Buffer.from(String(data))
}

function sanitizeDescriptionForFilename(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\s&\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeZipFilename(value: string, fallback = 'receipt.pdf'): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
}
