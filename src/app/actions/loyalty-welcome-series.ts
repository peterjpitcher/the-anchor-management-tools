'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { sendEmail } from '@/lib/email/emailService';
import { JobQueue } from '@/lib/background-jobs';

// Validation schemas
const WelcomeSeriesSchema = z.object({
  member_id: z.string().uuid(),
  trigger: z.enum(['immediate', 'scheduled']).default('immediate')
});

const WelcomeTemplateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  content: z.string().min(1),
  delay_days: z.number().min(0),
  active: z.boolean().default(true)
});

// Define the welcome series emails
const WELCOME_SERIES_TEMPLATES = [
  {
    id: 'welcome_immediate',
    name: 'Welcome to VIP Club',
    subject: 'Welcome to The Anchor VIP Club! 🎉',
    delay_days: 0,
    template: 'welcome_immediate'
  },
  {
    id: 'welcome_day_3',
    name: 'How to Earn Points',
    subject: 'Start earning VIP points at The Anchor',
    delay_days: 3,
    template: 'welcome_day_3'
  },
  {
    id: 'welcome_week_1',
    name: 'First Week Benefits',
    subject: 'Your VIP benefits this week',
    delay_days: 7,
    template: 'welcome_week_1'
  },
  {
    id: 'welcome_week_2',
    name: 'Rewards Reminder',
    subject: 'Don\'t forget your VIP rewards!',
    delay_days: 14,
    template: 'welcome_week_2'
  },
  {
    id: 'welcome_month_1',
    name: 'Monthly Update',
    subject: 'Your first month as a VIP',
    delay_days: 30,
    template: 'welcome_month_1'
  }
];

// Start welcome series for a new member
export async function startWelcomeSeries(data: z.infer<typeof WelcomeSeriesSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage welcome series' };
    }
    
    const validatedData = WelcomeSeriesSchema.parse(data);
    
    // Get member details
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers!inner(
          id,
          name,
          email_address,
          phone_number
        ),
        tier:loyalty_tiers(
          name,
          benefits
        )
      `)
      .eq('id', validatedData.member_id)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    // Check if member has email
    const customer = Array.isArray(member.customer) ? member.customer[0] : member.customer;
    if (!customer?.email_address) {
      return { error: 'Member does not have an email address' };
    }
    
    // Check if welcome series already started
    const { data: existingSeries } = await supabase
      .from('loyalty_welcome_series')
      .select('id')
      .eq('member_id', validatedData.member_id)
      .single();
    
    if (existingSeries) {
      return { error: 'Welcome series already started for this member' };
    }
    
    // Create welcome series record
    const { data: series, error: seriesError } = await supabase
      .from('loyalty_welcome_series')
      .insert({
        member_id: validatedData.member_id,
        status: 'active',
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (seriesError || !series) {
      return { error: 'Failed to start welcome series' };
    }
    
    // Queue welcome emails
    const jobQueue = JobQueue.getInstance();
    const emailJobs = [];
    
    for (const template of WELCOME_SERIES_TEMPLATES) {
      const scheduledFor = new Date();
      scheduledFor.setDate(scheduledFor.getDate() + template.delay_days);
      
      const jobData = {
        series_id: series.id,
        member_id: validatedData.member_id,
        customer_id: customer.id,
        template_id: template.id,
        template_name: template.template,
        customer_name: customer.name,
        customer_email: customer.email_address,
        tier_name: member.tier?.name || 'Member',
        current_points: member.points_balance
      };
      
      const jobId = await jobQueue.enqueue(
        'send_welcome_email',
        jobData,
        {
          delay: template.delay_days === 0 ? 0 : scheduledFor.getTime() - Date.now(),
          priority: template.delay_days === 0 ? 1 : 5
        }
      );
      
      emailJobs.push({
        job_id: jobId,
        template_id: template.id,
        scheduled_for: scheduledFor.toISOString()
      });
    }
    
    // Update series with job IDs
    await supabase
      .from('loyalty_welcome_series')
      .update({
        email_jobs: emailJobs
      })
      .eq('id', series.id);
    
    // Send immediate welcome SMS if phone number exists
    if (customer.phone_number) {
      await jobQueue.enqueue('send_sms', {
        to: customer.phone_number,
        message: `Welcome to The Anchor VIP Club! You've earned ${member.welcome_bonus_awarded || 50} bonus points. Show this message to claim your welcome drink! 🍻`
      });
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_welcome_series',
      resource_id: series.id,
      operation_status: 'success',
      new_values: {
        member_id: validatedData.member_id,
        email_count: WELCOME_SERIES_TEMPLATES.length,
        has_phone: !!customer.phone_number
      }
    });
    
    return { 
      success: true, 
      data: {
        series_id: series.id,
        emails_scheduled: emailJobs.length,
        sms_sent: !!customer.phone_number
      }
    };
  } catch (error) {
    console.error('Error starting welcome series:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to start welcome series' };
  }
}

