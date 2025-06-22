---
name: "🚨 CRITICAL: GDPR Compliance Implementation"
about: Implement required GDPR features to avoid legal liability
title: "🚨 CRITICAL: Implement GDPR Compliance Features"
labels: critical, compliance, legal, audit-finding
assignees: ''

---

## 🚨 Critical Audit Finding

**Severity**: CRITICAL - Legal Compliance Risk  
**Category**: Data Protection & Privacy  
**Audit Reference**: Phase 6 - Documentation & Compliance

## Problem

The application processes personal data but **lacks required GDPR compliance features**:

### Missing Legal Documents
- ❌ No Privacy Policy
- ❌ No Terms of Service  
- ❌ No Cookie Policy
- ❌ No Data Processing Agreement template

### Missing Technical Features
- ❌ No data export for individuals (Article 15)
- ❌ No right to erasure/anonymization (Article 17)
- ❌ No consent timestamp tracking
- ❌ No automated data retention
- ❌ No consent version management

## Legal Risk

**Potential GDPR fines**:
- Up to €20 million OR
- 4% of annual global turnover
- Whichever is HIGHER

**Immediate risks**:
- Data subject complaints
- Regulatory investigation
- Reputational damage
- Business operations halt

## Required Implementation

### Phase 1: Legal Documents (TODAY)

#### 1. Create Privacy Policy

Create `/app/privacy/page.tsx`:
```typescript
export default function PrivacyPolicy() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-4">
        Last updated: {new Date().toLocaleDateString()}
      </p>
      
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-2">1. Data We Collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Name and contact details (email, phone)</li>
            <li>Booking information and preferences</li>
            <li>Communication history</li>
            <li>Payment information (processed by third parties)</li>
          </ul>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">2. Legal Basis</h2>
          <p>We process your data based on:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Contract performance (bookings)</li>
            <li>Legitimate interests (customer service)</li>
            <li>Consent (marketing communications)</li>
          </ul>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">3. Your Rights</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access your data</li>
            <li>Correct inaccuracies</li>
            <li>Request deletion</li>
            <li>Export your data</li>
            <li>Withdraw consent</li>
          </ul>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">4. Contact Us</h2>
          <p>Email: privacy@theanchorpub.co.uk</p>
          <p>Phone: 01753 682 707</p>
        </div>
      </section>
    </div>
  );
}
```

#### 2. Add Privacy Links

Update `/src/components/Navigation.tsx` and footer:
```typescript
<Link href="/privacy" className="text-sm text-gray-500 hover:text-gray-700">
  Privacy Policy
</Link>
```

### Phase 2: Technical Implementation (Week 1)

#### 1. Data Export (Article 15)

Create `/src/app/actions/gdpr.ts`:
```typescript
'use server';

export async function exportUserData(customerId: string) {
  const supabase = createClient();
  
  // Verify user has permission
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  
  // Collect all user data
  const [customer, bookings, messages, auditLogs] = await Promise.all([
    supabase.from('customers').select('*').eq('id', customerId).single(),
    supabase.from('bookings').select('*').eq('customer_id', customerId),
    supabase.from('messages').select('*').eq('customer_id', customerId),
    supabase.from('audit_logs').select('*').eq('resource_id', customerId)
  ]);
  
  const exportData = {
    exportDate: new Date().toISOString(),
    customer: customer.data,
    bookings: bookings.data,
    messages: messages.data,
    auditHistory: auditLogs.data
  };
  
  // Log the export
  await logAuditEvent({
    action: 'export_customer_data',
    resourceType: 'customer',
    resourceId: customerId,
    details: { reason: 'GDPR data request' }
  });
  
  return exportData;
}
```

#### 2. Right to Erasure (Article 17)

