-- Update existing World Cup 2026 event rows with the teams now known.
-- Keeps event IDs intact; only names, slugs, and public briefs change.

WITH updates(old_slug, new_slug, name, brief) AS (
  VALUES
    (
      'world-cup-2026-canada-vs-tbd-group-b-2026-06-12',
      'world-cup-2026-canada-vs-bosnia-and-herzegovina-2026-06-12',
      'World Cup 2026: Canada vs Bosnia and Herzegovina (Group B)',
      'Match 3 - Group B - Toronto, Canada
Kick-off 20:00 BST (Friday). Canada vs Bosnia and Herzegovina.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-portugal-vs-tbd-group-k-2026-06-17',
      'world-cup-2026-portugal-vs-dr-congo-2026-06-17',
      'World Cup 2026: Portugal vs DR Congo (Group K)',
      'Match 23 - Group K - Houston, USA
Kick-off 18:00 BST (Wednesday). Portugal vs DR Congo.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-tbd-vs-south-africa-2026-06-18',
      'world-cup-2026-czechia-vs-south-africa-2026-06-18',
      'World Cup 2026: Czechia vs South Africa (Group A)',
      'Match 25 - Group A - Atlanta, USA
Kick-off 17:00 BST (Thursday). Czechia vs South Africa.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-switzerland-vs-tbd-group-b-2026-06-18',
      'world-cup-2026-switzerland-vs-bosnia-and-herzegovina-2026-06-18',
      'World Cup 2026: Switzerland vs Bosnia and Herzegovina (Group B)',
      'Match 26 - Group B - Los Angeles, USA
Kick-off 20:00 BST (Thursday). Switzerland vs Bosnia and Herzegovina.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-netherlands-vs-tbd-group-f-2026-06-20',
      'world-cup-2026-netherlands-vs-sweden-2026-06-20',
      'World Cup 2026: Netherlands vs Sweden (Group F)',
      'Match 35 - Group F - Houston, USA
Kick-off 18:00 BST (Saturday). Netherlands vs Sweden.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-france-vs-tbd-group-i-2026-06-22',
      'world-cup-2026-france-vs-iraq-2026-06-22',
      'World Cup 2026: France vs Iraq (Group I)',
      'Match 42 - Group I - Philadelphia, USA
Kick-off 22:00 BST (Monday). France vs Iraq.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-tbd-vs-qatar-group-b-2026-06-24',
      'world-cup-2026-bosnia-and-herzegovina-vs-qatar-2026-06-24',
      'World Cup 2026: Bosnia and Herzegovina vs Qatar (Group B)',
      'Match 52 - Group B - Seattle, USA
Kick-off 20:00 BST (Wednesday). Bosnia and Herzegovina vs Qatar.
Final group game - both Group B matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-senegal-vs-tbd-group-i-2026-06-26',
      'world-cup-2026-senegal-vs-iraq-2026-06-26',
      'World Cup 2026: Senegal vs Iraq (Group I)',
      'Match 62 - Group I - Toronto, Canada
Kick-off 20:00 BST (Friday). Senegal vs Iraq.
Final group game - both Group I matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-73-2026-06-28',
      'world-cup-2026-south-africa-vs-canada-r32-match-73-2026-06-28',
      'World Cup 2026: South Africa vs Canada (Round of 32)',
      'Match 73 - Round of 32 - Los Angeles, USA
Kick-off 20:00 BST (Sunday). South Africa vs Canada.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-76-2026-06-29',
      'world-cup-2026-brazil-vs-japan-r32-match-76-2026-06-29',
      'World Cup 2026: Brazil vs Japan (Round of 32)',
      'Match 76 - Round of 32 - Houston, USA
Kick-off 18:00 BST (Monday). Brazil vs Japan.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-74-2026-06-29',
      'world-cup-2026-germany-vs-paraguay-r32-match-74-2026-06-29',
      'World Cup 2026: Germany vs Paraguay (Round of 32)',
      'Match 74 - Round of 32 - Boston, USA
Kick-off 21:30 BST (Monday). Germany vs Paraguay.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-78-2026-06-30',
      'world-cup-2026-ivory-coast-vs-norway-r32-match-78-2026-06-30',
      'World Cup 2026: Ivory Coast vs Norway (Round of 32)',
      'Match 78 - Round of 32 - Dallas, USA
Kick-off 18:00 BST (Tuesday). Ivory Coast vs Norway.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-77-2026-06-30',
      'world-cup-2026-france-vs-sweden-r32-match-77-2026-06-30',
      'World Cup 2026: France vs Sweden (Round of 32)',
      'Match 77 - Round of 32 - New York, USA
Kick-off 22:00 BST (Tuesday). France vs Sweden.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-80-2026-07-01',
      'world-cup-2026-england-vs-dr-congo-r32-match-80-2026-07-01',
      'World Cup 2026: England vs DR Congo (Round of 32)',
      'Match 80 - Round of 32 - Atlanta, USA
Kick-off 17:00 BST (Wednesday). England vs DR Congo.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-82-2026-07-01',
      'world-cup-2026-belgium-vs-senegal-r32-match-82-2026-07-01',
      'World Cup 2026: Belgium vs Senegal (Round of 32)',
      'Match 82 - Round of 32 - Seattle, USA
Kick-off 21:00 BST (Wednesday). Belgium vs Senegal.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-84-2026-07-02',
      'world-cup-2026-spain-vs-austria-r32-match-84-2026-07-02',
      'World Cup 2026: Spain vs Austria (Round of 32)',
      'Match 84 - Round of 32 - Los Angeles, USA
Kick-off 20:00 BST (Thursday). Spain vs Austria.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-88-2026-07-03',
      'world-cup-2026-australia-vs-egypt-r32-match-88-2026-07-03',
      'World Cup 2026: Australia vs Egypt (Round of 32)',
      'Match 88 - Round of 32 - Dallas, USA
Kick-off 19:00 BST (Friday). Australia vs Egypt.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r32-match-86-2026-07-03',
      'world-cup-2026-argentina-vs-cabo-verde-r32-match-86-2026-07-03',
      'World Cup 2026: Argentina vs Cabo Verde (Round of 32)',
      'Match 86 - Round of 32 - Miami, USA
Kick-off 23:00 BST (Friday). Argentina vs Cabo Verde.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-89-2026-07-04',
      'world-cup-2026-paraguay-vs-france-r16-match-89-2026-07-04',
      'World Cup 2026: Paraguay vs France (Round of 16)',
      'Match 89 - Round of 16 - Philadelphia, USA
Kick-off 22:00 BST (Saturday). Paraguay vs France.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-90-2026-07-04',
      'world-cup-2026-canada-vs-morocco-r16-match-90-2026-07-04',
      'World Cup 2026: Canada vs Morocco (Round of 16)',
      'Match 90 - Round of 16 - Houston, USA
Kick-off 18:00 BST (Saturday). Canada vs Morocco.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-91-2026-07-05',
      'world-cup-2026-brazil-vs-norway-r16-match-91-2026-07-05',
      'World Cup 2026: Brazil vs Norway (Round of 16)',
      'Match 91 - Round of 16 - New York, USA
Kick-off 21:00 BST (Sunday). Brazil vs Norway.
Knockout match - extra time and penalties possible.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-93-2026-07-06',
      'world-cup-2026-spain-vs-portugal-r16-match-93-2026-07-06',
      'World Cup 2026: Spain vs Portugal (Round of 16)',
      'Match 93 - Round of 16 - Dallas, USA
Kick-off 20:00 BST (Monday). Spain vs Portugal.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-95-2026-07-07',
      'world-cup-2026-argentina-cabo-verde-vs-australia-egypt-r16-match-95-2026-07-07',
      'World Cup 2026: Argentina/Cabo Verde vs Australia/Egypt (Round of 16)',
      'Match 95 - Round of 16 - Atlanta, USA
Kick-off 17:00 BST (Tuesday). Winner of Argentina vs Cabo Verde faces winner of Australia vs Egypt.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-r16-match-96-2026-07-07',
      'world-cup-2026-switzerland-vs-colombia-ghana-r16-match-96-2026-07-07',
      'World Cup 2026: Switzerland vs Colombia/Ghana (Round of 16)',
      'Match 96 - Round of 16 - Vancouver, Canada
Kick-off 21:00 BST (Tuesday). Switzerland face the winner of Colombia vs Ghana.
Knockout match - extra time and penalties possible.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-qf-match-97-2026-07-09',
      'world-cup-2026-paraguay-france-vs-canada-morocco-qf-match-97-2026-07-09',
      'World Cup 2026: Paraguay/France vs Canada/Morocco (Quarter-final)',
      'Match 97 - Quarter-final - Boston, USA
Kick-off 21:00 BST (Thursday). Winner of Paraguay vs France faces winner of Canada vs Morocco.
Knockout match - extra time and penalties possible.
May run past closing - we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-qf-match-98-2026-07-10',
      'world-cup-2026-spain-portugal-vs-belgium-usa-qf-match-98-2026-07-10',
      'World Cup 2026: Spain/Portugal vs Belgium/USA (Quarter-final)',
      'Match 98 - Quarter-final - Los Angeles, USA
Kick-off 20:00 BST (Friday). Winner of Spain vs Portugal faces winner of Belgium vs USA.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    ),
    (
      'world-cup-2026-qf-match-99-2026-07-11',
      'world-cup-2026-brazil-norway-vs-mexico-england-qf-match-99-2026-07-11',
      'World Cup 2026: Brazil/Norway vs Mexico/England (Quarter-final)',
      'Match 99 - Quarter-final - Miami, USA
Kick-off 22:00 BST (Saturday). Winner of Brazil vs Norway faces winner of Mexico vs England.
Knockout match - extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'
    )
)
UPDATE public.events AS e
SET
  name = u.name,
  slug = u.new_slug,
  brief = u.brief
FROM updates AS u
WHERE e.slug = u.old_slug;
