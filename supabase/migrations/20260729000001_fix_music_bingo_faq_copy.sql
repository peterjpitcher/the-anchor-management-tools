update public.event_faqs
set answer = 'Music Bingo starts at 7pm on Friday 17th July. Make sure to arrive a little early to grab your seats and get settled in.',
    updated_at = now()
where event_id = '27e85126-e3cd-40ae-81c3-e1bf804664b5'
  and question = 'What time does Music Bingo start on 17th July?';

update public.event_faqs
set answer = 'Tickets for Music Bingo are £5 each. It’s a great value for a night full of fun and nostalgia with friends.',
    updated_at = now()
where event_id = '27e85126-e3cd-40ae-81c3-e1bf804664b5'
  and question = 'How much does it cost to join Music Bingo?';
