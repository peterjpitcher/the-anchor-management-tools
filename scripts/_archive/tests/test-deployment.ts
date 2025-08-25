#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testDeployment() {
  console.log('🧪 TESTING DEPLOYMENT STATUS\n');
  console.log('=' + '='.repeat(50) + '\n');

  const apiUrl = 'https://management.orangejelly.co.uk';
  
  // Test 1: Check if the site is up
  console.log('1. Testing site availability...');
  try {
    const response = await fetch(apiUrl);
    console.log(`   ✅ Site is up (Status: ${response.status})`);
  } catch (error) {
    console.log(`   ❌ Site is down: ${error}`);
    return;
  }

  // Test 2: Check API health
  console.log('\n2. Testing API health endpoint...');
  try {
    const response = await fetch(`${apiUrl}/api/health`);
    if (response.status === 404) {
      console.log('   ⚠️  No health endpoint found (404)');
    } else {
      console.log(`   ✅ API responded (Status: ${response.status})`);
    }
  } catch (error) {
    console.log(`   ❌ API error: ${error}`);
  }

  // Test 3: Check deployment info (if available)
  console.log('\n3. Checking deployment info...');
  try {
    // Try to fetch the build ID from the deployment
    const response = await fetch(apiUrl);
    const headers = response.headers;
    
    console.log('   Deployment headers:');
    console.log(`   - X-Vercel-Deployment-URL: ${headers.get('x-vercel-deployment-url') || 'Not found'}`);
    console.log(`   - X-Vercel-ID: ${headers.get('x-vercel-id') || 'Not found'}`);
    console.log(`   - Age: ${headers.get('age') || '0'} seconds`);
    
    const deploymentAge = parseInt(headers.get('age') || '0');
    if (deploymentAge < 3600) {
      console.log(`   ℹ️  Deployment is recent (less than 1 hour old)`);
    } else {
      console.log(`   ⚠️  Deployment is ${Math.floor(deploymentAge / 3600)} hours old`);
    }
  } catch (error) {
    console.log(`   ❌ Error checking deployment: ${error}`);
  }

  // Test 4: Check if our specific code changes are deployed
  console.log('\n4. Testing for our code changes...');
  console.log('   (This requires a valid API key to test booking initiation)');
  console.log('   To test manually, check if:');
  console.log('   - New pending_bookings have metadata.initial_sms');
  console.log('   - SMS is sent without recording in messages table');
  console.log('   - No "null customer_id" errors in logs');

  console.log('\n📋 MANUAL VERIFICATION STEPS:');
  console.log('1. Go to: https://vercel.com/dashboard');
  console.log('2. Find your project: the-anchor-management-tools');
  console.log('3. Check "Deployments" tab');
  console.log('4. Look for deployment from commit: 3aee739');
  console.log('5. Status should be "Ready" (green checkmark)');
  
  console.log('\n🔍 If deployment is missing or failed:');
  console.log('1. Click "Redeploy" on the latest deployment');
  console.log('2. Or push a new commit to trigger deployment');
  console.log('3. Or use: vercel --prod (if CLI installed)');
}

testDeployment().catch(console.error);