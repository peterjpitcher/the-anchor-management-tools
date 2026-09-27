import { Metadata } from 'next'
import {
  GuestEmailLink,
  GuestIntro,
  GuestLink,
  GuestSection,
  GuestShell,
  GUEST_SUNK_BOX_CLASS,
} from '@/components/features/guest'

export const metadata: Metadata = {
  title: 'Privacy Policy - The Anchor',
  description: 'Privacy policy for The Anchor Management Tools',
}

/**
 * The privacy policy is a document rather than a task, so it takes the wide
 * guest column. It opens with the same intro block as every other guest page;
 * the full-bleed dark hero it once had was the only guest page that overrode the
 * shell's width and padding, and it now follows the shell like the rest.
 *
 * The controller identity and postal address were corrected by the owner on
 * 2026-08-05 to Orange Jelly Limited at Stanwell Moor Village TW19 6AQ, which
 * now matches `COMPANY_DETAILS` and the shared guest footer. The previous
 * Staines-upon-Thames TW19 6BJ address was wrong.
 *
 * The contact mailbox was changed on 2026-08-06 from `privacy@theanchorpub.co.uk`,
 * which the owner confirmed is not used, to the single guest contact address in
 * `GUEST_CONTACT`. Everything else is unchanged wording.
 */

/** Policy prose reads at the lead size, a step up from body copy. */
const P_CLASS = 'font-anchor-body text-guest-lead text-guest-text'

/** Sub-labels such as "2.1 Information You Provide". */
const SUB_LABEL_CLASS = 'font-anchor-body text-guest-body text-guest-text-strong'

const UL_CLASS = 'flex list-disc flex-col gap-guest-2xs pl-5 font-anchor-body text-guest-lead text-guest-text'

