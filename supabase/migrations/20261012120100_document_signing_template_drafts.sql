-- Document signing: starter wording for the template kinds (tasks/plan-2026-10-12-document-signing.md).
--
-- Data only. Twelve rows in signing_templates, every one SWITCHED OFF (is_active = false).
--
-- This is draft wording, written to be edited, not legal advice. Each template opens with a
-- [[TO CONFIRM: ...]] line and marks every business-specific fact the same way. The app refuses
-- to switch a template on, or to send it, while any such marker remains, so none of this can
-- reach a person until the owner has read it, filled the gaps and switched it on in
-- Settings, Signing templates.
--
-- ON CONFLICT DO NOTHING on the slug: running this again never overwrites wording the owner has
-- since edited.

BEGIN;

INSERT INTO public.signing_templates (kind, slug, title, body) VALUES

('terms_variation', 'terms-variation', 'Change to your terms', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your HR or legal adviser before switching it on]]

## Who this is between
This is an agreed change to the terms between Orange Jelly Limited, trading as The Anchor, and {{worker_name}}.

## What is changing
{{change_summary}}

## When it starts
The change applies from {{effective_date}}.

## Everything else stays the same
All the other terms of your agreement with us carry on unchanged. If anything in this document conflicts with your existing agreement, this document applies.

## Agreement
By signing, you confirm that you have read this change, that you have had the chance to ask questions about it, and that you agree to it.

Issued by {{manager_name}} on {{date_today}}.$body$),

('deduction_consent', 'deduction-consent', 'Agreement to deductions from wages', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your HR or legal adviser before switching it on]]

## Who this is between
This is an agreement between Orange Jelly Limited, trading as The Anchor, and {{worker_name}}.

## Why we are asking
The law says an employer may only take money from a worker's wages in limited cases. One of them is where the worker has agreed to it in writing beforehand. This document is that agreement. It only covers what is set out below.

## What may be deducted
{{deduction_details}}

## The limits we will keep to
- We will only deduct for the things listed above.
- We will tell you the amount and the reason before any deduction is made.
- Every deduction will be shown on your payslip.
- [[TO CONFIRM: any limit you want to set, for example a maximum amount per pay period]]
- We will keep to the legal limits on deductions, including the rules on the minimum wage and on shortages in retail work.

## If you disagree with a deduction
Speak to {{manager_name}} first. You can also raise it in writing. Signing this does not take away any of your legal rights.

## Agreement
By signing, you agree that the deductions described above may be made from your wages.

Issued by {{manager_name}} on {{date_today}}.$body$),

('working_time_opt_out', 'working-time-opt-out', 'Opting out of the 48-hour working week', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your HR or legal adviser before switching it on]]

## Who this is between
This is an agreement between Orange Jelly Limited, trading as The Anchor, and {{worker_name}}.

## What the law says
Under the Working Time Regulations 1998, most workers cannot be required to work more than 48 hours a week on average. A worker who is 18 or over can choose to give up that limit by agreeing in writing.

## What you are agreeing to
You agree that the 48-hour average weekly limit will not apply to you while you work for us.

## This is your choice
- You do not have to sign this. You will not be treated any worse if you say no.
- You are still entitled to your rest breaks, daily rest, weekly rest and paid holiday.
- We will keep a record of the hours you work.

## Changing your mind
You can cancel this agreement at any time by telling us in writing. It will end [[TO CONFIRM: the notice period you want, which must be between 7 days and 3 months]] after you tell us.

## Agreement
By signing, you confirm that you are 18 or over, that you have read this and that you agree to opt out of the 48-hour limit.

Issued by {{manager_name}} on {{date_today}}.$body$),

('guardian_consent', 'guardian-consent', 'Parent or guardian consent', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your HR or legal adviser before switching it on]]

## Who this is about
{{worker_name}} is under 18 and has been offered work with Orange Jelly Limited, trading as The Anchor. We ask a parent or guardian to confirm they are happy for them to work with us.

## What the work involves
[[TO CONFIRM: a short description of the work a young worker does with you, and anything they are not allowed to do]]

## How we look after young workers
- We follow the legal limits on hours and rest for workers under 18.
- A young worker will not serve or sell alcohol except as the law allows and under supervision.
- We carry out a risk assessment for young workers and will share it with you if you ask.
- [[TO CONFIRM: who a parent or guardian should contact with a concern, and how]]

## Your consent
By signing, you confirm that you are the parent or guardian of {{worker_name}}, that you have read this, and that you agree to them working with us.

