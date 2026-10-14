import { beforeAll, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { publicSchemaColumns } from '../helpers/generatedSchema'
import { scanQueryColumns, type Reference, type Scan, type Unread, type UnreadReason } from '../helpers/queryColumns'

/**
 * Every column a query names must exist on the table or view it names it against.
 *
 * On 13 October 2026 the Quotes list was found dead in production: three reads in
 * src/app/actions/quotes.ts filtered on `quotes.deleted_at`, a column the table has never had,
 * and PostgREST answers that with a 400 ("column quotes.deleted_at does not exist"). The filter
 * had been there since 3 March. The same fault was fixed on the dashboard on 30 June without
 * anyone looking for its siblings, and nothing noticed either time because production held no
 * quotes, the Supabase clients are not typed against the schema, and a mocked client answers
 * any column.
 *
 * So this guard reads every query chain in src that starts at `.from('<table>')` and checks
 * each filter, each select item (embedded ones too), each update, insert and upsert key and
 * each onConflict column against src/types/database.generated.ts. tests/helpers/queryColumns.ts
 * does the reading and says what it follows.
 *
 * WHEN THIS FAILS on a column the live database really has, the generated types are stale.
 * Regenerate them and commit them in the same change as the migration:
 *
 *   npx supabase gen types typescript --project-id tfcasgxopxegwrabvwat --schema public > src/types/database.generated.ts
 *
 * Otherwise the query is a 400 the first time it runs: fix the query. Do not add to KNOWN_FAULTS.
 */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * Real faults: the live database has none of these columns (checked 13 October 2026). They were
 * found by this guard or by the sweep that led to it and are not fixed yet, so they are listed
 * rather than hidden. This list may only shrink. When one is fixed the guard fails until its
 * line is deleted; a new fault is fixed, never added.
 */
const KNOWN_FAULTS: Array<{ file: string; table: string; column: string; effect: string }> = [
  {
    file: 'src/app/api/webhooks/twilio/route.ts',
    table: 'webhook_logs',
    column: 'unmatched_communication_id',
    effect: 'logWebhookAttempt spreads extra keys into the row, so the log row for an inbound text matched to no customer is refused and lost.',
  },
  {
    file: 'src/app/api/webhooks/twilio/route.ts',
    table: 'webhook_logs',
    column: 'candidate_customer_ids',
    effect: 'The same lost log row, for the same inbound text.',
  },
  {
    file: 'src/app/api/webhooks/twilio/route.ts',
    table: 'webhook_logs',
    column: 'channel',
    effect: 'The same lost log row, for every inbound text that is handled: none of the 86 saved since 22 June 2026 has one.',
  },
  {
    file: 'src/app/api/webhooks/twilio/route.ts',
    table: 'webhook_logs',
    column: 'messageSid',
    effect: 'The same lost log row, for a status update that changes nothing.',
  },
]
const MOST_KNOWN_FAULTS = 4

/**
 * Query parts the reader cannot tie to a table and a column, each read by hand on 13 October
 * 2026. Anything else it cannot read fails the guard: write the table and the columns where the
 * chain can see them, or add the part here with what was checked.
 */
const READ_BY_HAND: Array<{ file: string; why: UnreadReason; checked: string }> = [
  {
    file: 'src/app/api/boh/table-bookings/[id]/status/route.ts',
    why: 'select list is built at run time',
    checked: 'The list comes from buildStaffStatusTransitionPlan in src/lib/table-bookings/staff-status-actions.ts. Its six lists name ten table_bookings columns and all ten exist.',
  },
  {
    file: 'src/lib/paypal-refund-webhook.ts',
    why: 'filter column is built at run time',
    checked: 'Table and column are looked up by source type in two records. private_bookings and table_bookings have paypal_deposit_capture_id; parking_booking_payments has transaction_id.',
  },
  {
    file: 'src/services/events.ts',
    why: 'filter column is built at run time',
    checked: 'The sort column of the events list is whatever the caller asks for. The default, date, exists on events.',
  },
  {
    file: 'src/services/receipts/receiptQueries.ts',
    why: 'filter column is built at run time',
    checked: 'The sort column is a ReceiptSortColumn: transaction_date, details, amount_in, amount_out or amount_total. receipt_transactions has all five.',
  },
]

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && entry !== 'database.generated.ts') {
      found.push(full)
    }
  }
  return found
}

