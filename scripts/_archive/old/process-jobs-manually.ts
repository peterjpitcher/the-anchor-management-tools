#!/usr/bin/env tsx

import { JobQueue } from '../src/lib/background-jobs';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function processJobsManually() {
  console.log('🚀 Processing pending jobs...\n');
  
  try {
    const jobQueue = JobQueue.getInstance();
    
    // Process up to 50 jobs to make sure we get yours
    await jobQueue.processJobs(50);
    
    console.log('✅ Job processing completed');
  } catch (error) {
    console.error('❌ Error processing jobs:', error);
  }
}

processJobsManually()
  .then(() => {
    console.log('\n✅ Script complete');
    // Don't exit immediately to allow async operations to complete
    setTimeout(() => process.exit(0), 2000);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });