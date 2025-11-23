import { User as SupabaseUser } from '@supabase/supabase-js';

export type CashupStatus = 'draft' | 'submitted' | 'approved' | 'locked';

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
  created_at: string;
  created_by_user_id: string;
  updated_at: string;
  updated_by_user_id: string;
}

export interface CashupPaymentBreakdown {
  id: string;
  cashup_session_id: string;
  payment_type_code: string;
  payment_type_label: string;
  expected_amount: number;
  counted_amount: number;
  variance_amount: number;
}

export interface CashupCashCount {
  id: string;
  cashup_session_id: string;
  denomination: number;
  quantity: number;
  total_amount: number;
}

export interface CashupWeeklyView {
  site_id: string;
  week_start_date: string;
  session_date: string;
  status: CashupStatus;
  total_expected_amount: number;
  total_counted_amount: number;
  total_variance_amount: number;
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
    quantity: number;
  }[];
}

export interface CashupDashboardStats {
  totalTakings: number;
  averageDailyTakings: number;
  totalVariance: number;
  highVarianceDays: number;
  daysWithSubmittedSessions: number;
  expectedDays: number;
}

export interface CashupDashboardData {
  kpis: CashupDashboardStats;
  charts: {
    dailyTakings: { date: string; siteId: string; totalTakings: number }[];
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
