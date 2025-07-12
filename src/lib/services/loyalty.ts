/**
 * Loyalty Service Layer
 * 
 * This service provides all loyalty program operations.
 * Currently uses mock data, but structured to easily switch to database.
 */

import { 
  mockMembers, 
  mockBookings, 
  todaysEvent, 
  tierConfig, 
  achievements,
  memberAchievements,
  rewards,
  activeRedemptionCodes,
  normalizePhoneNumber,
  generateRedemptionCode,
  getPointsForEvent,
  type LoyaltyMember,
  type Achievement,
  type Reward,
  type RedemptionCode,
  type Booking
} from '@/lib/mock-data/loyalty-demo';
import { sendLoyaltySMS } from '@/lib/sms-templates/loyalty-templates';
import { LOYALTY_CONFIG } from '@/lib/config/loyalty';
import { LoyaltySettingsService } from '@/lib/config/loyalty-settings';

// In production, these would be database queries
// For now, we'll use in-memory storage

interface CheckInResult {
  success: boolean;
  member?: LoyaltyMember;
  pointsEarned?: number;
  newAchievements?: Achievement[];
  message?: string;
  error?: string;
}

interface RedemptionResult {
  success: boolean;
  reward?: Reward;
  member?: LoyaltyMember;
  error?: string;
}

