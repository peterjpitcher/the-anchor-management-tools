import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'

/**
 * The signed-in person and the audit call, for the receipts action files.
 *
 * Not a server action file: these are helpers the action files call. Every receipts audit entry
 * names the person who did the thing. The shared audit service records whatever it is given and
 * looks nobody up, so an entry written without an actor is anonymous for good: 1,423 of the
 * first 1,429 receipts entries were. The actor is therefore a required argument.
 */

export type ReceiptActor = { user_id: string; user_email: string }

export async function requireReceiptActor(): Promise<ReceiptActor> {
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { user_id, user_email: user_email ?? '' }
}

export async function logReceiptActorAudit(
  actor: ReceiptActor,
  event: Omit<Parameters<typeof logAuditEvent>[0], 'user_id' | 'user_email'>
): Promise<void> {
  await logAuditEvent({ ...event, user_id: actor.user_id, user_email: actor.user_email || undefined })
}
