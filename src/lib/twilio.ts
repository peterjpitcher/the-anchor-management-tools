import twilio from 'twilio';
import { checkRateLimit } from './upstash-rate-limit';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

export const twilioClient = twilio(accountSid, authToken);

export const sendSMS = async (to: string, body: string) => {
  try {
    // Check rate limit for SMS sending (per phone number)
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const rateLimitResult = await checkRateLimit(to, 'sms');
      if (!rateLimitResult.success) {
        logger.warn(`Rate limit exceeded for ${to}`, {
          metadata: { remaining: rateLimitResult.remaining }
        });
        return { 
          success: false, 
          error: `Rate limit exceeded. Try again at ${rateLimitResult.reset.toLocaleTimeString()}` 
        };
      }
    }

    // Send SMS with retry logic
    const message = await retry(
      async () => {
        return await twilioClient.messages.create({
          body,
          to,
          from: fromNumber,
        });
      },
      {
        ...RetryConfigs.sms,
        onRetry: (error, attempt) => {
          logger.warn(`SMS send retry attempt ${attempt}`, {
            error,
            metadata: { to, bodyLength: body.length }
          });
        }
      }
    );
    
    logger.info('SMS sent successfully', {
      metadata: { 
        to, 
        messageSid: message.sid,
        segments: Math.ceil(body.length / 160)
      }
    });
    
    return { success: true, sid: message.sid };
  } catch (error: any) {
    logger.error('Failed to send SMS after retries', {
      error,
      metadata: { to, errorCode: error.code }
    });
    
    // Provide user-friendly error messages
    let userMessage = 'Failed to send message';
    if (error.code === 21211) {
      userMessage = 'Invalid phone number format';
    } else if (error.code === 21610) {
      userMessage = 'This number has opted out of messages';
    } else if (error.code === 20429) {
      userMessage = 'Too many messages sent. Please try again later';
    }
    
    return { success: false, error: userMessage };
  }
}; 