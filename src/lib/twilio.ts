import twilio from 'twilio';
import { retry, RetryConfigs } from './retry';
import { logger } from './logger';
import { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } from './env';

const accountSid = env.TWILIO_ACCOUNT_SID;
const authToken = env.TWILIO_AUTH_TOKEN;
const fromNumber = env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

export const twilioClient = twilio(accountSid, authToken);

export const sendSMS = async (to: string, body: string) => {
  try {
    // Build message parameters
    const messageParams: any = {
      body,
      to,
      statusCallback: TWILIO_STATUS_CALLBACK,
      statusCallbackMethod: TWILIO_STATUS_CALLBACK_METHOD,
    };

    // Use messaging service if configured, otherwise use from number
    if (messagingServiceSid) {
      messageParams.messagingServiceSid = messagingServiceSid;
    } else {
      messageParams.from = fromNumber;
    }

    // Send SMS with retry logic
    const message = await retry(
      async () => {
        return await twilioClient.messages.create(messageParams);
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