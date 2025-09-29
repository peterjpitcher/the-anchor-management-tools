import type { ReceiptExpenseCategory } from '@/types/database'

export type PnlTimeframeKey = '1m' | '3m' | '12m'

export const PNL_TIMEFRAMES: Array<{ key: PnlTimeframeKey; label: string; days: number }> = [
  { key: '1m', label: 'Last 30 days', days: 30 },
  { key: '3m', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 365 days', days: 365 },
]

export type PnlMetricType = 'manual' | 'expense'
export type PnlMetricFormat = 'currency' | 'percent'
export type PnlMetricGroup =
  | 'sales'
  | 'sales_mix'
  | 'sales_totals'
  | 'expenses'
  | 'occupancy'

export type PnlMetric = {
  key: string
  label: string
  type: PnlMetricType
  group: PnlMetricGroup
  format?: PnlMetricFormat
  description?: string
  expenseCategory?: ReceiptExpenseCategory
  baseMetricKey?: string
}

const EXPENSE_METRIC_DEFS: Array<{ key: string; label: string; category: ReceiptExpenseCategory }> = [
  { key: 'total_staff', label: 'Total Staff', category: 'Total Staff' },
  { key: 'business_rate', label: 'Business Rate', category: 'Business Rate' },
  { key: 'water_rates', label: 'Water Rates', category: 'Water Rates' },
  { key: 'heat_light_power', label: 'Heat/Light/Power', category: 'Heat/Light/Power' },
  { key: 'premises_repairs_maintenance', label: 'Premises Repairs/Maintenance', category: 'Premises Repairs/Maintenance' },
  { key: 'equipment_repairs_maintenance', label: 'Equipment Repairs/Maintenance', category: 'Equipment Repairs/Maintenance' },
  { key: 'gardening_expenses', label: 'Gardening Expenses', category: 'Gardening Expenses' },
  { key: 'buildings_insurance', label: 'Buildings Insurance', category: 'Buildings Insurance' },
  { key: 'maintenance_service_plans', label: 'Maintenance and Service Plan Charges', category: 'Maintenance and Service Plan Charges' },
  { key: 'licensing', label: 'Licensing', category: 'Licensing' },
  { key: 'tenant_insurance', label: 'Tenant Insurance', category: 'Tenant Insurance' },
  { key: 'entertainment', label: 'Entertainment', category: 'Entertainment' },
  { key: 'sky_prs_vidimix', label: 'Sky / PRS / Vidimix', category: 'Sky / PRS / Vidimix' },
  { key: 'marketing_promotion_advertising', label: 'Marketing/Promotion/Advertising', category: 'Marketing/Promotion/Advertising' },
  { key: 'print_post_stationary', label: 'Print/Post Stationary', category: 'Print/Post Stationary' },
  { key: 'telephone', label: 'Telephone', category: 'Telephone' },
  { key: 'travel_car', label: 'Travel/Car', category: 'Travel/Car' },
  { key: 'waste_disposal_cleaning_hygiene', label: 'Waste Disposal/Cleaning/Hygiene', category: 'Waste Disposal/Cleaning/Hygiene' },
  { key: 'third_party_booking_fee', label: 'Third Party Booking Fee', category: 'Third Party Booking Fee' },
  { key: 'accountant_stocktaker_professional_fees', label: 'Accountant/StockTaker/Professional Fees', category: 'Accountant/StockTaker/Professional Fees' },
  { key: 'bank_charges_credit_card_commission', label: 'Bank Charges/Credit Card Commission', category: 'Bank Charges/Credit Card Commission' },
  { key: 'equipment_hire', label: 'Equipment Hire', category: 'Equipment Hire' },
  { key: 'sundries_consumables', label: 'Sundries/Consumables', category: 'Sundries/Consumables' },
  { key: 'drinks_gas', label: 'Drinks Gas', category: 'Drinks Gas' },
]

export const PNL_METRICS: PnlMetric[] = [
  { key: 'drinks_sales', label: 'Drinks sales', type: 'manual', group: 'sales', format: 'currency' },
  { key: 'draught_beer_pct', label: 'Draught beer sales %', type: 'manual', group: 'sales_mix', format: 'percent', baseMetricKey: 'drinks_sales' },
  { key: 'cask_ale_pct', label: 'Cask ale %', type: 'manual', group: 'sales_mix', format: 'percent', baseMetricKey: 'drinks_sales' },
  { key: 'keg_beer_pct', label: 'Keg beer %', type: 'manual', group: 'sales_mix', format: 'percent', baseMetricKey: 'drinks_sales' },
  { key: 'cask_beer_pct', label: 'Cask beer %', type: 'manual', group: 'sales_mix', format: 'percent', baseMetricKey: 'drinks_sales' },
  { key: 'food_sales', label: 'Food sales', type: 'manual', group: 'sales', format: 'currency' },
  { key: 'accommodation_sales', label: 'Accommodation sales', type: 'manual', group: 'sales', format: 'currency' },
  { key: 'other_sales', label: 'Other sales', type: 'manual', group: 'sales', format: 'currency' },
  { key: 'net_machine_income', label: 'Net machine income', type: 'manual', group: 'sales', format: 'currency' },
  { key: 'total_drinks_post_wastage', label: 'Drinks GP %', type: 'manual', group: 'sales_totals', format: 'percent', baseMetricKey: 'drinks_sales' },
  { key: 'total_food', label: 'Food GP %', type: 'manual', group: 'sales_totals', format: 'percent', baseMetricKey: 'food_sales' },
  { key: 'total_accommodation', label: 'Accommodation GP %', type: 'manual', group: 'sales_totals', format: 'percent', baseMetricKey: 'accommodation_sales' },
  { key: 'total_other_sales', label: 'Other sales GP %', type: 'manual', group: 'sales_totals', format: 'percent', baseMetricKey: 'other_sales' },
  { key: 'rent', label: 'Rent', type: 'manual', group: 'occupancy', format: 'currency' },
  { key: 'royalty', label: 'Royalty', type: 'manual', group: 'occupancy', format: 'currency' },
  ...EXPENSE_METRIC_DEFS.map(({ key, label, category }) => ({
    key,
    label,
    type: 'expense' as const,
    group: 'expenses' as const,
    format: 'currency' as const,
    expenseCategory: category,
  })),
]

export const EXPENSE_METRIC_KEYS = EXPENSE_METRIC_DEFS.map(({ key }) => key)
export const MANUAL_METRIC_KEYS = PNL_METRICS.filter((metric) => metric.type === 'manual').map((metric) => metric.key)
