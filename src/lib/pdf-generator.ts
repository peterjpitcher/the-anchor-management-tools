// import type { PDFOptions } from 'puppeteer'
import type { ChildProcess } from 'node:child_process'
import {
  generateCompactInvoiceHTML,
  type InvoiceDocumentKind,
  type InvoiceRemittanceDetails
} from './invoice-template-compact'
import { generateCompactQuoteHTML } from './quote-template-compact'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'

// Helper to load puppeteer deps dynamically
async function loadPuppeteer() {
  const puppeteer = (await import('puppeteer')).default
  const chromium = (await import('@sparticuz/chromium')).default
  return { puppeteer, chromium }
}

type PdfGeneratorBrowser = {
  newPage: () => Promise<any>
  close: () => Promise<void>
  process?: () => ChildProcess | null
}

type PdfGeneratorPage = {
  setViewport: (viewport: { width: number; height: number }) => Promise<void>
  setContent: (
    html: string,
    options: { waitUntil: 'networkidle0'; timeout: number }
  ) => Promise<void>
  addStyleTag: (options: { content: string }) => Promise<void>
  pdf: (options: any) => Promise<Uint8Array>
  close: () => Promise<void>
}

type ExistingBrowserOptions = { browser?: PdfGeneratorBrowser }
type InvoicePdfOptions = ExistingBrowserOptions & {
  documentKind?: InvoiceDocumentKind
  remittance?: InvoiceRemittanceDetails
}

const LOCAL_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
]

let cachedChromiumExecutablePath: string | null = null

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export async function closePdfBrowser(browser: PdfGeneratorBrowser): Promise<void> {
  try {
    await withTimeout(browser.close(), 2000, 'browser.close')
  } catch {
    try {
      browser.process?.()?.kill('SIGKILL')
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function closePdfPage(page: PdfGeneratorPage): Promise<void> {
  try {
    await withTimeout(page.close(), 2000, 'page.close')
  } catch {
    // Ignore cleanup errors
  }
}

export async function createPdfBrowser(): Promise<PdfGeneratorBrowser> {
  const { puppeteer, chromium } = await loadPuppeteer()
  const useSparticuzChromium = Boolean(process.env.VERCEL) && process.platform === 'linux'

  const executablePath = useSparticuzChromium
    ? (cachedChromiumExecutablePath ??= await chromium.executablePath())
    : puppeteer.executablePath()

  return puppeteer.launch({
    headless: true,
    args: useSparticuzChromium ? chromium.args : LOCAL_CHROMIUM_ARGS,
    executablePath,
  })
}

async function renderPdfFromHtml(
  browser: PdfGeneratorBrowser,
  html: string,
  pdfOptions: any
): Promise<Buffer> {
  const page = (await browser.newPage()) as PdfGeneratorPage

  try {
    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    await page.addStyleTag({
      content: `
        @media print {
          body { -webkit-print-color-adjust: exact; }
        }
      `,
    })

    const pdf = await page.pdf(pdfOptions)
    return Buffer.from(pdf)
  } finally {
    await closePdfPage(page)
  }
}

// Generate PDF from invoice
export async function generateInvoicePDF(
  invoice: InvoiceWithDetails,
  options: InvoicePdfOptions = {}
): Promise<Buffer> {
  let browser: PdfGeneratorBrowser | null = options.browser ?? null
  const shouldCloseBrowser = !browser

  try {
    if (!browser) {
      browser = await createPdfBrowser()
    }

    // Generate HTML with absolute URL for logo
    const html = generateCompactInvoiceHTML({
      invoice,
      logoUrl: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
        : undefined,
      documentKind: options.documentKind,
      remittance: options.remittance,
    })

    // Generate PDF with A4 format
    return await renderPdfFromHtml(browser, html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '8mm',
        right: '8mm',
        bottom: '8mm',
        left: '8mm'
      },
      displayHeaderFooter: false
    })
  } catch (error) {
    console.error('Error generating invoice PDF:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser && shouldCloseBrowser) {
      await closePdfBrowser(browser)
    }
  }
}

// Generate PDF from quote
export async function generateQuotePDF(
  quote: QuoteWithDetails,
  options: ExistingBrowserOptions = {}
): Promise<Buffer> {
  let browser: PdfGeneratorBrowser | null = options.browser ?? null
  const shouldCloseBrowser = !browser

  try {
    if (!browser) {
      browser = await createPdfBrowser()
    }

    // Generate HTML with absolute URL for logo
    const html = generateCompactQuoteHTML({
      quote,
      logoUrl: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
        : undefined
    })

    // Generate PDF
    return await renderPdfFromHtml(browser, html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '8mm',
        right: '8mm',
        bottom: '8mm',
        left: '8mm'
      },
      displayHeaderFooter: false
    })
  } catch (error) {
    console.error('Error generating quote PDF:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser && shouldCloseBrowser) {
      await closePdfBrowser(browser)
    }
  }
}

// Helper function to generate PDF with custom HTML
export async function generatePDFFromHTML(
  html: string,
  pdfOptions?: any,
  options: ExistingBrowserOptions = {}
): Promise<Buffer> {
  let browser: PdfGeneratorBrowser | null = options.browser ?? null
  const shouldCloseBrowser = !browser

  try {
    if (!browser) {
      browser = await createPdfBrowser()
    }

    return await renderPdfFromHtml(browser, html, {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      },
      ...pdfOptions
    })
  } catch (error) {
    console.error('Error generating PDF from HTML:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser && shouldCloseBrowser) {
      await closePdfBrowser(browser)
    }
  }
}
