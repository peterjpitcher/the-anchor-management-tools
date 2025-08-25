import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testCronEndpoint() {
  console.log('🔍 Testing Cron Job Endpoint\n')
  
  const cronSecret = process.env.CRON_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
  
  if (!cronSecret) {
    console.error('❌ CRON_SECRET not found in environment variables')
    return
  }
  
  console.log(`Testing endpoint: ${appUrl}/api/jobs/process`)
  console.log(`Using CRON_SECRET: ${cronSecret.substring(0, 4)}...${cronSecret.substring(cronSecret.length - 4)}\n`)
  
  try {
    // Test the endpoint
    const response = await fetch(`${appUrl}/api/jobs/process`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    })
    
    console.log(`Response status: ${response.status} ${response.statusText}`)
    
    const data = await response.json()
    console.log('Response:', JSON.stringify(data, null, 2))
    
    if (response.ok) {
      console.log('\n✅ Cron endpoint is working correctly!')
    } else {
      console.log('\n❌ Cron endpoint returned an error')
      
      if (response.status === 401) {
        console.log('\nPossible issues:')
        console.log('1. CRON_SECRET in Vercel doesn\'t match the one in .env.local')
        console.log('2. Vercel cron is not sending the Authorization header')
        console.log('\nTo fix:')
        console.log('1. Go to Vercel dashboard → Settings → Environment Variables')
        console.log('2. Make sure CRON_SECRET is set to:', cronSecret)
        console.log('3. Redeploy the application')
      }
    }
    
    // Also test the health check
    console.log('\nTesting health check endpoint...')
    const healthResponse = await fetch(`${appUrl}/api/jobs/process`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
    })
    
    const healthData = await healthResponse.json()
    console.log('Health check:', JSON.stringify(healthData, null, 2))
    
  } catch (error) {
    console.error('❌ Error testing endpoint:', error)
  }
}

// Also check how Vercel is configured
async function checkVercelCronConfig() {
  console.log('\n📋 Vercel Cron Configuration Check:')
  console.log('==================================')
  
  console.log('\nExpected vercel.json configuration:')
  console.log(`{
  "crons": [
    {
      "path": "/api/jobs/process",
      "schedule": "*/5 * * * *"
    }
  ]
}`)
  
  console.log('\nVercel should automatically add these headers to cron requests:')
  console.log('- Authorization: Bearer CRON_SECRET_VALUE')
  console.log('- x-vercel-cron-signature (for additional security)')
  
  console.log('\n⚠️  Important: Vercel Cron only works in production!')
  console.log('For local testing, use: tsx scripts/process-sms-jobs.ts')
}

testCronEndpoint()
  .then(() => checkVercelCronConfig())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })