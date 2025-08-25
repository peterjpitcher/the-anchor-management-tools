# GDPR Compliance Implementation Guide

This guide provides a complete implementation plan for GDPR compliance based on critical audit findings.

## ⚖️ Legal Context

**GDPR Fines**: Up to €20M or 4% of global annual revenue  
**Timeline**: Must be compliant immediately  
**Scope**: All EU residents' data (even if business is UK-based)

## 📋 Compliance Checklist

### Immediate (Day 1)
- [ ] Privacy Policy created and published
- [ ] Cookie notice added (if using cookies)
- [ ] Privacy link in footer/navigation
- [ ] Contact details for data requests

### Week 1
- [ ] Data export functionality (Article 15)
- [ ] Right to erasure/anonymization (Article 17)
- [ ] Consent tracking with timestamps
- [ ] Data processing register

### Month 1
- [ ] Automated retention policies
- [ ] Data breach procedures
- [ ] Third-party processor agreements
- [ ] Full compliance audit

## Step 1: Privacy Policy (1 hour)

### 1.1 Create Privacy Policy Page

Create `app/privacy/page.tsx`:
```typescript
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - The Anchor',
  description: 'Privacy policy for The Anchor Management Tools',
};

export default function PrivacyPolicy() {
  const lastUpdated = new Date('2024-01-01').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long', 
    year: 'numeric'
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p className="text-sm text-gray-600 mb-8">Last updated: {lastUpdated}</p>

      <div className="prose prose-gray max-w-none">
        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
          <p className="mb-4">
            The Anchor ("we", "our", or "us") is committed to protecting your personal data. 
            This privacy policy explains how we collect, use, and protect your information 
            when you use our management tools and services.
          </p>
          <p className="mb-4">
            <strong>Data Controller:</strong><br />
            The Anchor<br />
            [Your Address]<br />
            Email: privacy@theanchor.co.uk<br />
            Phone: 01753 682 707
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
          
          <h3 className="text-xl font-semibold mb-2">2.1 Information You Provide</h3>
          <ul className="list-disc pl-6 mb-4">
            <li>Name and contact details (email, phone number)</li>
            <li>Date of birth (for age verification)</li>
            <li>Booking information and preferences</li>
            <li>Payment information (processed securely by third parties)</li>
            <li>Communications with us</li>
          </ul>

          <h3 className="text-xl font-semibold mb-2">2.2 Information We Collect Automatically</h3>
          <ul className="list-disc pl-6 mb-4">
            <li>Login information and access times</li>
            <li>IP address and device information</li>
            <li>Usage data and preferences</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">3. Legal Basis for Processing</h2>
          <p className="mb-4">We process your personal data based on:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
            <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
            <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
            <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">4. How We Use Your Information</h2>
          <ul className="list-disc pl-6 mb-4">
            <li>Process and manage bookings</li>
            <li>Send booking confirmations and reminders</li>
            <li>Provide customer support</li>
            <li>Send marketing communications (with consent)</li>
            <li>Improve our services</li>
            <li>Comply with legal obligations</li>
            <li>Prevent fraud and ensure security</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">5. Data Sharing</h2>
          <p className="mb-4">We may share your data with:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Service Providers:</strong> Twilio (SMS), payment processors</li>
            <li><strong>Legal Requirements:</strong> When required by law</li>
            <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
          </ul>
          <p className="mb-4">We never sell your personal data.</p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">6. Data Retention</h2>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Customer data:</strong> 2 years after last interaction</li>
            <li><strong>Booking records:</strong> 7 years for tax purposes</li>
            <li><strong>Marketing consent:</strong> Until withdrawn</li>
            <li><strong>Audit logs:</strong> 7 years for compliance</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">7. Your Rights</h2>
          <p className="mb-4">Under GDPR, you have the right to:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Rectification:</strong> Correct inaccurate data</li>
            <li><strong>Erasure:</strong> Request deletion of your data</li>
            <li><strong>Portability:</strong> Receive your data in a portable format</li>
            <li><strong>Object:</strong> Object to certain processing</li>
            <li><strong>Restrict:</strong> Limit how we use your data</li>
            <li><strong>Withdraw Consent:</strong> For consent-based processing</li>
          </ul>
          <p className="mb-4">
            To exercise these rights, contact us at privacy@theanchor.co.uk
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">8. Data Security</h2>
          <p className="mb-4">
            We implement appropriate technical and organizational measures to protect your data, including:
          </p>
          <ul className="list-disc pl-6 mb-4">
            <li>Encryption in transit (HTTPS)</li>
            <li>Access controls and authentication</li>
            <li>Regular security reviews</li>
            <li>Staff training on data protection</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">9. Cookies</h2>
          <p className="mb-4">
            We use essential cookies for authentication and session management. 
            These are necessary for the service to function and cannot be disabled.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">10. Children's Privacy</h2>
          <p className="mb-4">
            Our services are not intended for children under 18. We do not knowingly 
            collect data from children.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">11. International Transfers</h2>
          <p className="mb-4">
            Your data may be processed outside the UK/EEA by our service providers. 
            We ensure appropriate safeguards are in place.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">12. Complaints</h2>
          <p className="mb-4">
            If you have concerns about our data processing, please contact us first. 
            You also have the right to complain to the Information Commissioner's Office (ICO).
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">13. Changes to This Policy</h2>
          <p className="mb-4">
            We may update this policy from time to time. We will notify you of significant 
            changes via email or through the service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">14. Contact Us</h2>
          <p>
            For any questions about this privacy policy or your personal data:<br />
            Email: privacy@theanchor.co.uk<br />
            Phone: 01753 682 707<br />
            Post: The Anchor, [Your Address]
          </p>
        </section>
      </div>
    </div>
  );
}
```

### 1.2 Add Privacy Link to Navigation

Update `src/components/Navigation.tsx`:
```typescript
// Add to navigation items
{
  name: 'Privacy Policy',
  href: '/privacy',
  icon: ShieldCheckIcon,
}
```

Update footer component:
```typescript
<footer className="bg-gray-100 mt-auto">
  <div className="max-w-7xl mx-auto px-4 py-6">
    <div className="flex justify-between items-center">
      <p className="text-sm text-gray-500">
        © 2024 The Anchor. All rights reserved.
      </p>
      <div className="flex space-x-4">
        <Link href="/privacy" className="text-sm text-gray-500 hover:text-gray-700">
          Privacy Policy
        </Link>
        <Link href="/terms" className="text-sm text-gray-500 hover:text-gray-700">
          Terms of Service
        </Link>
      </div>
    </div>
  </div>
</footer>
```

## Step 2: Data Subject Rights (Article 15-20)

### 2.1 Create GDPR Actions

Create `app/actions/gdpr.ts`:
```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from './audit';

// Article 15: Right to Access
export async function exportCustomerData(customerId: string) {
  const supabase = createClient();
  
  // Verify permission
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Unauthorized' };
  }

  try {
    // Collect all customer data
    const [
      customerResult,
      bookingsResult,
      messagesResult,
      consentResult,
      documentsResult,
    ] = await Promise.all([
      // Personal data
      supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single(),
      
      // Bookings
      supabase
        .from('bookings')
        .select(`
          *,
          events (
            id,
            name,
            date,
            time
          )
        `)
        .eq('customer_id', customerId),
      
      // Messages
      supabase
        .from('messages')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
      
      // Consent history
      supabase
        .from('consent_history')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
      
      // Any documents
      supabase
        .from('customer_documents')
        .select('*')
        .eq('customer_id', customerId),
    ]);

    // Check for errors
    if (customerResult.error) throw customerResult.error;

    // Format export data
    const exportData = {
      exportDate: new Date().toISOString(),
      dataController: {
        name: 'The Anchor',
        email: 'privacy@theanchor.co.uk',
        phone: '01753 682 707',
      },
      personalData: customerResult.data,
      bookings: bookingsResult.data || [],
      communications: messagesResult.data || [],
      consentHistory: consentResult.data || [],
      documents: documentsResult.data || [],
      dataCategories: {
        identity: ['first_name', 'last_name', 'date_of_birth'],
        contact: ['email_address', 'mobile_number'],
        preferences: ['sms_opt_in', 'notes'],
        transactional: ['bookings', 'messages'],
      },
      retentionPeriods: {
        personalData: '2 years from last activity',
        bookings: '7 years for tax compliance',
        messages: '2 years',
        auditLogs: '7 years for compliance',
      },
      yourRights: [
        'Right to access (Article 15)',
        'Right to rectification (Article 16)',
        'Right to erasure (Article 17)',
        'Right to restriction (Article 18)',
        'Right to portability (Article 20)',
        'Right to object (Article 21)',
      ],
    };

    // Log the export
    await logAuditEvent({
      action: 'export_customer_data',
      resourceType: 'customer',
      resourceId: customerId,
      details: {
        reason: 'GDPR Article 15 request',
        exportedFields: Object.keys(exportData),
      },
    });

    return { 
      data: exportData,
      filename: `customer-data-${customerId}-${Date.now()}.json`
    };
  } catch (error) {
    console.error('Data export error:', error);
    return { error: 'Failed to export data' };
  }
}

// Article 17: Right to Erasure (Anonymization)
export async function anonymizeCustomer(
  customerId: string,
  reason: string = 'Customer request'
) {
  const supabase = createClient();
  
  // Verify permission
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Unauthorized' };
  }

  try {
    // Start transaction
    const timestamp = new Date().toISOString();
    const anonymizedId = `ANON-${Date.now()}`;

    // Anonymize personal data
    const { error: updateError } = await supabase
      .from('customers')
      .update({
        first_name: 'DELETED',
        last_name: 'CUSTOMER',
        email_address: `${anonymizedId}@deleted.local`,
        mobile_number: null,
        date_of_birth: null,
        notes: 'Account anonymized per GDPR request',
        sms_opt_in: false,
        anonymized_at: timestamp,
        anonymization_reason: reason,
      })
      .eq('id', customerId);

    if (updateError) throw updateError;

    // Delete/anonymize related data
    const results = await Promise.all([
      // Anonymize messages (keep for business records)
      supabase
        .from('messages')
        .update({ 
          message_body: '[Message content removed]',
          anonymized: true 
        })
        .eq('customer_id', customerId),
      
      // Delete consent history (no longer needed)
      supabase
        .from('consent_history')
        .delete()
        .eq('customer_id', customerId),
      
      // Delete any uploaded documents
      supabase
        .from('customer_documents')
        .delete()
        .eq('customer_id', customerId),
    ]);

    // Check for errors
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      throw new Error('Failed to anonymize some data');
    }

    // Log the anonymization
    await logAuditEvent({
      action: 'anonymize_customer',
      resourceType: 'customer',
      resourceId: customerId,
      details: {
        reason,
        anonymizedAt: timestamp,
        gdprArticle: 17,
      },
    });

    return { 
      success: true,
      message: 'Customer data has been anonymized',
      anonymizedAt: timestamp,
    };
  } catch (error) {
    console.error('Anonymization error:', error);
    return { error: 'Failed to anonymize customer data' };
  }
}

// Article 16: Right to Rectification
export async function requestDataCorrection(
  customerId: string,
  corrections: Record<string, any>,
  reason: string
) {
  const supabase = createClient();
  
  try {
    // Store the correction request
    const { data, error } = await supabase
      .from('data_correction_requests')
      .insert({
        customer_id: customerId,
        requested_changes: corrections,
        reason,
        status: 'pending',
        requested_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Log the request
    await logAuditEvent({
      action: 'data_correction_request',
      resourceType: 'customer',
      resourceId: customerId,
      details: {
        requestId: data.id,
        changes: corrections,
        gdprArticle: 16,
      },
    });

    // Send notification to admin
    // ... notification logic ...

    return { 
      success: true,
      requestId: data.id,
      message: 'Correction request submitted',
    };
  } catch (error) {
    console.error('Correction request error:', error);
    return { error: 'Failed to submit correction request' };
  }
}

// Consent Management
export async function updateConsent(
  customerId: string,
  consentType: 'sms' | 'email' | 'marketing',
  granted: boolean,
  ipAddress?: string,
  userAgent?: string
) {
  const supabase = createClient();
  
  try {
    // Record consent change
    const { error: historyError } = await supabase
      .from('consent_history')
      .insert({
        customer_id: customerId,
        consent_type: consentType,
        consent_given: granted,
        consent_version: '1.0', // Update when privacy policy changes
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
      });

    if (historyError) throw historyError;

    // Update customer record
    if (consentType === 'sms') {
      const { error: updateError } = await supabase
        .from('customers')
        .update({
          sms_opt_in: granted,
          consent_timestamp: new Date().toISOString(),
          consent_version: '1.0',
        })
        .eq('id', customerId);

      if (updateError) throw updateError;
    }

    // Log consent change
    await logAuditEvent({
      action: granted ? 'consent_granted' : 'consent_withdrawn',
      resourceType: 'customer',
      resourceId: customerId,
      details: {
        consentType,
        version: '1.0',
        ipAddress,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Consent update error:', error);
    return { error: 'Failed to update consent' };
  }
}
```

