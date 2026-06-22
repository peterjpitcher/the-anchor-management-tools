import { isGraphConfigured } from '@/lib/microsoft-graph';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { getErrorMessage } from '@/lib/errors';
import { Resend } from 'resend';
import { isEmailSuppressed, recordEmailMessage } from '@/lib/email/logging';

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: EmailAttachment[];
  provider?: EmailProvider;
  from?: string;
  graphSender?: string;
  replyTo?: string;
  commType?: string;
  customerId?: string | null;
  requireLog?: boolean;
  metadata?: Record<string, unknown>;
  tableBookingId?: string | null;
  eventBookingId?: string | null;
  privateBookingId?: string | null;
  parkingBookingId?: string | null;
  invoiceId?: string | null;
  quoteId?: string | null;
}

export interface EmailAttachment {
  name: string;
  content: Buffer | string;
  contentType: string;
}

export type EmailProvider = 'graph' | 'resend';
type EmailSendResult = { success: boolean; error?: string; messageId?: string };

let cachedResendClient: Resend | null = null;

function getEmailProvider(): EmailProvider {
  const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (configuredProvider === 'graph' || configuredProvider === 'resend') {
    return configuredProvider;
  }

  return process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS ? 'resend' : 'graph';
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!cachedResendClient) {
    cachedResendClient = new Resend(apiKey);
  }

  return cachedResendClient;
}

async function recordEmailOutcome(
  options: EmailOptions,
  input: {
    status: 'sent' | 'failed' | 'suppressed'
    fromAddress?: string | null
    messageId?: string | null
    error?: string | null
  }
) {
  const attachments = options.attachments?.map(att => ({
    filename: att.name,
    content_type: att.contentType,
    size: typeof att.content === 'string' ? Buffer.byteLength(att.content) : att.content.byteLength,
  })) ?? null

  const rowId = await recordEmailMessage({
    customerId: options.customerId ?? null,
    toAddress: options.to,
    fromAddress: input.fromAddress ?? null,
    commType: options.commType ?? null,
    subject: options.subject,
    bodyText: options.text ?? null,
    bodyHtml: options.html ?? null,
    attachments,
    resendMessageId: input.messageId ?? null,
    status: input.status,
    error: input.error ?? null,
    metadata: options.metadata ?? null,
    tableBookingId: options.tableBookingId ?? null,
    eventBookingId: options.eventBookingId ?? null,
    privateBookingId: options.privateBookingId ?? null,
    parkingBookingId: options.parkingBookingId ?? null,
    invoiceId: options.invoiceId ?? null,
    quoteId: options.quoteId ?? null,
  });

  if (options.requireLog === true && !rowId) {
    throw new Error('Email sent state could not be logged')
  }

  return rowId
}

/**
 * Send a general email using the configured provider.
 */
export async function sendEmail(options: EmailOptions): Promise<EmailSendResult> {
  if (await isEmailSuppressed(options.to)) {
    const error = 'Recipient email address is suppressed';
    try {
      await recordEmailOutcome(options, {
        status: 'suppressed',
        fromAddress: options.from ?? process.env.EMAIL_FROM_ADDRESS ?? process.env.MICROSOFT_USER_EMAIL ?? null,
        error,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : error,
      }
    }
    return { success: false, error };
  }

  const provider = options.provider ?? getEmailProvider();
  if (provider === 'resend') {
    return sendEmailViaResend(options);
  }

  return sendEmailViaGraph(options);
}

async function sendEmailViaResend(options: EmailOptions): Promise<EmailSendResult> {
  const fromAddress = options.from ?? process.env.EMAIL_FROM_ADDRESS;
  const client = getResendClient();

  if (!client || !fromAddress) {
    const error = 'Email service is not configured';
    try {
      await recordEmailOutcome(options, {
        status: 'failed',
        fromAddress: fromAddress ?? null,
        error,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : error,
      }
    }
    return { success: false, error };
  }

  try {
    const resendPayload: Record<string, unknown> = {
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: (options.replyTo ?? process.env.EMAIL_REPLY_TO) || undefined,
      attachments: options.attachments?.map(att => ({
        filename: att.name,
        content: typeof att.content === 'string'
          ? att.content
          : att.content.toString('base64'),
        contentType: att.contentType,
      })),
    };

    if (options.html) {
      resendPayload.html = options.html;
    }
    if (options.text) {
      resendPayload.text = options.text;
    }
    if (!options.html && !options.text) {
      resendPayload.text = '';
    }

    const { data, error } = await client.emails.send(resendPayload as any);

    if (error) {
      try {
        await recordEmailOutcome(options, {
          status: 'failed',
          fromAddress,
          error: error.message,
        });
      } catch (logError) {
        return {
          success: false,
          error: logError instanceof Error ? logError.message : error.message,
        }
      }
      return {
        success: false,
        error: error.message,
      };
    }

    try {
      await recordEmailOutcome(options, {
        status: 'sent',
        fromAddress,
        messageId: data?.id ?? null,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : 'Email logging failed',
        messageId: data?.id,
      }
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: unknown) {
    console.error('Error sending email:', error);
    const message = getErrorMessage(error);
    try {
      await recordEmailOutcome(options, {
        status: 'failed',
        fromAddress,
        error: message,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : message,
      }
    }
    return {
      success: false,
      error: message
    };
  }
}

async function sendEmailViaGraph(options: EmailOptions): Promise<EmailSendResult> {
  const senderEmail = options.graphSender?.trim() || process.env.MICROSOFT_USER_EMAIL || '';

  try {
    if (!isGraphConfigured()) {
      const error = 'Email service is not configured';
      try {
        await recordEmailOutcome(options, {
          status: 'failed',
          fromAddress: senderEmail || null,
          error,
        });
      } catch (logError) {
        return {
          success: false,
          error: logError instanceof Error ? logError.message : error,
        }
      }
      return {
        success: false,
        error
      };
    }

    const client = getGraphClient();

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

    const replyToAddress = (options.replyTo ?? process.env.EMAIL_REPLY_TO)?.trim();
    if (replyToAddress) {
      message.replyTo = [{ emailAddress: { address: replyToAddress } }];
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

    try {
      await recordEmailOutcome(options, {
        status: 'sent',
        fromAddress: senderEmail,
        messageId: response?.id ?? null,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : 'Email logging failed',
        messageId: response?.id,
      }
    }

    return {
      success: true,
      messageId: response?.id
    };
  } catch (error: unknown) {
    console.error('Error sending email:', error);
    const message = getErrorMessage(error);
    try {
      await recordEmailOutcome(options, {
        status: 'failed',
        fromAddress: senderEmail || null,
        error: message,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : message,
      }
    }
    return {
      success: false,
      error: message
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
