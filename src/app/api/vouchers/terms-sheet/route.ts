import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireModulePermission } from '@/lib/api/permissions'
import { buildTermsSheetHtml } from '@/lib/voucher-card-template'
import type { TermsVersionRow } from '@/types/vouchers'

export const dynamic = 'force-dynamic'

// GET /api/vouchers/terms-sheet?version=v2.0
// Renders the printable A4 terms sheet for a terms version (spec 3.6, F47).
// Any voucher user may print the terms, so this gates on vouchers.view.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const permission = await requireModulePermission('vouchers', 'view')
  if (!permission.ok) return permission.response

  const requestedVersion = request.nextUrl.searchParams.get('version')?.trim()

  let query = permission.supabase.from('terms_versions').select('*')
  if (requestedVersion) {
    query = query.eq('version', requestedVersion)
  } else {
    query = query.order('effective_from', { ascending: false }).limit(1)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Could not load the terms version.' }, { status: 500 })
  }
  const row = (data ?? [])[0] as TermsVersionRow | undefined
  if (!row) {
    return NextResponse.json({ error: 'Terms version not found.' }, { status: 404 })
  }

  const html = buildTermsSheetHtml({ version: row.version, clauses: row.clauses })
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
