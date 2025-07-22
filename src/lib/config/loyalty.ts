/**
 * Loyalty Program Configuration
 * 
 * This file contains all configurable aspects of the loyalty program.
 * Edit these values to adjust points, rewards, tiers, and achievements.
 */

export const LOYALTY_CONFIG = {
  // Program name and branding
  program: {
    name: 'The Anchor VIP Club',
    welcomeBonus: 50,
    pointsName: 'points', // Could be 'anchors', 'coins', etc.
    currency: '£'
  },

  // Points earning configuration
  points: {
    // Base points for attendance
    baseAttendance: 50,
    
    // Event type multipliers
    eventMultipliers: {
      quiz: 1,
      bingo: 1,
      karaoke: 1.2,
      gameshow: 1,
      drag: 1.5,
      tasting: 2,
      special: 2
    },
    
    // Bonus opportunities
    bonuses: {
      firstVisitOfMonth: 50,
      birthdayMonth: 2, // Multiplier
      bringNewMember: 100,
      weatherWarrior: 3, // Bad weather multiplier
      offPeak: 1.5, // Mon-Wed multiplier
      earlyBird: 25, // First 10 check-ins
      milestone: {
        '10': 100,  // 10th visit
        '25': 250,  // 25th visit
        '50': 500,  // 50th visit
        '100': 1000 // 100th visit
      }
    }
  },

  // Tier configuration
  tiers: {
    member: {
      name: 'VIP Member',
      minEvents: 0,
      pointMultiplier: 1,
      color: '#9CA3AF',
      icon: '🌟',
      benefits: [
        'Welcome bonus points',
        'SMS event alerts',
        'Birthday month recognition',
        'Access to loyalty portal'
      ]
    },
    bronze: {
      name: 'Bronze VIP',
      minEvents: 5,
      pointMultiplier: 2,
      color: '#92400E',
      icon: '🥉',
      benefits: [
        'All Member benefits',
        'Double points on all visits',
        'Early access booking (24 hours)',
        '10% off ticketed events',
        'Monthly bonus challenges'
      ]
    },
    silver: {
      name: 'Silver VIP',
      minEvents: 10,
      pointMultiplier: 3,
      color: '#6B7280',
      icon: '🥈',
      benefits: [
        'All Bronze benefits',
        'Triple points on all visits',
        'Bring-a-friend bonus points',
        '15% off ticketed events',
        'Exclusive Silver-only events',
        'Skip-the-queue privileges'
      ]
    },
    gold: {
      name: 'Gold VIP',
      minEvents: 20,
      pointMultiplier: 4,
      color: '#EAB308',
      icon: '🥇',
      benefits: [
        'All Silver benefits',
        '4x points on all visits',
        'Complimentary welcome drink each visit',
        '20% off ticketed events',
        'Influence on event planning',
        'Reserved Gold table option'
      ]
    },
    platinum: {
      name: 'Platinum VIP',
      minEvents: 40,
      pointMultiplier: 6,
      color: '#7C3AED',
      icon: '💎',
      benefits: [
        'All Gold benefits',
        '6x points on all visits',
        'Free plus-one to all events',
        'Lifetime membership status',
        'Custom achievement creation',
        'Wall of Fame recognition'
      ]
    }
  },

  // Rewards catalog
  rewards: {
    snacks: {
      house_snack: {
        key: 'reward-snack-1',
        name: 'House Snack',
        description: 'Any starter or bar snack',
        pointsCost: 300,
        icon: '🍿',
        category: 'food'
      },
      premium_snack: {
        key: 'reward-snack-2',
        name: 'Premium Snack',
        description: 'Premium starter or sharing platter',
        pointsCost: 500,
        icon: '🍤',
        category: 'food'
      }
    },
    drinks: {
      house_drink: {
        key: 'reward-drink-1',
        name: 'House Drink',
        description: 'Any house beer, wine or soft drink',
        pointsCost: 400,
        icon: '🍺',
        category: 'drink'
      },
      premium_drink: {
        key: 'reward-drink-2',
        name: 'Premium Drink',
        description: 'Any premium or cocktail',
        pointsCost: 600,
        tierRequired: 'bronze',
        icon: '🍸',
        category: 'drink'
      },
      bottle_wine: {
        key: 'reward-drink-3',
        name: 'Bottle of House Wine',
        description: 'Red, white or rosé',
        pointsCost: 1200,
        tierRequired: 'silver',
        icon: '🍷',
        category: 'drink'
      }
    },
    desserts: {
      any_dessert: {
        key: 'reward-dessert-1',
        name: 'Any Dessert',
        description: 'Choose from our dessert menu',
        pointsCost: 400,
        icon: '🍰',
        category: 'food'
      }
    },
    experiences: {
      bring_friend: {
        key: 'reward-exp-1',
        name: 'Bring a Friend Free',
        description: 'Free entry for you and a guest',
        pointsCost: 750,
        tierRequired: 'silver',
        icon: '👥',
        category: 'experience'
      },
      reserved_table: {
        key: 'reward-exp-2',
        name: 'Reserved Table',
        description: 'Guaranteed table for your party',
        pointsCost: 500,
        tierRequired: 'bronze',
        icon: '🪑',
        category: 'experience'
      },
      birthday_package: {
        key: 'reward-exp-3',
        name: 'Birthday Package',
        description: 'Cake, decorations & welcome drink',
        pointsCost: 2000,
        tierRequired: 'gold',
        icon: '🎂',
        category: 'experience'
      }
    },
    credit: {
      credit_5: {
        key: 'reward-credit-1',
        name: '£5 Credit',
        description: 'Applied to your bill',
        pointsCost: 500,
        icon: '💷',
        category: 'credit'
      },
      credit_10: {
        key: 'reward-credit-2',
        name: '£10 Credit',
        description: 'Applied to your bill',
        pointsCost: 1000,
        tierRequired: 'silver',
        icon: '💷',
        category: 'credit'
      },
      credit_25: {
        key: 'reward-credit-3',
        name: '£25 Credit',
        description: 'Applied to your bill',
        pointsCost: 2500,
        tierRequired: 'gold',
        icon: '💷',
        category: 'credit'
      }
    },
    special: {
      host_event: {
        key: 'reward-special-1',
        name: 'Host Your Own Theme Night',
        description: 'Work with us to create your event',
        pointsCost: 5000,
        tierRequired: 'platinum',
        icon: '🎉',
        category: 'special'
      },
      private_party: {
        key: 'reward-special-2',
        name: 'Private Area for 2 Hours',
        description: 'Reserve our function space',
        pointsCost: 3000,
        tierRequired: 'gold',
        icon: '🏛️',
        category: 'special'
      }
    }
  },

  // Achievement definitions
  achievements: {
    attendance: [
      {
        key: 'ach-first-timer',
        name: 'First Timer',
        description: 'Attend your first event',
        icon: '🎯',
        pointsValue: 25,
        criteria: { type: 'attendance_count', value: 1 }
      },
      {
        key: 'ach-regular',
        name: 'The Regular',
        description: 'Attend 10 events',
        icon: '📅',
        pointsValue: 100,
        criteria: { type: 'attendance_count', value: 10 }
      },
      {
        key: 'ach-superfan',
        name: 'Super Fan',
        description: 'Attend 50 total events',
        icon: '🌟',
        pointsValue: 500,
        criteria: { type: 'attendance_count', value: 50 }
      },
      {
        key: 'ach-centurion',
        name: 'Centurion',
        description: 'Attend 100 events',
        icon: '💯',
        pointsValue: 1000,
        criteria: { type: 'attendance_count', value: 100 }
      }
    ],
    streaks: [
      {
        key: 'ach-week-warrior',
        name: 'Week Warrior',
        description: 'Attend 4 events in one month',
        icon: '🗓️',
        pointsValue: 100,
        criteria: { type: 'monthly_attendance', value: 4 }
      },
      {
        key: 'ach-hot-streak',
        name: 'Hot Streak',
        description: '3 months consecutive attendance',
        icon: '🔥',
        pointsValue: 150,
        criteria: { type: 'consecutive_months', value: 3 }
      },
      {
        key: 'ach-loyal-year',
        name: 'Year of Loyalty',
        description: 'Attend at least once every month for a year',
        icon: '🏆',
        pointsValue: 500,
        criteria: { type: 'consecutive_months', value: 12 }
      }
    ],
    eventTypes: [
      {
        key: 'ach-quiz-master',
        name: 'Quiz Master',
        description: 'Attend 5 quiz nights',
        icon: '🧠',
        pointsValue: 100,
        criteria: { type: 'event_type_count', eventType: 'quiz', value: 5 }
      },
      {
        key: 'ach-bingo-regular',
        name: 'Bingo Regular',
        description: 'Attend 5 bingo nights',
        icon: '🎱',
        pointsValue: 100,
        criteria: { type: 'event_type_count', eventType: 'bingo', value: 5 }
      },
      {
        key: 'ach-karaoke-star',
        name: 'Karaoke Star',
        description: 'Perform at karaoke 3 times',
        icon: '🎤',
        pointsValue: 75,
        criteria: { type: 'event_type_count', eventType: 'karaoke', value: 3 }
      },
      {
        key: 'ach-drag-enthusiast',
        name: 'Drag Enthusiast',
        description: 'Attend 3 drag shows',
        icon: '👑',
        pointsValue: 100,
        criteria: { type: 'event_type_count', eventType: 'drag', value: 3 }
      },
      {
        key: 'ach-event-explorer',
        name: 'Event Explorer',
        description: 'Try 5 different event types',
        icon: '🎯',
        pointsValue: 150,
        criteria: { type: 'unique_event_types', value: 5 }
      }
    ],
    social: [
      {
        key: 'ach-social-butterfly',
        name: 'Social Butterfly',
        description: 'Bring 5 different friends',
        icon: '👥',
        pointsValue: 200,
        criteria: { type: 'unique_guests', value: 5 }
      },
      {
        key: 'ach-party-starter',
        name: 'Party Starter',
        description: 'Check in within first 30 minutes of 10 events',
        icon: '🎉',
        pointsValue: 100,
        criteria: { type: 'early_arrival_count', value: 10 }
      },
      {
        key: 'ach-influencer',
        name: 'The Influencer',
        description: 'Refer 3 new members who attend',
        icon: '📢',
        pointsValue: 300,
        criteria: { type: 'referrals', value: 3 }
      }
    ],
    seasonal: [
      {
        key: 'ach-halloween-hero',
        name: 'Halloween Hero',
        description: 'Attend in costume on Halloween',
        icon: '🎃',
        pointsValue: 50,
        criteria: { type: 'seasonal_event', value: 'halloween' }
      },
      {
        key: 'ach-festive-spirit',
        name: 'Festive Spirit',
        description: 'Attend 3 December events',
        icon: '🎄',
        pointsValue: 100,
        criteria: { type: 'monthly_attendance', month: 12, value: 3 }
      },
      {
        key: 'ach-summer-sensation',
        name: 'Summer Sensation',
        description: 'Attend 5 summer events',
        icon: '☀️',
        pointsValue: 100,
        criteria: { type: 'seasonal_attendance', season: 'summer', value: 5 }
      },
      {
        key: 'ach-birthday-celebrant',
        name: 'Birthday Celebrant',
        description: 'Attend on your birthday',
        icon: '🎂',
        pointsValue: 100,
        criteria: { type: 'birthday_attendance' }
      }
    ]
  },

  // Redemption settings
  redemption: {
    codeExpiryMinutes: 5,
    codeFormat: {
      prefixes: {
        food: 'FUD',
        drink: 'DRK',
        dessert: 'DES',
        experience: 'EXP',
        credit: 'CRD',
        special: 'SPL'
      },
      length: 7 // e.g., DRK1234
    },
    dailyLimits: {
      perMember: 3,
      perReward: 10
    }
  },

  // SMS message templates
  messages: {
    welcome: 'Welcome to {program_name}! You\'ve earned {points} points. Visit {portal_url} to view your rewards.',
    checkIn: 'Thanks for visiting {venue}! You\'ve earned {points} points. Total: {total_points}',
    tierUpgrade: '🎉 Congratulations! You\'ve been upgraded to {tier_name}! Enjoy your new benefits.',
    achievementUnlocked: '🏆 Achievement unlocked: {achievement_name}! You\'ve earned {points} bonus points.',
    birthdayReminder: '🎂 Happy Birthday Month! Visit us this month for double points on all visits!',
    redemptionCode: 'Your redemption code is {code}. Show this to staff within {expiry} minutes.',
    pointsExpiring: 'You have {points} points expiring on {date}. Visit {portal_url} to redeem rewards!',
    winBack: 'We miss you at {venue}! It\'s been {days} days. Come back for bonus points: {bonus}'
  },

  // Business rules
  rules: {
    pointsExpiry: {
      enabled: false,
      months: 12
    },
    minimumRedemption: 100,
    allowPartialRedemption: true,
    requirePhysicalPresence: true,
    autoEnrollOnBooking: true,
    allowSelfEnrollment: true
  }
};

// Helper function to get all rewards as a flat array
export function getAllRewards() {
  const rewards: any[] = [];
  Object.values(LOYALTY_CONFIG.rewards).forEach(category => {
    Object.values(category).forEach(reward => {
      rewards.push(reward);
    });
  });
  return rewards;
}

// Helper function to get all achievements as a flat array
export function getAllAchievements() {
  const achievements: any[] = [];
  Object.values(LOYALTY_CONFIG.achievements).forEach(category => {
    category.forEach(achievement => {
      achievements.push(achievement);
    });
  });
  return achievements;
}