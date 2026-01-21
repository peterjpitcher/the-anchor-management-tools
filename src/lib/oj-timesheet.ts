import { generatePDFFromHTML } from '@/lib/pdf-generator'

function escapeHtml(value: string) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function generateOjTimesheetPDF(input: {
  invoiceNumber: string
  vendorName?: string | null
  periodStart: string
  periodEnd: string
  notesText: string
}): Promise<Buffer> {
  const title = `OJ Projects Timesheet`
  const vendorLabel = input.vendorName ? `Client: ${input.vendorName}` : ''
  const meta = `Invoice: ${input.invoiceNumber} • Billing month: ${input.periodStart} to ${input.periodEnd}`
  const generatedAt = `Generated: ${new Date().toISOString()}`

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        color: #111827;
        font-size: 11px;
        line-height: 1.4;
      }
      h1 {
        font-size: 16px;
        margin: 0 0 6px 0;
      }
      .meta {
        color: #374151;
        margin: 0 0 10px 0;
      }
      .meta div { margin: 2px 0; }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 10px;
        line-height: 1.35;
        margin: 0;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #f9fafb;
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div>${escapeHtml(meta)}</div>
      ${vendorLabel ? `<div>${escapeHtml(vendorLabel)}</div>` : ''}
      <div>${escapeHtml(generatedAt)}</div>
    </div>
    <pre>${escapeHtml(input.notesText)}</pre>
  </body>
</html>`

  return generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: '10mm',
      right: '10mm',
      bottom: '10mm',
      left: '10mm',
    },
  })
}

