import { Metadata } from 'next'
import { GUEST_SUNK_BOX_CLASS, GuestShell } from '@/components/features/guest'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Privacy Policy - The Anchor',
  description: 'Privacy policy for The Anchor Management Tools',
}

/**
 * The privacy policy is the one guest surface with a hero, because it is a
 * document rather than a task.
 *
 * The controller identity and postal address were corrected by the owner on
 * 2026-08-05 to Orange Jelly Limited at Stanwell Moor Village TW19 6AQ, which
 * now matches `COMPANY_DETAILS` and the shared guest footer. The previous
 * Staines-upon-Thames TW19 6BJ address was wrong.
 *
 * Still outstanding: the `privacy@theanchorpub.co.uk` mailbox is on a domain
 * that does not match either the company or the pub, and the owner has not yet
 * confirmed whether it is monitored. Everything else is unchanged wording.
 */

/** One numbered section: heading plus its paragraphs and lists. */
const SECTION_CLASS = 'flex flex-col gap-2.5'

const H2_CLASS = 'font-anchor-display text-[21px] font-normal leading-[1.3] text-guest-text-strong'

const P_CLASS = 'font-anchor-body text-[15px] leading-[1.7] text-guest-text'

/** Sub-labels such as "2.1 Information You Provide". */
const SUB_LABEL_CLASS = 'font-anchor-body text-[14px] leading-[1.5] text-guest-text-strong'

const UL_CLASS =
  'list-disc space-y-[5px] pl-5 font-anchor-body text-[15px] leading-[1.6] text-guest-text'

const LINK_CLASS =
  'font-semibold text-guest-accent-text underline underline-offset-[3px] hover:no-underline'

/** Data Controller, ICO and Contact Us blocks sit in the recessed panel. */
const CONTACT_BOX_CLASS = cn(GUEST_SUNK_BOX_CLASS, 'p-[15px] text-[14px] leading-[1.7]')

