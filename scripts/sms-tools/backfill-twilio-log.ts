import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import Papa from 'papaparse'
import * as dotenv from 'dotenv'
import { formatPhoneForStorage, generatePhoneVariants } from '../../src/lib/utils'

type CsvRow = {
  From: string
  To: string
  Body: string
  Status: string
  SentDate: string
  ApiVersion?: string
  NumSegments?: string
  ErrorCode?: string
  AccountSid?: string
  Sid: string
  Direction: string
  Price?: string
  PriceUnit?: string
  ShortenedLinkEnabled?: string
  ShortenedLinkFirstClicked?: string
}

type CustomerCache = Map<string, string | null>

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

interface Options {
  dryRun?: boolean
}

function parseArgs(): { filePath: string; options: Options } {
  const [, , filePath, ...rest] = process.argv
  if (!filePath) {
    throw new Error('Usage: tsx scripts/sms-tools/backfill-twilio-log.ts <path-to-csv> [--dry-run]')
  }

  const options: Options = {
    dryRun: rest.includes('--dry-run')
  }

  return { filePath, options }
}

function loadCsv(filePath: string): CsvRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at ${filePath}`)
  }

  const fileContent = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse<CsvRow>(fileContent, {
    header: true,
    skipEmptyLines: true
  })

  if (result.errors.length > 0) {
    console.error('CSV parse errors:', result.errors)
    throw new Error('Failed to parse CSV file')
  }

  return result.data.filter(row => row.Sid && row.Sid.trim().length > 0)
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

async function fetchExistingSids(supabase: SupabaseClient, sids: string[]): Promise<Set<string>> {
  const existing = new Set<string>()
  const batches = chunk(Array.from(new Set(sids)), 250)

  for (const batch of batches) {
    const { data, error } = await supabase
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', batch)

    if (error) {
      throw error
    }

    data?.forEach(row => {
      if (row.twilio_message_sid) {
        existing.add(row.twilio_message_sid)
      }
    })
  }

  return existing
}

function parseDate(value?: string): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function deriveDirection(twilioDirection?: string): 'inbound' | 'outbound' {
  if (!twilioDirection) return 'outbound'
  return twilioDirection.startsWith('inbound') ? 'inbound' : 'outbound'
}

async function resolveCustomerId(
  supabase: SupabaseClient,
  cache: CustomerCache,
  phone: string | undefined,
  fallbackName?: string
): Promise<string | null> {
  if (!phone) {
    return null
  }

  let standardized: string
  try {
    standardized = formatPhoneForStorage(phone)
  } catch {
    return null
  }

  const numericLength = standardized.replace(/\D/g, '').length
  if (numericLength < 10) {
    cache.set(standardized, null)
    return null
  }

  if (cache.has(standardized)) {
    return cache.get(standardized) ?? null
  }

  const variants = generatePhoneVariants(standardized)
  let query = supabase.from('customers').select('id').limit(1)
  if (variants.length === 1) {
    query = query.eq('mobile_number', variants[0])
  } else {
    const filter = variants.map(value => `mobile_number.eq.${value}`).join(',')
    query = query.or(filter)
  }

  const { data: existing, error: lookupError } = await query.maybeSingle()

  if (lookupError) {
    console.error('Failed to lookup customer by phone:', lookupError)
  }

  if (existing?.id) {
    cache.set(standardized, existing.id)
    return existing.id
  }

  const nameParts = (fallbackName ?? '').trim().split(' ').filter(Boolean)
  const firstName = nameParts[0] || 'Guest'
  const lastName = nameParts.slice(1).join(' ') || ''

  const { data: inserted, error: insertError } = await supabase
    .from('customers')
    .insert({
      first_name: firstName,
      last_name: lastName,
      mobile_number: standardized,
      sms_opt_in: true
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('Failed to create customer for phone:', standardized, insertError)
    cache.set(standardized, null)
    return null
  }

  cache.set(standardized, inserted?.id ?? null)
  return inserted?.id ?? null
}

function toNumber(value?: string): number | null {
  if (!value || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function main() {
  const { filePath, options } = parseArgs()
  const csvRows = loadCsv(filePath)

  console.log(`Loaded ${csvRows.length} rows from ${filePath}`)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials in environment variables')
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const sids = csvRows.map(row => row.Sid)
  const existingSidSet = await fetchExistingSids(supabase, sids)
  console.log(`Found ${existingSidSet.size} existing messages in the database`)

  const newRows = csvRows.filter(row => !existingSidSet.has(row.Sid))

  if (newRows.length === 0) {
    console.log('Nothing new to import — all SIDs already present')
    return
  }

  console.log(`Preparing to import ${newRows.length} new message(s)${options.dryRun ? ' (dry run)' : ''}`)

  const customerCache: CustomerCache = new Map()
  const records = [] as any[]
  let skippedWithoutCustomer = 0
  const sourceFile = path.basename(filePath)

  for (const row of newRows) {
    const direction = deriveDirection(row.Direction)
    const customerPhone = direction === 'outbound' ? row.To : row.From
    const sentAtIso = parseDate(row.SentDate)
    const price = toNumber(row.Price)
    const status = (row.Status || '').toLowerCase() || null
    const segments = toNumber(row.NumSegments) ?? 1

    const customerId = await resolveCustomerId(supabase, customerCache, customerPhone)

    if (!customerId) {
      skippedWithoutCustomer += 1
      continue
    }

    const isFailure = status ? ['failed', 'undelivered'].includes(status) : false
    const isDelivered = status === 'delivered'

    const record: Record<string, any> = {
      message_sid: row.Sid,
      twilio_message_sid: row.Sid,
      direction,
      body: row.Body,
      status,
      twilio_status: status,
      from_number: row.From,
      to_number: row.To,
      message_type: 'sms',
      segments,
      cost_usd: price != null ? Math.abs(price) : null,
      read_at: sentAtIso
    }

    record.customer_id = customerId

    if (sentAtIso) {
      record.created_at = sentAtIso
      record.sent_at = sentAtIso
    }

    if (isDelivered && sentAtIso) {
      record.delivered_at = sentAtIso
    }

    if (isFailure && sentAtIso) {
      record.failed_at = sentAtIso
    }

    if (row.ErrorCode && row.ErrorCode !== '0') {
      record.error_code = row.ErrorCode
    }

    records.push(record)
  }

  if (records.length === 0) {
    console.log('After processing, no records remain to insert (possible parsing issues).')
    if (skippedWithoutCustomer > 0) {
      console.log(`Skipped ${skippedWithoutCustomer} message(s) with unresolvable customer IDs.`)
    }
    return
  }

  if (options.dryRun) {
    console.log('Dry run complete. Sample record:', records[0])
    console.log(`Would insert ${records.length} records.`)
    if (skippedWithoutCustomer > 0) {
      console.log(`Skipped ${skippedWithoutCustomer} message(s) with unresolvable customer IDs.`)
    }
    return
  }

  const batches = chunk(records, 100)
  let inserted = 0

  for (const batch of batches) {
    const { data, error } = await supabase
      .from('messages')
      .insert(batch)
      .select('id')

    if (error) {
      console.error('Failed to insert batch:', error)
      throw error
    }

    inserted += data?.length ?? 0
    console.log(`Inserted batch of ${data?.length ?? 0}; total inserted so far: ${inserted}`)
  }

  console.log(`Backfill complete. Inserted ${inserted} new message(s).`)
  if (skippedWithoutCustomer > 0) {
    console.log(`Skipped ${skippedWithoutCustomer} message(s) with unresolvable customer IDs.`)
  }
}

main().catch(error => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
