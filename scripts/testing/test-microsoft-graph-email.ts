#!/usr/bin/env tsx

/**
 * Microsoft Graph email configuration test (safe by default).
 *
 * Safety:
 * - DRY RUN by default (no email send).
 * - To send a test email, you must pass `--confirm`, set env gates, and provide `--limit=1`.
 * - Fails closed on any env/network error (non-zero exit).
 */

import { config } from 'dotenv'
import { join } from 'path'

// Load environment variables
config({ path: join(process.cwd(), '.env.local') })
config({ path: join(process.cwd(), '.env') })

const SCRIPT_NAME = 'test-microsoft-graph-email'
const RUN_SEND_ENV = 'RUN_TEST_MICROSOFT_GRAPH_EMAIL_SEND'
const ALLOW_SEND_ENV = 'ALLOW_TEST_MICROSOFT_GRAPH_EMAIL_SEND_SCRIPT'
const HARD_CAP = 1

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  to: string | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const to = findFlagValue(rest, '--to')

  return { confirm, dryRun, limit, to }
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

async function getAccessToken() {
  const tenantId = requireEnv('MICROSOFT_TENANT_ID', process.env.MICROSOFT_TENANT_ID)
  const clientId = requireEnv('MICROSOFT_CLIENT_ID', process.env.MICROSOFT_CLIENT_ID)
  const clientSecret = requireEnv('MICROSOFT_CLIENT_SECRET', process.env.MICROSOFT_CLIENT_SECRET)

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  console.log(`[${SCRIPT_NAME}] Requesting access token from Microsoft...`)

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token request failed: ${response.status} - ${error}`)
  }

  const data = await response.json()
  if (!data?.access_token) {
    throw new Error('Token request succeeded but no access_token was returned')
  }
  return data.access_token as string
}

async function sendTestEmail(params: { accessToken: string; fromUserEmail: string; toEmail: string }) {
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${params.fromUserEmail}/sendMail`
  
  const emailData = {
    message: {
      subject: 'Test Email from Anchor Management System',
      body: {
        contentType: 'HTML',
        content: `
          <h2>Test Email</h2>
          <p>This is a test email from the Anchor Management System to verify Microsoft Graph email configuration.</p>
          <p>If you receive this email, your configuration is working correctly!</p>
          <hr>
          <p><small>Sent at: ${new Date().toISOString()}</small></p>
        `
      },
      toRecipients: [
        {
          emailAddress: {
            address: params.toEmail
          }
        }
      ]
    },
    saveToSentItems: true
  };

  console.log(`[${SCRIPT_NAME}] Attempting to send a test email to ${params.toEmail} (dangerous) ...`)

  const response = await fetch(graphUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailData),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Send email failed: ${response.status} - ${error}`)
  }

  console.log(`[${SCRIPT_NAME}] Test email sent successfully.`)
}

async function main() {
  const args = parseArgs(process.argv)

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'CONFIRM'} starting`)
  console.log(`[${SCRIPT_NAME}] Mode: ${args.dryRun ? 'DRY RUN (safe)' : 'SEND (dangerous)'}`)
  
  // Always validate config and obtain a token (read-only).
  const tenantId = requireEnv('MICROSOFT_TENANT_ID', process.env.MICROSOFT_TENANT_ID)
  const clientId = requireEnv('MICROSOFT_CLIENT_ID', process.env.MICROSOFT_CLIENT_ID)
  requireEnv('MICROSOFT_CLIENT_SECRET', process.env.MICROSOFT_CLIENT_SECRET)
  const userEmail = requireEnv('MICROSOFT_USER_EMAIL', process.env.MICROSOFT_USER_EMAIL)

  console.log(`[${SCRIPT_NAME}] Configuration:`)
  console.log(`- Tenant ID: ${tenantId}`)
  console.log(`- Client ID: ${clientId}`)
  console.log(`- User Email: ${userEmail}`)

  const accessToken = await getAccessToken()
  console.log(`[${SCRIPT_NAME}] Successfully obtained access token`)

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No email sent.`)
    console.log(`[${SCRIPT_NAME}] To send a test email (dangerous), you must:`)
    console.log(`- Pass --confirm --limit=1 --to <email>`)
    console.log(`- Set ${RUN_SEND_ENV}=true`)
    console.log(`- Set ${ALLOW_SEND_ENV}=true`)
    return
  }

  // Sending mode (dangerous): multi-gate and cap.
  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] send blocked: missing --confirm`)
  }
  if (!isTruthyEnv(process.env[RUN_SEND_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] send blocked by safety guard. Set ${RUN_SEND_ENV}=true to enable sending.`)
  }
  if (!isTruthyEnv(process.env[ALLOW_SEND_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] send blocked by safety guard. Set ${ALLOW_SEND_ENV}=true to allow this script.`)
  }

  if (!args.limit) {
    throw new Error(`[${SCRIPT_NAME}] sending requires --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (args.limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (args.limit < 1) {
    throw new Error(`[${SCRIPT_NAME}] --limit too low (need at least 1)`)
  }

  const toEmail = args.to?.trim()
  if (!toEmail) {
    throw new Error(`[${SCRIPT_NAME}] sending requires --to <email>`)
  }

  await sendTestEmail({ accessToken, fromUserEmail: userEmail, toEmail })
  console.log(`[${SCRIPT_NAME}] SEND complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
