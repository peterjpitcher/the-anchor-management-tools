export interface CashCountValueInput {
  denomination: number;
  totalAmount: number;
}

export interface NormalizedCashCount {
  denomination: number;
  quantity: number;
  totalAmount: number;
}

const PENCE_PER_POUND = 100;
const PENCE_EPSILON = 1e-6;

function toPence(amount: number, label: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`${label} must be a valid amount`);
  }

  const pence = Math.round(amount * PENCE_PER_POUND);
  if (Math.abs(amount * PENCE_PER_POUND - pence) > PENCE_EPSILON) {
    throw new Error(`${label} must be in whole pence`);
  }

  return pence;
}

function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

export function normalizeCashCountInput(input: CashCountValueInput): NormalizedCashCount {
  const denominationPence = toPence(input.denomination, 'Cash denomination');
  if (denominationPence <= 0) {
    throw new Error('Cash denomination must be greater than zero');
  }

  const totalPence = toPence(input.totalAmount, `Total amount for ${formatCurrency(input.denomination)}`);
  if (totalPence < 0) {
    throw new Error(`Total amount for ${formatCurrency(input.denomination)} cannot be negative`);
  }

  if (totalPence % denominationPence !== 0) {
    throw new Error(
      `Total amount ${formatCurrency(totalPence / PENCE_PER_POUND)} is not valid for ${formatCurrency(input.denomination)}; it must be a multiple of ${formatCurrency(input.denomination)}.`
    );
  }

  return {
    denomination: denominationPence / PENCE_PER_POUND,
    quantity: totalPence / denominationPence,
    totalAmount: totalPence / PENCE_PER_POUND,
  };
}

export function normalizeCashCountInputs(inputs: CashCountValueInput[]): NormalizedCashCount[] {
  return inputs
    .map(normalizeCashCountInput)
    .filter(count => count.quantity > 0);
}