export class LoyaltyService {
  /**
   * Check in a customer to an event
   */
  static async checkIn(phoneNumber: string, eventId: string): Promise<CheckInResult> {
    try {
      const normalized = normalizePhoneNumber(phoneNumber);
      
      // In production: Query database for member
      const member = mockMembers[normalized];
      const booking = mockBookings.find(b => b.phoneNumber === normalized && b.eventId === eventId);
      
      // Check if already checked in
      if (booking?.checkedIn) {
        return {
          success: false,
          error: 'Already checked in for this event'
        };
      }
      
      if (!member) {
        // Check if auto-enrollment is enabled
        if (LoyaltySettingsService.isAutoEnrollmentEnabled()) {
          const newMember = await this.enrollMember(phoneNumber);
          return {
            success: true,
            member: newMember,
            pointsEarned: LoyaltySettingsService.isPointsEarningEnabled() ? 50 : 0,
            message: 'Welcome to The Anchor VIP Club!'
          };
        } else {
          return {
            success: false,
            error: 'Not enrolled in VIP Club. Please ask staff to enroll you.'
          };
        }
      }
      
      // Calculate points based on operational status
      const basePoints = getPointsForEvent(member.tier, 'quiz'); // In production, get actual event type
      const pointsEarned = LoyaltySettingsService.isPointsEarningEnabled() ? basePoints : 0;
      
      // Update member points only if points earning is enabled
      if (LoyaltySettingsService.isPointsEarningEnabled()) {
        member.totalPoints += pointsEarned;
        member.availablePoints += pointsEarned;
        member.lifetimeEvents += 1;
        member.lastVisit = new Date().toISOString().split('T')[0];
      }
      
      // Check for tier upgrade
      const tierUpgrade = this.checkTierUpgrade(member);
      
      // Check for new achievements
      const newAchievements = this.checkAchievements(member);
      
      // Mark booking as checked in
      if (booking) {
        booking.checkedIn = true;
        booking.checkInTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      
      // Send SMS notification only if SMS is enabled
      if (LoyaltySettingsService.isSmsEnabled()) {
        if (tierUpgrade) {
          // Send tier upgrade notification
          await sendLoyaltySMS(phoneNumber, 'tierUpgrade', {
            customerName: member.customerName,
            newTier: tierUpgrade,
            tierIcon: LOYALTY_CONFIG.tiers[member.tier as keyof typeof LOYALTY_CONFIG.tiers].icon
          });
        } else if (pointsEarned > 0) {
          // Send regular check-in confirmation
          await sendLoyaltySMS(phoneNumber, 'checkInSuccess', {
            customerName: member.customerName,
            points: pointsEarned,
            eventName: todaysEvent.name,
            availablePoints: member.availablePoints
          });
        }
      }
      
      return {
        success: true,
        member,
        pointsEarned,
        newAchievements,
        message: tierUpgrade ? `Congratulations! You've been upgraded to ${tierUpgrade}!` : undefined
      };
    } catch (error) {
      console.error('Check-in error:', error);
      return {
        success: false,
        error: 'Failed to process check-in'
      };
    }
  }
  
  /**
   * Enroll a new member
   */
  static async enrollMember(phoneNumber: string, customerName?: string): Promise<LoyaltyMember> {
    const normalized = normalizePhoneNumber(phoneNumber);
    
    const newMember: LoyaltyMember = {
      id: `member-${Date.now()}`,
      customerId: `cust-${Date.now()}`,
      customerName: customerName || 'New Member', // Use provided name or default
      phoneNumber: normalized,
      tier: 'member',
      totalPoints: 50, // Welcome bonus
      availablePoints: 50,
      lifetimeEvents: 0,
      joinDate: new Date().toISOString().split('T')[0],
      lastVisit: new Date().toISOString().split('T')[0]
    };
    
    // In production: Insert into database
    mockMembers[normalized] = newMember;
    
    // Send welcome SMS
    await sendLoyaltySMS(phoneNumber, 'welcome', {
      customerName: newMember.customerName,
      points: newMember.totalPoints
    });
    
    return newMember;
  }
  
  /**
   * Get member by phone number
   */
  static async getMemberByPhone(phoneNumber: string): Promise<LoyaltyMember | null> {
    const normalized = normalizePhoneNumber(phoneNumber);
    // In production: Query database
    return mockMembers[normalized] || null;
  }
  
  /**
   * Generate a redemption code
   */
  static async generateRedemption(memberId: string, rewardId: string): Promise<RedemptionCode | null> {
    // In production: Use database transactions
    const member = Object.values(mockMembers).find(m => m.id === memberId);
    const reward = rewards.find(r => r.id === rewardId);
    
    if (!member || !reward) {
      return null;
    }
    
    // Check if member has enough points
    if (member.availablePoints < reward.pointsCost) {
      return null;
    }
    
    // Check if member meets tier requirement
    if (reward.tierRequired) {
      const memberTierLevel = Object.keys(tierConfig).indexOf(member.tier);
      const requiredTierLevel = Object.keys(tierConfig).indexOf(reward.tierRequired);
      if (memberTierLevel < requiredTierLevel) {
        return null;
      }
    }
    
    // Generate code
    const code = generateRedemptionCode(rewardId);
    const redemptionCode: RedemptionCode = {
      code,
      rewardId,
      memberId,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      used: false
    };
    
    // In production: Insert into database
    activeRedemptionCodes.push(redemptionCode);
    
    // Deduct points immediately
    member.availablePoints -= reward.pointsCost;
    
    // Send SMS with redemption code
    await sendLoyaltySMS(member.phoneNumber, 'redemptionSuccess', {
      customerName: member.customerName,
      redemptionCode: code,
      rewardName: reward.name
    });
    
    return redemptionCode;
  }
  
  /**
   * Validate and redeem a code
   */
  static async redeemCode(code: string): Promise<RedemptionResult> {
    // In production: Query database
    const redemptionCode = activeRedemptionCodes.find(
      rc => rc.code.toUpperCase() === code.toUpperCase()
    );
    
    if (!redemptionCode) {
      return {
        success: false,
        error: 'Invalid code'
      };
    }
    
    if (redemptionCode.used) {
      return {
        success: false,
        error: 'Code already used'
      };
    }
    
    const expiresAt = new Date(redemptionCode.expiresAt);
    if (expiresAt < new Date()) {
      return {
        success: false,
        error: 'Code expired'
      };
    }
    
    // Get reward and member details
    const reward = rewards.find(r => r.id === redemptionCode.rewardId);
    const member = Object.values(mockMembers).find(m => m.id === redemptionCode.memberId);
    
    if (!reward || !member) {
      return {
        success: false,
        error: 'Invalid redemption data'
      };
    }
    
    // Mark as used (in production: database update)
    redemptionCode.used = true;
    redemptionCode.usedAt = new Date().toISOString();
    
    return {
      success: true,
      reward,
      member
    };
  }
  
  /**
   * Check if member qualifies for tier upgrade
   */
  private static checkTierUpgrade(member: LoyaltyMember): string | null {
    const currentTierIndex = Object.keys(tierConfig).indexOf(member.tier);
    const tiers = Object.entries(tierConfig);
    
    for (let i = currentTierIndex + 1; i < tiers.length; i++) {
      const [tierKey, tierData] = tiers[i];
      if (member.lifetimeEvents >= tierData.minEvents) {
        // In production: Update database and send notification
        member.tier = tierKey as LoyaltyMember['tier'];
        return tierData.name;
      }
    }
    
    return null;
  }
  
  /**
   * Check for new achievements
   */
  private static checkAchievements(member: LoyaltyMember): Achievement[] {
    const currentAchievements = memberAchievements[member.id] || [];
    const newAchievements: Achievement[] = [];
    
    // In production: This would be a rules engine
    // For now, simple checks
    if (member.lifetimeEvents === 5 && !currentAchievements.includes('ach-1')) {
      const achievement = achievements.find(a => a.id === 'ach-1');
      if (achievement) {
        newAchievements.push(achievement);
        currentAchievements.push('ach-1');
        member.availablePoints += achievement.pointsValue;
      }
    }
    
    // Update member achievements (in production: database)
    if (newAchievements.length > 0) {
      memberAchievements[member.id] = currentAchievements;
    }
    
    return newAchievements;
  }
  
  
  /**
   * Get member statistics
   */
  static async getMemberStats(memberId: string) {
    const member = Object.values(mockMembers).find(m => m.id === memberId);
    if (!member) return null;
    
    const memberAchievementIds = memberAchievements[memberId] || [];
    const unlockedAchievements = achievements.filter(a => memberAchievementIds.includes(a.id));
    
    return {
      member,
      achievements: unlockedAchievements,
      nextTier: this.getNextTier(member.tier),
      availableRewards: this.getAvailableRewards(member),
      recentActivity: [] // In production: Query from database
    };
  }
  
  /**
   * Get next tier info
   */
  private static getNextTier(currentTier: LoyaltyMember['tier']) {
    const tiers = Object.keys(tierConfig);
    const currentIndex = tiers.indexOf(currentTier);
    
    if (currentIndex < tiers.length - 1) {
      const nextTierKey = tiers[currentIndex + 1];
      return {
        key: nextTierKey,
        ...tierConfig[nextTierKey as keyof typeof tierConfig]
      };
    }
    
    return null;
  }
  
  /**
   * Get available rewards for member
   */
  private static getAvailableRewards(member: LoyaltyMember): Reward[] {
    return rewards.filter(reward => {
      // Check points
      if (reward.pointsCost > member.availablePoints) {
        return false;
      }
      
      // Check tier requirement
      if (reward.tierRequired) {
        const memberTierLevel = Object.keys(tierConfig).indexOf(member.tier);
        const requiredTierLevel = Object.keys(tierConfig).indexOf(reward.tierRequired);
        if (memberTierLevel < requiredTierLevel) {
          return false;
        }
      }
      
      return true;
    });
  }
}