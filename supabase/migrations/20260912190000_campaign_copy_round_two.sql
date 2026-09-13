-- Round two of the scheduled campaign copy fixes from the guest email review.
-- Owner-approved 12 September 2026. Each string is changed at the path it sits on, guarded on
-- the value there now and on the campaign's content_hash, and every edited campaign was run
-- back through parseCampaignContent, so none can be refused at send time.
--
-- dec-booked-preheader: "the festive nights are booked" reads as sold out.
-- dec-usual-hours: The old line made the kitchen look open from 2 to 10 January, when it is closed.
-- nov-snowball-figure: The stored copy freezes at approval, so a figure decided by an earlier night cannot be right on the day.
-- dec-snowball-figure: Two cash bingo nights fall between approval and this send, and the stored copy cannot update.
-- dec-snowball-played-at: SSOT section 10 says played at, not attended.
-- sep-snowball-figure: Images are usually blocked, so the copy hung a figure on a poster the reader cannot see.
-- snowball-played-at: SSOT section 10 says played at, not attended: watching does not qualify.
-- dabbers-cash-only: SSOT section 10: £1 and cash only, which the guest needs to know before arriving.
-- dabbers-cash-only-sep: Same wording on every cash bingo email.
-- oct-preheader-count: Halloween is one of the three, so the old line reads as four nights.
-- oct-singalong: It is music bingo, not a singalong.
-- business-filling-fast: Nothing supports the scarcity claim (SSOT section 1, rule 5).
-- contraction-seat-you: SSOT section 1: use contractions.
-- contraction-see-whats-on: SSOT section 1: use contractions.
-- contraction-let-us-know: SSOT section 1: use contractions.
-- tasting-night: the 20 November tasting night, the only event with no email, is added to the
--   November round-ups from its own event record, and the heading and preview line count four.