Signed by {{guardian_name}}.

Issued by {{manager_name}} on {{date_today}}.$body$),

('job_offer', 'job-offer', 'Offer of work at The Anchor', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your HR or legal adviser before switching it on]]

## The offer
{{candidate_name}}, we are pleased to offer you work at The Anchor as {{job_title}}.

## Start date
We would like you to start on {{start_date}}.

## Pay
{{pay_details}}

## What happens next
- This offer depends on you showing us proof of your right to work in the UK before your first shift.
- [[TO CONFIRM: anything else the offer depends on, such as references]]
- Once you accept, we will send you a link to complete your details and your worker agreement.

## Accepting
By signing, you accept this offer on the terms above. If you would rather not accept, use the decline option and tell us why if you are happy to.

Offered by {{manager_name}} on {{date_today}}.$body$),

('client_agreement', 'client-agreement', 'Services agreement', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your legal adviser before switching it on]]

## Who this is between
This agreement is between Orange Jelly Limited and {{client_name}}.

## What we will do
{{services_summary}}

## Fees
{{fees_summary}}

## Start date
This agreement starts on {{start_date}}.

## Payment
We invoice [[TO CONFIRM: when you invoice, for example monthly in arrears]]. Invoices are due within [[TO CONFIRM: your payment terms in days]] days of the invoice date.

## Changes
Either of us can propose a change to the work or the fees. A change takes effect once we have both agreed it in writing.

## Ending the agreement
Either of us can end this agreement by giving [[TO CONFIRM: notice period]] notice in writing. Work done up to the end date will be invoiced and is payable.

## Confidentiality
We will each keep the other's confidential information private and use it only for the work under this agreement.

## Law
This agreement is governed by the law of England and Wales.

## Agreement
By signing, you confirm that you have authority to agree this on behalf of {{client_name}} and that you agree to it.

Issued by {{manager_name}} on {{date_today}}.$body$),

('supplier_confirmation', 'supplier-confirmation', 'Booking confirmation', $body$[[TO CONFIRM: starter wording. Read it, change it to suit, and have it checked by your legal adviser before switching it on]]

## Who this is between
This confirms a booking between Orange Jelly Limited, trading as The Anchor, and {{supplier_name}}.

## What you are providing
{{service_summary}}

## When
{{event_date}}

## Fee
{{fee_summary}}

## On the day
- Please arrive in good time to set up before the start.
- You are responsible for your own equipment and for holding any insurance your work needs.
- [[TO CONFIRM: anything else you need from suppliers, such as public liability insurance or PAT testing certificates]]

## If plans change
- If you can no longer attend, tell us as soon as you know.
- If we cancel, [[TO CONFIRM: what you pay a supplier if you cancel, and how much notice counts]]
- If you cancel, [[TO CONFIRM: what you expect from a supplier who cancels]]

## Agreement
By signing, you confirm the booking on the terms above.

Issued by {{manager_name}} on {{date_today}}.$body$),

('policy_acknowledgement', 'staff-handbook', 'Staff handbook', $body$[[TO CONFIRM: starter outline only. Replace every section with how The Anchor actually works before switching it on]]

## Welcome
This handbook sets out how we work at The Anchor and what we expect of each other. Please read all of it. If anything is unclear, ask your manager.

## Hours, rota and time off
[[TO CONFIRM: how the rota is published, how to swap a shift, and how to ask for holiday]]

## Clocking in and out
[[TO CONFIRM: how staff clock in and out, and what to do if they forget]]

## Pay
[[TO CONFIRM: when and how staff are paid, and who to speak to about a pay query]]

## Sickness and lateness
[[TO CONFIRM: who to tell, how, and by when, if you are ill or running late]]

## Uniform and appearance
[[TO CONFIRM: what staff wear and what is provided]]

## Conduct
- Treat customers and colleagues with respect.
- Do not work under the influence of alcohol or drugs.
- Mobile phones stay away while you are serving.
- [[TO CONFIRM: anything else you want to set out, such as staff drinks and discounts]]

## Raising a concern
If something is wrong, tell your manager. If the concern is about your manager, tell [[TO CONFIRM: who else staff can go to]].

## Changes to this handbook
We may update this handbook from time to time. When we do, we will ask you to read and confirm the new version.$body$),

