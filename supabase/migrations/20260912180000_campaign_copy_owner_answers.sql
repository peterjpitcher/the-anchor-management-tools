-- The owner's answers of 12 September 2026, from the guest email review.
--
-- 1. There is no fire anywhere in the pub, so four fire claims come out of the October and
--    November 2026 round-ups (guests and business). The website SSOT records the ban.
-- 2. New Year's Eve closes at 1am, so both December round-ups stop telling their list 10pm.
--    The 31 December special-hours row was corrected to 01:00 on 11 September 2026.
-- 3. The 3 October Halloween save the date is cancelled: the round-up on 1 October makes the
--    same ask 48 hours earlier. Cancelled, not deleted, so the record survives.
-- 4. The minimum gap between guest campaigns goes from 2 days to 4. Unsubscribes ran at 7.1%
--    on the first campaign and 0.8% to 3.5% since, against a norm well under 0.5%.
--
-- Each string is changed at the exact path it sits on, guarded on the value found there now,
-- on the campaign's reviewed content_hash and on its status, so a campaign anyone has edited
-- since is left alone and the whole statement raises. Nothing here sends an email or moves a
-- send time. The new content_hash values were computed from the edited content by
-- scripts/one-off/generate-campaign-copy-owner-answers-2026-09-12.ts, whose --verify pass
-- re-reads every row afterwards and reproduces each hash from the stored content.