do $$
begin
  -- Autumn Jackpot Cash Bingo - guests - 30 Sep 2026: sep-snowball-figure at blocks.3.data.body.0; snowball-played-at at blocks.3.data.body.1; dabbers-cash-only-sep at blocks.5.data.body.0
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(content, '{blocks,3,data,body,0}', to_jsonb('Game 9 is the Snowball, and it grows every night nobody wins it, so ask at the bar for the night’s prize.'::text)), '{blocks,3,data,body,1}', to_jsonb('To play for the Snowball, you need to have played at one of the previous three Cash Bingo nights. This condition applies to the Snowball, not the final cash jackpot.'::text)), '{blocks,5,data,body,0}', to_jsonb('Numbers appear on the pub TVs, so beginners can follow along. Dabbers are £1, cash only, from the bar.'::text)),
    content_hash = '21a48a98afbcbddb869e28782ded81447940afa83f473c5dbb4e09f4a9fe5fed',
    updated_at = now()
  where utm_campaign = 'autumn-jackpot-cash-bingo-2026-guests'
    and status = 'scheduled'
    and content_hash = '11670bdadeb748035f96ed82211d9f37b6c37b9f4a7d1fe8e21558fc5226aef2'
    and content #>> '{blocks,3,data,body,0}' = 'The poster shows a projected £160 Snowball for a full house within 56 numbers. This depends on it remaining unclaimed at earlier Cash Bingo nights.'
    and content #>> '{blocks,3,data,body,1}' = 'To play for the Snowball, you must have attended at least one of the previous three Cash Bingo nights. This condition applies to the Snowball, not the final cash jackpot.'
    and content #>> '{blocks,5,data,body,0}' = 'Numbers appear on the pub TVs, so beginners can follow along. Dabbers are available for £1 cash.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'autumn-jackpot-cash-bingo-2026-guests';
  end if;
  -- Christmas 2026, local businesses, October offer reminder: business-filling-fast at blocks.1.data.body.1
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,1,data,body,1}', to_jsonb('The sooner you tell us your date, the more choice you will have. We want to prioritise local businesses wherever possible, so please get in touch while we can help you explore the available dates.'::text)),
    content_hash = '99e0298ad8ddee5143c842410f1b607bb04e21d2076e2cbc704ec26233aa174b',
    updated_at = now()
  where utm_campaign = 'christmas-local-business-food-offer-2026-10-01'
    and status = 'scheduled'
    and content_hash = 'e984761a0ddc839c4874d55352b15a979763187bae6b5d9a08307a5da28dbb9a'
    and content #>> '{blocks,1,data,body,1}' = 'Our festive diary is filling fast. We want to prioritise local businesses wherever possible, so please get in touch while we can help you explore the available dates.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'christmas-local-business-food-offer-2026-10-01';
  end if;
  -- Autumn Kick-Off Quiz Night — guests — 16 Sep 2026: contraction-seat-you at blocks.3.data.rows.3.value
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,3,data,rows,3,value}', to_jsonb('Book your team in together and we''ll seat you together'::text)),
    content_hash = '7780099665b451b0bcffa38f4859ccfadb60fda8841dffda63a44aa48263b20c',
    updated_at = now()
  where utm_campaign = 'autumn-kick-off-quiz-night-2026-09-16'
    and status = 'scheduled'
    and content_hash = '58e129840704dd35593b64453c80f6fafe1afdd6f1a268a7863fa3e0a115d831'
    and content #>> '{blocks,3,data,rows,3,value}' = 'Book your team in together and we will seat you together'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'autumn-kick-off-quiz-night-2026-09-16';
  end if;
  -- A Hint of Halloween Quiz Night - guests - 7 Oct 2026: contraction-seat-you at blocks.3.data.rows.3.value
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,3,data,rows,3,value}', to_jsonb('Book your team in together and we''ll seat you together'::text)),
    content_hash = 'eb49500495f34ed234bdd06ebf1f2f72775f0606f34ee2a2ba0f4b05fe4f208a',
    updated_at = now()
  where utm_campaign = 'hint-of-halloween-quiz-night-2026-10-07'
    and status = 'scheduled'
    and content_hash = '693256ee79459fc52a66916ef4da1b77d66d310ecc97d156bcfc8deea1e2d704'
    and content #>> '{blocks,3,data,rows,3,value}' = 'Book your team in together and we will seat you together'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'hint-of-halloween-quiz-night-2026-10-07';
  end if;
  -- House of Horrors Halloween Party - guests - 31 Oct 2026: contraction-let-us-know at blocks.1.data.body.2; contraction-let-us-know at blocks.1.data.buttons.0.label; contraction-let-us-know at blocks.5.data.cta_label
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(content, '{blocks,1,data,body,2}', to_jsonb('Entry is free. Let us know you''re coming so we know how busy to expect it.'::text)), '{blocks,1,data,buttons,0,label}', to_jsonb('Let us know you''re coming'::text)), '{blocks,5,data,cta_label}', to_jsonb('Let us know you''re coming'::text)),
    content_hash = 'c30d0326c8ea2426135cfecbccfcad4c00f19cd6012832797a4bd098d281add6',
    updated_at = now()
  where utm_campaign = 'house-of-horrors-halloween-party-2026-10-31'
    and status = 'scheduled'
    and content_hash = '520935ea5c9542dac006aaad55c71fd017eaf1829b2f04a64eb5612d08b65d83'
    and content #>> '{blocks,1,data,body,2}' = 'Entry is free. Let us know you are coming so we know how busy to expect it.'
    and content #>> '{blocks,1,data,buttons,0,label}' = 'Let us know you are coming'
    and content #>> '{blocks,5,data,cta_label}' = 'Let us know you are coming'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'house-of-horrors-halloween-party-2026-10-31';
  end if;
  -- Welcome to October - businesses - 2026: oct-preheader-count at preheader; oct-singalong at blocks.1.data.body.1; contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.7.data.cta_label
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('Dark evenings, a spooky quiz, horror music bingo and Halloween done properly.'::text)), '{blocks,1,data,body,1}', to_jsonb('Three nights out, each with its own bit of mischief, building to Halloween itself on the Saturday. Whether that''s a quiz, horror soundtrack bingo or full fancy dress, there''s one here with your name on it.'::text)), '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,7,data,cta_label}', to_jsonb('See what''s on'::text)),
    content_hash = '8e8d33553cfe03055cdbed2a89b63b0126e34ade1f3e50eb85f3bb20a3be97df',
    preheader = 'Dark evenings, a spooky quiz, horror music bingo and Halloween done properly.',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = '73ab4b06900aab4e40e08050daf0552c30ef7a5549cf1cc9e6a5d6e9ae9a69e8'
    and content #>> '{preheader}' = 'Dark evenings, three brilliant nights out, and Halloween done properly.'
    and content #>> '{blocks,1,data,body,1}' = 'Three nights out, each with its own bit of mischief, building to Halloween itself on the Saturday. Whether that''s a quiz, a horror singalong or full fancy dress, there''s one here with your name on it.'
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,7,data,cta_label}' = 'See what is on'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-business';
  end if;
  -- Snowball Showdown Cash Bingo - guests - 18 Nov 2026: nov-snowball-figure at blocks.3.data.body.0; dec-snowball-played-at at blocks.3.data.body.1; dabbers-cash-only at blocks.5.data.body.0
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(content, '{blocks,3,data,body,0}', to_jsonb('The Game 9 Snowball grows by £20 and two numbers every night nobody wins it, so ask at the bar for the night’s prize.'::text)), '{blocks,3,data,body,1}', to_jsonb('To play for the Snowball you need to have played at one of the previous three Cash Bingo nights. That condition applies to the Snowball, not to the final cash jackpot.'::text)), '{blocks,5,data,body,0}', to_jsonb('Numbers appear on the pub TVs, so beginners can follow along easily. Dabbers are £1, cash only, from the bar.'::text)),
    content_hash = 'e7c66904737621f458312d682d5e61e373f0e97fc75abf7fc39f7a9d5d2bdec3',
    updated_at = now()
  where utm_campaign = 'snowball-showdown-cash-bingo-2026-11-18'
    and status = 'scheduled'
    and content_hash = 'ff6dbcf706d3c55b9f9dc4f10732435a9bcf77d48d31e453ee3244f5cde83748'
    and content #>> '{blocks,3,data,body,0}' = 'The Game 9 Snowball is projected at £180 for a full house within 58 numbers. That projection depends on it staying unclaimed at the earlier Cash Bingo nights, and if it is won the amount and the number target are updated before this one.'
    and content #>> '{blocks,3,data,body,1}' = 'To play for the Snowball you need to have attended one of the previous three Cash Bingo nights. That condition applies to the Snowball, not to the final cash jackpot.'
    and content #>> '{blocks,5,data,body,0}' = 'Numbers appear on the pub TVs, so beginners can follow along easily. Dabbers are available to buy at the bar.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'snowball-showdown-cash-bingo-2026-11-18';
  end if;
  -- Welcome to October - guests - 2026: oct-preheader-count at preheader; oct-singalong at blocks.1.data.body.1; contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.7.data.cta_label
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('Dark evenings, a spooky quiz, horror music bingo and Halloween done properly.'::text)), '{blocks,1,data,body,1}', to_jsonb('Three nights out, each with its own bit of mischief, building to Halloween itself on the Saturday. Whether that''s a quiz, horror soundtrack bingo or full fancy dress, there''s one here with your name on it.'::text)), '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,7,data,cta_label}', to_jsonb('See what''s on'::text)),
    content_hash = '7164703aa754f09082f839e67887f4a15415d9ad29230531a66786b57d39b023',
    preheader = 'Dark evenings, a spooky quiz, horror music bingo and Halloween done properly.',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = 'f9bb5ba484585e30a4af979c8e9d895969f6d5f0c2fe116e43e5ca3db62c85b0'
    and content #>> '{preheader}' = 'Dark evenings, three brilliant nights out, and Halloween done properly.'
    and content #>> '{blocks,1,data,body,1}' = 'Three nights out, each with its own bit of mischief, building to Halloween itself on the Saturday. Whether that''s a quiz, a horror singalong or full fancy dress, there''s one here with your name on it.'
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,7,data,cta_label}' = 'See what is on'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-guests';
  end if;
  -- Tinsel & Trivia Quiz Night - guests - 2 Dec 2026: contraction-seat-you at blocks.3.data.rows.3.value
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,3,data,rows,3,value}', to_jsonb('Book your team in together and we''ll seat you together'::text)),
    content_hash = '48a2d585f5f3ae2dc195f74ed1e44afb457c4ecc5654df8dba64b585560eae39',
    updated_at = now()
  where utm_campaign = 'tinsel-and-trivia-quiz-night-2026-12-02'
    and status = 'scheduled'
    and content_hash = 'e720a94620fe8f4c035ac1137673dac67c2769693d8120b1ad92d69117e5d55f'
    and content #>> '{blocks,3,data,rows,3,value}' = 'Book your team in together and we will seat you together'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'tinsel-and-trivia-quiz-night-2026-12-02';
  end if;
  -- Welcome to November - guests - 2026: contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.6.data.cta_label; tasting night added, heading counts four; preheader counts four at preheader
  update public.marketing_campaigns set
    content = jsonb_insert(jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,6,data,cta_label}', to_jsonb('See what''s on'::text)), '{blocks,2,data,heading}', to_jsonb('Four nights in November'::text)), '{preheader}', to_jsonb('A warm pub, four cracking nights out, and Christmas tables up for grabs.'::text)), '{blocks,2,data,events,3}', '{"date":"Fri 20 Nov","name":"Tinsel & Tipples Christmas Tasting Night","detail":"Expert-led festive tasting, £45 a person, or £5 less booked online. Just 25 places.","image":{"src":"https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events/5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65/square/branded/1789049534326-square.png","alt":"A fun Tasting Night at The Anchor featuring festive drinks and food.","width":180,"height":180},"cta_label":"Book your place →","url":"https://www.the-anchor.pub/events/christmas-night-out-tasting-night-2026-11-20"}'::jsonb),
    content_hash = 'b2fd5802b2d123cbc5e1ef7acf3d673275c4aadc5af5d238f2c24a94bef9a232',
    preheader = 'A warm pub, four cracking nights out, and Christmas tables up for grabs.',
    updated_at = now()
  where utm_campaign = 'november-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = '30c052dbb7dd55234385243f8aae1dca0f175a8723edb77726c5801f921a782b'
    and jsonb_array_length(content #> '{blocks,2,data,events}') = 3
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,6,data,cta_label}' = 'See what is on'
    and content #>> '{blocks,2,data,heading}' = 'Three nights in November'
    and content #>> '{preheader}' = 'A warm pub, three cracking nights out, and Christmas tables up for grabs.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'november-2026-roundup-guests';
  end if;
  -- Welcome to November - businesses - 2026: contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.6.data.cta_label; tasting night added, heading counts four; preheader counts four at preheader
  update public.marketing_campaigns set
    content = jsonb_insert(jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,6,data,cta_label}', to_jsonb('See what''s on'::text)), '{blocks,2,data,heading}', to_jsonb('Four nights in November'::text)), '{preheader}', to_jsonb('A warm pub, four cracking nights out, and Christmas tables up for grabs.'::text)), '{blocks,2,data,events,3}', '{"date":"Fri 20 Nov","name":"Tinsel & Tipples Christmas Tasting Night","detail":"Expert-led festive tasting, £45 a person, or £5 less booked online. Just 25 places.","image":{"src":"https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events/5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65/square/branded/1789049534326-square.png","alt":"A fun Tasting Night at The Anchor featuring festive drinks and food.","width":180,"height":180},"cta_label":"Book your place →","url":"https://www.the-anchor.pub/events/christmas-night-out-tasting-night-2026-11-20"}'::jsonb),
    content_hash = '99053ed9ad01d89c1197fd07ef1aa7fb4874df16fd2b389d29ddc6e324fd611b',
    preheader = 'A warm pub, four cracking nights out, and Christmas tables up for grabs.',
    updated_at = now()
  where utm_campaign = 'november-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = 'ec15cae12e9f5ff90ebe5f6bbecaf5fe844ee37e30fe91fbe60f73d8c0e51a03'
    and jsonb_array_length(content #> '{blocks,2,data,events}') = 3
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,6,data,cta_label}' = 'See what is on'
    and content #>> '{blocks,2,data,heading}' = 'Three nights in November'
    and content #>> '{preheader}' = 'A warm pub, three cracking nights out, and Christmas tables up for grabs.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'november-2026-roundup-business';
  end if;
  -- Welcome to December - guests - 2026: dec-booked-preheader at preheader; dec-usual-hours at blocks.4.data.footnote; contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.7.data.cta_label
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('The lights are up, three festive nights are in the diary, and everyone''s welcome.'::text)), '{blocks,4,data,footnote}', to_jsonb('Any date not listed keeps our usual bar hours above, and the kitchen stays closed until Tuesday 12 January.'::text)), '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,7,data,cta_label}', to_jsonb('See what''s on'::text)),
    content_hash = '19030833f89b67941fc7c8ee100055e437448a6c9e840c3b075ecd67f44f5323',
    preheader = 'The lights are up, three festive nights are in the diary, and everyone''s welcome.',
    updated_at = now()
  where utm_campaign = 'december-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = 'd20b046ef91ee95582fd603250a478cc460aac3f9f0e9271eb14001052e602ec'
    and content #>> '{preheader}' = 'The lights are up, the festive nights are booked, and everyone is welcome.'
    and content #>> '{blocks,4,data,footnote}' = 'Any date not listed runs our usual hours above. The kitchen is back to normal on Tuesday 12 January.'
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,7,data,cta_label}' = 'See what is on'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'december-2026-roundup-guests';
  end if;
  -- Welcome to December - businesses - 2026: dec-booked-preheader at preheader; dec-usual-hours at blocks.4.data.footnote; contraction-see-whats-on at blocks.1.data.buttons.0.label; contraction-see-whats-on at blocks.7.data.cta_label
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('The lights are up, three festive nights are in the diary, and everyone''s welcome.'::text)), '{blocks,4,data,footnote}', to_jsonb('Any date not listed keeps our usual bar hours above, and the kitchen stays closed until Tuesday 12 January.'::text)), '{blocks,1,data,buttons,0,label}', to_jsonb('See what''s on'::text)), '{blocks,7,data,cta_label}', to_jsonb('See what''s on'::text)),
    content_hash = '82d24e4b628411f83bd23647f22ab23098574853a01bde368af53ac56887fc57',
    preheader = 'The lights are up, three festive nights are in the diary, and everyone''s welcome.',
    updated_at = now()
  where utm_campaign = 'december-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = '5ad31cb76368b758518a7087adabf13527ce02af6bcd3bb36e59c6492d3a3af7'
    and content #>> '{preheader}' = 'The lights are up, the festive nights are booked, and everyone is welcome.'
    and content #>> '{blocks,4,data,footnote}' = 'Any date not listed runs our usual hours above. The kitchen is back to normal on Tuesday 12 January.'
    and content #>> '{blocks,1,data,buttons,0,label}' = 'See what is on'
    and content #>> '{blocks,7,data,cta_label}' = 'See what is on'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'december-2026-roundup-business';
  end if;
  -- Christmas Jackpot Cash Bingo - guests - 16 Dec 2026: dec-snowball-figure at blocks.3.data.body.0; dec-snowball-played-at at blocks.3.data.body.1; dabbers-cash-only at blocks.5.data.body.0
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(jsonb_set(content, '{blocks,3,data,body,0}', to_jsonb('The Game 9 Snowball grows by £20 and two numbers every night nobody wins it, so ask at the bar for the night’s prize.'::text)), '{blocks,3,data,body,1}', to_jsonb('To play for the Snowball you need to have played at one of the previous three Cash Bingo nights. That condition applies to the Snowball, not to the final cash jackpot.'::text)), '{blocks,5,data,body,0}', to_jsonb('Numbers appear on the pub TVs, so beginners can follow along easily. Dabbers are £1, cash only, from the bar.'::text)),
    content_hash = 'fe621ee220293892f206d22b900bec2390c37d893b0365d8939eceff504ac1c1',
    updated_at = now()
  where utm_campaign = 'christmas-jackpot-cash-bingo-2026-12-16'
    and status = 'scheduled'
    and content_hash = '2a732d938498d2b8ee3195391b32cb335c879e05f3f50b3c901d8a014366ca89'
    and content #>> '{blocks,3,data,body,0}' = 'The Game 9 Snowball is projected at £200 for a full house within 60 numbers. That projection depends on it staying unclaimed at the earlier Cash Bingo nights, and if it is won the amount and the number target are updated before this one.'
    and content #>> '{blocks,3,data,body,1}' = 'To play for the Snowball you need to have attended one of the previous three Cash Bingo nights. That condition applies to the Snowball, not to the final cash jackpot.'
    and content #>> '{blocks,5,data,body,0}' = 'Numbers appear on the pub TVs, so beginners can follow along easily. Dabbers are available to buy at the bar.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'christmas-jackpot-cash-bingo-2026-12-16';
  end if;
  -- Sparks & Sparklers Quiz Night - guests - 4 Nov 2026: contraction-seat-you at blocks.3.data.rows.3.value
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,3,data,rows,3,value}', to_jsonb('Book your team in together and we''ll seat you together'::text)),
    content_hash = 'efe3e3df1d4aff61f3bfed7c141c3e54e92dd78c7d3d3f7e9e7da149e7079bfa',
    updated_at = now()
  where utm_campaign = 'sparks-and-sparklers-quiz-night-2026-11-04'
    and status = 'scheduled'
    and content_hash = '9beefd86bdbdeb7b4efe328d5744cb57556f5dc82f017b1d5bdc0cf6deb95742'
    and content #>> '{blocks,3,data,rows,3,value}' = 'Book your team in together and we will seat you together'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'sparks-and-sparklers-quiz-night-2026-11-04';
  end if;
end $$;
