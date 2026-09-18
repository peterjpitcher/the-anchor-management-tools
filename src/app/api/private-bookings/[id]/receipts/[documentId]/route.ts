import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { CONTRACT_DOCUMENTS_BUCKET } from '@/lib/private-bookings/contract-lifecycle'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }): Promise<NextResponse> {
  const { id, documentId } = await params
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(documentId).success) return new NextResponse('Invalid document reference', { status: 400 })
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })
  if (!await checkUserPermission('private_bookings', 'view', user.id) || !await checkUserPermission('private_bookings', 'view_pricing', user.id)) return new NextResponse('Permission denied', { status: 403 })
  const db = createAdminClient()
  const { data: document, error } = await db.from('private_booking_documents').select('storage_path, file_name, metadata').eq('id', documentId).eq('booking_id', id).eq('document_type', 'receipt').single()
  if (error || !document) return new NextResponse('Receipt not found', { status: 404 })
  const { data: stored, error: storageError } = await db.storage.from(CONTRACT_DOCUMENTS_BUCKET).download(document.storage_path)
  if (storageError || !stored) return new NextResponse('Stored receipt unavailable', { status: 503 })
  const bytes = Buffer.from(await stored.arrayBuffer())
  if (document.metadata?.sha256 && createHash('sha256').update(bytes).digest('hex') !== document.metadata.sha256) return new NextResponse('Receipt integrity check failed', { status: 503 })
  return new NextResponse(bytes as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${document.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Cache-Control': 'private, no-store' } })
}