do $$
begin
  -- Welcome to October - guests - 2026: oct-fire-body at blocks.1.data.body.0; oct-fire-pint at blocks.7.data.body
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(content, '{blocks,1,data,body,0}', to_jsonb('There''s something about the first properly dark evening of the year. The lights go on, it''s warm inside, and suddenly a Wednesday feels like an occasion. October''s our favourite month for exactly that reason, and we''ve gone all in on it.'::text)), '{blocks,7,data,body}', to_jsonb('Quiz team, fancy dress, or just a quiet pint somewhere warm. Whatever brings you in this month, we''d love to see you.'::text)),
    content_hash = 'f9bb5ba484585e30a4af979c8e9d895969f6d5f0c2fe116e43e5ca3db62c85b0',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = 'a3caa4bcd15bc1582a1b26d0aa5cb49394842eb4e3f8e786ab335c8acb4e92fc'
    and content #>> '{blocks,1,data,body,0}' = 'There''s something about the first properly dark evening of the year. The lights go on, the fire gets going, and suddenly a Wednesday feels like an occasion. October''s our favourite month for exactly that reason, and we''ve gone all in on it.'
    and content #>> '{blocks,7,data,body}' = 'Quiz team, fancy dress, or just a quiet pint by the fire. Whatever brings you in this month, we''d love to see you.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-guests';
  end if;
  -- Welcome to October - businesses - 2026: oct-fire-body at blocks.1.data.body.0; oct-fire-pint at blocks.7.data.body
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(content, '{blocks,1,data,body,0}', to_jsonb('There''s something about the first properly dark evening of the year. The lights go on, it''s warm inside, and suddenly a Wednesday feels like an occasion. October''s our favourite month for exactly that reason, and we''ve gone all in on it.'::text)), '{blocks,7,data,body}', to_jsonb('Quiz team, fancy dress, or just a quiet pint somewhere warm. Whatever brings you in this month, we''d love to see you.'::text)),
    content_hash = '73ab4b06900aab4e40e08050daf0552c30ef7a5549cf1cc9e6a5d6e9ae9a69e8',
    updated_at = now()
  where utm_campaign = 'october-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = '616ac3f6ade066264bbe77b2653ba08d62ac5ce3df3dac2749981e668550d3b0'
    and content #>> '{blocks,1,data,body,0}' = 'There''s something about the first properly dark evening of the year. The lights go on, the fire gets going, and suddenly a Wednesday feels like an occasion. October''s our favourite month for exactly that reason, and we''ve gone all in on it.'
    and content #>> '{blocks,7,data,body}' = 'Quiz team, fancy dress, or just a quiet pint by the fire. Whatever brings you in this month, we''d love to see you.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'october-2026-roundup-business';
  end if;
  -- Welcome to November - guests - 2026: nov-fire-preheader at preheader; nov-fire-justify at blocks.1.data.body.0
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('A warm pub, three cracking nights out, and Christmas tables up for grabs.'::text)), '{blocks,1,data,body,0}', to_jsonb('November''s the month the year finally slows down enough to enjoy. It''s dark by five and cold enough to stay put. There''s no better excuse to be sat in a warm pub with people you like.'::text)),
    content_hash = '30c052dbb7dd55234385243f8aae1dca0f175a8723edb77726c5801f921a782b',
    preheader = 'A warm pub, three cracking nights out, and Christmas tables up for grabs.',
    updated_at = now()
  where utm_campaign = 'november-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = 'd9308f5f72d70ebd25687f4466c55eaad5157e0c8df7c537a54c57bfd3a5307f'
    and preheader = 'Fires lit, three cracking nights out, and Christmas tables up for grabs.'
    and content #>> '{preheader}' = 'Fires lit, three cracking nights out, and Christmas tables up for grabs.'
    and content #>> '{blocks,1,data,body,0}' = 'November''s the month the year finally slows down enough to enjoy. It''s dark by five and cold enough to justify the fire. There''s no better excuse to be sat in a warm pub with people you like.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'november-2026-roundup-guests';
  end if;
  -- Welcome to November - businesses - 2026: nov-fire-preheader at preheader; nov-fire-justify at blocks.1.data.body.0
  update public.marketing_campaigns set
    content = jsonb_set(jsonb_set(content, '{preheader}', to_jsonb('A warm pub, three cracking nights out, and Christmas tables up for grabs.'::text)), '{blocks,1,data,body,0}', to_jsonb('November''s the month the year finally slows down enough to enjoy. It''s dark by five and cold enough to stay put. There''s no better excuse to be sat in a warm pub with people you like.'::text)),
    content_hash = 'ec15cae12e9f5ff90ebe5f6bbecaf5fe844ee37e30fe91fbe60f73d8c0e51a03',
    preheader = 'A warm pub, three cracking nights out, and Christmas tables up for grabs.',
    updated_at = now()
  where utm_campaign = 'november-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = 'fb11dc6cd783620932c14ded973c5c07eb79359eb391adaf3f818fd691042286'
    and preheader = 'Fires lit, three cracking nights out, and Christmas tables up for grabs.'
    and content #>> '{preheader}' = 'Fires lit, three cracking nights out, and Christmas tables up for grabs.'
    and content #>> '{blocks,1,data,body,0}' = 'November''s the month the year finally slows down enough to enjoy. It''s dark by five and cold enough to justify the fire. There''s no better excuse to be sat in a warm pub with people you like.'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'november-2026-roundup-business';
  end if;
  -- Welcome to December - guests - 2026: New Year's Eve hours at blocks.4.data.rows.8.hours
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data,rows,8,hours}', to_jsonb('12pm to 1am'::text)),
    content_hash = 'd20b046ef91ee95582fd603250a478cc460aac3f9f0e9271eb14001052e602ec',
    updated_at = now()
  where utm_campaign = 'december-2026-roundup-guests'
    and status = 'scheduled'
    and content_hash = '6ce24d2ca76f1f12b1d120f1553de61b0595e56ad98c98c549f3832536ee768d'
    and content #>> '{blocks,4,data,rows,8,date}' = 'Thu 31 Dec'
    and content #>> '{blocks,4,data,rows,8,hours}' = '12pm to 10pm'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'december-2026-roundup-guests';
  end if;
  -- Welcome to December - businesses - 2026: New Year's Eve hours at blocks.4.data.rows.8.hours
  update public.marketing_campaigns set
    content = jsonb_set(content, '{blocks,4,data,rows,8,hours}', to_jsonb('12pm to 1am'::text)),
    content_hash = '5ad31cb76368b758518a7087adabf13527ce02af6bcd3bb36e59c6492d3a3af7',
    updated_at = now()
  where utm_campaign = 'december-2026-roundup-business'
    and status = 'scheduled'
    and content_hash = 'cf06b34ed630152756473327530c165c6518438fce8484602ca1817983feeac1'
    and content #>> '{blocks,4,data,rows,8,date}' = 'Thu 31 Dec'
    and content #>> '{blocks,4,data,rows,8,hours}' = '12pm to 10pm'
  ;
  if not found then
    raise exception '% is not in the state this change was reviewed against, so nothing was changed', 'december-2026-roundup-business';
  end if;

  update public.marketing_campaigns set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where utm_campaign = 'house-of-horrors-halloween-party-save-the-date-2026-10-03'
    and status = 'scheduled';
  if not found then
    raise exception 'The Halloween save the date was not scheduled, so nothing was cancelled';
  end if;

  update public.marketing_settings set
    frequency_cap_days = 4,
    updated_at = now()
  where frequency_cap_days = 2;
  if not found then
    raise exception 'The frequency cap was not 2 days, so it was left alone';
  end if;

  if exists (
    select 1 from public.marketing_campaigns
    where status = 'scheduled'
      and (content::text like '%the fire%' or content::text like '%Fires lit%' or preheader like '%Fires lit%')
  ) then
    raise exception 'A scheduled campaign still carries a fire claim';
  end if;

  if exists (
    select 1 from public.marketing_campaigns
    where status = 'scheduled' and utm_campaign like 'december-2026-roundup-%'
      and content::text not like '%12pm to 1am%'
  ) then
    raise exception 'A December round-up does not carry the 1am New Year''s Eve close';
  end if;
end $$;
