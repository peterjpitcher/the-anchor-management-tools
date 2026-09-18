/** Real Chromium interaction with production components and isolated action fixtures.
 * No database or provider access. Complements the real PostgreSQL transaction suite.
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'output/private-booking-extras-browser')
await mkdir(output, { recursive: true })
const fixture = `
import {calculateExtraChargeTotals} from '@/lib/private-bookings/extra-charges';
const original={id:'original',invoice_number:'FIXTURE-001',kind:'original',status:'paid',invoice_date:'2026-09-18',due_date:'2026-09-18',total_amount:120,paid_amount:120,credit_amount:0,balance:0,sent_at:'2026-09-18T12:00:00Z',paypalEnabled:true,paymentUrl:null,deliveryState:'sent'};
const batches=[]; const invoices=[original];
export async function getPrivateBookingBilling(){return {data:{batches:[...batches],invoices:[...invoices],supplementaryTotal:invoices.slice(1).reduce((s,i)=>s+i.total_amount,0),creditsTotal:0,collectibleBalance:invoices.reduce((s,i)=>s+i.balance,0)}}}
export async function getLineItemCatalog(){return {items:[]}}
export async function savePrivateBookingExtras(input){if(!input.dueDate)return {error:'Select a payment due date.'}; if(input.lines.some(l=>!l.description))return {error:'Enter a description.'};const batch={id:input.batchId,booking_id:input.bookingId,lines:input.lines,due_date:input.dueDate,reference:input.reference,status:'draft',revision:(input.expectedRevision||0)+1,created_at:'2026-09-18T12:00:00Z'};const idx=batches.findIndex(b=>b.id===batch.id);if(idx>=0)batches[idx]=batch;else batches.push(batch);return {batch}}
export async function previewPrivateBookingExtras(id,batchId){const batch=batches.find(b=>b.id===batchId);return {preview:{batch,totals:calculateExtraChargeTotals(batch.lines),recipientEmail:'fixture@example.test',paypalEnabled:true,sourceHash:'fixture'}}}
export async function issuePrivateBookingExtras(input){const batch=batches.find(b=>b.id===input.batchId);if(batch.status==='draft'){batch.status='issued';batch.invoice_id='supplement';const total=calculateExtraChargeTotals(batch.lines).totalAmount;invoices.push({...original,id:'supplement',invoice_number:'FIXTURE-002',kind:'supplementary',status:'sent',due_date:batch.due_date,total_amount:total,paid_amount:0,balance:total,paymentUrl:'/fixture-pay'})}return {invoiceId:'supplement',invoiceNumber:'FIXTURE-002',sent:true}}
export async function recordPrivateBookingInvoicePayment(input){for(const a of input.allocations){const i=invoices.find(i=>i.id===a.invoiceId);i.paid_amount+=a.amount;i.balance-=a.amount;i.status=i.balance===0?'paid':'partially_paid'}return {success:true}}
export async function resendPrivateBookingExtraInvoice(){return {sent:true}}
export async function cancelPrivateBookingExtraInvoice(){return {success:true}}
export async function deletePrivateBookingExtras(){return {success:true}}
export async function previewPrivateBookingReceipt(){const total=invoices.reduce((s,i)=>s+i.total_amount,0);const paid=invoices.reduce((s,i)=>s+i.paid_amount,0);return {success:true,data:{documents:[],model:{kind:paid===total?'final_receipt':'payment_statement',blockers:paid===total?[]:['An invoice balance is still due.'],totals:{charges:total,credits:0,receipts:paid,refunds:0,applied:paid,creditBalance:0,balanceDue:total-paid,depositHeld:0},invoices:invoices.map(i=>({id:i.id,number:i.invoice_number,date:i.invoice_date,lines:[{description:i.kind==='original'?'Original booking':'Additional fixture charge',quantity:1,gross:i.total_amount}]})),payments:invoices.filter(i=>i.paid_amount).map(i=>({id:i.id,date:'2026-09-18',amount:i.paid_amount,method:'bank_transfer',purpose:i.invoice_number,reference:null,recordedDate:false})),refunds:[]}}}}
export async function generatePrivateBookingReceipt(){return {error:'Fixture mode does not persist documents.'}}
export async function sendPrivateBookingReceipt(){throw Error('Fixture mode cannot send')}
`
await writeFile(path.join(output, 'actions.js'), fixture)
await writeFile(path.join(output, 'entry.jsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {PrivateBookingBilling} from '@/components/private-bookings/PrivateBookingBilling';import {PrivateBookingReceiptPanel} from '@/components/private-bookings/PrivateBookingReceiptPanel';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:24}}><PrivateBookingBilling bookingId="fixture" canIssue canRecordPayments canAddExtras onChanged={()=>{}}/><PrivateBookingReceiptPanel bookingId="fixture" canGenerate/></main>);`)
const primitives = ['Alert', 'Button', 'Input', 'Modal', 'Select']
await writeFile(path.join(output, 'ds.js'), primitives.map(name => `export {${name}} from '${path.join(root, 'src/ds/primitives', name)}';`).join('\n') + `\nexport {Card} from '${path.join(root, 'src/ds/composites/Card')}';`)
await build({
  entryPoints: [path.join(output, 'entry.jsx')], outfile: path.join(output, 'app.js'), bundle: true,
  platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'isolated-boundary', setup(builder) {
    builder.onResolve({ filter: /^@\/app\/actions\// }, () => ({ path: path.join(output, 'actions.js') }))
    builder.onResolve({ filter: /^@\/ds$/ }, () => ({ path: path.join(output, 'ds.js') }))
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}", loader: 'jsx', resolveDir: root }))
  } }],
})
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') })
await writeFile(path.join(output, 'app.css'), css.css)
const server = createServer(async (req, res) => {
  if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(path.join(output, req.url.slice(1)))) }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.setRequestInterception(true)
page.on('request', request => request.url().startsWith(url) ? request.continue() : request.abort())
async function click(text) { await page.locator(`::-p-text(${text})`).click() }
async function fill(label, value) {
  await page.waitForFunction(text => [...document.querySelectorAll('label')].some(label => label.textContent === text), {}, label)
  const id = await page.evaluate(text => { const element = [...document.querySelectorAll('label')].find(label => label.textContent === text); return element?.htmlFor }, label)
  if (!id) throw Error(`Missing input label ${label}`)
  const inputType = await page.$eval(`[id="${id}"]`, input => input.type)
  if (inputType === 'date') {
    await page.$eval(`[id="${id}"]`, (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', {bubbles:true}))
      input.dispatchEvent(new Event('change', {bubbles:true}))
    }, value)
  } else await page.locator(`[id="${id}"]`).fill(value)
}
try {
  await page.setViewport({ width: 1280, height: 1000 })
  await page.goto(url)
  await click('Add extra charges')
  await fill('Description 1', 'Additional fixture charge')
  await fill('Quantity 1', '2')
  await fill('Unit price excluding VAT 1', '25')
  await fill('Payment due date', '2026-10-01')
  await click('Preview invoice')
  await page.waitForFunction(() => document.body.innerText.includes('Send to fixture@example.test'))
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'))
  await page.screenshot({ path: path.join(output, 'invoice-preview-desktop.png'), fullPage: true })
  await click('Issue and send additional invoice')
  await page.waitForFunction(() => document.body.innerText.includes('Invoice FIXTURE-002 sent.'))
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  await click('Record invoice payment')
  await fill('Total payment received', '60')
  await fill('FIXTURE-002: £60.00 outstanding', '60')
  await click('Record payment')
  await page.waitForFunction(() => document.body.innerText.includes('Payment recorded against the selected invoices.'))
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'))
  await click('Preview final receipt')
  await page.waitForFunction(() => document.body.innerText.includes('Final booking receipt'))
  const receipt = await page.$eval('[role=dialog]', element => element.innerText)
  for (const text of ['FIXTURE-001', 'FIXTURE-002', '£180.00', '£60.00', 'Additional fixture charge']) if (!receipt.includes(text)) throw Error(`Receipt missing ${text}`)
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'))
  await page.screenshot({ path: path.join(output, 'receipt-desktop.png'), fullPage: true })
  await page.setViewport({ width: 390, height: 844 })
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'))
  await page.screenshot({ path: path.join(output, 'receipt-mobile.png'), fullPage: true })
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Page overflows mobile viewport')
  if (errors.length) throw Error(errors.join('\n'))
  console.log('PASS Chromium: preview, issue, allocate payment, consolidated receipt; desktop/mobile; no external requests or browser errors.')
} catch (error) {
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
  console.error(await page.evaluate(()=>document.body.innerText));
  console.error(errors);
  throw error;
} finally { await browser.close(); server.close() }