// Get welcome email content
export function getWelcomeEmailContent(template: string, data: any): { subject: string; html: string; text: string } {
  switch (template) {
    case 'welcome_immediate':
      return generateWelcomeEmail(data);
    case 'welcome_day_3':
      return generatePointsGuideEmail(data);
    case 'welcome_week_1':
      return generateFirstWeekEmail(data);
    case 'welcome_week_2':
      return generateRewardsReminderEmail(data);
    case 'welcome_month_1':
      return generateMonthlyUpdateEmail(data);
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

// Email template generators
function generateWelcomeEmail(data: any) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to The Anchor VIP Club</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 32px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #f59e0b; font-size: 32px; margin: 0;">Welcome to The Anchor VIP Club!</h1>
          </div>
          
          <p style="color: #1a1a1a; font-size: 16px; line-height: 1.5;">
            Hi ${data.customer_name},
          </p>
          
          <p style="color: #1a1a1a; font-size: 16px; line-height: 1.5;">
            Welcome to our exclusive VIP program! As a ${data.tier_name} member, you're now part of an elite group that enjoys special perks and rewards at The Anchor.
          </p>
          
          <div style="background-color: #fef3c7; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h2 style="color: #92400e; font-size: 20px; margin: 0 0 12px 0;">Your Welcome Bonus</h2>
            <p style="color: #92400e; font-size: 24px; font-weight: bold; margin: 0;">
              ${data.current_points} points
            </p>
            <p style="color: #92400e; font-size: 14px; margin: 8px 0 0 0;">
              Ready to use on your next visit!
            </p>
          </div>
          
          <h3 style="color: #1a1a1a; font-size: 18px; margin-top: 32px;">What can you do with your points?</h3>
          <ul style="color: #4b5563; font-size: 16px; line-height: 1.8;">
            <li>Free drinks starting at 100 points</li>
            <li>Appetizers and snacks from 150 points</li>
            <li>Main courses from 300 points</li>
            <li>Exclusive member-only specials</li>
          </ul>
          
          <h3 style="color: #1a1a1a; font-size: 18px; margin-top: 32px;">How to earn more points:</h3>
          <ul style="color: #4b5563; font-size: 16px; line-height: 1.8;">
            <li>Check in at every visit (10 points)</li>
            <li>Book tables in advance (5 points)</li>
            <li>Attend special events (bonus points)</li>
            <li>Refer friends to join (50 points each)</li>
          </ul>
          
          <div style="text-align: center; margin-top: 32px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal" 
               style="display: inline-block; background-color: #f59e0b; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">
              View Your VIP Dashboard
            </a>
          </div>
          
          <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
          
          <p style="color: #6b7280; font-size: 14px; text-align: center;">
            The Anchor - Your Local VIP Experience<br>
            Questions? Reply to this email or visit us at the bar.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `
Welcome to The Anchor VIP Club!

Hi ${data.customer_name},

Welcome to our exclusive VIP program! As a ${data.tier_name} member, you're now part of an elite group that enjoys special perks and rewards at The Anchor.

YOUR WELCOME BONUS: ${data.current_points} points
Ready to use on your next visit!

What can you do with your points?
- Free drinks starting at 100 points
- Appetizers and snacks from 150 points  
- Main courses from 300 points
- Exclusive member-only specials

How to earn more points:
- Check in at every visit (10 points)
- Book tables in advance (5 points)
- Attend special events (bonus points)
- Refer friends to join (50 points each)

View your VIP dashboard: ${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal

The Anchor - Your Local VIP Experience
Questions? Reply to this email or visit us at the bar.
  `;
  
  return {
    subject: 'Welcome to The Anchor VIP Club! 🎉',
    html,
    text
  };
}

function generatePointsGuideEmail(data: any) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your VIP Points Guide</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 32px;">
          <h1 style="color: #1a1a1a; font-size: 28px; margin: 0 0 24px 0;">Your Guide to Earning VIP Points</h1>
          
          <p style="color: #1a1a1a; font-size: 16px; line-height: 1.5;">
            Hi ${data.customer_name},
          </p>
          
          <p style="color: #1a1a1a; font-size: 16px; line-height: 1.5;">
            Ready to make the most of your VIP membership? Here's everything you need to know about earning and spending points at The Anchor.
          </p>
          
          <div style="background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px 0;">🎯 Quick Wins</h2>
            <ul style="color: #4b5563; font-size: 16px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li><strong>Check-in bonus:</strong> 10 points every visit</li>
              <li><strong>Happy Hour:</strong> Double points (5-7 PM)</li>
              <li><strong>Weekend Special:</strong> Triple points on Sundays</li>
            </ul>
          </div>
          
          <h3 style="color: #1a1a1a; font-size: 18px; margin-top: 32px;">📱 How to Check In</h3>
          <ol style="color: #4b5563; font-size: 16px; line-height: 1.8;">
            <li>Look for QR codes at the entrance or on tables</li>
            <li>Scan with your phone camera</li>
            <li>Enter your mobile number</li>
            <li>Points credited instantly!</li>
          </ol>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal" 
               style="display: inline-block; background-color: #f59e0b; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">
              Check Your Points Balance
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
            Pro tip: Set a reminder to visit during happy hour for maximum points!
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `Your Guide to Earning VIP Points

Hi ${data.customer_name},

Ready to make the most of your VIP membership? Here's everything you need to know about earning and spending points at The Anchor.

QUICK WINS:
- Check-in bonus: 10 points every visit
- Happy Hour: Double points (5-7 PM)
- Weekend Special: Triple points on Sundays

HOW TO CHECK IN:
1. Look for QR codes at the entrance or on tables
2. Scan with your phone camera
3. Enter your mobile number
4. Points credited instantly!

Check your points balance: ${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal

Pro tip: Set a reminder to visit during happy hour for maximum points!

The Anchor VIP Club`;
  
  return {
    subject: 'Start earning VIP points at The Anchor',
    html,
    text
  };
}

