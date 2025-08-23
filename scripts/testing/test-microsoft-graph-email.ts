#!/usr/bin/env tsx

import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  console.log('🔐 Requesting access token from Microsoft...');
  
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('❌ Failed to get access token:', error);
    throw error;
  }
}

async function testSendEmail(accessToken: string) {
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MICROSOFT_USER_EMAIL}/sendMail`;
  
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
            address: process.env.MICROSOFT_USER_EMAIL!
          }
        }
      ]
    },
    saveToSentItems: true
  };

  console.log(`📧 Attempting to send test email to ${process.env.MICROSOFT_USER_EMAIL}...`);
  
  try {
    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Send email failed: ${response.status} - ${error}`);
    }

    console.log('✅ Test email sent successfully!');
    console.log('📬 Check your inbox for the test email.');
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    throw error;
  }
}

async function main() {
  console.log('🧪 Testing Microsoft Graph Email Configuration\n');
  
  // Check required environment variables
  const requiredVars = [
    'MICROSOFT_TENANT_ID',
    'MICROSOFT_CLIENT_ID', 
    'MICROSOFT_CLIENT_SECRET',
    'MICROSOFT_USER_EMAIL'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.log('\nPlease ensure these are set in your .env.local file');
    process.exit(1);
  }
  
  console.log('✅ All required environment variables are present\n');
  console.log('Configuration:');
  console.log(`  Tenant ID: ${process.env.MICROSOFT_TENANT_ID}`);
  console.log(`  Client ID: ${process.env.MICROSOFT_CLIENT_ID}`);
  console.log(`  User Email: ${process.env.MICROSOFT_USER_EMAIL}`);
  console.log(`  Client Secret: ***${process.env.MICROSOFT_CLIENT_SECRET?.slice(-4)}\n`);
  
  try {
    // Step 1: Get access token
    const accessToken = await getAccessToken();
    console.log('✅ Successfully obtained access token\n');
    
    // Step 2: Test sending email
    await testSendEmail(accessToken);
    
    console.log('\n🎉 Microsoft Graph email configuration is working correctly!');
    console.log('You can now send invoices and quotes via email from the application.');
    
  } catch (error) {
    console.error('\n❌ Configuration test failed');
    console.error('Please check your Azure AD app registration and ensure:');
    console.error('1. The app has Mail.Send permission granted');
    console.error('2. Admin consent has been given for the permissions');
    console.error('3. The client secret is correct and not expired');
    console.error('4. The user email has a valid mailbox');
    process.exit(1);
  }
}

main().catch(console.error);