```typescript
export async function anonymizeCustomer(customerId: string) {
  const supabase = createClient();
  
  // Anonymize rather than delete to preserve booking history
  const anonymized = {
    first_name: 'ANONYMIZED',
    last_name: 'USER',
    email_address: `deleted-${customerId}@anonymized.local`,
    mobile_number: null,
    date_of_birth: null,
    notes: 'Account anonymized per GDPR request',
    sms_opt_in: false,
    anonymized_at: new Date().toISOString()
  };
  
  const { error } = await supabase
    .from('customers')
    .update(anonymized)
    .eq('id', customerId);
    
  if (!error) {
    await logAuditEvent({
      action: 'anonymize_customer',
      resourceType: 'customer', 
      resourceId: customerId,
      details: { reason: 'GDPR erasure request' }
    });
  }
  
  return { error };
}
```

#### 3. Consent Tracking

Add migration:
```sql
-- Add consent tracking
ALTER TABLE customers ADD COLUMN consent_version VARCHAR(50);
ALTER TABLE customers ADD COLUMN consent_timestamp TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN consent_ip_address INET;

-- Track consent changes
CREATE TABLE consent_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL, -- 'sms', 'email', 'marketing'
  consent_given BOOLEAN NOT NULL,
  consent_version VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4. Update SMS Opt-in

```typescript
export async function updateSmsConsent(
  customerId: string, 
  optIn: boolean,
  ipAddress?: string
) {
  const supabase = createClient();
  
  // Record consent with timestamp
  await supabase.from('consent_history').insert({
    customer_id: customerId,
    consent_type: 'sms',
    consent_given: optIn,
    consent_version: '1.0',
    ip_address: ipAddress
  });
  
  // Update customer record
  await supabase
    .from('customers')
    .update({
      sms_opt_in: optIn,
      consent_timestamp: new Date().toISOString(),
      consent_version: '1.0'
    })
    .eq('id', customerId);
}
```

### Phase 3: Retention & Automation (Week 2)

#### 1. Automated Retention

```sql
-- Create retention policy function
CREATE OR REPLACE FUNCTION apply_retention_policies()
RETURNS void AS $$
BEGIN
  -- Anonymize customers inactive for 2 years
  UPDATE customers
  SET 
    first_name = 'ANONYMIZED',
    last_name = 'USER',
    email_address = CONCAT('deleted-', id, '@anonymized.local'),
    mobile_number = NULL,
    date_of_birth = NULL,
    anonymized_at = NOW()
  WHERE 
    last_booking_date < NOW() - INTERVAL '2 years'
    AND anonymized_at IS NULL;
    
  -- Delete old messages (>2 years)
  DELETE FROM messages
  WHERE created_at < NOW() - INTERVAL '2 years';
  
  -- Archive old audit logs (>7 years) 
  -- Note: Don't delete, move to cold storage
END;
$$ LANGUAGE plpgsql;
```

## Testing Checklist

- [ ] Privacy policy accessible at `/privacy`
- [ ] Data export returns all user data
- [ ] Anonymization preserves booking history
- [ ] Consent changes are logged
- [ ] Retention policies run successfully
- [ ] Export includes all data types
- [ ] Audit trail for all GDPR actions

## Success Criteria

### Immediate (Day 1)
- [ ] Privacy Policy published
- [ ] Link in navigation/footer
- [ ] Basic consent tracking

### Week 1
- [ ] Data export implemented
- [ ] Right to erasure working
- [ ] Consent management enhanced
- [ ] Terms of Service added

### Week 2  
- [ ] Automated retention
- [ ] Complete audit trail
- [ ] GDPR request workflow
- [ ] Documentation complete

## Legal Requirements Checklist

- [ ] Privacy Policy covers all data types
- [ ] Clear lawful basis stated
- [ ] Contact details provided
- [ ] Rights explained clearly
- [ ] Retention periods stated
- [ ] Third parties listed
- [ ] International transfers noted
- [ ] Cookie usage explained

## References

- [ICO GDPR Guide](https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/)
- [GDPR Articles 15-20](https://gdpr-info.eu/)
- [Privacy Policy Generator](https://www.privacypolicygenerator.info/)
- [Audit Report - Compliance](/docs/audit-reports/comprehensive-audit-report.md#compliance-features-analysis)

## Deadline

**Must be completed by**: [IMMEDIATELY]

**Legal risk increases every day without compliance**