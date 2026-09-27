/**
 * Status colours for the seasonal pre-order block. A complete order is success; an order still
 * missing a main is warning, because the kitchen cannot cook for that seat yet.
 */
export const PREORDER_COMPLETENESS_TONE = {
  complete: 'success',
  incomplete: 'warning',
} as const
