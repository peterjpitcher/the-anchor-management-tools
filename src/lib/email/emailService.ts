import { isGraphConfigured } from '@/lib/microsoft-graph';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';

interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: EmailAttachment[];
}

interface EmailAttachment {
  name: string;
  content: Buffer | string;
  contentType: string;
}

/**
 * Send a general email using Microsoft Graph
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    if (!isGraphConfigured()) {
      return {
        success: false,
        error: 'Email service is not configured'
      };
    }

    const client = getGraphClient();
    const senderEmail = process.env.MICROSOFT_USER_EMAIL!;

    // Build recipients
    const toRecipients = [{ emailAddress: { address: options.to } }];
    const ccRecipients = options.cc?.map(email => ({ emailAddress: { address: email } })) || [];
    const bccRecipients = options.bcc?.map(email => ({ emailAddress: { address: email } })) || [];

    // Build attachments
    const attachments = options.attachments?.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentType: att.contentType,
      contentBytes: typeof att.content === 'string' 
        ? att.content 
        : att.content.toString('base64')
    })) || [];

    // Create email message
    const message: any = {
      subject: options.subject,
      body: {
        contentType: options.html ? 'HTML' : 'Text',
        content: options.html || options.text || ''
      },
      toRecipients
    };

    if (ccRecipients.length > 0) {
      message.ccRecipients = ccRecipients;
    }

    if (bccRecipients.length > 0) {
      message.bccRecipients = bccRecipients;
    }

    if (attachments.length > 0) {
      message.attachments = attachments;
    }

    // Send email
    const response = await client
      .api(`/users/${senderEmail}/sendMail`)
      .post({
        message,
        saveToSentItems: true
      });

    return {
      success: true,
      messageId: response?.id
    };
  } catch (error: any) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email'
    };
  }
}

/**
 * Send a simple text email
 */
export async function sendSimpleEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  return sendEmail({ to, subject, text: body });
}

/**
 * Helper to get the configured graph client
 */
function getGraphClient() {
  
  const credential = new ClientSecretCredential(
    process.env.MICROSOFT_TENANT_ID!,
    process.env.MICROSOFT_CLIENT_ID!,
    process.env.MICROSOFT_CLIENT_SECRET!
  );

  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token?.token || '';
      }
    }
  });

  return client;
}