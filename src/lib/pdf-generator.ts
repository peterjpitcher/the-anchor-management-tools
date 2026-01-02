// import type { PDFOptions } from 'puppeteer'
import { generateCompactInvoiceHTML } from './invoice-template-compact'
import { generateCompactQuoteHTML } from './quote-template-compact'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'

// Helper to load puppeteer deps dynamically
async function loadPuppeteer() {
  const puppeteer = (await import('puppeteer')).default
  const chromium = (await import('@sparticuz/chromium')).default
  return { puppeteer, chromium }
}

// Generate PDF from invoice
export async function generateInvoicePDF(invoice: InvoiceWithDetails): Promise<Buffer> {
  let browser = null

  try {
    const { puppeteer, chromium } = await loadPuppeteer()

    // Launch puppeteer with optimized settings for serverless environments
    browser = await puppeteer.launch({
      headless: true,
      args: process.env.VERCEL
        ? chromium.args
        : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
      executablePath: process.env.VERCEL
        ? await chromium.executablePath()
        : puppeteer.executablePath()
    })

    const page = await browser.newPage()

    // Generate HTML with absolute URL for logo
    const html = generateCompactInvoiceHTML({
      invoice,
      logoUrl: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
        : undefined
    })

    // Set content with proper viewport
    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000 // 30 second timeout
    })

    // Add custom styles for PDF rendering
    await page.addStyleTag({
      content: `
        @media print {
          body { -webkit-print-color-adjust: exact; }
        }
      `
    })

    // Generate PDF with A4 format
    const pdf = await page.pdf({
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

    return Buffer.from(pdf)
  } catch (error) {
    console.error('Error generating invoice PDF:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

// Generate PDF from quote
export async function generateQuotePDF(quote: QuoteWithDetails): Promise<Buffer> {
  let browser = null

  try {
    const { puppeteer, chromium } = await loadPuppeteer()

    // Launch puppeteer with optimized settings
    browser = await puppeteer.launch({
      headless: true,
      args: process.env.VERCEL
        ? chromium.args
        : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
      executablePath: process.env.VERCEL
        ? await chromium.executablePath()
        : puppeteer.executablePath()
    })

    const page = await browser.newPage()

    // Generate HTML with absolute URL for logo
    const html = generateCompactQuoteHTML({
      quote,
      logoUrl: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
        : undefined
    })

    // Set content with proper viewport
    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    })

    // Add custom styles for PDF rendering
    await page.addStyleTag({
      content: `
        @media print {
          body { -webkit-print-color-adjust: exact; }
        }
      `
    })

    // Generate PDF
    const pdf = await page.pdf({
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

    return Buffer.from(pdf)
  } catch (error) {
    console.error('Error generating quote PDF:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

// Helper function to generate PDF with custom HTML
export async function generatePDFFromHTML(
  html: string,
  pdfOptions?: any
): Promise<Buffer> {
  let browser = null

  try {
    const { puppeteer, chromium } = await loadPuppeteer()

    browser = await puppeteer.launch({
      headless: true,
      args: process.env.VERCEL
        ? chromium.args
        : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
      executablePath: process.env.VERCEL
        ? await chromium.executablePath()
        : puppeteer.executablePath()
    })

    const page = await browser.newPage()

    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    })

    const pdf = await page.pdf({
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

    return Buffer.from(pdf)
  } catch (error) {
    console.error('Error generating PDF from HTML:', error)
    throw new Error('Failed to generate PDF')
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}
