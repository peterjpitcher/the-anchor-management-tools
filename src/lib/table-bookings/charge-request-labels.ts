/**
 * Pure display helpers for charge requests, kept apart from
 * `charge-approvals.ts` so client components can import them. That module
 * reaches Stripe and the email stack, which pulls Node-only packages (`net`,
 * `fs`, `tls`) into any browser bundle that touches it.
 */

export function formatChargeRequestType(type?: string | null): string {
  switch (type) {
    case 'late_cancel':
      return 'Late cancellation'
    case 'no_show':
      return 'No-show'
    case 'reduction_fee':
      return 'Reduction fee'
    case 'walkout':
      return 'Walkout / unpaid bill'
    default:
      return 'Charge request'
  }
}
