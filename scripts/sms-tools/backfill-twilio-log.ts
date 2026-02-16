import * as fs from 'fs'
import * as path from 'path'
import Papa from 'papaparse'
import * as dotenv from 'dotenv'
import { formatPhoneForStorage, generatePhoneVariants } from '../../src/lib/utils'
import {
  assertTwilioLogBackfillBatchInsertComplete,
  assertTwilioLogBackfillCompletedWithoutUnresolvedRows,
  assertTwilioLogBackfillLookupSafe,
  isTwilioLogBackfillDuplicateKeyError
} from '../../src/lib/twilio-log-backfill-safety'
import {
  assertTwilioLogBackfillCustomerCreationAllowed,
  assertTwilioLogBackfillMutationAllowed,
  buildTwilioLogBackfillPlaceholderCustomerInsert,
  isTwilioLogBackfillCustomerCreationEnabled,
  isTwilioLogBackfillMutationEnabled,
  parseTwilioLogBackfillArgs,
  requireScriptLimit
} from '../../src/lib/twilio-log-backfill-script-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

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
type ScriptSupabaseClient = ReturnType<typeof createAdminClient>

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

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

async function fetchExistingSids(supabase: ScriptSupabaseClient, sids: string[]): Promise<Set<string>> {
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
  supabase: ScriptSupabaseClient,
  cache: CustomerCache,
  phone: string | undefined,
  options: {
    fallbackName?: string
    allowCreateIfMissing: boolean
    createControls?: {
      createdPhones: Set<string>
      maxCreates: number
    }
  }
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
  const buildLookupQuery = () => {
    let query = supabase.from('customers').select('id').limit(1)
    if (variants.length === 1) {
      query = query.eq('mobile_number', variants[0])
    } else {
      const filter = variants.map(value => `mobile_number.eq.${value}`).join(',')
      query = query.or(filter)
    }
    return query
  }

  const { data: existing, error: lookupError } = await buildLookupQuery().maybeSingle()

  assertTwilioLogBackfillLookupSafe({
    phone: standardized,
    error: lookupError as { message?: string; code?: string } | null
  })

  if (existing?.id) {
    cache.set(standardized, existing.id)
    return existing.id
  }

  if (!options.allowCreateIfMissing) {
    cache.set(standardized, null)
    return null
  }

  if (options.createControls) {
    if (!options.createControls.createdPhones.has(standardized)) {
      if (options.createControls.createdPhones.size >= options.createControls.maxCreates) {
        throw new Error(
          `Backfill customer creation exceeded limit (max ${options.createControls.maxCreates}). Rerun with a smaller import batch or increase --create-customers-limit.`
        )
      }
      options.createControls.createdPhones.add(standardized)
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('customers')
    .insert(buildTwilioLogBackfillPlaceholderCustomerInsert({
      phoneE164: standardized,
      fallbackName: options.fallbackName
    }))
    .select('id')
    .single()

  if (insertError) {
    if (isTwilioLogBackfillDuplicateKeyError(insertError as { message?: string; code?: string } | null)) {
      const { data: concurrentExisting, error: concurrentLookupError } = await buildLookupQuery().maybeSingle()
      assertTwilioLogBackfillLookupSafe({
        phone: standardized,
        error: concurrentLookupError as { message?: string; code?: string } | null
      })

      if (concurrentExisting?.id) {
        cache.set(standardized, concurrentExisting.id)
        return concurrentExisting.id
      }

      throw new Error(`Failed to resolve concurrently-created customer for phone ${standardized}`)
    }

    throw new Error(
      `Failed to create customer for phone ${standardized}: ${insertError.message || 'unknown database error'}`
    )
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
  const args = parseTwilioLogBackfillArgs()
  const mutationEnabled = isTwilioLogBackfillMutationEnabled(process.argv)
  const customerCreationEnabled = isTwilioLogBackfillCustomerCreationEnabled(process.argv)

  if (args.confirm && !args.dryRun && !mutationEnabled) {
    throw new Error(
      'backfill-twilio-log blocked by safety guard. To enable writes: pass --confirm and set RUN_TWILIO_LOG_BACKFILL_MUTATION=true and ALLOW_TWILIO_LOG_BACKFILL_MUTATION_SCRIPT=true.'
    )
  }

  if (args.allowCreateCustomers && !args.dryRun && !customerCreationEnabled) {
    throw new Error(
      'backfill-twilio-log customer creation blocked by safety guard. To enable: pass --allow-create-customers and set RUN_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS=true and ALLOW_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS=true (plus mutation send gates).'
    )
  }

  const insertLimit = mutationEnabled
    ? requireScriptLimit({ label: '--limit', value: args.limit, hardCap: 1000 })
    : null
  const customerCreateLimit = customerCreationEnabled
    ? requireScriptLimit({ label: '--create-customers-limit', value: args.createCustomersLimit, hardCap: 50 })
    : null

  if (mutationEnabled) {
    assertTwilioLogBackfillMutationAllowed()
  }
  if (customerCreationEnabled) {
    assertTwilioLogBackfillCustomerCreationAllowed()
  }

  const csvRows = loadCsv(args.filePath)

  console.log(`Loaded ${csvRows.length} rows from ${args.filePath}`)

  const supabase = createAdminClient()

  const sids = csvRows.map(row => row.Sid)
  const existingSidSet = await fetchExistingSids(supabase, sids)
  console.log(`Found ${existingSidSet.size} existing messages in the database`)

  const newRows = csvRows.filter(row => !existingSidSet.has(row.Sid))

  if (newRows.length === 0) {
    console.log('Nothing new to import — all SIDs already present')
    return
  }

  const rowsToProcess = insertLimit ? newRows.slice(0, insertLimit) : newRows
  if (insertLimit && rowsToProcess.length !== newRows.length) {
    console.log(`Applying insert limit: processing ${rowsToProcess.length}/${newRows.length} new message(s).`)
  }

  console.log(`Preparing to import ${rowsToProcess.length} new message(s)${args.dryRun ? ' (dry run)' : ''}`)

  const customerCache: CustomerCache = new Map()
  const records = [] as any[]
  const unresolvedRows: Array<{ sid: string; reason: string }> = []
  const createControls = customerCreationEnabled && customerCreateLimit
    ? { createdPhones: new Set<string>(), maxCreates: customerCreateLimit }
    : undefined

  for (const row of rowsToProcess) {
    const direction = deriveDirection(row.Direction)
    const customerPhone = direction === 'outbound' ? row.To : row.From
    const sentAtIso = parseDate(row.SentDate)
    const price = toNumber(row.Price)
    const status = (row.Status || '').toLowerCase() || null
    const segments = toNumber(row.NumSegments) ?? 1

    const customerId = await resolveCustomerId(supabase, customerCache, customerPhone, {
      allowCreateIfMissing: customerCreationEnabled,
      createControls
    })

    if (!customerId) {
      unresolvedRows.push({
        sid: row.Sid,
        reason: 'customer_unresolved'
      })
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
    assertTwilioLogBackfillCompletedWithoutUnresolvedRows({ unresolvedRows })
    return
  }

  if (args.dryRun) {
    console.log('Dry run complete. Sample record:', records[0])
    console.log(`Would insert ${records.length} records.`)
    assertTwilioLogBackfillCompletedWithoutUnresolvedRows({ unresolvedRows })
    return
  }

  // Fail closed before writing anything if any rows could not be resolved.
  assertTwilioLogBackfillCompletedWithoutUnresolvedRows({ unresolvedRows })

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

    const { insertedCount } = assertTwilioLogBackfillBatchInsertComplete({
      expectedRows: batch.length,
      insertedRows: (data ?? null) as Array<{ id?: string }> | null
    })
    inserted += insertedCount
    console.log(`Inserted batch of ${insertedCount}; total inserted so far: ${inserted}`)
  }

  console.log(`Backfill complete. Inserted ${inserted} new message(s).`)
  assertTwilioLogBackfillCompletedWithoutUnresolvedRows({ unresolvedRows })
}

main().catch(error => {
  console.error('Backfill failed:', error)
  process.exitCode = 1
})
