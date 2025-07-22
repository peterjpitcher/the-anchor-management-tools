// Loyalty System Type Definitions

export interface LoyaltyProgram {
  id: string;
  name: string;
  active: boolean;
  settings: {
    points_per_check_in?: number;
    welcome_bonus?: number;
    birthday_bonus?: number;
    referral_bonus?: number;
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

export interface LoyaltyTier {
  id: string;
  program_id: string;
  name: string;
  level: number;
  min_events: number;
  point_multiplier: number;
  color: string;
  icon: string;
  benefits: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyMember {
  id: string;
  customer_id: string;
  program_id: string;
  tier_id: string;
  total_points: number;
  available_points: number;
  lifetime_points: number;
  lifetime_events: number;
  join_date: string;
  last_activity_date: string | null;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
  // Relations
  customer?: {
    id: string;
    name: string;
    email_address: string | null;
    phone_number: string;
  };
  tier?: LoyaltyTier;
}

export interface EventCheckIn {
  id: string;
  booking_id: string | null;
  event_id: string;
  customer_id: string;
  member_id: string | null;
  check_in_time: string;
  check_in_method: 'qr' | 'manual' | 'self';
  points_earned: number;
  achievements_earned: string[];
  staff_id: string | null;
  notes: string | null;
  created_at: string;
  // Relations
  event?: any;
  customer?: any;
  member?: LoyaltyMember;
}

export interface LoyaltyAchievement {
  id: string;
  program_id: string;
  name: string;
  description: string;
  icon: string;
  points_value: number;
  criteria: {
    type: string;
    [id: string]: any;
  };
  category: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerAchievement {
  id: string;
  member_id: string;
  achievement_id: string;
  earned_date: string;
  points_awarded: number;
  created_at: string;
  // Relations
  achievement?: LoyaltyAchievement;
}

export interface LoyaltyReward {
  id: string;
  program_id: string;
  name: string;
  description: string;
  points_cost: number;
  tier_required?: string;
  category: 'snacks' | 'drinks' | 'desserts' | 'experiences' | string;
  icon: string;
  inventory?: number;
  daily_limit?: number;
  active: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  // Relations
  tier?: LoyaltyTier;
}

export interface RewardRedemption {
  id: string;
  member_id: string;
  reward_id: string;
  points_spent: number;
  redeemed_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  status: 'pending' | 'fulfilled' | 'cancelled';
  notes: string | null;
  created_at: string;
  // Relations
  member?: LoyaltyMember;
  reward?: LoyaltyReward;
}

export interface LoyaltyPointTransaction {
  id: string;
  member_id: string;
  points: number; // positive for earned, negative for spent
  balance_after: number;
  transaction_type: 'earned' | 'redeemed' | 'expired' | 'adjusted' | 'bonus';
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  created_by: string | null;
  // Relations
  member?: LoyaltyMember;
}

export interface LoyaltyCampaign {
  id: string;
  program_id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  bonus_type: 'multiplier' | 'fixed' | 'percentage';
  bonus_value: number;
  criteria: Record<string, any>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyChallenge {
  id: string;
  program_id: string;
  name: string;
  description: string;
  icon: string;
  points_value: number;
  criteria: {
    type: string;
    [id: string]: any;
  };
  category: 'monthly' | 'seasonal' | 'special';
  start_date: string;
  end_date: string;
  max_completions: number;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerChallenge {
  id: string;
  member_id: string;
  challenge_id: string;
  progress: Record<string, any>;
  completed_badge: number;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Relations
  challenge?: LoyaltyChallenge;
}

export interface AchievementProgress {
  id: string;
  member_id: string;
  achievement_id: string;
  progress: Record<string, any>;
  current_value: number;
  target_value: number;
  created_at: string;
  updated_at: string;
  // Relations
  achievement?: LoyaltyAchievement;
}

// Form data types for creating/updating
export interface LoyaltyMemberFormData {
  customer_id: string;
  status?: 'active' | 'inactive' | 'suspended';
  join_date?: string;
}

export interface RewardFormData {
  name: string;
  description: string;
  category: string;
  points_cost: number;
  tier_required?: string;
  icon?: string;
  inventory?: number;
  daily_limit?: number;
  active: boolean;
}

export interface AchievementFormData {
  name: string;
  description: string;
  category: string;
  points_value: number;
  criteria: Record<string, any>;
  icon?: string;
  sort_order?: number;
  active: boolean;
}

export interface ChallengeFormData {
  name: string;
  description: string;
  category: 'monthly' | 'seasonal' | 'special';
  points_value: number;
  criteria: Record<string, any>;
  start_date: string;
  end_date: string;
  max_completions?: number;
  icon?: string;
  sort_order?: number;
  active: boolean;
}