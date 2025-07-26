#!/usr/bin/env tsx

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:3000' 
  : 'https://management.orangejelly.co.uk';

async function processSMSJobs() {
  if (!CRON_SECRET) {
    console.error('❌ CRON_SECRET not found in environment variables');
    return;
  }
  
  console.log('🚀 Processing SMS jobs...\n');
  console.log(`Using ${process.env.NODE_ENV === 'development' ? 'local' : 'production'} environment`);
  
  try {
    const response = await fetch(`${APP_URL}/api/jobs/process?batch=50`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Failed to process jobs:', response.status, error);
      return;
    }
    
    const result = await response.json();
    console.log('✅ Jobs processed successfully:', result);
    
  } catch (error) {
    console.error('❌ Error calling job processor:', error);
  }
}

// Run the processor
processSMSJobs();