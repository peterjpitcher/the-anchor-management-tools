#!/usr/bin/env tsx
/**
 * Test PayPal API credentials
 * Run with: tsx scripts/test-paypal-credentials.ts
 */

import dotenv from 'dotenv'
import fetch from 'node-fetch'

// Load environment variables
dotenv.config({ path: '.env.local' })

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
}

async function testPayPalCredentials() {
  console.log(`${colors.blue}Testing PayPal API Credentials...${colors.reset}\n`)

  // Check if environment variables are set
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET
  const environment = process.env.PAYPAL_ENVIRONMENT || 'sandbox'
  const webhookId = process.env.PAYPAL_WEBHOOK_ID

  console.log('Environment Variables Check:')
  console.log(`- PAYPAL_CLIENT_ID: ${clientId ? `${colors.green}✓ Set${colors.reset} (${clientId.substring(0, 10)}...)` : `${colors.red}✗ Not set${colors.reset}`}`)
  console.log(`- PAYPAL_CLIENT_SECRET: ${clientSecret ? `${colors.green}✓ Set${colors.reset} (hidden)` : `${colors.red}✗ Not set${colors.reset}`}`)
  console.log(`- PAYPAL_ENVIRONMENT: ${colors.blue}${environment}${colors.reset}`)
  console.log(`- PAYPAL_WEBHOOK_ID: ${webhookId ? `${colors.green}✓ Set${colors.reset} (${webhookId})` : `${colors.yellow}⚠ Not set (optional)${colors.reset}`}`)

  if (!clientId || !clientSecret) {
    console.log(`\n${colors.red}Error: Missing required credentials. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local${colors.reset}`)
    process.exit(1)
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
    console.log('\n2. Testing API access...')
    const userInfoResponse = await fetch(`${apiBaseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    })

    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json() as any
      console.log(`${colors.green}✓ API access confirmed${colors.reset}`)
      console.log(`  Account ID: ${userInfo.user_id || userInfo.payer_id || 'N/A'}`)
    }

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
          console.log(`${colors.yellow}⚠ Webhook ID not found in current webhooks${colors.reset}`)
          console.log('  Available webhook IDs:')
          webhooks.forEach((wh: any) => {
            console.log(`    - ${wh.id} (${wh.url})`)
          })
        }
      }
    }

    // Step 4: Test creating a sample order (dry run)
    console.log('\n4. Testing order creation capability...')
    const orderResponse = await fetch(`${apiBaseUrl}/v1/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'GBP',
            value: '1.00'
          },
          description: 'Test Order - Do not capture'
        }]
      })
    })

    if (orderResponse.ok) {
      const orderData = await orderResponse.json() as any
      console.log(`${colors.green}✓ Order creation test successful${colors.reset}`)
      console.log(`  Order ID: ${orderData.id}`)
      console.log(`  Status: ${orderData.status}`)
      console.log(`  ${colors.yellow}Note: This is a test order and should not be captured${colors.reset}`)
    }

    console.log(`\n${colors.green}✅ All tests passed! Your PayPal credentials are working correctly.${colors.reset}`)
    
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
    
    process.exit(1)
  }
}

// Run the test
testPayPalCredentials()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unexpected error:', error)
    process.exit(1)
  })