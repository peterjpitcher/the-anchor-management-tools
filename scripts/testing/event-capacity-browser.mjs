/** Chromium coverage of the actual event drawer with isolated server actions.
 * No database, provider or external network access. Does not replace route smoke checks.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(root, 'output/event-capacity-browser')
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'actions.js'), `
const capture=(id,data)=>{window.submission={id,values:Object.fromEntries(data.entries())};return {error:'Fixture saved locally; no database access.'}};
export async function createEvent(data){return capture(null,data)}
export async function updateEvent(id,data){return capture(id,data)}
export async function getEventChecklist(){return {success:true,items:[]}}
export async function toggleEventChecklistTask(){throw Error('Not available in fixture')}
export async function generateEventSeoContent(){throw Error('Not available in fixture')}
`)
await writeFile(path.join(output, 'entry.jsx'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {EventDrawer} from '@/app/(authenticated)/events/_components/EventDrawer';
const legacy=new URLSearchParams(location.search).has('legacy');
const event=legacy?{id:'fixture',name:'Fixture communal event',date:'2099-09-25',time:'19:00',booking_mode:'communal',capacity:60,seated_capacity:40,standing_capacity:null,resolved_standing_capacity:20,seated_remaining:12,is_free:true,payment_mode:'free',event_status:'draft'}:null;
createRoot(document.getElementById('root')).render(<EventDrawer open event={event} categories={[]} onClose={()=>{}} onSave={()=>{}}/>);
`)
const primitives = ['Drawer', 'Button', 'Input', 'Select', 'Textarea', 'DateTimePicker', 'Checkbox', 'Spinner', 'Switch']
await writeFile(path.join(output, 'ds.js'), primitives.map(name => `export {${name}} from '${path.join(root, 'src/ds/primitives', name)}';`).join('\n') + '\nexport {default as toast} from "react-hot-toast";')
await build({
  entryPoints: [path.join(output, 'entry.jsx')], outfile: path.join(output, 'app.js'), bundle: true,
  platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'isolated-boundaries', setup(builder) {
    builder.onResolve({ filter: /^@\/app\/actions\// }, () => ({ path: path.join(output, 'actions.js') }))
    builder.onResolve({ filter: /^@\/ds$/ }, () => ({ path: path.join(output, 'ds.js') }))
    builder.onResolve({ filter: /\/EventImagePanel$/ }, () => ({ path: 'images', namespace: 'fixture' }))
    builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      contents: args.path === 'next/link'
        ? "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}"
        : args.path === 'next/navigation'
          ? 'export function useRouter(){return {refresh(){},push(){}}}'
          : 'export function EventImagePanel(){return null}',
      loader: 'jsx', resolveDir: root,
    }))
  } }],
})
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') })
await writeFile(path.join(output, 'app.css'), css.css)
const server = createServer(async (req, res) => {
  if (req.url === '/app.js' || req.url === '/app.css') {
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(await readFile(path.join(output, req.url.slice(1))))
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.setRequestInterception(true)
page.on('request', request => request.url().startsWith(url) ? request.continue() : request.abort())
async function field(label) {
  await page.waitForFunction(text => [...document.querySelectorAll('label')].some(element => element.textContent === text), {}, label)
  return page.evaluate(text => [...document.querySelectorAll('label')].find(element => element.textContent === text).htmlFor, label)
}
async function hasLabel(label) { return page.evaluate(text => [...document.querySelectorAll('label')].some(element => element.textContent === text), label) }
async function selectMode(value) { await page.select(`[id="${await field('Booking Mode')}"]`, value) }
try {
  await page.setViewport({ width: 1280, height: 1000 })
  await page.goto(url)
  await field('Booking Mode')
  assert.equal(await hasLabel('Capacity'), false)
  assert.equal(await hasLabel('Ticket limit'), false)
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('option')].some(option => option.value === 'mixed')), false)
  await selectMode('communal')
  assert.equal(await hasLabel('Seated capacity'), false)
  const standing = await field('Standing ticket limit')
  assert.equal(await page.$eval(`[id="${standing}"]`, input => input.value), '0')
  await page.$eval(`[id="${standing}"]`, input => input.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(output, 'new-communal-desktop.png'), fullPage: true })
  await selectMode('general')
  await field('Ticket limit')
  assert.equal(await hasLabel('Standing ticket limit'), false)
  await page.goto(`${url}/?legacy`)
  const legacyStanding = await field('Standing ticket limit')
  assert.equal(await page.$eval(`[id="${legacyStanding}"]`, input => input.value), '20')
  await page.waitForFunction(() => document.body.innerText.includes('Existing seating limit: 40'))
  await page.locator('::-p-text(Save Changes)').click()
  await page.waitForFunction(() => window.submission)
  const submission = await page.evaluate(() => window.submission)
  assert.equal(submission.id, 'fixture')
  assert.equal(submission.values.booking_mode, 'communal')
  for (const key of ['capacity', 'seated_capacity', 'standing_capacity']) assert.equal(key in submission.values, false)
  await page.$eval(`[id="${legacyStanding}"]`, input => input.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(output, 'legacy-communal-desktop.png'), fullPage: true })
  await page.setViewport({ width: 390, height: 844 })
  await page.$eval(`[id="${legacyStanding}"]`, input => input.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(output, 'legacy-communal-mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log('PASS Chromium: actual EventDrawer, physical seating controls, general ticket limit, no new mixed option, legacy capacity values preserved on save, desktop/mobile. No external requests or database writes.')
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
  console.error(errors)
  throw error
} finally {
  await browser.close()
  server.close()
}