function generateFirstWeekEmail(data: any) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your First Week VIP Benefits</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 32px;">
          <h1 style="color: #1a1a1a; font-size: 28px; margin: 0 0 24px 0;">Your First Week as a VIP</h1>
          
          <p style="color: #1a1a1a; font-size: 16px; line-height: 1.5;">
            Congratulations ${data.customer_name}! You've been a VIP member for a week now.
          </p>
          
          <div style="background-color: #dbeafe; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h2 style="color: #1e40af; font-size: 20px; margin: 0 0 12px 0;">This Week's Special Offer</h2>
            <p style="color: #1e40af; font-size: 16px; margin: 0;">
              <strong>20% bonus points</strong> on all food orders this weekend!<br>
              Valid Friday to Sunday only.
            </p>
          </div>
          
          <h3 style="color: #1a1a1a; font-size: 18px; margin-top: 32px;">Don't Miss Out!</h3>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            As a ${data.tier_name} member, you have access to exclusive rewards. Have you checked what's available?
          </p>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal" 
               style="display: inline-block; background-color: #f59e0b; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">
              Browse Rewards
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `Your First Week as a VIP

Congratulations ${data.customer_name}! You've been a VIP member for a week now.

THIS WEEK'S SPECIAL OFFER:
20% bonus points on all food orders this weekend!
Valid Friday to Sunday only.

Don't Miss Out!
As a ${data.tier_name} member, you have access to exclusive rewards. Have you checked what's available?

Browse rewards: ${process.env.NEXT_PUBLIC_APP_URL}/loyalty/portal

The Anchor VIP Club`;
  
  return {
    subject: 'Your VIP benefits this week',
    html,
    text
  };
}

function generateRewardsReminderEmail(data: any) {
  return {
    subject: 'Don\'t forget your VIP rewards!',
    html: `<p>Reminder about available rewards...</p>`,
    text: 'Reminder about available rewards...'
  };
}

function generateMonthlyUpdateEmail(data: any) {
  return {
    subject: 'Your first month as a VIP',
    html: `<p>Monthly update...</p>`,
    text: 'Monthly update...'
  };
}

// Process welcome email job (called by background job processor)
export async function processWelcomeEmailJob(jobData: any) {
  try {
    const { template_name, customer_email, ...emailData } = jobData;
    
    // Get email content
    const { subject, html, text } = getWelcomeEmailContent(template_name, emailData);
    
    // Send email
    const result = await sendEmail({
      to: customer_email,
      subject,
      html,
      text
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to send email');
    }
    
    // Update welcome series tracking
    const supabase = await createClient();
    await supabase
      .from('loyalty_welcome_series')
      .update({
        last_email_sent_at: new Date().toISOString()
      })
      .eq('id', jobData.series_id);
    
    return { success: true };
  } catch (error) {
    console.error('Error processing welcome email job:', error);
    throw error;
  }
}