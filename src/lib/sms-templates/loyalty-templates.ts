// Loyalty Program SMS Templates

import { LOYALTY_CONFIG } from '../config/loyalty';

export interface LoyaltySMSTemplateData {
  customerName?: string;
  points?: number;
  tier?: string;
  tierIcon?: string;
  eventName?: string;
  rewardName?: string;
  redemptionCode?: string;
  newTier?: string;
  nextTierName?: string;
  pointsToNextTier?: number;
  availablePoints?: number;
}

export const loyaltySMSTemplates = {
  // Welcome message when customer joins
  welcome: (data: LoyaltySMSTemplateData) => 
    `Welcome to The Anchor VIP Club, ${data.customerName}! 🎉 You've earned ${data.points} bonus points for joining. Start earning rewards with every visit! Reply STOP to opt out.`,

  // Check-in confirmation
  checkInSuccess: (data: LoyaltySMSTemplateData) => 
    `Thanks for checking in at ${data.eventName}! You've earned ${data.points} VIP points. Your balance: ${data.availablePoints} points. Keep earning for exclusive rewards! 🌟`,

  // Tier upgrade notification
  tierUpgrade: (data: LoyaltySMSTemplateData) => 
    `Congratulations! You've been upgraded to ${data.newTier} ${data.tierIcon}! Enjoy your new benefits and keep earning for even more rewards. Well done! 🎊`,

  // Points balance reminder
  pointsReminder: (data: LoyaltySMSTemplateData) => 
    `Hi ${data.customerName}! You have ${data.availablePoints} VIP points available. Visit us soon to redeem rewards or keep earning! Only ${data.pointsToNextTier} points to ${data.nextTierName}. 💫`,

  // Reward redemption confirmation
  redemptionSuccess: (data: LoyaltySMSTemplateData) => 
    `Your reward is ready! Show code ${data.redemptionCode} to staff to claim your ${data.rewardName}. Valid for 24 hours. Enjoy! 🎁`,

  // Achievement unlocked
  achievementUnlocked: (data: LoyaltySMSTemplateData) => 
    `Achievement unlocked! 🏆 You've earned ${data.points} bonus points. Your new balance: ${data.availablePoints} points. Keep up the great attendance!`,

  // Inactivity reminder
  inactivityReminder: (data: LoyaltySMSTemplateData) => 
    `We miss you at The Anchor! You still have ${data.availablePoints} VIP points waiting. Visit us soon and continue earning rewards! 🍺`,

  // Special offer for VIP members
  vipOffer: (data: LoyaltySMSTemplateData) => 
    `Exclusive VIP offer! As a ${data.tier} member, enjoy double points this weekend. Don't miss out on earning rewards faster! See you soon 🌟`,
};

// Function to send loyalty SMS
export async function sendLoyaltySMS(
  phoneNumber: string, 
  template: keyof typeof loyaltySMSTemplates, 
  data: LoyaltySMSTemplateData
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the message template
    const messageTemplate = loyaltySMSTemplates[template];
    if (!messageTemplate) {
      return { success: false, error: 'Invalid template' };
    }

    const message = messageTemplate(data);

    // In production, this would integrate with the existing SMS system
    // For now, we'll just log it
    console.log('Loyalty SMS:', {
      to: phoneNumber,
      template,
      message,
      data
    });

    // TODO: Integrate with actual SMS sending via jobs table
    // const { error } = await supabase
    //   .from('jobs')
    //   .insert({
    //     type: 'send_sms',
    //     payload: {
    //       to: phoneNumber,
    //       message,
    //       metadata: {
    //         type: 'loyalty',
    //         template,
    //         ...data
    //       }
    //     }
    //   });

    return { success: true };
  } catch (error) {
    console.error('Error sending loyalty SMS:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to send SMS' 
    };
  }
}

// Batch send loyalty SMS to multiple members
export async function sendBulkLoyaltySMS(
  members: Array<{ phoneNumber: string; data: LoyaltySMSTemplateData }>,
  template: keyof typeof loyaltySMSTemplates
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of members) {
    const result = await sendLoyaltySMS(member.phoneNumber, template, member.data);
    if (result.success) {
      sent++;
    } else {
      failed++;
      if (result.error) {
        errors.push(`${member.phoneNumber}: ${result.error}`);
      }
    }
  }

  return { sent, failed, errors };
}