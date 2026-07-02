import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy - The Anchor',
  description: 'Privacy policy for The Anchor Management Tools',
}

export default function PrivacyPolicy() {
  const lastUpdated = new Date('2024-12-21').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="public">
      <div className="public__hero public__hero--slim">
        <div className="public__hero-bg" />
        <div className="public__hero-inner">
          <div className="public__brand-mini">The Anchor</div>
          <h1 className="public__hero-title">Privacy Policy</h1>
          <p className="public__hero-sub">Last updated: {lastUpdated}</p>
        </div>
      </div>

      <div className="public__main public__main--prose">
        <article className="public__prose">
          <h2>1. Introduction</h2>
          <p>
            The Anchor (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data.
            This privacy policy explains how we collect, use, and protect your information
            when you use our management tools and services.
          </p>
          <p>
            <strong>Data Controller:</strong><br />
            The Anchor<br />
            Horton Road<br />
            Staines-upon-Thames<br />
            Surrey TW19 6BJ<br />
            Email: <a href="mailto:privacy@theanchorpub.co.uk">privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707
          </p>

          <h2>2. Information We Collect</h2>
          <p><strong>2.1 Information You Provide</strong></p>
          <ul>
            <li>Name and contact details (email, phone number)</li>
            <li>Date of birth (for age verification)</li>
            <li>Booking information and preferences</li>
            <li>Payment information (processed securely by third parties)</li>
            <li>Communications with us</li>
            <li>Employee information (for staff members)</li>
          </ul>
          <p><strong>2.2 Information We Collect Automatically</strong></p>
          <ul>
            <li>Login information and access times</li>
            <li>IP address and device information</li>
            <li>Usage data and preferences</li>
            <li>Audit logs of system activities</li>
          </ul>

          <h2>3. Legal Basis for Processing</h2>
          <p>We process your personal data based on:</p>
          <ul>
            <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
            <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
            <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
            <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
          </ul>

          <h2>4. How We Use Your Information</h2>
          <ul>
            <li>Process and manage bookings</li>
            <li>Send booking confirmations and reminders</li>
            <li>Provide customer support</li>
            <li>Send marketing communications (with consent)</li>
            <li>Improve our services</li>
            <li>Comply with legal obligations</li>
            <li>Prevent fraud and ensure security</li>
            <li>Manage employee records and payroll</li>
          </ul>
          <p>
            If you choose to leave your name, email or phone number with feedback, we&apos;ll only use it to contact you about that feedback.
          </p>

          <h2>5. Data Sharing</h2>
          <p>We may share your data with:</p>
          <ul>
            <li><strong>Service Providers:</strong> Twilio (SMS), Supabase (database), payment processors</li>
            <li><strong>Legal Requirements:</strong> When required by law or court order</li>
            <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
          </ul>
          <p><strong>We never sell your personal data.</strong></p>

          <h2>6. Data Retention</h2>
          <ul>
            <li><strong>Customer data:</strong> 2 years after last interaction</li>
            <li><strong>Booking records:</strong> 7 years for tax purposes</li>
            <li><strong>Employee records:</strong> 7 years after employment ends</li>
            <li><strong>Marketing consent:</strong> Until withdrawn</li>
            <li><strong>Audit logs:</strong> 7 years for compliance</li>
            <li><strong>Messages:</strong> 2 years</li>
          </ul>

          <h2>7. Your Rights</h2>
          <p>Under GDPR, you have the right to:</p>
          <ul>
            <li><strong>Access</strong> -- Request a copy of your personal data</li>
            <li><strong>Rectification</strong> -- Correct inaccurate data</li>
            <li><strong>Erasure</strong> -- Request deletion of your data</li>
            <li><strong>Portability</strong> -- Receive your data in a portable format</li>
            <li><strong>Object</strong> -- Object to certain processing</li>
            <li><strong>Restrict</strong> -- Limit how we use your data</li>
          </ul>
          <p>
            To exercise these rights, contact us at{' '}
            <a href="mailto:privacy@theanchorpub.co.uk">privacy@theanchorpub.co.uk</a>
          </p>

          <h2>8. Data Security</h2>
          <p>We implement appropriate technical and organizational measures to protect your data, including:</p>
          <ul>
            <li>Encryption in transit (HTTPS)</li>
            <li>Access controls and authentication</li>
            <li>Regular security reviews</li>
            <li>Staff training on data protection</li>
            <li>Audit logging of access and changes</li>
            <li>Row-level security in our database</li>
          </ul>

          <h2>9. Cookies</h2>
          <p>
            We use essential cookies for authentication and session management.
            These are necessary for the service to function and cannot be disabled.
          </p>

          <h2>10. Children&apos;s Privacy</h2>
          <p>
            Our services are not intended for children under 18. We do not knowingly
            collect data from children. Age verification is required for certain services.
          </p>

          <h2>11. International Transfers</h2>
          <p>
            Your data may be processed outside the UK/EEA by our service providers
            (e.g., Twilio in the US). We ensure appropriate safeguards are in place
            through standard contractual clauses.
          </p>

          <h2>12. Marketing Communications</h2>
          <p>If you have opted in to receive marketing communications:</p>
          <ul>
            <li>You can opt out at any time by replying STOP to SMS messages</li>
            <li>We will only send relevant communications about our events and offers</li>
            <li>Your consent is recorded with timestamp and version</li>
            <li>We respect your communication preferences</li>
          </ul>

          <h2>13. Complaints</h2>
          <p>
            If you have concerns about our data processing, please contact us first.
            You also have the right to complain to the Information Commissioner&apos;s Office (ICO):
          </p>
          <p>
            Information Commissioner&apos;s Office<br />
            Wycliffe House<br />
            Water Lane<br />
            Wilmslow<br />
            Cheshire SK9 5AF<br />
            Website: <a href="https://ico.org.uk">ico.org.uk</a>
          </p>

          <h2>14. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. We will notify you of significant
            changes via email or through the service. The &quot;Last updated&quot; date at the top
            shows when this policy was last revised.
          </p>

          <h2>15. Contact Us</h2>
          <p>For any questions about this privacy policy or your personal data:</p>
          <p>
            <strong>Data Protection Contact:</strong><br />
            Email: <a href="mailto:privacy@theanchorpub.co.uk">privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707<br />
            Post: The Anchor, Horton Road, Staines-upon-Thames, Surrey TW19 6BJ
          </p>
        </article>
      </div>

      <div className="public__footer">
        <span>&copy; {new Date().getFullYear()} The Anchor, Staines-upon-Thames</span>
        <div>
          <a href="/privacy" className="public__link">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}
