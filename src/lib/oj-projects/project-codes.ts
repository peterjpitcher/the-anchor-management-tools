import crypto from 'crypto'
import type { createClient } from '@/lib/supabase/server'
import { deriveClientCode } from '@/lib/oj-projects/utils'

type SupabaseLike = Awaited<ReturnType<typeof createClient>>

function randomSuffix(length = 5) {
  const targetLength = Math.max(1, Math.floor(length))
  return crypto
    .randomBytes(Math.max(4, Math.ceil(targetLength / 2)))
    .toString('hex')
    .toUpperCase()
    .slice(0, targetLength)
}

export async function generateProjectCode(supabase: SupabaseLike, vendorId: string) {
  let clientCode: string | null = null
  try {
    const { data: settings } = await supabase
      .from('oj_vendor_billing_settings')
      .select('client_code')
      .eq('vendor_id', vendorId)
      .maybeSingle()
    if (settings?.client_code) {
      clientCode = String(settings.client_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null
    }
  } catch { }

  if (!clientCode) {
    const { data: vendor } = await supabase
      .from('invoice_vendors')
      .select('name')
      .eq('id', vendorId)
      .maybeSingle()
    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
  }

  for (let i = 0; i < 10; i++) {
    const code = `OJP-${clientCode}-${randomSuffix(5)}`
    const { data: existing } = await supabase
      .from('oj_projects')
      .select('id')
      .eq('project_code', code)
      .maybeSingle()
    if (!existing) return code
  }

  return `OJP-${clientCode}-${randomSuffix(8)}`
}
