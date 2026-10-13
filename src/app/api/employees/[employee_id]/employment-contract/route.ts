import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildWorkerAgreementDocument } from '@/lib/signing/documents/worker-agreement'

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employee_id: string }> }
) {
  const { employee_id: employeeId } = await params

  if (!employeeId) {
    return new NextResponse('Employee ID required', { status: 400 })
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const hasPermission = await checkUserPermission('employees', 'view')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  try {
    // One builder for the download and for signing (src/lib/signing/documents/worker-agreement.ts),
    // so the agreement someone signs is the agreement staff can download.
    const document = await buildWorkerAgreementDocument(employeeId)
    if (!document) {
      return new NextResponse('Employee not found', { status: 404 })
    }
    const { employee, pdf } = document

    const safeName = sanitizeFilename(
      `zero-hours-worker-agreement-${employee.last_name}-${employee.first_name}.pdf`,
      `zero-hours-worker-agreement-${employee.employee_id}.pdf`
    )

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error generating worker agreement PDF:', error)
    return new NextResponse('Failed to generate contract PDF', { status: 500 })
  }
}
