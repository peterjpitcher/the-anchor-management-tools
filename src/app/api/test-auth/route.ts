import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createHash } from 'crypto';

export async function GET(request: NextRequest) {
  console.log('\n=== TEST AUTH ENDPOINT ===');
  
  // Method 1: Get headers from request
  const xApiKey1 = request.headers.get('x-api-key');
  const auth1 = request.headers.get('authorization');
  
  console.log('Method 1 - request.headers:');
  console.log('  X-API-Key:', xApiKey1 ? xApiKey1.substring(0, 10) + '...' : 'Not found');
  console.log('  Authorization:', auth1 ? auth1.substring(0, 20) + '...' : 'Not found');
  
  // Method 2: Get headers from headers() function
  const headersList = await headers();
  const xApiKey2 = headersList.get('x-api-key');
  const auth2 = headersList.get('authorization');
  
  console.log('\nMethod 2 - headers() function:');
  console.log('  X-API-Key:', xApiKey2 ? xApiKey2.substring(0, 10) + '...' : 'Not found');
  console.log('  Authorization:', auth2 ? auth2.substring(0, 20) + '...' : 'Not found');
  
  // Show all headers
  console.log('\nAll headers:');
  request.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });
  
  // Test hash
  const testKey = 'anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg';
  const hash = createHash('sha256').update(testKey).digest('hex');
  console.log('\nExpected key hash:', hash);
  console.log('=========================\n');
  
  return NextResponse.json({
    test: 'auth endpoint',
    headers: {
      method1: {
        'x-api-key': xApiKey1 ? 'Found' : 'Not found',
        'authorization': auth1 ? 'Found' : 'Not found'
      },
      method2: {
        'x-api-key': xApiKey2 ? 'Found' : 'Not found',
        'authorization': auth2 ? 'Found' : 'Not found'
      }
    },
    expectedKeyHash: hash
  });
}