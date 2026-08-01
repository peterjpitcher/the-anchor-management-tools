import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireModulePermission } from '@/lib/api/permissions'
import { logger } from '@/lib/logger'
import { DEPOSIT_BASES, PERIOD_KINDS } from '@/lib/table-bookings/periods'

/**
 * Seasonal booking periods, manager CRUD.
 *
 * Validation is duplicated on purpose. What is here gives a fast, readable error; the rules that
 * actually protect the venue live in `set_booking_period` in the database, because a rule that only
 * exists in a form is a rule anyone can walk around. The overlap rule in particular is a database
 * exclusion constraint, so two active periods covering one date are impossible rather than merely
 * discouraged.
 *
 * The actor is passed to the RPC from here, AFTER the permission check, so the audit row is written
 * in the same transaction as the change and can never end up unattributed.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const SavePeriodSchema = z
  .object({
    id: z.string().uuid().optional(),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'The code must be lowercase words joined by hyphens, for example christmas-2027')
      .min(3)
      .max(60)
      .optional(),
    period_kind: z.enum(PERIOD_KINDS).optional(),
    name: z.string().trim().min(2, 'A period needs a name').max(80),
    starts_on: z.string().regex(ISO_DATE, 'The start date must use YYYY-MM-DD format'),
    ends_on: z.string().regex(ISO_DATE, 'The end date must use YYYY-MM-DD format'),
    guest_question: z.string().trim().min(5, 'The guest question is too short').max(160),
    guest_blurb: z.string().trim().max(400).optional().nullable(),
    requires_preorder: z.boolean().default(false),
    preorder_cutoff_days: z.coerce.number().int().min(0).max(90).default(7),
    deposit_basis: z.enum(DEPOSIT_BASES).default('none'),
    deposit_amount: z.coerce.number().min(0).max(1000).default(0),
    refund_cutoff_days: z.coerce.number().int().min(0).max(90).default(7),
    min_party_size: z.coerce.number().int().min(1).max(200).nullable().optional(),
    max_party_size: z.coerce.number().int().min(1).max(200).nullable().optional(),
    min_notice_hours: z.coerce.number().int().min(0).max(720).default(0),
  })
  .refine((v) => v.ends_on >= v.starts_on, {
    message: 'The end date cannot be before the start date',
    path: ['ends_on'],
  })
  .refine((v) => v.deposit_basis === 'none' || v.deposit_amount > 0, {
    message: 'A deposit basis needs an amount above zero, or set the basis to none',
    path: ['deposit_amount'],
  })
  .refine(
    (v) => v.min_party_size == null || v.max_party_size == null || v.max_party_size >= v.min_party_size,
    { message: 'The largest party cannot be smaller than the smallest party', path: ['max_party_size'] },
  )
  .refine((v) => Boolean(v.id) || (Boolean(v.code) && Boolean(v.period_kind)), {
    message: 'A new period needs a code and a kind',
    path: ['code'],
  })

const ActiveSchema = z
  .object({
    id: z.string().uuid(),
    is_active: z.boolean().optional(),
    archive: z.boolean().optional(),
  })
  .refine((v) => typeof v.is_active === 'boolean' || v.archive === true, {
    message: 'Say whether to switch the period on, off, or archive it',
  })

type RpcResult = { ok?: boolean; error?: string; id?: string; is_active?: boolean }

export async function GET() {
  const auth = await requireModulePermission('table_bookings', 'manage')
  if (!auth.ok) return auth.response

  try {
    const { data, error } = await auth.supabase.rpc('get_booking_periods')
    if (error) throw error
    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (error) {
    logger.error('Failed to load seasonal booking periods', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Failed to load seasonal booking periods' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireModulePermission('table_bookings', 'manage')
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SavePeriodSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }

  try {
    const { data, error } = await auth.supabase.rpc('set_booking_period', {
      p_payload: parsed.data,
      p_actor_id: auth.userId,
    })
    if (error) throw error

    const result = (data ?? {}) as RpcResult
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Could not save the period' }, { status: 400 })
    }

    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    logger.error('Failed to save a seasonal booking period', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { periodId: parsed.data.id ?? null },
    })
    return NextResponse.json({ error: 'Failed to save the period' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModulePermission('table_bookings', 'manage')
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ActiveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }

  try {
    const { data, error } = await auth.supabase.rpc('set_booking_period_active', {
      p_id: parsed.data.id,
      p_is_active: parsed.data.is_active ?? false,
      p_archive: parsed.data.archive ?? false,
      p_actor_id: auth.userId,
    })
    if (error) throw error

    const result = (data ?? {}) as RpcResult
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Could not change the period' }, { status: 400 })
    }

    return NextResponse.json({ success: true, is_active: result.is_active })
  } catch (error) {
    logger.error('Failed to change a seasonal booking period status', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { periodId: parsed.data.id },
    })
    return NextResponse.json({ error: 'Failed to change the period' }, { status: 500 })
  }
}
