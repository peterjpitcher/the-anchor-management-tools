/**
 * When a seasonal pre-order stops being editable.
 *
 * The rule itself now lives with the rest of the pre-order rules, in
 * src/lib/table-bookings/preorder.ts, because the staff screen, the booker's manage page and the
 * chase cron all have to give the guest the same answer. This file is kept only as the import path
 * the staff screen and its server action already use, and it must never grow an implementation of
 * its own: the moment there are two, they drift.
 */

export { getPreorderCutoff, type PreorderCutoff } from '@/lib/table-bookings/preorder'