export default function PrivacyPolicy() {
  const lastUpdated = new Date('2024-12-21').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <GuestShell width="wide">
      <GuestIntro kicker="The Anchor" title="Privacy Policy" lead={`Last updated: ${lastUpdated}`} />

      <GuestSection title="1. Introduction" titleId="privacy-1">
        <p className={P_CLASS}>
          The Anchor (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data.
          This privacy policy explains how we collect, use, and protect your information
          when you use our management tools and services.
        </p>
        <p className={GUEST_SUNK_BOX_CLASS}>
          <strong>Data Controller:</strong><br />
          Orange Jelly Limited<br />
          The Anchor<br />
          Horton Road<br />
          Stanwell Moor Village<br />
          Surrey TW19 6AQ<br />
          Email: <GuestEmailLink /><br />
          Phone: 01753 682 707
        </p>
      </GuestSection>

      <GuestSection title="2. Information We Collect" titleId="privacy-2">
        <p className={SUB_LABEL_CLASS}><strong>2.1 Information You Provide</strong></p>
        <ul className={UL_CLASS}>
          <li>Name and contact details (email, phone number)</li>
          <li>Date of birth (for age verification)</li>
          <li>Booking information and preferences</li>
          <li>Payment information (processed securely by third parties)</li>
          <li>Communications with us</li>
          <li>Employee information (for staff members)</li>
        </ul>
        <p className={SUB_LABEL_CLASS}><strong>2.2 Information We Collect Automatically</strong></p>
        <ul className={UL_CLASS}>
          <li>Login information and access times</li>
          <li>IP address and device information</li>
          <li>Usage data and preferences</li>
          <li>Audit logs of system activities</li>
        </ul>
      </GuestSection>

      <GuestSection title="3. Legal Basis for Processing" titleId="privacy-3">
        <p className={P_CLASS}>We process your personal data based on:</p>
        <ul className={UL_CLASS}>
          <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
          <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
          <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
          <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
        </ul>
      </GuestSection>

      <GuestSection title="4. How We Use Your Information" titleId="privacy-4">
        <ul className={UL_CLASS}>
          <li>Process and manage bookings</li>
          <li>Send booking confirmations and reminders</li>
          <li>Provide customer support</li>
          <li>Send marketing communications (with consent)</li>
          <li>Improve our services</li>
          <li>Comply with legal obligations</li>
          <li>Prevent fraud and ensure security</li>
          <li>Manage employee records and payroll</li>
        </ul>
        <p className={P_CLASS}>
          If you choose to leave your name, email or phone number with feedback, we&apos;ll only use it to contact you about that feedback.
        </p>
      </GuestSection>

      <GuestSection title="5. Data Sharing" titleId="privacy-5">
        <p className={P_CLASS}>We may share your data with:</p>
        <ul className={UL_CLASS}>
          <li><strong>Service Providers:</strong> Twilio (SMS), Supabase (database), payment processors</li>
          <li><strong>Legal Requirements:</strong> When required by law or court order</li>
          <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
        </ul>
        <p className={P_CLASS}><strong>We never sell your personal data.</strong></p>
      </GuestSection>

      <GuestSection title="6. Data Retention" titleId="privacy-6">
        <ul className={UL_CLASS}>
          <li><strong>Customer data:</strong> 2 years after last interaction</li>
          <li><strong>Booking records:</strong> 7 years for tax purposes</li>
          <li><strong>Employee records:</strong> 7 years after employment ends</li>
          <li><strong>Marketing consent:</strong> Until withdrawn</li>
          <li><strong>Audit logs:</strong> 7 years for compliance</li>
          <li><strong>Messages:</strong> 2 years</li>
        </ul>
      </GuestSection>

      <GuestSection title="7. Your Rights" titleId="privacy-7">
        <p className={P_CLASS}>Under GDPR, you have the right to:</p>
        <ul className={UL_CLASS}>
          <li><strong>Access</strong> -- Request a copy of your personal data</li>
          <li><strong>Rectification</strong> -- Correct inaccurate data</li>
          <li><strong>Erasure</strong> -- Request deletion of your data</li>
          <li><strong>Portability</strong> -- Receive your data in a portable format</li>
          <li><strong>Object</strong> -- Object to certain processing</li>
          <li><strong>Restrict</strong> -- Limit how we use your data</li>
        </ul>
        <p className={P_CLASS}>
          To exercise these rights, contact us at{' '}
          <GuestEmailLink />
        </p>
      </GuestSection>

      <GuestSection title="8. Data Security" titleId="privacy-8">
        <p className={P_CLASS}>We implement appropriate technical and organizational measures to protect your data, including:</p>
        <ul className={UL_CLASS}>
          <li>Encryption in transit (HTTPS)</li>
          <li>Access controls and authentication</li>
          <li>Regular security reviews</li>
          <li>Staff training on data protection</li>
          <li>Audit logging of access and changes</li>
          <li>Row-level security in our database</li>
        </ul>
      </GuestSection>

      <GuestSection title="9. Cookies" titleId="privacy-9">
        <p className={P_CLASS}>
          We use essential cookies for authentication and session management.
          These are necessary for the service to function and cannot be disabled.
        </p>
      </GuestSection>

      <GuestSection title="10. Children's Privacy" titleId="privacy-10">
        <p className={P_CLASS}>
          Our services are not intended for children under 18. We do not knowingly
          collect data from children. Age verification is required for certain services.
        </p>
      </GuestSection>

      <GuestSection title="11. International Transfers" titleId="privacy-11">
        <p className={P_CLASS}>
          Your data may be processed outside the UK/EEA by our service providers
          (e.g., Twilio in the US). We ensure appropriate safeguards are in place
          through standard contractual clauses.
        </p>
      </GuestSection>

      <GuestSection title="12. Marketing Communications" titleId="privacy-12">
        <p className={P_CLASS}>If you have opted in to receive marketing communications:</p>
        <ul className={UL_CLASS}>
          <li>You can opt out at any time by replying STOP to SMS messages</li>
          <li>We will only send relevant communications about our events and offers</li>
          <li>Your consent is recorded with timestamp and version</li>
          <li>We respect your communication preferences</li>
        </ul>
      </GuestSection>

      <GuestSection title="13. Complaints" titleId="privacy-13">
        <p className={P_CLASS}>
          If you have concerns about our data processing, please contact us first.
          You also have the right to complain to the Information Commissioner&apos;s Office (ICO):
        </p>
        <p className={GUEST_SUNK_BOX_CLASS}>
          Information Commissioner&apos;s Office<br />
          Wycliffe House<br />
          Water Lane<br />
          Wilmslow<br />
          Cheshire SK9 5AF<br />
          Website: <GuestLink href="https://ico.org.uk">ico.org.uk</GuestLink>
        </p>
      </GuestSection>

      <GuestSection title="14. Changes to This Policy" titleId="privacy-14">
        <p className={P_CLASS}>
          We may update this policy from time to time. We will notify you of significant
          changes via email or through the service. The &quot;Last updated&quot; date at the top
          shows when this policy was last revised.
        </p>
      </GuestSection>

      <GuestSection title="15. Contact Us" titleId="privacy-15">
        <p className={P_CLASS}>For any questions about this privacy policy or your personal data:</p>
        <p className={GUEST_SUNK_BOX_CLASS}>
          <strong>Data Protection Contact:</strong><br />
          Email: <GuestEmailLink /><br />
          Phone: 01753 682 707<br />
          Post: Orange Jelly Limited, The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ
        </p>
      </GuestSection>
    </GuestShell>
  )
}
