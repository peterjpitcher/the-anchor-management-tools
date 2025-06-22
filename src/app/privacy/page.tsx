import { Metadata } from 'next';

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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p className="text-sm text-gray-600 mb-8">Last updated: {lastUpdated}</p>

      <div className="prose prose-gray max-w-none space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
          <p className="mb-4">
            The Anchor (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data. 
            This privacy policy explains how we collect, use, and protect your information 
            when you use our management tools and services.
          </p>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="font-semibold mb-2">Data Controller:</p>
            <p>The Anchor<br />
            Horton Road<br />
            Staines-upon-Thames<br />
            Surrey TW19 6BJ<br />
            Email: privacy@theanchorpub.co.uk<br />
            Phone: 01753 682 707</p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
          
          <h3 className="text-xl font-semibold mb-2">2.1 Information You Provide</h3>
          <ul className="list-disc pl-6 mb-4 space-y-1">
            <li>Name and contact details (email, phone number)</li>
            <li>Date of birth (for age verification)</li>
            <li>Booking information and preferences</li>
            <li>Payment information (processed securely by third parties)</li>
            <li>Communications with us</li>
            <li>Employee information (for staff members)</li>
          </ul>

          <h3 className="text-xl font-semibold mb-2">2.2 Information We Collect Automatically</h3>
          <ul className="list-disc pl-6 mb-4 space-y-1">
            <li>Login information and access times</li>
            <li>IP address and device information</li>
            <li>Usage data and preferences</li>
            <li>Audit logs of system activities</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">3. Legal Basis for Processing</h2>
          <p className="mb-4">We process your personal data based on:</p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
            <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
            <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
            <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">4. How We Use Your Information</h2>
          <ul className="list-disc pl-6 mb-4 space-y-1">
            <li>Process and manage bookings</li>
            <li>Send booking confirmations and reminders</li>
            <li>Provide customer support</li>
            <li>Send marketing communications (with consent)</li>
            <li>Improve our services</li>
            <li>Comply with legal obligations</li>
            <li>Prevent fraud and ensure security</li>
            <li>Manage employee records and payroll</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">5. Data Sharing</h2>
          <p className="mb-4">We may share your data with:</p>
          <ul className="list-disc pl-6 mb-4 space-y-2">
            <li><strong>Service Providers:</strong> Twilio (SMS), Supabase (database), payment processors</li>
            <li><strong>Legal Requirements:</strong> When required by law or court order</li>
            <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
          </ul>
          <p className="mb-4 font-semibold">We never sell your personal data.</p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">6. Data Retention</h2>
          <div className="bg-gray-50 p-4 rounded-lg">
            <ul className="space-y-2">
              <li><strong>Customer data:</strong> 2 years after last interaction</li>
              <li><strong>Booking records:</strong> 7 years for tax purposes</li>
              <li><strong>Employee records:</strong> 7 years after employment ends</li>
              <li><strong>Marketing consent:</strong> Until withdrawn</li>
              <li><strong>Audit logs:</strong> 7 years for compliance</li>
              <li><strong>Messages:</strong> 2 years</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">7. Your Rights</h2>
          <p className="mb-4">Under GDPR, you have the right to:</p>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Access</h4>
              <p className="text-sm">Request a copy of your personal data</p>
            </div>
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Rectification</h4>
              <p className="text-sm">Correct inaccurate data</p>
            </div>
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Erasure</h4>
              <p className="text-sm">Request deletion of your data</p>
            </div>
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Portability</h4>
              <p className="text-sm">Receive your data in a portable format</p>
            </div>
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Object</h4>
              <p className="text-sm">Object to certain processing</p>
            </div>
            <div className="border border-gray-200 p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Restrict</h4>
              <p className="text-sm">Limit how we use your data</p>
            </div>
          </div>
          <p className="mb-4">
            To exercise these rights, contact us at <a href="mailto:privacy@theanchorpub.co.uk" className="text-blue-600 hover:underline">privacy@theanchorpub.co.uk</a>
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">8. Data Security</h2>
          <p className="mb-4">
            We implement appropriate technical and organizational measures to protect your data, including:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-1">
            <li>Encryption in transit (HTTPS)</li>
            <li>Access controls and authentication</li>
            <li>Regular security reviews</li>
            <li>Staff training on data protection</li>
            <li>Audit logging of access and changes</li>
            <li>Row-level security in our database</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">9. Cookies</h2>
          <p className="mb-4">
            We use essential cookies for authentication and session management. 
            These are necessary for the service to function and cannot be disabled.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">10. Children&apos;s Privacy</h2>
          <p className="mb-4">
            Our services are not intended for children under 18. We do not knowingly 
            collect data from children. Age verification is required for certain services.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">11. International Transfers</h2>
          <p className="mb-4">
            Your data may be processed outside the UK/EEA by our service providers 
            (e.g., Twilio in the US). We ensure appropriate safeguards are in place 
            through standard contractual clauses.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">12. Marketing Communications</h2>
          <p className="mb-4">
            If you have opted in to receive marketing communications:
          </p>
          <ul className="list-disc pl-6 mb-4 space-y-1">
            <li>You can opt out at any time by replying STOP to SMS messages</li>
            <li>We will only send relevant communications about our events and offers</li>
            <li>Your consent is recorded with timestamp and version</li>
            <li>We respect your communication preferences</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">13. Complaints</h2>
          <p className="mb-4">
            If you have concerns about our data processing, please contact us first. 
            You also have the right to complain to the Information Commissioner&apos;s Office (ICO):
          </p>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p>Information Commissioner&apos;s Office<br />
            Wycliffe House<br />
            Water Lane<br />
            Wilmslow<br />
            Cheshire SK9 5AF<br />
            Website: <a href="https://ico.org.uk" className="text-blue-600 hover:underline">ico.org.uk</a></p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">14. Changes to This Policy</h2>
          <p className="mb-4">
            We may update this policy from time to time. We will notify you of significant 
            changes via email or through the service. The &quot;Last updated&quot; date at the top 
            shows when this policy was last revised.
          </p>
        </section>

        <section className="border-t pt-8">
          <h2 className="text-2xl font-semibold mb-4">15. Contact Us</h2>
          <p className="mb-4">
            For any questions about this privacy policy or your personal data:
          </p>
          <div className="bg-blue-50 p-6 rounded-lg">
            <p className="font-semibold mb-2">Data Protection Contact:</p>
            <p>Email: <a href="mailto:privacy@theanchorpub.co.uk" className="text-blue-600 hover:underline">privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707<br />
            Post: The Anchor, Horton Road, Staines-upon-Thames, Surrey TW19 6BJ</p>
          </div>
        </section>
      </div>
    </div>
  );
}