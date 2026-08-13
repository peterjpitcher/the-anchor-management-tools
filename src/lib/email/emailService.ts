import { isGraphConfigured } from '@/lib/microsoft-graph';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { getErrorMessage } from '@/lib/errors';
import { Resend } from 'resend';
import { getEmailSuppressionStatus, recordEmailMessage } from '@/lib/email/logging';

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
  idempotencyKey?: string;
  /**
   * A working one-click unsubscribe URL for this recipient.
   *
   * OPT-IN PER CALL, never defaulted. `sendEmail` is the single chokepoint for every
   * outbound email in the app, invoices and quotes and rota mail included, and putting a
   * List-Unsubscribe header on a VAT invoice would be wrong. Only marketing sends pass it.
   *
   * Build it with `getOrCreateUnsubscribeUrl`. Both headers below are set together on
   * purpose: `List-Unsubscribe` alone, without `List-Unsubscribe-Post`, does not satisfy
   * Gmail's one-click requirement and reads as a half-implemented opt-out.
   */
  unsubscribeUrl?: string;
  /** Marketing linkage, written onto the email_messages row so webhook events can be traced back. */
  businessContactId?: string | null;
  marketingCampaignId?: string | null;
  marketingRecipientId?: string | null;
  /**
   * What to do when the suppression list cannot be read.
   *
   * 'fail_open' (the default, and the existing behaviour) sends anyway. A database wobble
   * must not stop a booking confirmation.
   *
   * 'fail_closed' refuses to send. Marketing carries the opposite risk: mailing an address
   * that bounced or complained is worse than mailing it late, so the marketing sender uses
   * this and retries once the check is available again.
   */
  suppressionMode?: 'fail_open' | 'fail_closed';
}

export interface EmailAttachment {
  name: string;
  content: Buffer | string;
  contentType: string;
}

type EmailProvider = 'graph' | 'resend';
type EmailSendResult = {
  success: boolean;
  error?: string;
  /** The provider's own id (Resend/Graph). Not a local row id. */
  messageId?: string;
  /**
   * The uuid of the `email_messages` row for this send, when one was written.
   *
   * Callers that need to join a send back to its delivery events must use this, not
   * `messageId`. A send can succeed with this null if logging failed, which is a real state
   * a bulk sender has to handle: the recipient got the email, so retrying would duplicate it.
   */
  emailMessageId?: string | null;
  /** True when the suppression list could not be read and the send was refused because of it. */
  suppressionCheckUnavailable?: boolean;
};

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
    businessContactId: options.businessContactId ?? null,
    marketingCampaignId: options.marketingCampaignId ?? null,
    marketingRecipientId: options.marketingRecipientId ?? null,
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
  const suppressionStatus = await getEmailSuppressionStatus(options.to);

  // Only marketing opts into failing closed. Everything else keeps the original behaviour of
  // sending when the list cannot be read.
  if (suppressionStatus === 'unavailable' && options.suppressionMode === 'fail_closed') {
    return {
      success: false,
      error: 'Suppression list could not be checked',
      suppressionCheckUnavailable: true,
    };
  }

  if (suppressionStatus === 'suppressed') {
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

    if (options.unsubscribeUrl) {
      const mailto = process.env.EMAIL_REPLY_TO
        ? `, <mailto:${process.env.EMAIL_REPLY_TO}?subject=unsubscribe>`
        : '';
      resendPayload.headers = {
        'List-Unsubscribe': `<${options.unsubscribeUrl}>${mailto}`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }

    const { data, error } = options.idempotencyKey
      ? await client.emails.send(resendPayload as any, { idempotencyKey: options.idempotencyKey })
      : await client.emails.send(resendPayload as any);

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

    let emailMessageId: string | null = null;
    try {
      emailMessageId = await recordEmailOutcome(options, {
        status: 'sent',
        fromAddress,
        messageId: data?.id ?? null,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : 'Email logging failed',
        messageId: data?.id,
        emailMessageId: null,
      }
    }

    // emailMessageId can be null here when logging failed without requireLog set. The email
    // HAS been sent, so a caller that retries on a null id would send it twice.
    return {
      success: true,
      messageId: data?.id,
      emailMessageId,
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

    // The same two headers as the Resend branch. Without this, unsubscribe silently
    // disappears from every message whenever EMAIL_PROVIDER is graph, and the opt-out the
    // soft opt-in basis depends on would exist on only one of the two send paths.
    if (options.unsubscribeUrl) {
      const mailto = process.env.EMAIL_REPLY_TO
        ? `, <mailto:${process.env.EMAIL_REPLY_TO}?subject=unsubscribe>`
        : '';
      message.internetMessageHeaders = [
        { name: 'List-Unsubscribe', value: `<${options.unsubscribeUrl}>${mailto}` },
        { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
      ];
    }

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

    let emailMessageId: string | null = null;
    try {
      emailMessageId = await recordEmailOutcome(options, {
        status: 'sent',
        fromAddress: senderEmail,
        messageId: response?.id ?? null,
      });
    } catch (logError) {
      return {
        success: false,
        error: logError instanceof Error ? logError.message : 'Email logging failed',
        messageId: response?.id,
        emailMessageId: null,
      }
    }

    return {
      success: true,
      messageId: response?.id,
      emailMessageId,
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
async function sendSimpleEmail(
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
