#!/usr/bin/env tsx
/**
 * Test PayPal API credentials (safe by default).
 *
 * Safety note:
 * - DRY RUN by default (no order creation).
 * - Creating a test order is a side effect and requires explicit multi-gating + caps.
 */

import dotenv from 'dotenv'
import fetch from 'node-fetch'

// Load environment variables
dotenv.config({ path: '.env.local' })

const SCRIPT_NAME = 'test-paypal-credentials'
const RUN_MUTATION_ENV = 'RUN_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE'
const ALLOW_MUTATION_ENV = 'ALLOW_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE_SCRIPT'
const HARD_CAP = 1

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
}

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
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  allowLive: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const allowLive = rest.includes('--live')

  return { confirm, dryRun, limit, allowLive }
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function mask(value: string, keep = 4): string {
  if (!value) return '(missing)'
  if (value.length <= keep) return '***'
  return `${'*'.repeat(Math.max(0, value.length - keep))}${value.slice(-keep)}`
}

async function run() {
  console.log(`${colors.blue}Testing PayPal API Credentials...${colors.reset}\n`)

  // Check if environment variables are set
  const clientId = requireEnv('PAYPAL_CLIENT_ID', process.env.PAYPAL_CLIENT_ID)
  const clientSecret = requireEnv('PAYPAL_CLIENT_SECRET', process.env.PAYPAL_CLIENT_SECRET)
  const environment = (process.env.PAYPAL_ENVIRONMENT || 'sandbox').trim()
  const webhookId = process.env.PAYPAL_WEBHOOK_ID

  const args = parseArgs(process.argv)

  console.log('Environment Variables Check:')
  console.log(`- PAYPAL_CLIENT_ID: ${colors.green}✓ Set${colors.reset} (${mask(clientId)})`)
  console.log(`- PAYPAL_CLIENT_SECRET: ${colors.green}✓ Set${colors.reset} (hidden)`)
  console.log(`- PAYPAL_ENVIRONMENT: ${colors.blue}${environment}${colors.reset}`)
  console.log(`- PAYPAL_WEBHOOK_ID: ${webhookId ? `${colors.green}✓ Set${colors.reset} (${webhookId})` : `${colors.yellow}⚠ Not set (optional)${colors.reset}`}`)
  console.log(`- Mode: ${args.dryRun ? 'DRY RUN (safe)' : 'CONFIRM (order creation enabled, dangerous)'}`)

  if (environment !== 'sandbox' && environment !== 'live') {
    throw new Error(`Invalid PAYPAL_ENVIRONMENT: ${environment} (expected sandbox|live)`)
  }

  // Determine API base URL
  const apiBaseUrl = environment === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com'

  console.log(`\n${colors.blue}Testing connection to PayPal ${environment} API...${colors.reset}`)
  console.log(`API Base URL: ${apiBaseUrl}`)

  try {
    // Step 1: Get Access Token
    console.log('\n1. Obtaining access token...')
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    
    const tokenResponse = await fetch(`${apiBaseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      throw new Error(`Failed to get access token: ${tokenResponse.status} - ${error}`)
    }

    const tokenData = await tokenResponse.json() as any
    console.log(`${colors.green}✓ Access token obtained successfully${colors.reset}`)
    console.log(`  Token type: ${tokenData.token_type}`)
    console.log(`  Expires in: ${tokenData.expires_in} seconds`)
    console.log(`  App ID: ${tokenData.app_id}`)

    // Step 2: Test API Access
    console.log('\n2. Token obtained; skipping identity calls (not required for credential validity).')

    // Step 3: List Webhooks (if webhook ID is provided)
    if (webhookId) {
      console.log('\n3. Verifying webhook configuration...')
      
      // First, list all webhooks
      const webhooksResponse = await fetch(`${apiBaseUrl}/v1/notifications/webhooks`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (webhooksResponse.ok) {
        const webhooksData = await webhooksResponse.json() as any
        const webhooks = webhooksData.webhooks || []
        
        console.log(`${colors.green}✓ Retrieved ${webhooks.length} webhook(s)${colors.reset}`)
        
        // Check if our webhook ID exists
        const ourWebhook = webhooks.find((wh: any) => wh.id === webhookId)
        
        if (ourWebhook) {
          console.log(`${colors.green}✓ Webhook ID verified${colors.reset}`)
          console.log(`  URL: ${ourWebhook.url}`)
          console.log(`  Events: ${ourWebhook.event_types.map((e: any) => e.name).join(', ')}`)
        } else {
          throw new Error(`Webhook ID not found in PayPal account: ${webhookId}`)
        }
      } else {
        const errorText = await webhooksResponse.text()
        throw new Error(`Failed to list webhooks: ${webhooksResponse.status} - ${errorText}`)
      }
    }

    // Step 4: (Optional) Create a test order (side effect)
    if (args.dryRun) {
      console.log('\n4. Skipping order creation (dry run).')
      console.log(`   To create a test order (dangerous), you must:`)
      console.log(`   - Pass --confirm --limit=1`)
      console.log(`   - Set ${RUN_MUTATION_ENV}=true`)
      console.log(`   - Set ${ALLOW_MUTATION_ENV}=true`)
      if (environment === 'live') {
        console.log(`   - Also pass --live (required for PAYPAL_ENVIRONMENT=live)`)
      }
    } else {
      if (!args.confirm) {
        throw new Error('Order creation blocked: missing --confirm')
      }

      if (environment === 'live' && !args.allowLive) {
        throw new Error('Order creation blocked: refusing PAYPAL_ENVIRONMENT=live without --live')
      }

      if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
        throw new Error(
          `Order creation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable this mutation step.`
        )
      }

      if (!isTruthyEnv(process.env[ALLOW_MUTATION_ENV])) {
        throw new Error(
          `Order creation blocked by safety guard. Set ${ALLOW_MUTATION_ENV}=true to allow this mutation step.`
        )
      }

      const limit = args.limit
      if (!limit) {
        throw new Error(`Order creation requires --limit <n> (hard cap ${HARD_CAP})`)
      }
      if (limit > HARD_CAP) {
        throw new Error(`--limit exceeds hard cap (max ${HARD_CAP})`)
      }
      if (limit < 1) {
        throw new Error(`--limit too low for order creation (need at least 1)`)
      }

      console.log('\n4. Creating a test order (side effect)...')
      const orderResponse = await fetch(`${apiBaseUrl}/v1/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: {
                currency_code: 'GBP',
                value: '1.00',
              },
              description: 'Test Order - Do not capture',
            },
          ],
        }),
      })

      if (!orderResponse.ok) {
        const errorText = await orderResponse.text()
        throw new Error(`Order creation failed: ${orderResponse.status} - ${errorText}`)
      }

      const orderData = (await orderResponse.json()) as any
      console.log(`${colors.green}✓ Order creation test successful${colors.reset}`)
      console.log(`  Order ID: ${orderData.id}`)
      console.log(`  Status: ${orderData.status}`)
      console.log(`  ${colors.yellow}Note: This is a test order and should not be captured${colors.reset}`)
    }

    console.log(`\n${colors.green}✅ PayPal credential diagnostics completed successfully.${colors.reset}`)
    
    if (!webhookId) {
      console.log(`\n${colors.yellow}💡 Tip: Add PAYPAL_WEBHOOK_ID to enable webhook verification${colors.reset}`)
    }

  } catch (error) {
    console.error(`\n${colors.red}❌ Test failed:${colors.reset}`, error)
    
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        console.log(`\n${colors.yellow}Possible issues:${colors.reset}`)
        console.log('- Invalid Client ID or Secret')
        console.log('- Using Live credentials in Sandbox mode (or vice versa)')
        console.log('- Credentials not properly activated in PayPal')
      }
    }
    
    throw error
  }
}

run().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
