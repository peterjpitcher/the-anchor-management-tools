'use server';

import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import crypto from 'crypto';
import { sendOTPMessage } from './sms';
import { formatPhoneForStorage } from '@/lib/validation';

// OTP configuration
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const OTP_RATE_LIMIT_MINUTES = 1;

// Validation schemas
const RequestOTPSchema = z.object({
  phoneNumber: z.string().min(10, 'Invalid phone number')
});

const VerifyOTPSchema = z.object({
  phoneNumber: z.string().min(10, 'Invalid phone number'),
  otpCode: z.string().length(OTP_LENGTH, `OTP must be ${OTP_LENGTH} digits`)
});

// Generate a numeric OTP
function generateOTP(): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

// Request OTP for customer portal access
export async function requestLoyaltyOTP(data: z.infer<typeof RequestOTPSchema>) {
  try {
    const supabase = await createClient();
    
    // Validate input
    const validatedData = RequestOTPSchema.parse(data);
    
    // Format phone number
    let formattedPhone: string;
    try {
      formattedPhone = formatPhoneForStorage(validatedData.phoneNumber);
    } catch (error) {
      return { error: 'Invalid phone number format' };
    }
    
    // Check if customer exists and is a loyalty member
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select(`
        id,
        name,
        phone_number,
        sms_consent,
        loyalty_members!inner(
          id,
          status
        )
      `)
      .eq('phone_number', formattedPhone)
      .single();
    
    if (customerError || !customer) {
      return { error: 'No loyalty account found for this phone number' };
    }
    
    if (!customer.sms_consent) {
      return { error: 'SMS consent required for OTP verification' };
    }
    
    const loyaltyMember = customer.loyalty_members?.[0];
    if (!loyaltyMember || loyaltyMember.status !== 'active') {
      return { error: 'Loyalty membership is not active' };
    }
    
    // Check rate limiting - don't allow OTP requests too frequently
    const rateLimitTime = new Date();
    rateLimitTime.setMinutes(rateLimitTime.getMinutes() - OTP_RATE_LIMIT_MINUTES);
    
    const { data: recentOTP } = await supabase
      .from('loyalty_otp_verifications')
      .select('id')
      .eq('phone_number', formattedPhone)
      .gte('created_at', rateLimitTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (recentOTP) {
      return { error: `Please wait ${OTP_RATE_LIMIT_MINUTES} minute(s) before requesting another OTP` };
    }
    
    // Generate OTP
    const otpCode = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);
    
    // Store OTP
    const { error: otpError } = await supabase
      .from('loyalty_otp_verifications')
      .insert({
        phone_number: formattedPhone,
        customer_id: customer.id,
        member_id: loyaltyMember.id,
        otp_code: otpCode,
        expires_at: expiresAt.toISOString(),
        attempts: 0
      });
    
    if (otpError) {
      console.error('Failed to store OTP:', otpError);
      return { error: 'Failed to generate OTP' };
    }
    
    // Send OTP via SMS
    const message = `Your Anchor VIP verification code is: ${otpCode}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`;
    
    try {
      await sendOTPMessage({
        phoneNumber: formattedPhone,
        message,
        customerId: customer.id
      });
    } catch (smsError) {
      console.error('Failed to send OTP SMS:', smsError);
      // Clean up the OTP record
      await supabase
        .from('loyalty_otp_verifications')
        .delete()
        .eq('phone_number', formattedPhone)
        .eq('otp_code', otpCode);
      
      return { error: 'Failed to send verification code' };
    }
    
    return { 
      success: true,
      maskedPhone: formattedPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    };
  } catch (error) {
    console.error('OTP request error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Verify OTP and create session
export async function verifyLoyaltyOTP(data: z.infer<typeof VerifyOTPSchema>) {
  try {
    const supabase = await createClient();
    
    // Validate input
    const validatedData = VerifyOTPSchema.parse(data);
    
    // Format phone number
    let formattedPhone: string;
    try {
      formattedPhone = formatPhoneForStorage(validatedData.phoneNumber);
    } catch (error) {
      return { error: 'Invalid phone number format' };
    }
    
    // Get the most recent OTP for this phone number
    const { data: otpRecord, error: otpError } = await supabase
      .from('loyalty_otp_verifications')
      .select('*')
      .eq('phone_number', formattedPhone)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (otpError || !otpRecord) {
      return { error: 'No verification code found. Please request a new one.' };
    }
    
    // Check if OTP has expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      return { error: 'Verification code has expired. Please request a new one.' };
    }
    
    // Check attempts
    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      return { error: 'Too many attempts. Please request a new verification code.' };
    }
    
    // Verify OTP code
    if (otpRecord.otp_code !== validatedData.otpCode) {
      // Increment attempts
      await supabase
        .from('loyalty_otp_verifications')
        .update({ attempts: otpRecord.attempts + 1 })
        .eq('id', otpRecord.id);
      
      const remainingAttempts = MAX_OTP_ATTEMPTS - (otpRecord.attempts + 1);
      if (remainingAttempts > 0) {
        return { error: `Invalid code. ${remainingAttempts} attempts remaining.` };
      } else {
        return { error: 'Too many attempts. Please request a new verification code.' };
      }
    }
    
    // Mark OTP as verified
    const { error: updateError } = await supabase
      .from('loyalty_otp_verifications')
      .update({ 
        verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', otpRecord.id);
    
    if (updateError) {
      return { error: 'Failed to verify code' };
    }
    
    // Create a session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionExpiry = new Date();
    sessionExpiry.setHours(sessionExpiry.getHours() + 24); // 24 hour session
    
    const { error: sessionError } = await supabase
      .from('loyalty_portal_sessions')
      .insert({
        member_id: otpRecord.member_id,
        customer_id: otpRecord.customer_id,
        session_token: sessionToken,
        expires_at: sessionExpiry.toISOString()
      });
    
    if (sessionError) {
      console.error('Failed to create session:', sessionError);
      return { error: 'Failed to create session' };
    }
    
    return { 
      success: true,
      sessionToken,
      memberId: otpRecord.member_id,
      customerId: otpRecord.customer_id
    };
  } catch (error) {
    console.error('OTP verification error:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'An unexpected error occurred' };
  }
}

// Validate portal session
export async function validatePortalSession(sessionToken: string) {
  try {
    const supabase = await createClient();
    
    const { data: session, error } = await supabase
      .from('loyalty_portal_sessions')
      .select(`
        *,
        member:loyalty_members(
          *,
          customer:customers(*),
          tier:loyalty_tiers(*)
        )
      `)
      .eq('session_token', sessionToken)
      .eq('active', true)
      .single();
    
    if (error || !session) {
      return { error: 'Invalid or expired session' };
    }
    
    // Check if session has expired
    if (new Date(session.expires_at) < new Date()) {
      // Mark session as inactive
      await supabase
        .from('loyalty_portal_sessions')
        .update({ active: false })
        .eq('id', session.id);
      
      return { error: 'Session has expired' };
    }
    
    // Update last activity
    await supabase
      .from('loyalty_portal_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', session.id);
    
    return { 
      data: {
        session,
        member: session.member
      }
    };
  } catch (error) {
    console.error('Session validation error:', error);
    return { error: 'Failed to validate session' };
  }
}

// End portal session
export async function endPortalSession(sessionToken: string) {
  try {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('loyalty_portal_sessions')
      .update({ 
        active: false,
        ended_at: new Date().toISOString()
      })
      .eq('session_token', sessionToken);
    
    if (error) {
      return { error: 'Failed to end session' };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Session end error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Validate direct access token
export async function validateTokenAccess(token: string) {
  try {
    const supabase = await createClient();
    
    // Find member by access token
    const { data: member, error } = await supabase
      .from('loyalty_members')
      .select(`
        id,
        customer_id,
        available_points,
        total_points,
        lifetime_points,
        lifetime_events,
        status,
        tier:loyalty_tiers(
          id,
          name,
          level,
          icon
        ),
        customer:customers!inner(
          id,
          first_name,
          last_name,
          mobile_number
        )
      `)
      .eq('access_token', token)
      .eq('status', 'active')
      .single();
    
    if (error || !member) {
      return { error: 'Invalid or expired link' };
    }
    
    // Type assertion for the joined data
    const memberData = member as any;
    
    return { 
      success: true, 
      member: {
        id: memberData.id,
        customer_id: memberData.customer_id,
        name: `${memberData.customer.first_name} ${memberData.customer.last_name}`,
        phone_number: memberData.customer.mobile_number,
        available_points: memberData.available_points,
        total_points: memberData.total_points,
        lifetime_points: memberData.lifetime_points,
        lifetime_events: memberData.lifetime_events,
        tier: memberData.tier,
        status: memberData.status
      }
    };
  } catch (error) {
    console.error('Token validation error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
