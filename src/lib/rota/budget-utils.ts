export type BudgetTargets = {
  annual: number;
  monthly: number;
  weekly: number;
};

export function deriveBudgetTargets(annualHours: number): BudgetTargets {
  return {
    annual: annualHours,
    monthly: Math.round((annualHours / 12) * 10) / 10,
    weekly: Math.round((annualHours / 52) * 10) / 10,
  };
}