### 2.2 Create GDPR UI

Create `app/(authenticated)/customers/[id]/gdpr/page.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  exportCustomerData, 
  anonymizeCustomer,
  updateConsent 
} from '@/app/actions/gdpr';
import { 
  ArrowDownTrayIcon,
  TrashIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

export default function CustomerGDPRPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [loading, setLoading] = useState<string | null>(null);
  const [showAnonymizeConfirm, setShowAnonymizeConfirm] = useState(false);

  const handleExportData = async () => {
    setLoading('export');
    try {
      const result = await exportCustomerData(customerId);
      
      if (result.error) {
        toast.error(result.error);
        return;
      }

      // Download JSON file
      const blob = new Blob(
        [JSON.stringify(result.data, null, 2)], 
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success('Data exported successfully');
    } catch (error) {
      toast.error('Failed to export data');
    } finally {
      setLoading(null);
    }
  };

  const handleAnonymize = async () => {
    setLoading('anonymize');
    try {
      const result = await anonymizeCustomer(
        customerId, 
        'Customer requested deletion'
      );
      
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success('Customer data anonymized');
      router.push('/customers');
    } catch (error) {
      toast.error('Failed to anonymize data');
    } finally {
      setLoading(null);
      setShowAnonymizeConfirm(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center">
          <ShieldCheckIcon className="h-8 w-8 mr-2 text-blue-600" />
          GDPR Data Management
        </h1>
        <p className="text-gray-600 mt-2">
          Manage customer data rights under GDPR
        </p>
      </div>

      <div className="space-y-6">
        {/* Data Export */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Right to Access (Article 15)
          </h2>
          <p className="text-gray-600 mb-4">
            Export all customer data in a portable format
          </p>
          <button
            onClick={handleExportData}
            disabled={loading === 'export'}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
            {loading === 'export' ? 'Exporting...' : 'Export Data'}
          </button>
        </div>

        {/* Data Erasure */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Right to Erasure (Article 17)
          </h2>
          <p className="text-gray-600 mb-4">
            Anonymize customer data while preserving business records
          </p>
          
          {!showAnonymizeConfirm ? (
            <button
              onClick={() => setShowAnonymizeConfirm(true)}
              className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <TrashIcon className="h-5 w-5 mr-2" />
              Request Anonymization
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-semibold mb-2">
                ⚠️ This action cannot be undone
              </p>
              <p className="text-red-700 text-sm mb-4">
                Personal data will be permanently anonymized. Booking history 
                will be preserved for legal compliance.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={handleAnonymize}
                  disabled={loading === 'anonymize'}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {loading === 'anonymize' ? 'Processing...' : 'Confirm Anonymization'}
                </button>
                <button
                  onClick={() => setShowAnonymizeConfirm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Data Portability */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">
            Right to Data Portability (Article 20)
          </h2>
          <p className="text-gray-600 mb-4">
            Export data in machine-readable format for transfer to another service
          </p>
          <div className="flex space-x-3">
            <button
              onClick={handleExportData}
              disabled={loading === 'export'}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <DocumentTextIcon className="h-5 w-5 mr-2" />
              Export as JSON
            </button>
          </div>
        </div>

        {/* Privacy Policy */}
        <div className="bg-blue-50 rounded-lg p-6">
          <h3 className="font-semibold mb-2">Data Protection Contact</h3>
          <p className="text-sm text-gray-700">
            For any questions about data protection or to exercise your rights:<br />
            Email: privacy@theanchor.co.uk<br />
            Phone: 01753 682 707
          </p>
        </div>
      </div>
    </div>
  );
}
```