('policy_acknowledgement', 'health-and-safety', 'Health and safety policy', $body$[[TO CONFIRM: starter outline only. Check it against your own risk assessments before switching it on]]

## Why this matters
Everyone who works here has a part in keeping themselves, their colleagues and our customers safe.

## What we expect from you
- Follow the training and instructions you are given.
- Use the equipment provided, and use it properly.
- Clean up spills straight away and put out a wet floor sign.
- Lift safely, and ask for help with anything heavy or awkward.
- Never block a fire exit or prop open a fire door.
- Report anything unsafe, and any near miss, to your manager straight away.

## Fire
[[TO CONFIRM: what to do when the alarm sounds, and where the assembly point is]]

## First aid and accidents
[[TO CONFIRM: where the first aid kit is, who the first aiders are, and how an accident is recorded]]

## Cellar and deliveries
[[TO CONFIRM: your rules for the cellar, gas and deliveries, including who is allowed to do what]]

## Cleaning chemicals
Only use a product you have been shown how to use. Never mix chemicals. Wear the protective equipment provided.

## If you are worried
You can stop any task you believe is dangerous and tell your manager. You will not be treated any worse for raising a safety concern.$body$),

('policy_acknowledgement', 'allergens', 'Allergens policy', $body$[[TO CONFIRM: starter outline only. Check it against how your kitchen and bar actually work before switching it on]]

## Why this matters
A customer with a food allergy can become seriously ill, or die, from a small amount of the wrong ingredient. Getting this right is part of everyone's job.

## The 14 allergens
The law names 14 allergens we must be able to tell customers about: celery, cereals containing gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, peanuts, sesame, soybeans, sulphur dioxide and sulphites, and tree nuts.

## When a customer mentions an allergy
- Never guess, and never say a dish is safe from memory.
- Check the allergen information for the dish every time.
- Tell the kitchen clearly, and mark the order.
- If you are not sure, say so, and ask a manager.
- [[TO CONFIRM: where your allergen information is kept and how an allergy order is marked]]

## In the kitchen and behind the bar
- Keep allergen ingredients stored and labelled separately.
- Use clean equipment and a clean surface for an allergy order.
- Do not change an ingredient or a recipe without updating the allergen information.

## If someone has a reaction
Call 999 straight away and say it is anaphylaxis. Tell a manager. [[TO CONFIRM: anything else you want staff to do]]$body$),

('policy_acknowledgement', 'challenge-25', 'Challenge 25 and alcohol sales', $body$[[TO CONFIRM: starter outline only. Check it against your premises licence conditions before switching it on]]

## The law
It is against the law to sell alcohol to anyone under 18, or to someone buying it for a person under 18. It is also against the law to sell alcohol to someone who is drunk.

## Challenge 25
If a customer looks under 25, ask for proof of age before you serve them alcohol.

## The proof of age we accept
- A passport.
- A photocard driving licence.
- A proof of age card with the PASS hologram.
- [[TO CONFIRM: any other form of proof you accept]]

## Refusing a sale
- If they have no accepted proof of age, do not serve them. Be polite and firm.
- If you think an adult is buying for someone under 18, do not serve them.
- If someone is drunk, do not serve them.
- Record every refusal. [[TO CONFIRM: where refusals are recorded]]
- If a customer becomes difficult, fetch a manager.

## Your own position
You can be personally fined for selling alcohol to someone under 18. If in doubt, ask for proof of age. We will always back you for asking.$body$),

('policy_acknowledgement', 'data-protection', 'Data protection and confidentiality', $body$[[TO CONFIRM: starter outline only. Check it against your privacy notice before switching it on]]

## Why this matters
We hold personal information about customers and about staff. The law requires us to keep it safe and to use it only for the reason we collected it.

## What we expect from you
- Only look at personal information you need for your job.
- Never share a customer's or a colleague's details with anyone outside the business.
- Do not take photos of screens, booking sheets or paperwork that show personal details.
- Lock or log out of a screen when you leave it.
- Keep your password to yourself, and never use someone else's login.
- Do not post about customers, colleagues or what happens at work on social media.

## If someone asks for information
If a customer or anyone else asks what information we hold about them, or asks us to delete it, pass the request to a manager the same day. Do not try to answer it yourself.

## If something goes wrong
If information is lost, sent to the wrong person or seen by someone who should not have seen it, tell a manager straight away. Acting quickly matters more than whose fault it was.

## After you leave
These rules about confidentiality still apply after you stop working here.

[[TO CONFIRM: who staff should contact about data protection]]$body$)

ON CONFLICT (slug) DO NOTHING;

COMMIT;
