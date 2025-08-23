import 'dotenv/config';

async function testCustomerLabelsCron() {
  console.log('=== Testing Customer Labels Cron Endpoint ===\n');
  
  // For testing, use localhost if available
  const isLocalhost = process.argv.includes('--local');
  const baseUrl = isLocalhost ? 'http://localhost:3000' : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  const cronSecret = process.env.CRON_SECRET;
  
  if (!cronSecret) {
    console.error('❌ CRON_SECRET not found in environment variables');
    console.log('Please set CRON_SECRET in your .env.local file');
    process.exit(1);
  }
  
  console.log(`Testing endpoint: ${baseUrl}/api/cron/apply-customer-labels`);
  console.log(`Using CRON_SECRET: ${cronSecret.substring(0, 4)}...${cronSecret.substring(cronSecret.length - 4)}\n`);
  
  try {
    // Test with valid authorization
    console.log('1. Testing with valid authorization...');
    const validResponse = await fetch(`${baseUrl}/api/cron/apply-customer-labels`, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${cronSecret}`
      }
    });
    
    console.log(`   Status: ${validResponse.status}`);
    console.log(`   Content-Type: ${validResponse.headers.get('content-type')}`);
    
    let validData;
    const contentType = validResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      validData = await validResponse.json();
      console.log(`   Response:`, validData);
    } else {
      const text = await validResponse.text();
      console.log(`   Response (HTML - first 200 chars):`, text.substring(0, 200) + '...');
      console.log(`\n   ℹ️  Note: The endpoint returned HTML instead of JSON.`);
      console.log(`   This usually means the request was redirected or blocked.`);
      console.log(`   Try running with: npm run dev && tsx scripts/test-customer-labels-cron.ts --local`);
      return;
    }
    
    if (validResponse.ok) {
      console.log('   ✅ Cron endpoint executed successfully!\n');
    } else {
      console.log('   ❌ Cron endpoint failed\n');
    }
    
    // Test without authorization
    console.log('2. Testing without authorization (should fail)...');
    const unauthorizedResponse = await fetch(`${baseUrl}/api/cron/apply-customer-labels`, {
      method: 'GET'
    });
    
    console.log(`   Status: ${unauthorizedResponse.status}`);
    
    const unauthorizedContentType = unauthorizedResponse.headers.get('content-type');
    if (unauthorizedContentType && unauthorizedContentType.includes('application/json')) {
      const unauthorizedData = await unauthorizedResponse.json();
      console.log(`   Response:`, unauthorizedData);
    } else {
      console.log(`   Response: HTML page (not JSON)`);
    }
    
    if (unauthorizedResponse.status === 401) {
      console.log('   ✅ Correctly rejected unauthorized request\n');
    } else {
      console.log('   ❌ Security issue: endpoint should require authorization\n');
    }
    
    // Summary
    console.log('=== Summary ===');
    if (validResponse.ok && unauthorizedResponse.status === 401) {
      console.log('✅ Customer labels cron endpoint is working correctly!');
      console.log('\nThe cron job will run daily at 2:00 AM UTC to automatically update customer labels.');
    } else {
      console.log('❌ There are issues with the cron endpoint that need to be fixed.');
    }
    
  } catch (error) {
    console.error('❌ Error testing cron endpoint:', error);
  }
}

// Show usage help
if (process.argv.includes('--help')) {
  console.log(`
Usage: tsx scripts/test-customer-labels-cron.ts [options]

Options:
  --local    Test against localhost:3000 instead of production
  --help     Show this help message

Examples:
  # Test against production
  tsx scripts/test-customer-labels-cron.ts
  
  # Test against local development server
  npm run dev  # In another terminal
  tsx scripts/test-customer-labels-cron.ts --local
`);
  process.exit(0);
}

testCustomerLabelsCron().catch(console.error);