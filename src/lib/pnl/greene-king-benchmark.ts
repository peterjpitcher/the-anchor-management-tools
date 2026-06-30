import type { PLTimeframe } from '@/types/database'

type GreeneKingBenchmarkRowSection =
  | 'sales'
  | 'income'
  | 'expenses'
  | 'profit'
  | 'adjustments'
  | 'rent'

type GreeneKingBenchmarkRow = {
  section: GreeneKingBenchmarkRowSection
  metricKey: string
  label: string
  rowOrder: number
  annualAmount: number | null
  grossProfit: number | null
  grossProfitPercent: number | null
  salesMixPercent: number | null
  percentOfSales: number | null
}

export type GreeneKingBenchmark = {
  benchmarkKey: string
  pubCode: string
  pubName: string
  proposalId: string
  assessmentDate: string
  reportDate: string
  agreementType: string
  agreementReason: string
  tieDetails: string
  rows: GreeneKingBenchmarkRow[]
}

export const GREENE_KING_ANNUAL_TARGETS: Record<string, Partial<Record<PLTimeframe, number>>> = {
  drinks_sales: { '12m': 252313 },
  food_sales: { '12m': 68293 },
  accommodation_sales: { '12m': 0 },
  net_machine_income: { '12m': 3500 },
  draught_beer_pct: { '12m': 49.5 },
  cask_ale_pct: { '12m': 1.5 },
  keg_beer_pct: { '12m': 24.1 },
  cask_beer_pct: { '12m': 14.8 },
  total_drinks_post_wastage: { '12m': 64.2 },
  total_food: { '12m': 67.1 },
  total_accommodation: { '12m': 0 },
  rent: { '12m': 28500 },
  royalty: { '12m': 0 },
  total_staff: { '12m': 80684 },
  business_rate: { '12m': 0 },
  water_rates: { '12m': 3500 },
  heat_light_power: { '12m': 15820 },
  premises_repairs_maintenance: { '12m': 3500 },
  equipment_repairs_maintenance: { '12m': 1500 },
  gardening_expenses: { '12m': 2600 },
  buildings_insurance: { '12m': 960 },
  maintenance_service_plans: { '12m': 2829 },
  licensing: { '12m': 180 },
  tenant_insurance: { '12m': 3500 },
  entertainment: { '12m': 2600 },
  sky_prs_vidimix: { '12m': 9100 },
  marketing_promotion_advertising: { '12m': 2200 },
  print_post_stationary: { '12m': 1200 },
  telephone: { '12m': 1200 },
  travel_car: { '12m': 2000 },
  waste_disposal_cleaning_hygiene: { '12m': 4500 },
  third_party_booking_fee: { '12m': 0 },
  accountant_stocktaker_professional_fees: { '12m': 4500 },
  bank_charges_credit_card_commission: { '12m': 4500 },
  equipment_hire: { '12m': 750 },
  sundries_consumables: { '12m': 4000 },
  drinks_gas: { '12m': 750 },
}

export const GREENE_KING_BENCHMARK: GreeneKingBenchmark = {
  benchmarkKey: 'greene-king-anchor-stanwell-moor-2023-shadow-pnl',
  pubCode: '5356',
  pubName: 'Anchor (Stanwell Moor)',
  proposalId: '26331',
  assessmentDate: '2023-08-22',
  reportDate: '2023-11-27',
  agreementType: 'Tenancy Standard',
  agreementReason: 'Post investment',
  tieDetails: 'Full Tie - Access to Discounted Prices / No',
  rows: [
    { section: 'sales', metricKey: 'drinks_sales', label: 'Total drinks sales', rowOrder: 10, annualAmount: 252313, grossProfit: 162049, grossProfitPercent: 64.2, salesMixPercent: 78.7, percentOfSales: null },
    { section: 'sales', metricKey: 'food_sales', label: 'Food + other sales', rowOrder: 20, annualAmount: 68293, grossProfit: 45833, grossProfitPercent: 67.1, salesMixPercent: 21.3, percentOfSales: null },
    { section: 'sales', metricKey: 'accommodation_sales', label: 'Accommodation', rowOrder: 30, annualAmount: 0, grossProfit: 0, grossProfitPercent: 0, salesMixPercent: 0, percentOfSales: null },
    { section: 'income', metricKey: 'total_sales', label: 'Total sales', rowOrder: 40, annualAmount: 320606, grossProfit: 207882, grossProfitPercent: 64.8, salesMixPercent: 100, percentOfSales: null },
    { section: 'income', metricKey: 'net_machine_income', label: 'Net machine income', rowOrder: 50, annualAmount: 3500, grossProfit: 3500, grossProfitPercent: 100, salesMixPercent: 1.1, percentOfSales: null },
    { section: 'income', metricKey: 'total_income', label: 'Total income', rowOrder: 60, annualAmount: 324106, grossProfit: 211382, grossProfitPercent: 65.2, salesMixPercent: 101.1, percentOfSales: null },
    { section: 'expenses', metricKey: 'total_staff', label: 'Total Staff', rowOrder: 100, annualAmount: 80684, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 25.2 },
    { section: 'expenses', metricKey: 'business_rate', label: 'Business Rate', rowOrder: 110, annualAmount: 0, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0 },
    { section: 'expenses', metricKey: 'water_rates', label: 'Water Rates', rowOrder: 120, annualAmount: 3500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.1 },
    { section: 'expenses', metricKey: 'heat_light_power', label: 'Heat/Light/Power', rowOrder: 130, annualAmount: 15820, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 4.9 },
    { section: 'expenses', metricKey: 'premises_repairs_maintenance', label: 'Premises Repairs/Maintenance', rowOrder: 140, annualAmount: 3500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.1 },
    { section: 'expenses', metricKey: 'equipment_repairs_maintenance', label: 'Equipment Repairs/Maintenance', rowOrder: 150, annualAmount: 1500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.5 },
    { section: 'expenses', metricKey: 'gardening_expenses', label: 'Gardening Expenses', rowOrder: 160, annualAmount: 2600, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.8 },
    { section: 'expenses', metricKey: 'buildings_insurance', label: 'Buildings Insurance', rowOrder: 170, annualAmount: 960, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.3 },
    { section: 'expenses', metricKey: 'maintenance_service_plans', label: 'Maintenance and Service Plan Charges', rowOrder: 180, annualAmount: 2829, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.9 },
    { section: 'expenses', metricKey: 'licensing', label: 'Licensing', rowOrder: 190, annualAmount: 180, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.1 },
    { section: 'expenses', metricKey: 'tenant_insurance', label: 'Tenant Insurance', rowOrder: 200, annualAmount: 3500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.1 },
    { section: 'expenses', metricKey: 'entertainment', label: 'Entertainment', rowOrder: 210, annualAmount: 2600, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.8 },
    { section: 'expenses', metricKey: 'sky_prs_vidimix', label: 'Sky / PRS / Vidimix', rowOrder: 220, annualAmount: 9100, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 2.8 },
    { section: 'expenses', metricKey: 'marketing_promotion_advertising', label: 'Marketing/Promotion/Advertising', rowOrder: 230, annualAmount: 2200, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.7 },
    { section: 'expenses', metricKey: 'print_post_stationary', label: 'Print/Post Stationary', rowOrder: 240, annualAmount: 1200, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.4 },
    { section: 'expenses', metricKey: 'telephone', label: 'Telephone', rowOrder: 250, annualAmount: 1200, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.4 },
    { section: 'expenses', metricKey: 'travel_car', label: 'Travel/Car', rowOrder: 260, annualAmount: 2000, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.6 },
    { section: 'expenses', metricKey: 'waste_disposal_cleaning_hygiene', label: 'Waste Disposal/Cleaning/Hygiene', rowOrder: 270, annualAmount: 4500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.4 },
    { section: 'expenses', metricKey: 'third_party_booking_fee', label: 'Third Party Booking Fee', rowOrder: 280, annualAmount: 0, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0 },
    { section: 'expenses', metricKey: 'accountant_stocktaker_professional_fees', label: 'Accountant/StockTaker/Professional Fees', rowOrder: 290, annualAmount: 4500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.4 },
    { section: 'expenses', metricKey: 'bank_charges_credit_card_commission', label: 'Bank Charges/Credit Card Commission', rowOrder: 300, annualAmount: 4500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.4 },
    { section: 'expenses', metricKey: 'equipment_hire', label: 'Equipment Hire', rowOrder: 310, annualAmount: 750, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.2 },
    { section: 'expenses', metricKey: 'sundries_consumables', label: 'Sundries/Consumables', rowOrder: 320, annualAmount: 4000, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 1.2 },
    { section: 'expenses', metricKey: 'drinks_gas', label: 'Drinks Gas', rowOrder: 330, annualAmount: 750, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 0.2 },
    { section: 'expenses', metricKey: 'total_expenses', label: 'Total expenses', rowOrder: 340, annualAmount: 152373, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 47.5 },
    { section: 'profit', metricKey: 'net_operating_profit_before_rent', label: 'Net operating profit before rent', rowOrder: 400, annualAmount: 59010, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: null },
    { section: 'adjustments', metricKey: 'working_capital_interest', label: 'Interest on working capital @ 8%', rowOrder: 500, annualAmount: 2000, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: null },
    { section: 'adjustments', metricKey: 'total_adjustments', label: 'Total adjustments', rowOrder: 510, annualAmount: 2000, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: null },
    { section: 'rent', metricKey: 'divisible_balance', label: 'Divisible balance', rowOrder: 600, annualAmount: 57010, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: null },
    { section: 'rent', metricKey: 'rent', label: 'Assessed fixed rental value', rowOrder: 610, annualAmount: 28500, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 8.9 },
    { section: 'rent', metricKey: 'operators_retained_income', label: "Operator's retained income including machine income", rowOrder: 620, annualAmount: 28510, grossProfit: null, grossProfitPercent: null, salesMixPercent: null, percentOfSales: 8.9 },
  ],
}