export default function PrivacyPolicy() {
  const lastUpdated = new Date('2024-12-21').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    // The hero has to run full bleed under the brand bar, so the shell's own
    // column width and padding are dropped here and re-applied to the prose
    // column below. This is the only guest page that does that.
    <GuestShell
      maxWidthClassName="max-w-none"
      bodyClassName="gap-0 px-0 pt-0 pb-0 sm:px-0 sm:pt-0 sm:pb-0"
    >
      <section className="w-full bg-anchor-green-deep px-5 py-8">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2">
          <p className="font-anchor-body text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-anchor-gold-bright">
            The Anchor
          </p>
          <h1 className="font-anchor-display text-[34px] font-normal leading-[1.2] tracking-[-0.02em] text-anchor-cream-text">
            Privacy Policy
          </h1>
          <p className="font-anchor-body text-[14px] leading-[1.5] text-anchor-cream-text/70">
            Last updated: {lastUpdated}
          </p>
        </div>
      </section>

      <article className="mx-auto flex w-full max-w-[560px] flex-col gap-[22px] px-[18px] pb-[34px] pt-7">
        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>1. Introduction</h2>
          <p className={P_CLASS}>
            The Anchor (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data.
            This privacy policy explains how we collect, use, and protect your information
            when you use our management tools and services.
          </p>
          <p className={CONTACT_BOX_CLASS}>
            <strong>Data Controller:</strong><br />
            Orange Jelly Limited<br />
            The Anchor<br />
            Horton Road<br />
            Stanwell Moor Village<br />
            Surrey TW19 6AQ<br />
            Email: <a href="mailto:privacy@theanchorpub.co.uk" className={LINK_CLASS}>privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>2. Information We Collect</h2>
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
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>3. Legal Basis for Processing</h2>
          <p className={P_CLASS}>We process your personal data based on:</p>
          <ul className={UL_CLASS}>
            <li><strong>Contract:</strong> To manage your bookings and provide our services</li>
            <li><strong>Legitimate Interests:</strong> For customer service, security, and business improvement</li>
            <li><strong>Consent:</strong> For marketing communications (SMS/email)</li>
            <li><strong>Legal Obligations:</strong> To comply with laws and regulations</li>
          </ul>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>4. How We Use Your Information</h2>
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
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>5. Data Sharing</h2>
          <p className={P_CLASS}>We may share your data with:</p>
          <ul className={UL_CLASS}>
            <li><strong>Service Providers:</strong> Twilio (SMS), Supabase (database), payment processors</li>
            <li><strong>Legal Requirements:</strong> When required by law or court order</li>
            <li><strong>Business Transfers:</strong> In case of merger or acquisition</li>
          </ul>
          <p className={P_CLASS}><strong>We never sell your personal data.</strong></p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>6. Data Retention</h2>
          <ul className={UL_CLASS}>
            <li><strong>Customer data:</strong> 2 years after last interaction</li>
            <li><strong>Booking records:</strong> 7 years for tax purposes</li>
            <li><strong>Employee records:</strong> 7 years after employment ends</li>
            <li><strong>Marketing consent:</strong> Until withdrawn</li>
            <li><strong>Audit logs:</strong> 7 years for compliance</li>
            <li><strong>Messages:</strong> 2 years</li>
          </ul>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>7. Your Rights</h2>
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
            <a href="mailto:privacy@theanchorpub.co.uk" className={LINK_CLASS}>privacy@theanchorpub.co.uk</a>
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>8. Data Security</h2>
          <p className={P_CLASS}>We implement appropriate technical and organizational measures to protect your data, including:</p>
          <ul className={UL_CLASS}>
            <li>Encryption in transit (HTTPS)</li>
            <li>Access controls and authentication</li>
            <li>Regular security reviews</li>
            <li>Staff training on data protection</li>
            <li>Audit logging of access and changes</li>
            <li>Row-level security in our database</li>
          </ul>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>9. Cookies</h2>
          <p className={P_CLASS}>
            We use essential cookies for authentication and session management.
            These are necessary for the service to function and cannot be disabled.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>10. Children&apos;s Privacy</h2>
          <p className={P_CLASS}>
            Our services are not intended for children under 18. We do not knowingly
            collect data from children. Age verification is required for certain services.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>11. International Transfers</h2>
          <p className={P_CLASS}>
            Your data may be processed outside the UK/EEA by our service providers
            (e.g., Twilio in the US). We ensure appropriate safeguards are in place
            through standard contractual clauses.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>12. Marketing Communications</h2>
          <p className={P_CLASS}>If you have opted in to receive marketing communications:</p>
          <ul className={UL_CLASS}>
            <li>You can opt out at any time by replying STOP to SMS messages</li>
            <li>We will only send relevant communications about our events and offers</li>
            <li>Your consent is recorded with timestamp and version</li>
            <li>We respect your communication preferences</li>
          </ul>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>13. Complaints</h2>
          <p className={P_CLASS}>
            If you have concerns about our data processing, please contact us first.
            You also have the right to complain to the Information Commissioner&apos;s Office (ICO):
          </p>
          <p className={CONTACT_BOX_CLASS}>
            Information Commissioner&apos;s Office<br />
            Wycliffe House<br />
            Water Lane<br />
            Wilmslow<br />
            Cheshire SK9 5AF<br />
            Website: <a href="https://ico.org.uk" referrerPolicy="no-referrer" className={LINK_CLASS}>ico.org.uk</a>
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>14. Changes to This Policy</h2>
          <p className={P_CLASS}>
            We may update this policy from time to time. We will notify you of significant
            changes via email or through the service. The &quot;Last updated&quot; date at the top
            shows when this policy was last revised.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={H2_CLASS}>15. Contact Us</h2>
          <p className={P_CLASS}>For any questions about this privacy policy or your personal data:</p>
          <p className={CONTACT_BOX_CLASS}>
            <strong>Data Protection Contact:</strong><br />
            Email: <a href="mailto:privacy@theanchorpub.co.uk" className={LINK_CLASS}>privacy@theanchorpub.co.uk</a><br />
            Phone: 01753 682 707<br />
            Post: Orange Jelly Limited, The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ
          </p>
        </section>
      </article>
    </GuestShell>
  )
}