describe('query columns', () => {
  const schema = publicSchemaColumns()
  const scan = (text: string, file = 'src/example.ts'): Scan => scanQueryColumns(file, text, schema)
  const missing = ({ table, column }: Reference): boolean => schema.has(table) && !schema.get(table)?.has(column)
  const offences = (references: Reference[]): string[] =>
    references.filter(missing).map(({ file, line, table, column, how }) => `${file}:${line} ${how} names ${table}.${column}`)
  /** The columns a snippet names that their table lacks, as `table.column`, each once. */
  const faults = (text: string): string[] => [...new Set(scan(text).references.filter(missing).map(({ table, column }) => `${table}.${column}`))]
  const named = (text: string): string[] => [...new Set(scan(text).references.map(({ table, column }) => `${table}.${column}`))]

  describe('what the reader catches', () => {
    it('catches each shape of the quotes fault of 13 October 2026', () => {
      const quotesAsItWas = `
        async function getQuotes(supabase) {
          let query = supabase.from('quotes').select('*, vendor:invoice_vendors(*)').is('deleted_at', null)
          query = query.order('quote_date', { ascending: false })
          return query
        }
        async function deleteQuote(supabase, quoteId, userId) {
          await supabase.from('quotes').select('id, status, deleted_at').eq('id', quoteId).single()
          await supabase
            .from('quotes')
            .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
            .eq('id', quoteId)
        }
      `
      expect(offences(scan(quotesAsItWas, 'src/app/actions/quotes.ts').references)).toEqual([
        'src/app/actions/quotes.ts:3 .is() names quotes.deleted_at',
        'src/app/actions/quotes.ts:8 .select() names quotes.deleted_at',
        'src/app/actions/quotes.ts:11 .update() names quotes.deleted_at',
        'src/app/actions/quotes.ts:11 .update() names quotes.deleted_by',
      ])
    })

    it('follows a query kept in a variable and a select list kept in a constant', () => {
      const found = scan(`
        const COLUMNS = 'id, invoice:invoices!private_bookings_invoice_id_fkey(id, deleted_at)'
        async function load(supabase, onlyLive) {
          let query = supabase.from('quotes').select('id')
          if (onlyLive) query = query.is('deleted_at', null)
          await supabase.from('private_bookings').select(COLUMNS)
          return query
        }
      `)
      expect(found.unread).toEqual([])
      expect(found.references.map(({ table, column, how }) => `${how} ${table}.${column}`)).toEqual([
        '.select() quotes.id',
        '.is() quotes.deleted_at',
        '.select() private_bookings.id',
        '.select() invoices.id',
        '.select() invoices.deleted_at',
      ])
      expect(offences(found.references)).toEqual(['src/example.ts:5 .is() names quotes.deleted_at'])
    })

    it('allows the soft delete on invoices, the one table that has it', () => {
      expect(faults(`
        async function removeInvoice(supabase, id, userId) {
          await supabase.from('invoices').select('id, status, deleted_at').eq('id', id).is('deleted_at', null).single()
          await supabase.from('invoices').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id)
        }
      `)).toEqual([])
    })

    it('reads an embedded resource by table, alias, foreign key column and constraint name', () => {
      const text = `
        async function load(supabase) {
          await supabase
            .from('bookings')
            .select('id, seats, customer:customer_id(first_name, nickname), event:events!bookings_event_id_fkey(name), who:bookings_customer_id_fkey(mobile_e164)')
            .eq('event.date', '2026-10-13')
            .eq('customers.sms_opt_in', true)
          await supabase
            .from('invoices')
            .select('id, lines:invoice_line_items(description)')
            .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
            .order('sort_position', { referencedTable: 'lines' })
            .is('lines', null)
        }
      `
      expect(scan(text).unread).toEqual([])
      expect(named(text)).toEqual(expect.arrayContaining([
        'customers.first_name', 'events.name', 'customers.mobile_e164', 'events.date', 'customers.sms_opt_in',
        'invoice_line_items.description', 'invoice_line_items.display_order',
      ]))
      // `.is('lines', null)` asks for invoices with no lines: `lines` is the embedded resource, not a column.
      expect(faults(text)).toEqual(['customers.nickname', 'invoice_line_items.sort_position'])
    })

    it('does not mistake a count, an aggregate, a cast or a JSON path for a column', () => {
      const text = `
        async function load(supabase) {
          await supabase.from('customers').select('count', { count: 'exact', head: true })
          await supabase.from('invoices').select('*, status, count(), total:total_amount.sum(), paid:paid_amount::text, ref:reference')
          await supabase.from('webhook_logs').select('id, sid:params->>MessageSid, headers->host').eq('params->>From', '+44').order('error_details->code')
        }
      `
      expect(scan(text).unread).toEqual([])
      expect(faults(text)).toEqual([])
      expect(named(text).sort()).toEqual([
        'invoices.paid_amount', 'invoices.reference', 'invoices.status', 'invoices.total_amount',
        'webhook_logs.error_details', 'webhook_logs.headers', 'webhook_logs.id', 'webhook_logs.params',
      ])
    })

    it('reads the columns of an .or() filter, however it is put together', () => {
      expect(faults(`
        async function search(supabase, term, ids) {
          await supabase.from('customers').select('id')
            .or(\`first_name.ilike.%\${term}%,and(last_name.ilike.%\${term}%,nickname.is.null),not.or(email.eq.a,mobile_number.in.(1,2))\`)
          const clauses = ids.map((id) => \`shoe_size.eq.\${id}\`)
          await supabase.from('customers').select('id').or(['hat_size.is.null', ...clauses].join(','))
        }
      `)).toEqual(['customers.nickname', 'customers.hat_size', 'customers.shoe_size'])
    })

    it('reads the keys of a write, and the columns of an upsert conflict target', () => {
      expect(faults(`
        async function save(supabase, rows, extra, vip) {
          const payload = { first_name: 'A', shoe_size: 9 }
          await supabase.from('customers').insert(payload)
          await supabase.from('customers').insert([{ last_name: 'B' }, { hat_size: 1 }])
          await supabase.from('customers').upsert(rows.map((row) => ({ email: row.email, ...extra, glove_size: 2 })), { onConflict: 'email, collar_size' })
          await supabase.from('customers').update({ 'mobile_number': '1', ...(vip ? { ring_size: 1 } : {}) }).eq('id', 1)
        }
      `)).toEqual(['customers.shoe_size', 'customers.hat_size', 'customers.glove_size', 'customers.collar_size', 'customers.ring_size'])
    })

    it('reads a query that can be on one of several tables against each, and no further', () => {
      // bookings has seats and table_bookings has party_size, not the other way round.
      expect(faults(`
        async function clear(supabase, table: 'bookings' | 'table_bookings') {
          for (const name of ['customers', 'quotes'] as const) {
            await supabase.from(name).select('id').eq('first_name', 'A')
          }
          let query = supabase.from(table).update({ status: 'cancelled' })
          if (table === 'bookings') query = query.eq('seats', 2)
          return query.eq('party_size', 2)
        }
      `)).toEqual(['quotes.first_name', 'bookings.party_size'])
    })

    it('pairs the table a helper is handed with the columns of the same call', () => {
      // On 13 October 2026 this found the Twilio webhook writing keys webhook_logs does not have.
      expect(faults(`
        async function scrub(supabase, table: string, values: Record<string, unknown>, extra?: Record<string, unknown>) {
          await supabase.from(table).update({ ...values, ...extra }).in('id', [])
        }
        async function erase(supabase) {
          await scrub(supabase, 'customers', { first_name: null, body: null })
          await scrub(supabase, 'webhook_logs', { body: null }, { messageSid: 'SM1' })
        }
      `)).toEqual(['customers.body', 'webhook_logs.messageSid'])
    })

    it('leaves alone the things that only look like queries', () => {
      expect(scan(`
        const schema = z.string().optional().or(z.literal(''))
        const live = rows.filter((row) => row.deleted_at === null)
        const hidden = element.classList.contains('deleted_at')
        async function run(supabase, calendar, path, file) {
          await supabase.storage.from('receipts').upload(path, file)
          await supabase.rpc('do_thing', { deleted_at: null })
          await calendar.events.insert({ calendarId: 'a', requestBody: {} })
        }
      `)).toEqual({ references: [], unread: [] })
    })

    it('says so when it cannot read a query, rather than passing it', () => {
      const found = scan(`
        export async function list(supabase, table: string, columns: string) {
          return supabase.from('customers').select(columns), supabase.from(table).select('id')
        }
        export function paidOnly(query) {
          return query.eq('status', 'paid')
        }
      `)
      expect(found.references).toEqual([])
      expect(found.unread.map(({ line, why }) => `${line} ${why}`)).toEqual([
        '3 select list is built at run time',
        '3 table is not written in the chain',
        '6 query is not traced to a .from()',
      ])
    })
  })

  describe('the queries in src', () => {
    const references: Reference[] = []
    const unread: Unread[] = []

    beforeAll(() => {
      for (const file of sourceFiles(SRC)) {
        const found = scanQueryColumns(relative(ROOT, file), readFileSync(file, 'utf8'), schema)
        references.push(...found.references)
        unread.push(...found.unread)
      }
    }, 120_000)

    it('are read: a reader that finds nothing passes for the wrong reason', () => {
      // 19,836 references to 2,967 columns of 266 tables on 13 October 2026.
      expect(references.length).toBeGreaterThan(15_000)
      expect(new Set(references.map(({ table }) => table)).size).toBeGreaterThan(200)
    })

    it('name only tables and views the generated types list', () => {
      const unknown = [...new Set(references.filter(({ table }) => !schema.has(table)).map(({ file, table }) => `${file} names ${table}`))]

      expect(
        unknown,
        'No such table or view in src/types/database.generated.ts. If the live database has it, regenerate the types (see the top of this file).',
      ).toEqual([])
    })

    it('name only columns the table has', () => {
      const known = new Set(KNOWN_FAULTS.map(({ file, table, column }) => `${file} ${table}.${column}`))
      const fresh = references.filter(missing).filter(({ file, table, column }) => !known.has(`${file} ${table}.${column}`))

      expect(
        offences(fresh),
        'These columns are not in src/types/database.generated.ts. If the live database has them, the types are stale: regenerate them (see the top of this file) and commit them with the migration. If it does not, the query is a 400 at run time: fix it.',
      ).toEqual([])
    })

    it('keep the list of known faults one that only shrinks', () => {
      const live = new Set(references.filter(missing).map(({ file, table, column }) => `${file} ${table}.${column}`))
      const fixed = KNOWN_FAULTS.filter(({ file, table, column }) => !live.has(`${file} ${table}.${column}`))

      expect(fixed.map(({ file, table, column }) => `${file} ${table}.${column}`), 'Fixed: delete these from KNOWN_FAULTS and lower MOST_KNOWN_FAULTS.').toEqual([])
      expect(KNOWN_FAULTS.length, 'KNOWN_FAULTS may only shrink. Fix the new fault instead of listing it.').toBeLessThanOrEqual(MOST_KNOWN_FAULTS)
      for (const fault of KNOWN_FAULTS) expect(fault.effect.length, `${fault.table}.${fault.column} needs its effect`).toBeGreaterThan(20)
    })

    it('are all read, or read by hand with what was checked', () => {
      const byHand = new Set(READ_BY_HAND.map(({ file, why }) => `${file} ${why}`))
      const unexplained = unread.filter(({ file, why }) => !byHand.has(`${file} ${why}`))

      expect(
        unexplained.map(({ file, line, why, what }) => `${file}:${line} ${what}: ${why}`),
        'Nothing checks the columns of these query parts. Write the table and the columns where the chain can see them, or check them by hand and add the part to READ_BY_HAND.',
      ).toEqual([])
    })

    it('keep the read by hand list honest', () => {
      const found = new Set(unread.map(({ file, why }) => `${file} ${why}`))
      for (const entry of READ_BY_HAND) {
        expect(found.has(`${entry.file} ${entry.why}`), `${entry.file} is read in full now, so drop it from READ_BY_HAND`).toBe(true)
        expect(entry.checked.length, `${entry.file} needs what was checked`).toBeGreaterThan(40)
      }
    })
  })
})
