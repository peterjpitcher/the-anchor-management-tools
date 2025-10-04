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
      .order('transaction_date', { ascending: false })
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
  const margin = 36
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let cursorY = height - margin

  const logoImage = await loadLogoImage(pdfDoc)
  if (logoImage) {
    const logoWidth = 100
    const logoHeight = (logoImage.height / logoImage.width) * logoWidth
    page.drawImage(logoImage, {
      x: margin,
      y: cursorY - logoHeight,
      width: logoWidth,
      height: logoHeight,
    })
    cursorY -= logoHeight + 16
  }

  const drawText = (
    text: string,
    options: { x?: number; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> }
  ) => {
    const { x = margin, font = fontRegular, size = 6, color = rgb(0, 0, 0) } = options
    page.drawText(text, { x, y: cursorY, size, font, color })
  }

  const ensureSpace = (required: number) => {
    if (cursorY - required < margin) {
      page = pdfDoc.addPage(pageSize)
      cursorY = height - margin
      drawHeaderRow()
    }
  }

  drawText(`Receipts Summary — Q${quarter} ${year}`, { font: fontBold, size: 16 })
  cursorY -= 24

  const totals = transactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.status] = (acc[tx.status] || 0) + 1
    return acc
  }, {})

  const lineSpacing = 10
  const rowGap = 5

  const columnDefs = [
    { key: 'date', label: 'Date', width: 60 },
    { key: 'details', label: 'Details', width: 200 },
    { key: 'vendor', label: 'Vendor', width: 110 },
    { key: 'expense', label: 'Expense type', width: 120 },
    { key: 'in', label: 'In', width: 60 },
    { key: 'out', label: 'Out', width: 60 },
    { key: 'status', label: 'Status', width: 70 },
  ] as const

  drawSummaryGrid({
    total: transactions.length,
    completed: totals['completed'] ?? 0,
    autoCompleted: totals['auto_completed'] ?? 0,
    noReceiptRequired: totals['no_receipt_required'] ?? 0,
    cantFind: totals['cant_find'] ?? 0,
    pending: totals['pending'] ?? 0,
  })

  cursorY -= 8
  drawHeaderRow()

  if (!transactions.length) {
    drawText('No transactions recorded for this quarter.', { size: 10 })
    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
  }

  transactions.forEach((tx) => {
    const rowLines = buildRowLines(tx, fontRegular, fontBold, width - margin * 2)
    const rowHeight = rowLines.length * lineSpacing
    ensureSpace(rowHeight + rowGap)
    const rowTop = cursorY

    rowLines.forEach((segments) => {
      let offsetX = margin
      segments.forEach((segment) => {
        const font = segment.bold ? fontBold : fontRegular
        const size = segment.size ?? 6
        page.drawText(segment.text, { x: offsetX + 2, y: cursorY, size, font, color: rgb(0.15, 0.17, 0.2) })
        offsetX += segment.width
      })
      cursorY -= lineSpacing
    })

    const rowBottom = cursorY
    drawRowGrid(rowTop, rowBottom)

    cursorY = rowBottom - rowGap
  })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)

  function drawSummaryGrid(stats: {
    total: number
    completed: number
    autoCompleted: number
    noReceiptRequired: number
    cantFind: number
    pending: number
  }) {
    const cards = [
      { label: 'Total transactions', value: stats.total, accent: rgb(0.18, 0.4, 0.54) },
      { label: 'Completed', value: stats.completed, accent: rgb(0.07, 0.47, 0.32) },
      { label: 'Auto-completed', value: stats.autoCompleted, accent: rgb(0.09, 0.36, 0.66) },
      { label: 'No receipt required', value: stats.noReceiptRequired, accent: rgb(0.35, 0.35, 0.42) },
      { label: "Can't find", value: stats.cantFind, accent: rgb(0.71, 0.22, 0.29) },
      { label: 'Pending', value: stats.pending, accent: rgb(0.83, 0.52, 0.08) },
    ]

    const cardsPerRow = 3
    const gap = 12
    const cardHeight = 40
    const cardWidth = (width - margin * 2 - gap * (cardsPerRow - 1)) / cardsPerRow

    let index = 0
    while (index < cards.length) {
      ensureSpace(cardHeight + 8)
      const rowY = cursorY - cardHeight
      let offsetX = margin

      for (let col = 0; col < cardsPerRow && index < cards.length; col += 1) {
        const card = cards[index]
        page.drawRectangle({
          x: offsetX,
          y: rowY,
          width: cardWidth,
          height: cardHeight,
          color: rgb(0.97, 0.98, 0.99),
          borderColor: rgb(0.82, 0.85, 0.9),
          borderWidth: 0.75,
        })

        const labelY = rowY + cardHeight - 14
        page.drawText(card.label.toUpperCase(), {
          x: offsetX + 10,
          y: labelY,
          size: 5,
          font: fontBold,
          color: rgb(0.35, 0.4, 0.45),
        })

        page.drawText(String(card.value), {
          x: offsetX + 10,
          y: rowY + 12,
          size: 11,
          font: fontBold,
          color: card.accent,
        })

        offsetX += cardWidth + gap
        index += 1
      }

      cursorY = rowY - 12
    }
  }

  function drawHeaderRow() {
    let offsetX = margin
    columnDefs.forEach((header) => {
      drawText(header.label.toUpperCase(), {
        x: offsetX,
        font: fontBold,
        size: 6,
        color: rgb(0.28, 0.35, 0.42),
      })
      offsetX += header.width
    })

    const lineY = cursorY - 10
    page.drawLine({
      start: { x: margin, y: lineY },
      end: { x: width - margin, y: lineY },
      color: rgb(0.85, 0.85, 0.85),
      thickness: 0.75,
    })

    cursorY = lineY - 6
  }

  function drawRowGrid(rowTop: number, rowBottom: number) {
    page.drawLine({
      start: { x: margin, y: rowTop },
      end: { x: width - margin, y: rowTop },
      color: rgb(0.88, 0.88, 0.9),
      thickness: 0.5,
    })

    page.drawLine({
      start: { x: margin, y: rowBottom },
      end: { x: width - margin, y: rowBottom },
      color: rgb(0.88, 0.88, 0.9),
      thickness: 0.5,
    })

    let offsetX = margin
    columnDefs.forEach((column) => {
      page.drawLine({
        start: { x: offsetX, y: rowTop },
        end: { x: offsetX, y: rowBottom },
        color: rgb(0.88, 0.88, 0.9),
        thickness: 0.5,
      })
      offsetX += column.width
    })

    page.drawLine({
      start: { x: offsetX, y: rowTop },
      end: { x: offsetX, y: rowBottom },
      color: rgb(0.88, 0.88, 0.9),
      thickness: 0.5,
    })
  }

  function buildRowLines(
    tx: ReceiptTransactionRow,
    regular: PDFFont,
    bold: PDFFont,
    maxWidth: number
  ): Array<Array<{ text: string; width: number; bold?: boolean; size?: number }>> {
    const columns = [
      { text: formatDate(tx.transaction_date), width: columnDefs[0].width, bold: true },
      { text: tx.details ?? '', width: columnDefs[1].width },
      { text: tx.vendor_name ?? '', width: columnDefs[2].width },
      { text: tx.expense_category ?? '', width: columnDefs[3].width },
      { text: tx.amount_in ? formatCurrency(tx.amount_in) : '', width: columnDefs[4].width },
      { text: tx.amount_out ? formatCurrency(tx.amount_out) : '', width: columnDefs[5].width },
      { text: friendlyStatus(tx.status), width: columnDefs[6].width },
    ]

    const columnLines = columns.map((column) =>
      wrapText(column.text, column.bold ? bold : regular, 6, column.width)
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

    if (tx.transaction_type) {
      lines.push([
        { text: '', width: columns[0].width },
        { text: `Type: ${tx.transaction_type}`, width: columns[1].width },
        ...columns.slice(2).map((column) => ({ text: '', width: column.width })),
      ])
    }

    const notes = tx.notes?.trim()
    if (notes) {
      const wrapped = wrapText(`Notes: ${notes}`, regular, 6, columns[1].width)
      wrapped.forEach((noteLine, idx) => {
        lines.push([
          { text: '', width: columns[0].width },
          { text: idx === 0 ? noteLine : `   ${noteLine}`, width: columns[1].width },
          ...columns.slice(2).map((column) => ({ text: '', width: column.width })),
        ])
      })
    }

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
    case 'cant_find':
      return "Can't find"
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
