/**
 * Returns the canonical transaction direction based on amount fields.
 * 'in'      = money received (amount_in > 0)
 * 'out'     = money spent   (amount_out > 0)
 * 'unknown' = neither or both
 */
export function getTransactionDirection(
  amountIn?: number | null,
  amountOut?: number | null
): 'in' | 'out' | 'unknown' {
  if (amountIn && amountIn > 0) return 'in'
  if (amountOut && amountOut > 0) return 'out'
  return 'unknown'
}
