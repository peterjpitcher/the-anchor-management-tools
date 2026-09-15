# Vendor PayPal setting design

Date: 15 September 2026

## Outcome

Staff can decide which invoice vendors are offered online payment by card or PayPal. The choice is made once on the vendor record and is honoured by every invoice email and payment-link route. The invoice PDF remains unchanged.

## Agreed behaviour

- Add an **Offer PayPal/card payment** checkbox to the invoice vendor add and edit form.
- The checkbox is off by default for all existing and new vendors.
- Enable the setting initially for **Sidemen Entertainment Limited**. No other existing vendor is enabled during rollout.
- An enabled vendor receives the secure invoice payment-page link in manual invoice emails, chasers, reminders and automatic invoice sends.
- A disabled vendor receives the invoice PDF and normal email wording without the payment link.
- The invoice PDF never contains the payment link.
- Staff payment-link controls are not shown for a disabled vendor.
- Server actions reject attempts to create, copy or email a payment link for a disabled vendor, even if called without the user interface.
- The public invoice payment page does not offer a new payment when the vendor is disabled. This also makes previously emailed links unavailable after the setting is switched off.
- A PayPal payment that completed before the setting changed is still recorded. Disabling the setting must not hide or lose money already captured.
- Paid, void and written-off invoices continue to follow their existing rules regardless of the vendor setting.

## Data design

Add `paypal_payments_enabled boolean NOT NULL DEFAULT false` to `public.invoice_vendors`.

The setting belongs to the vendor rather than the invoice because the owner wants a stable customer policy. Changing the vendor setting affects all unpaid invoices for that vendor, including old invoice links. No PayPal setting or link is stored on the PDF or copied into invoice rows.

The migration adds one column, assigns the safe default to existing rows, and enables the uniquely verified Sidemen Entertainment Limited vendor row `ed3bb6b9-01a5-4894-b54f-b83fe73cc52b`. Live invoice `INV-003WP` belongs to that vendor and has £420 outstanding. The live schema has no views depending on `invoice_vendors`. Existing functions that read the table do not need their interfaces changed. Current grants and row-level security remain unchanged.

## Application design

The vendor form reads and writes the new boolean through the existing authenticated vendor actions and service. The existing `invoices:create` and `invoices:edit` permissions continue to control who may set it. Vendor create and update audit entries include the resulting PayPal setting.

Invoice eligibility has two independent conditions:

1. The invoice has an outstanding payable balance.
2. Its vendor has PayPal payments enabled.

A shared pure helper owns this decision. The email footer, staff actions and public page use the same rule so the interfaces cannot disagree.

Every invoice email continues to pass through `sendInvoiceEmail`. The payment footer is appended there only when the shared rule allows it. Explicit vendor projections used by the automatic-send and reminder jobs include the new field; paths already selecting the full vendor row need no special query.

The invoice detail page hides **Email payment link** and **Copy payment link** when the vendor setting is off. The normal **Email** action remains available and still attaches the invoice PDF.

The public payment page shows a clear unavailable message when PayPal is disabled. Capture and reconciliation paths remain able to record a completed PayPal capture so money already moved is never discarded.

## Failure handling

- The database default fails closed: a missing or unknown setting means no PayPal option.
- Direct calls to payment-link server actions return a clear disabled message.
- An invoice email still sends successfully without the PayPal footer when the vendor is disabled.
- Existing email suspension, recipient validation, PayPal idempotency, amount checks, webhooks and reconciliation safeguards remain in place.

## Verification

- Migration validation in a rolled-back transaction, including default, nullability and existing rows.
- Regenerated Supabase database types.
- Vendor create and update tests for enabled and disabled values.
- Email footer tests proving enabled vendors get the link and disabled vendors do not.
- Payment action tests proving disabled vendors cannot receive or create new links.
- Invoice detail and public portal tests for the enabled and disabled states.
- Capture test proving a completed PayPal payment is still recorded after the setting is switched off.
- Existing invoice PDF tests proving no payment link enters the document.
- Lint, TypeScript, focused tests, full test suite and production build.
- Supabase anonymous-surface assertion and migration parity checks before any production application.

## Delivery and rollback

Implementation is split into two independently safe changes:

1. Add the database column with a false default, enable the verified Sidemen Entertainment Limited row, and update generated types. Current application behaviour remains safe because the application has not yet started reading the setting.
2. Add the vendor control and enforce the setting across emails and payment routes.

The migration will be prepared and tested locally but not applied to production without a separate explicit approval. Application deployment must follow the production migration because the new code reads the column. Rolling back the application restores the previous behaviour; the additive database column can remain safely in place.

## Out of scope

- Choosing PayPal separately on each invoice.
- Adding the payment link to PDFs.
- Changing payment amounts, PayPal credentials, fees, refunds or settlement behaviour.
- Sending a live invoice. Sidemen Entertainment Limited is enabled only when the approved production migration is applied.