## Step 3: Database Migrations

### 3.1 Add GDPR Fields

Create migration `20241221_gdpr_compliance.sql`:
```sql
-- Add GDPR compliance fields
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS consent_version VARCHAR(50),
ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS consent_ip_address INET,
ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS anonymization_reason TEXT;

-- Create consent history table
CREATE TABLE IF NOT EXISTS consent_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL,
  consent_given BOOLEAN NOT NULL,
  consent_version VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_consent_customer (customer_id),
  INDEX idx_consent_created (created_at)
);

-- Create data correction requests table
CREATE TABLE IF NOT EXISTS data_correction_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  requested_changes JSONB NOT NULL,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id),
  processing_notes TEXT,
  INDEX idx_correction_customer (customer_id),
  INDEX idx_correction_status (status)
);

-- Create data retention policy function
CREATE OR REPLACE FUNCTION apply_data_retention_policy()
RETURNS void AS $$
BEGIN
  -- Anonymize inactive customers (2 years)
  UPDATE customers
  SET 
    first_name = 'DELETED',
    last_name = 'CUSTOMER',
    email_address = CONCAT('deleted-', id, '@anonymized.local'),
    mobile_number = NULL,
    date_of_birth = NULL,
    notes = 'Auto-anonymized per retention policy',
    anonymized_at = NOW(),
    anonymization_reason = 'Retention policy - 2 years inactive'
  WHERE 
    anonymized_at IS NULL
    AND (
      last_booking_date < NOW() - INTERVAL '2 years'
      OR (last_booking_date IS NULL AND created_at < NOW() - INTERVAL '2 years')
    );

  -- Delete old messages (2 years)
  DELETE FROM messages
  WHERE created_at < NOW() - INTERVAL '2 years';

  -- Delete old consent history (except latest per type)
  DELETE FROM consent_history
  WHERE id NOT IN (
    SELECT DISTINCT ON (customer_id, consent_type) id
    FROM consent_history
    ORDER BY customer_id, consent_type, created_at DESC
  )
  AND created_at < NOW() - INTERVAL '2 years';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule retention policy (requires pg_cron extension)
-- SELECT cron.schedule('apply-retention-policy', '0 2 * * *', 'SELECT apply_data_retention_policy();');

-- Add RLS policies
ALTER TABLE consent_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_correction_requests ENABLE ROW LEVEL SECURITY;

-- Consent history viewable by customer and staff
CREATE POLICY "Consent history viewable by customer and staff" ON consent_history
  FOR SELECT USING (
    auth.uid() = customer_id 
    OR EXISTS (
      SELECT 1 FROM user_has_permission('customers', 'view')
    )
  );

-- Only system can insert consent records
CREATE POLICY "Consent history system managed" ON consent_history
  FOR INSERT WITH CHECK (false);

-- Grant necessary permissions
GRANT SELECT ON consent_history TO authenticated;
GRANT SELECT ON data_correction_requests TO authenticated;
GRANT EXECUTE ON FUNCTION apply_data_retention_policy() TO authenticated;
```

## Step 4: Consent Management UI

### 4.1 Update Customer Form

Add consent tracking to `CustomerForm.tsx`:
```typescript
// Add to form state
const [consentVersion] = useState('1.0');
const [consentTimestamp] = useState(new Date().toISOString());

// Add consent checkbox
<div className="mt-6 space-y-4">
  <div className="flex items-start">
    <input
      type="checkbox"
      id="sms_consent"
      name="sms_opt_in"
      defaultChecked={customer?.sms_opt_in}
      className="mt-1 h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
    />
    <label htmlFor="sms_consent" className="ml-3">
      <span className="text-sm font-medium text-gray-700">
        SMS Marketing Consent
      </span>
      <p className="text-xs text-gray-500 mt-1">
        I consent to receive marketing messages via SMS. I can opt-out 
        at any time by replying STOP. View our{' '}
        <Link href="/privacy" className="text-blue-600 hover:underline">
          Privacy Policy
        </Link>
      </p>
    </label>
  </div>
  
  <input type="hidden" name="consent_version" value={consentVersion} />
  <input type="hidden" name="consent_timestamp" value={consentTimestamp} />
</div>
```

## Step 5: Automated Retention

### 5.1 Create Cron Job

Create `app/api/cron/retention/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient();
    
    // Apply retention policy
    const { error } = await supabase.rpc('apply_data_retention_policy');
    
    if (error) {
      logger.error({ error }, 'Retention policy failed');
      return NextResponse.json(
        { error: 'Retention policy failed' },
        { status: 500 }
      );
    }

    logger.info('Retention policy applied successfully');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Retention cron error');
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
```

### 5.2 Schedule in Vercel

Update `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/retention",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## Testing Checklist

### Legal Documents
- [ ] Privacy Policy accessible at `/privacy`
- [ ] Privacy link in navigation/footer
- [ ] All required sections included
- [ ] Contact information correct

### Data Export
- [ ] Export includes all data types
- [ ] JSON format is valid
- [ ] Download works correctly
- [ ] Audit log entry created

### Anonymization
- [ ] Personal data replaced
- [ ] Booking history preserved
- [ ] Related data cleaned
- [ ] Cannot be reversed

### Consent Management
- [ ] Consent recorded with timestamp
- [ ] Version tracking works
- [ ] History maintained
- [ ] Opt-out honored

### Retention Policy
- [ ] Identifies old records correctly
- [ ] Anonymizes as expected
- [ ] Runs on schedule
- [ ] Logs execution

## Compliance Verification

Run this checklist monthly:
1. Review privacy policy for accuracy
2. Test data export functionality
3. Verify retention policies running
4. Check consent management
5. Review audit logs
6. Update documentation as needed

## Next Steps

1. **Legal Review**: Have a lawyer review the privacy policy
2. **Staff Training**: Train team on GDPR procedures
3. **Documentation**: Create user-facing GDPR guides
4. **Monitoring**: Set up compliance dashboards
5. **Regular Audits**: Schedule quarterly reviews