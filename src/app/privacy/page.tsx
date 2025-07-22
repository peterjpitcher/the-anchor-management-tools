import { Metadata } from 'next';
import { Page, Card, Section, Alert } from '@/components/ui-v2';

export const metadata: Metadata = {
  title: 'Privacy Policy - The Anchor',
  description: 'Privacy policy for The Anchor Management Tools',
};

export default function PrivacyPolicy() {
  const lastUpdated = new Date('2024-12-21').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long', 
    year: 'numeric'
  });

  return (
    <Page 
      title="Privacy Policy" 
      description={`Last updated: ${lastUpdated}`}
      containerSize="lg"
    >
      <div className="space-y-6 sm:space-y-8">
        <Section title="1. Introduction">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            The Anchor (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data. 
            This privacy policy explains how we collect, use, and protect your information 
            when you use our management tools and services.
          </p>
          <Card variant="bordered" padding="sm">
            <p className="font-semibold mb-2">Data Controller:</p>
            <p>The Anchor<br />
            Horton Road<br />
            Staines-upon-Thames<br />
            Surrey TW19 6BJ<br />
            Email: <a href="mailto:privacy@theanchorpub.co.uk" className="text-blue-600 hover:underline">privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707</p>
          </Card>
        </Section>

        <Section title="2. Information We Collect">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2">2.1 Information You Provide</h3>
              <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1 text-sm sm:text-base">
                <li>Name and contact details (email, phone number)</li>
                <li>Date of birth (for age verification)</li>
                <li>Booking information and preferences</li>
                <li>Payment information (processed securely by third parties)</li>
                <li>Communications with us</li>
                <li>Employee information (for staff members)</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2">2.2 Information We Collect Automatically</h3>
              <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1 text-sm sm:text-base">
                <li>Login information and access times</li>
                <li>IP address and device information</li>
                <li>Usage data and preferences</li>
                <li>Audit logs of system activities</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section title="3. Legal Basis for Processing">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">We process your personal data based on:</p>
          <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1.5 sm:space-y-2 text-sm sm:text-base">
            <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
            <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
            <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
            <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
          </ul>
        </Section>

        <Section title="4. How We Use Your Information">
          <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1 text-sm sm:text-base">
            <li>Process and manage bookings</li>
            <li>Send booking confirmations and reminders</li>
            <li>Provide customer support</li>
            <li>Send marketing communications (with consent)</li>
            <li>Improve our services</li>
            <li>Comply with legal obligations</li>
            <li>Prevent fraud and ensure security</li>
            <li>Manage employee records and payroll</li>
          </ul>
        </Section>

        <Section title="5. Data Sharing">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">We may share your data with:</p>
          <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1.5 sm:space-y-2 text-sm sm:text-base">
            <li><strong>Service Providers:</strong> Twilio (SMS), Supabase (database), payment processors</li>
            <li><strong>Legal Requirements:</strong> When required by law or court order</li>
            <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
          </ul>
          <Alert variant="info" title="We never sell your personal data." />
        </Section>

        <Section title="6. Data Retention">
          <Card variant="bordered" padding="sm">
            <ul className="space-y-2 text-sm sm:text-base">
              <li><strong>Customer data:</strong> 2 years after last interaction</li>
              <li><strong>Booking records:</strong> 7 years for tax purposes</li>
              <li><strong>Employee records:</strong> 7 years after employment ends</li>
              <li><strong>Marketing consent:</strong> Until withdrawn</li>
              <li><strong>Audit logs:</strong> 7 years for compliance</li>
              <li><strong>Messages:</strong> 2 years</li>
            </ul>
          </Card>
        </Section>

        <Section title="7. Your Rights">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">Under GDPR, you have the right to:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Access</h4>
              <p className="text-xs sm:text-sm">Request a copy of your personal data</p>
            </Card>
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Rectification</h4>
              <p className="text-xs sm:text-sm">Correct inaccurate data</p>
            </Card>
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Erasure</h4>
              <p className="text-xs sm:text-sm">Request deletion of your data</p>
            </Card>
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Portability</h4>
              <p className="text-xs sm:text-sm">Receive your data in a portable format</p>
            </Card>
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Object</h4>
              <p className="text-xs sm:text-sm">Object to certain processing</p>
            </Card>
            <Card variant="bordered" padding="sm">
              <h4 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Restrict</h4>
              <p className="text-xs sm:text-sm">Limit how we use your data</p>
            </Card>
          </div>
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            To exercise these rights, contact us at <a href="mailto:privacy@theanchorpub.co.uk" className="text-blue-600 hover:underline break-all">privacy@theanchorpub.co.uk</a>
          </p>
        </Section>

        <Section title="8. Data Security">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            We implement appropriate technical and organizational measures to protect your data, including:
          </p>
          <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1 text-sm sm:text-base">
            <li>Encryption in transit (HTTPS)</li>
            <li>Access controls and authentication</li>
            <li>Regular security reviews</li>
            <li>Staff training on data protection</li>
            <li>Audit logging of access and changes</li>
            <li>Row-level security in our database</li>
          </ul>
        </Section>

        <Section title="9. Cookies">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            We use essential cookies for authentication and session management. 
            These are necessary for the service to function and cannot be disabled.
          </p>
        </Section>

        <Section title="10. Children's Privacy">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            Our services are not intended for children under 18. We do not knowingly 
            collect data from children. Age verification is required for certain services.
          </p>
        </Section>

        <Section title="11. International Transfers">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            Your data may be processed outside the UK/EEA by our service providers 
            (e.g., Twilio in the US). We ensure appropriate safeguards are in place 
            through standard contractual clauses.
          </p>
        </Section>

        <Section title="12. Marketing Communications">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            If you have opted in to receive marketing communications:
          </p>
          <ul className="list-disc pl-5 sm:pl-6 mb-3 sm:mb-4 space-y-1 text-sm sm:text-base">
            <li>You can opt out at any time by replying STOP to SMS messages</li>
            <li>We will only send relevant communications about our events and offers</li>
            <li>Your consent is recorded with timestamp and version</li>
            <li>We respect your communication preferences</li>
          </ul>
        </Section>

        <Section title="13. Complaints">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            If you have concerns about our data processing, please contact us first. 
            You also have the right to complain to the Information Commissioner&apos;s Office (ICO):
          </p>
          <Card variant="bordered" padding="sm">
            <p>Information Commissioner&apos;s Office<br />
            Wycliffe House<br />
            Water Lane<br />
            Wilmslow<br />
            Cheshire SK9 5AF<br />
            Website: <a href="https://ico.org.uk" className="text-blue-600 hover:underline">ico.org.uk</a></p>
          </Card>
        </Section>

        <Section title="14. Changes to This Policy">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            We may update this policy from time to time. We will notify you of significant 
            changes via email or through the service. The &quot;Last updated&quot; date at the top 
            shows when this policy was last revised.
          </p>
        </Section>

        <Section title="15. Contact Us" className="border-t pt-8">
          <p className="mb-3 sm:mb-4 text-sm sm:text-base">
            For any questions about this privacy policy or your personal data:
          </p>
          <Alert variant="info"
            title="Data Protection Contact:"
            description="Email: privacy@theanchorpub.co.uk | Phone: 01753 682 707 | Post: The Anchor, Horton Road, Staines-upon-Thames, Surrey TW19 6BJ"
          />
        </Section>
      </div>
    </Page>
  );
}