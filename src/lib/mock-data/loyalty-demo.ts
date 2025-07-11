// Mock data for loyalty system demo
// This is temporary data for demonstration - will be replaced with database

export interface LoyaltyMember {
  id: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  tier: 'member' | 'bronze' | 'silver' | 'gold' | 'platinum';
  totalPoints: number;
  availablePoints: number;
  lifetimeEvents: number;
  joinDate: string;
  lastVisit: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  pointsValue: number;
  unlockedDate?: string;
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  tierRequired?: 'bronze' | 'silver' | 'gold' | 'platinum';
  icon: string;
}

export interface ActiveEvent {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  type: 'quiz' | 'bingo' | 'karaoke' | 'gameshow' | 'drag' | 'tasting';
}

export interface Booking {
  id: string;
  customerId: string;
  eventId: string;
  phoneNumber: string;
  partySize: number;
  checkedIn: boolean;
  checkInTime?: string;
}

export interface RedemptionCode {
  code: string;
  rewardId: string;
  memberId: string;
  generatedAt: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
}

// Mock Members
export const mockMembers: Record<string, LoyaltyMember> = {
  '+447700900001': {
    id: '1',
    customerId: 'cust-1',
    customerName: 'Sarah Johnson',
    phoneNumber: '+447700900001',
    tier: 'silver',
    totalPoints: 1850,
    availablePoints: 1850,
    lifetimeEvents: 12,
    joinDate: '2024-06-15',
    lastVisit: '2024-11-27'
  },
  '+447700900002': {
    id: '2',
    customerId: 'cust-2',
    customerName: 'Mike Williams',
    phoneNumber: '+447700900002',
    tier: 'bronze',
    totalPoints: 650,
    availablePoints: 650,
    lifetimeEvents: 6,
    joinDate: '2024-09-20',
    lastVisit: '2024-12-04'
  },
  '+447700900003': {
    id: '3',
    customerId: 'cust-3',
    customerName: 'Emma Davis',
    phoneNumber: '+447700900003',
    tier: 'gold',
    totalPoints: 3200,
    availablePoints: 2700,
    lifetimeEvents: 24,
    joinDate: '2024-03-10',
    lastVisit: '2024-12-11'
  }
};

// Mock Achievements
export const achievements: Achievement[] = [
  {
    id: 'ach-1',
    name: 'Quiz Regular',
    description: 'Attend 5 quiz nights',
    icon: '🧠',
    pointsValue: 100
  },
  {
    id: 'ach-2',
    name: 'Karaoke Star',
    description: 'Perform at karaoke 3 times',
    icon: '🎤',
    pointsValue: 75
  },
  {
    id: 'ach-3',
    name: 'Event Explorer',
    description: 'Try 3 different event types',
    icon: '🎯',
    pointsValue: 150
  },
  {
    id: 'ach-4',
    name: 'Weekend Warrior',
    description: 'Attend 5 weekend events',
    icon: '🎉',
    pointsValue: 100
  },
  {
    id: 'ach-5',
    name: 'Loyal Customer',
    description: 'Attend 10 events',
    icon: '⭐',
    pointsValue: 200
  }
];

// Mock Rewards
export const rewards: Reward[] = [
  {
    id: 'reward-1',
    name: 'House Snack',
    description: 'Any starter or bar snack',
    pointsCost: 300,
    icon: '🍿'
  },
  {
    id: 'reward-2',
    name: 'Free Dessert',
    description: 'Any dessert from our menu',
    pointsCost: 400,
    icon: '🍰'
  },
  {
    id: 'reward-3',
    name: 'Drink Upgrade',
    description: 'Upgrade any drink to premium',
    pointsCost: 500,
    tierRequired: 'bronze',
    icon: '🍺'
  },
  {
    id: 'reward-4',
    name: 'Free Drink',
    description: 'Any house drink',
    pointsCost: 600,
    tierRequired: 'silver',
    icon: '🥂'
  },
  {
    id: 'reward-5',
    name: 'Bring a Friend',
    description: 'Free entry for you and a friend',
    pointsCost: 750,
    tierRequired: 'silver',
    icon: '👥'
  },
  {
    id: 'reward-6',
    name: '£10 Credit',
    description: '£10 off your bill',
    pointsCost: 1000,
    tierRequired: 'gold',
    icon: '💷'
  }
];

// Today's Event
export const todaysEvent: ActiveEvent = {
  id: 'event-123',
  name: 'Quiz Night',
  date: '2024-12-13',
  startTime: '19:00',
  endTime: '21:00',
  type: 'quiz'
};

// Mock Bookings for tonight
export const mockBookings: Booking[] = [
  {
    id: 'booking-1',
    customerId: 'cust-1',
    eventId: 'event-123',
    phoneNumber: '+447700900001',
    partySize: 4,
    checkedIn: false
  },
  {
    id: 'booking-2',
    customerId: 'cust-2',
    eventId: 'event-123',
    phoneNumber: '+447700900002',
    partySize: 2,
    checkedIn: false
  },
  {
    id: 'booking-3',
    customerId: 'cust-3',
    eventId: 'event-123',
    phoneNumber: '+447700900003',
    partySize: 6,
    checkedIn: true,
    checkInTime: '19:15'
  }
];

// Active redemption codes
export const activeRedemptionCodes: RedemptionCode[] = [];

// Tier configuration
export const tierConfig = {
  member: {
    name: 'VIP Member',
    minEvents: 0,
    pointMultiplier: 1,
    color: '#9CA3AF',
    icon: '🌟'
  },
  bronze: {
    name: 'Bronze VIP',
    minEvents: 5,
    pointMultiplier: 2,
    color: '#92400E',
    icon: '🥉'
  },
  silver: {
    name: 'Silver VIP',
    minEvents: 10,
    pointMultiplier: 3,
    color: '#6B7280',
    icon: '🥈'
  },
  gold: {
    name: 'Gold VIP',
    minEvents: 20,
    pointMultiplier: 4,
    color: '#EAB308',
    icon: '🥇'
  },
  platinum: {
    name: 'Platinum VIP',
    minEvents: 40,
    pointMultiplier: 6,
    color: '#7C3AED',
    icon: '💎'
  }
};

// Helper functions
export function normalizePhoneNumber(phone: string): string {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle UK numbers
  if (cleaned.startsWith('44')) {
    cleaned = '+' + cleaned;
  } else if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  } else if (cleaned.length === 10 && cleaned.startsWith('7')) {
    cleaned = '+44' + cleaned;
  }
  
  return cleaned;
}

export function generateRedemptionCode(rewardId: string): string {
  const prefix = rewardId === 'reward-1' ? 'SNK' :
                rewardId === 'reward-2' ? 'DES' :
                rewardId === 'reward-3' ? 'DRK' :
                rewardId === 'reward-4' ? 'FRE' :
                rewardId === 'reward-5' ? 'BRG' :
                'GEN';
  
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}${random}`;
}

export function getPointsForEvent(tier: string, eventType: string): number {
  const basePoints = 50;
  const multiplier = tierConfig[tier as keyof typeof tierConfig].pointMultiplier;
  return basePoints * multiplier;
}

// Mock member achievements (Sarah has some unlocked)
export const memberAchievements: Record<string, string[]> = {
  '1': ['ach-1', 'ach-2', 'ach-3'], // Sarah
  '2': ['ach-5'], // Mike
  '3': ['ach-1', 'ach-2', 'ach-3', 'ach-4', 'ach-5'] // Emma
};