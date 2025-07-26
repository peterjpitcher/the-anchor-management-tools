import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

console.log('🕐 Setting up temporary cron job for testing\n')

const cronSecret = process.env.CRON_SECRET
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'

if (!cronSecret) {
  console.error('❌ CRON_SECRET not found in environment variables')
  process.exit(1)
}

console.log('This script will call the job processor every 30 seconds for testing.')
console.log('Press Ctrl+C to stop.\n')

let iteration = 0

async function callJobProcessor() {
  iteration++
  const timestamp = new Date().toLocaleTimeString()
  
  console.log(`[${timestamp}] Iteration ${iteration}: Calling job processor...`)
  
  try {
    const response = await fetch(`${appUrl}/api/jobs/process`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    })
    
    const data = await response.json()
    
    if (response.ok) {
      console.log(`[${timestamp}] ✅ ${data.message}`)
    } else {
      console.log(`[${timestamp}] ❌ Error: ${data.error}`)
    }
  } catch (error) {
    console.log(`[${timestamp}] ❌ Request failed:`, error.message)
  }
}

// Call immediately
callJobProcessor()

// Then call every 30 seconds
const interval = setInterval(callJobProcessor, 30000)

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nStopping test cron job...')
  clearInterval(interval)
  process.exit(0)
})

console.log('Test cron job is running. It will process jobs every 30 seconds.')
console.log('Keep this running to ensure SMS messages are sent promptly.')