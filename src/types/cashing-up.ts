import { User as SupabaseUser } from '@supabase/supabase-js';

export type CashupStatus = 'draft' | 'submitted' | 'approved' | 'locked';
export type CashupSalesCategory = 'drinks_sales' | 'food_sales' | 'other_sales';
export type CashupInsightsPeriod = '30d' | '90d' | '180d' | '365d' | '12m';

export interface CashupSession {
  id: string;
  site_id: string;
  session_date: string; // YYYY-MM-DD
  status: CashupStatus;
  prepared_by_user_id: string;
  approved_by_user_id: string | null;
  total_expected_amount: number;
  total_counted_amount: number;
  total_variance_amount: number;
  notes: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  created_at: string;
  created_by_user_id: string;
  updated_at: string;
  updated_by_user_id: string;
  cashup_payment_breakdowns: CashupPaymentBreakdown[]; // Added
  cashup_cash_counts: CashupCashCount[]; // Added
  cashup_sales_breakdowns: CashupSalesBreakdown[];
}

interface CashupPaymentBreakdown {
  id: string;
  cashup_session_id: string;
  payment_type_code: string;
  payment_type_label: string;
  expected_amount: number;
  counted_amount: number;
  variance_amount: number;
}

interface CashupCashCount {
  id: string;
  cashup_session_id: string;
  denomination: number;
  quantity: number;
  total_amount: number;
}

interface CashupSalesBreakdown {
  id: string;
  cashup_session_id: string;
  sales_category: CashupSalesCategory;
  amount: number;
  created_at?: string;
  updated_at?: string;
}

interface CashupWeeklyView {
  site_id: string;
  week_start_date: string;
  session_date: string;
  status: CashupStatus;
  total_expected_amount: number;
  total_counted_amount: number;
  total_variance_amount: number;
  cash_counted_amount?: number;
  card_counted_amount?: number;
  stripe_counted_amount?: number;
  non_cash_counted_amount?: number;
}

// DTOs for API/Actions

export interface UpsertCashupSessionDTO {
  siteId: string;
  sessionDate: string;
  status?: CashupStatus;
  notes?: string | null;
  paymentBreakdowns: {
    paymentTypeCode: string;
    paymentTypeLabel: string;
    expectedAmount: number;
    countedAmount: number;
  }[];
  cashCounts: {
    denomination: number;
    totalAmount: number;
  }[];
  salesBreakdowns?: {
    salesCategory: CashupSalesCategory;
    amount: number;
  }[];
}

interface CashupDashboardStats {
  totalTakings: number;
  totalTarget: number;
  averageDailyTakings: number;
  totalVariance: number;
  highVarianceDays: number;
  daysWithSubmittedSessions: number;
  expectedDays: number;
}

export interface CashupDashboardData {
  kpis: CashupDashboardStats;
  charts: {
    dailyTakings: { date: string; siteId: string; totalTakings: number; target: number }[];
    dailyVariance: { date: string; totalVariance: number }[];
    paymentMix: { paymentTypeCode: string; amount: number }[];
    topSitesByVariance: { siteId: string; siteName: string; totalVariance: number }[];
  };
  tables: {
    variance: {
      siteId: string;
      siteName: string;
      sessionDate: string;
      totalTakings: number;
      variance: number;
      variancePercent: number;
      status: CashupStatus;
      notes: string | null;
      cashTotal: number;
      cardTotal: number;
      stripeTotal: number;
      dailyTarget: number;
      accruedTarget: number;
      accruedTakings: number;
      targetPerformancePercent: number | null;
    }[];
    compliance: {
      siteId: string;
      siteName: string;
      expectedDays: number;
      submittedDays: number;
      approvedDays: number;
    }[];
  };
}

export interface CashupInsightsData {
  dayOfWeek: {
    dayName: string;
    avgTakings: number;
    avgVariance: number;
  }[];
  paymentMix: {
    label: string;
    value: number;
    percentage: number;
    color: string;
  }[];
  salesMix: {
    label: string;
    value: number;
    percentage: number;
    color: string;
  }[];
  salesMixMonthly: {
    monthStart: string;
    monthLabel: string;
    drinksSales: number;
    foodSales: number;
    otherSales: number;
    totalSales: number;
    drinksPercentage: number;
    foodPercentage: number;
    otherPercentage: number;
  }[];
  monthlyGrowth: {
    monthLabel: string;
    totalTakings: number;
    targetTakings?: number;
    previousYearTakings?: number;
  }[];
}
