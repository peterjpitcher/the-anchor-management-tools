import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiters } from '@/lib/rate-limit'
import { legacyReportSubmissionSchema } from '@/lib/short-links/legacy-report'
import { parseUserAgent } from '@/lib/user-agent-parser'

/**
 * Records where somebody found a legacy vip-club.uk link.
 *
 * Public by design: it is submitted from the legacy-domain interstitial, which anonymous
 * customers see. Writes go through the service-role client so the table needs no anon
 * grant, and nothing identifying is stored.
 */
export async function POST(request: NextRequest) {
  // The rate-limit store is shared across every limiter, so the key is namespaced to
  // this route rather than left as the bare IP.
  const clientIp =
    request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  const limited = await rateLimiters.api(request, `legacy-report:${clientIp}`)
  if (limited) return limited

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = legacyReportSubmissionSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid submission' },
      { status: 400 }
    )
  }

  const { code, locationKey, locationDetail, isStaff } = parsed.data
  const requestedCode = code.trim().toLowerCase()

  try {
    const supabase = createAdminClient()

    // Resolve the code so reports can be grouped by link, following the same
    // code-then-alias order the redirect handler uses. A code that resolves to nothing
    // is still recorded: the answer is useful even if the link has since been deleted.
    let shortLinkId: string | null = null

    const { data: link } = await supabase
      .from('short_links')
      .select('id')
      .eq('short_code', requestedCode)
      .maybeSingle()

    if (link) {
      shortLinkId = link.id
    } else {
      const { data: alias } = await supabase
        .from('short_link_aliases')
        .select('short_link_id')
        .eq('alias_code', requestedCode)
        .maybeSingle()
      shortLinkId = alias?.short_link_id ?? null
    }

    const { deviceType } = parseUserAgent(request.headers.get('user-agent'))

    const { error: insertError } = await supabase.from('short_link_legacy_reports').insert({
      short_link_id: shortLinkId,
      requested_code: requestedCode,
      request_host: request.headers.get('host')?.split(':')[0]?.trim().toLowerCase() || null,
      location_key: locationKey,
      location_detail: locationDetail ?? null,
      is_staff: isStaff,
      device_type: deviceType,
    })

    if (insertError) throw insertError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to record legacy short-link report:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Could not save your answer' }, { status: 500 })
  }
}
