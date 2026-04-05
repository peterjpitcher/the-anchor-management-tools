-- =============================================================================
-- World Cup 2026: Replace placeholder events with actual match fixtures
-- =============================================================================
-- Deletes 12 placeholder/rest-day events, updates 3 existing England matches,
-- and inserts 51 new events for all matches the pub is showing.
-- All times BST. All events created as draft for review before publishing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. DELETE placeholder and rest-day events
-- ---------------------------------------------------------------------------
DELETE FROM public.events WHERE slug IN (
  'world-cup-2026-group-stage-2026-06-11',
  'world-cup-2026-opening-match-2026-06-11',
  'world-cup-2026-round-of-32-2026-06-28',
  'world-cup-2026-round-of-16-2026-07-04',
  'world-cup-2026-rest-day-2026-07-08',
  'world-cup-2026-quarter-finals-2026-07-09',
  'world-cup-2026-rest-days-2026-07-12',
  'world-cup-2026-semi-finals-2026-07-14',
  'world-cup-2026-rest-days-2026-07-16',
  'world-cup-2026-third-place-play-off-2026-07-18',
  'world-cup-2026-final-2026-07-19'
);

-- ---------------------------------------------------------------------------
-- 2. UPDATE existing England group matches (fix times, add briefs)
-- ---------------------------------------------------------------------------

-- England vs Croatia: time 20:00 → 21:00, end_time 22:30 → 23:00
UPDATE public.events
SET
  name = 'World Cup 2026: England vs Croatia (Group L)',
  time = '21:00',
  end_time = '23:00',
  is_free = true,
  price = 0,
  brief = 'Match 22 · Group L · Dallas, USA
Kick-off 21:00 BST (Wednesday). Showing on our screens with sound on.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
WHERE slug = 'world-cup-2026-england-vs-croatia-group-stage-2026-06-17';

-- England vs Ghana: time 20:00 → 21:00, end_time 22:30 → 23:00
UPDATE public.events
SET
  name = 'World Cup 2026: England vs Ghana (Group L)',
  time = '21:00',
  end_time = '23:00',
  is_free = true,
  price = 0,
  brief = 'Match 45 · Group L · Boston, USA
Kick-off 21:00 BST (Tuesday). Showing on our screens with sound on.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'
WHERE slug = 'world-cup-2026-england-vs-ghana-group-stage-2026-06-23';

-- Panama vs England: time 21:00 → 22:00, end_time 23:30 → 00:00
UPDATE public.events
SET
  name = 'World Cup 2026: Panama vs England (Group L)',
  time = '22:00',
  end_time = '00:00',
  is_free = true,
  price = 0,
  brief = 'Match 67 · Group L · New York, USA
Kick-off 22:00 BST (Saturday). Showing on our screens with sound on.
Final group game — both Group L matches kick off simultaneously.
Book a table for the best screen view. Free entry, no deposits.'
WHERE slug = 'world-cup-2026-panama-vs-england-group-stage-2026-06-27';

-- ---------------------------------------------------------------------------
-- 3. INSERT all other showing matches (51 new events)
-- ---------------------------------------------------------------------------

INSERT INTO public.events (name, date, time, end_time, event_status, is_free, price, slug, brief)
VALUES

-- ===== GROUP STAGE — Matchday 1 =====

-- Thu 11 Jun
('World Cup 2026: Mexico vs South Africa (Group A)',
 '2026-06-11', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-mexico-vs-south-africa-2026-06-11',
 'Match 1 · Group A · Mexico City, Mexico
Kick-off 20:00 BST (Thursday). Opening match of the 2026 World Cup.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Fri 12 Jun
('World Cup 2026: Canada vs TBD (Group B)',
 '2026-06-12', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-canada-vs-tbd-group-b-2026-06-12',
 'Match 3 · Group B · Toronto, Canada
Kick-off 20:00 BST (Friday). Canada vs UEFA playoff winner (Italy/N.Ireland/Wales/Bosnia).
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sat 13 Jun
('World Cup 2026: Qatar vs Switzerland (Group B)',
 '2026-06-13', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-qatar-vs-switzerland-2026-06-13',
 'Match 8 · Group B · San Francisco Bay Area, USA
Kick-off 20:00 BST (Saturday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Brazil vs Morocco (Group C)',
 '2026-06-13', '23:00', '01:00', 'draft', true, 0,
 'world-cup-2026-brazil-vs-morocco-2026-06-13',
 'Match 7 · Group C · New York, USA
Kick-off 23:00 BST (Saturday). Showing on our screens with sound on.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sun 14 Jun
('World Cup 2026: Germany vs Curaçao (Group E)',
 '2026-06-14', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-germany-vs-curacao-2026-06-14',
 'Match 10 · Group E · Houston, USA
Kick-off 18:00 BST (Sunday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Netherlands vs Japan (Group F)',
 '2026-06-14', '21:00', '23:00', 'draft', true, 0,
 'world-cup-2026-netherlands-vs-japan-2026-06-14',
 'Match 11 · Group F · Dallas, USA
Kick-off 21:00 BST (Sunday). Showing on our screens with sound on.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Mon 15 Jun
('World Cup 2026: Spain vs Cape Verde (Group H)',
 '2026-06-15', '17:00', '19:00', 'draft', true, 0,
 'world-cup-2026-spain-vs-cape-verde-2026-06-15',
 'Match 14 · Group H · Atlanta, USA
Kick-off 17:00 BST (Monday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Belgium vs Egypt (Group G)',
 '2026-06-15', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-belgium-vs-egypt-2026-06-15',
 'Match 16 · Group G · Seattle, USA
Kick-off 20:00 BST (Monday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Tue 16 Jun
('World Cup 2026: France vs Senegal (Group I)',
 '2026-06-16', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-france-vs-senegal-2026-06-16',
 'Match 17 · Group I · New York, USA
Kick-off 20:00 BST (Tuesday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Wed 17 Jun
('World Cup 2026: Portugal vs TBD (Group K)',
 '2026-06-17', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-portugal-vs-tbd-group-k-2026-06-17',
 'Match 23 · Group K · Houston, USA
Kick-off 18:00 BST (Wednesday). Portugal vs CONCACAF/OFC playoff winner.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- (England vs Croatia at 21:00 already exists — updated above)

-- ===== GROUP STAGE — Matchday 2 =====

-- Thu 18 Jun
('World Cup 2026: TBD vs South Africa (Group A)',
 '2026-06-18', '17:00', '19:00', 'draft', true, 0,
 'world-cup-2026-tbd-vs-south-africa-2026-06-18',
 'Match 25 · Group A · Atlanta, USA
Kick-off 17:00 BST (Thursday). UEFA playoff winner vs South Africa.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Switzerland vs TBD (Group B)',
 '2026-06-18', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-switzerland-vs-tbd-group-b-2026-06-18',
 'Match 26 · Group B · Los Angeles, USA
Kick-off 20:00 BST (Thursday). Switzerland vs UEFA playoff winner (Italy/N.Ireland/Wales/Bosnia).
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Fri 19 Jun
('World Cup 2026: USA vs Australia (Group D)',
 '2026-06-19', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-usa-vs-australia-2026-06-19',
 'Match 32 · Group D · Seattle, USA
Kick-off 20:00 BST (Friday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Scotland vs Morocco (Group C)',
 '2026-06-19', '23:00', '01:00', 'draft', true, 0,
 'world-cup-2026-scotland-vs-morocco-2026-06-19',
 'Match 30 · Group C · Boston, USA
Kick-off 23:00 BST (Friday). Showing on our screens with sound on.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sat 20 Jun
('World Cup 2026: Netherlands vs TBD (Group F)',
 '2026-06-20', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-netherlands-vs-tbd-group-f-2026-06-20',
 'Match 35 · Group F · Houston, USA
Kick-off 18:00 BST (Saturday). Netherlands vs UEFA/AFC playoff winner.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Germany vs Ivory Coast (Group E)',
 '2026-06-20', '21:00', '23:00', 'draft', true, 0,
 'world-cup-2026-germany-vs-ivory-coast-2026-06-20',
 'Match 33 · Group E · Toronto, Canada
Kick-off 21:00 BST (Saturday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sun 21 Jun
('World Cup 2026: Spain vs Saudi Arabia (Group H)',
 '2026-06-21', '17:00', '19:00', 'draft', true, 0,
 'world-cup-2026-spain-vs-saudi-arabia-2026-06-21',
 'Match 38 · Group H · Atlanta, USA
Kick-off 17:00 BST (Sunday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Belgium vs Iran (Group G)',
 '2026-06-21', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-belgium-vs-iran-2026-06-21',
 'Match 39 · Group G · Los Angeles, USA
Kick-off 20:00 BST (Sunday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Mon 22 Jun
('World Cup 2026: Argentina vs Austria (Group J)',
 '2026-06-22', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-argentina-vs-austria-2026-06-22',
 'Match 43 · Group J · Dallas, USA
Kick-off 18:00 BST (Monday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: France vs TBD (Group I)',
 '2026-06-22', '22:00', '00:00', 'draft', true, 0,
 'world-cup-2026-france-vs-tbd-group-i-2026-06-22',
 'Match 42 · Group I · Philadelphia, USA
Kick-off 22:00 BST (Monday). France vs AFC/CONMEBOL playoff winner.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Tue 23 Jun
('World Cup 2026: Portugal vs Uzbekistan (Group K)',
 '2026-06-23', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-portugal-vs-uzbekistan-2026-06-23',
 'Match 47 · Group K · Houston, USA
Kick-off 18:00 BST (Tuesday). Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- (England vs Ghana at 21:00 already exists — updated above)

-- ===== GROUP STAGE — Matchday 3 =====

-- Wed 24 Jun
('World Cup 2026: Switzerland vs Canada (Group B)',
 '2026-06-24', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-switzerland-vs-canada-2026-06-24',
 'Match 51 · Group B · Vancouver, Canada
Kick-off 20:00 BST (Wednesday). Final group game — both Group B matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: TBD vs Qatar (Group B)',
 '2026-06-24', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-tbd-vs-qatar-group-b-2026-06-24',
 'Match 52 · Group B · Seattle, USA
Kick-off 20:00 BST (Wednesday). UEFA playoff winner vs Qatar. Final group game — both Group B matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Thu 25 Jun
('World Cup 2026: Curaçao vs Ivory Coast (Group E)',
 '2026-06-25', '21:00', '23:00', 'draft', true, 0,
 'world-cup-2026-curacao-vs-ivory-coast-2026-06-25',
 'Match 55 · Group E · Philadelphia, USA
Kick-off 21:00 BST (Thursday). Final group game — both Group E matches kick off simultaneously.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Ecuador vs Germany (Group E)',
 '2026-06-25', '21:00', '23:00', 'draft', true, 0,
 'world-cup-2026-ecuador-vs-germany-2026-06-25',
 'Match 56 · Group E · New York, USA
Kick-off 21:00 BST (Thursday). Final group game — both Group E matches kick off simultaneously.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Fri 26 Jun
('World Cup 2026: Norway vs France (Group I)',
 '2026-06-26', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-norway-vs-france-2026-06-26',
 'Match 61 · Group I · Boston, USA
Kick-off 20:00 BST (Friday). Final group game — both Group I matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Senegal vs TBD (Group I)',
 '2026-06-26', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-senegal-vs-tbd-group-i-2026-06-26',
 'Match 62 · Group I · Toronto, Canada
Kick-off 20:00 BST (Friday). Senegal vs AFC/CONMEBOL playoff winner. Final group game — both Group I matches kick off simultaneously.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sat 27 Jun
-- (Panama vs England at 22:00 already exists — updated above)

('World Cup 2026: Croatia vs Ghana (Group L)',
 '2026-06-27', '22:00', '00:00', 'draft', true, 0,
 'world-cup-2026-croatia-vs-ghana-2026-06-27',
 'Match 68 · Group L · Philadelphia, USA
Kick-off 22:00 BST (Saturday). Final group game — both Group L matches kick off simultaneously.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== ROUND OF 32 =====

-- Sun 28 Jun
('World Cup 2026: Round of 32 (Match 73)',
 '2026-06-28', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-r32-match-73-2026-06-28',
 'Match 73 · Round of 32 · Los Angeles, USA
Kick-off 20:00 BST (Sunday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Mon 29 Jun
('World Cup 2026: Round of 32 (Match 76)',
 '2026-06-29', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-r32-match-76-2026-06-29',
 'Match 76 · Round of 32 · Houston, USA
Kick-off 18:00 BST (Monday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 32 (Match 74)',
 '2026-06-29', '21:30', '23:30', 'draft', true, 0,
 'world-cup-2026-r32-match-74-2026-06-29',
 'Match 74 · Round of 32 · Boston, USA
Kick-off 21:30 BST (Monday). Teams TBD — decided by group results.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Tue 30 Jun
('World Cup 2026: Round of 32 (Match 78)',
 '2026-06-30', '18:00', '20:00', 'draft', true, 0,
 'world-cup-2026-r32-match-78-2026-06-30',
 'Match 78 · Round of 32 · Dallas, USA
Kick-off 18:00 BST (Tuesday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 32 (Match 77)',
 '2026-06-30', '22:00', '00:00', 'draft', true, 0,
 'world-cup-2026-r32-match-77-2026-06-30',
 'Match 77 · Round of 32 · New York, USA
Kick-off 22:00 BST (Tuesday). Teams TBD — decided by group results.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Wed 1 Jul
('World Cup 2026: Round of 32 (Match 80)',
 '2026-07-01', '17:00', '19:00', 'draft', true, 0,
 'world-cup-2026-r32-match-80-2026-07-01',
 'Match 80 · Round of 32 · Atlanta, USA
Kick-off 17:00 BST (Wednesday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 32 (Match 82)',
 '2026-07-01', '21:00', '23:00', 'draft', true, 0,
 'world-cup-2026-r32-match-82-2026-07-01',
 'Match 82 · Round of 32 · Seattle, USA
Kick-off 21:00 BST (Wednesday). Teams TBD — decided by group results.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Thu 2 Jul
('World Cup 2026: Round of 32 (Match 84)',
 '2026-07-02', '20:00', '22:00', 'draft', true, 0,
 'world-cup-2026-r32-match-84-2026-07-02',
 'Match 84 · Round of 32 · Los Angeles, USA
Kick-off 20:00 BST (Thursday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Fri 3 Jul
('World Cup 2026: Round of 32 (Match 88)',
 '2026-07-03', '19:00', '21:00', 'draft', true, 0,
 'world-cup-2026-r32-match-88-2026-07-03',
 'Match 88 · Round of 32 · Dallas, USA
Kick-off 19:00 BST (Friday). Teams TBD — decided by group results.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 32 (Match 86)',
 '2026-07-03', '23:00', '01:00', 'draft', true, 0,
 'world-cup-2026-r32-match-86-2026-07-03',
 'Match 86 · Round of 32 · Miami, USA
Kick-off 23:00 BST (Friday). Teams TBD — decided by group results.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== ROUND OF 16 =====

-- Sat 4 Jul
('World Cup 2026: Round of 16 (Match 90)',
 '2026-07-04', '18:00', '20:30', 'draft', true, 0,
 'world-cup-2026-r16-match-90-2026-07-04',
 'Match 90 · Round of 16 · Houston, USA
Kick-off 18:00 BST (Saturday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 16 (Match 89)',
 '2026-07-04', '22:00', '00:30', 'draft', true, 0,
 'world-cup-2026-r16-match-89-2026-07-04',
 'Match 89 · Round of 16 · Philadelphia, USA
Kick-off 22:00 BST (Saturday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sun 5 Jul
('World Cup 2026: Round of 16 (Match 91)',
 '2026-07-05', '21:00', '23:30', 'draft', true, 0,
 'world-cup-2026-r16-match-91-2026-07-05',
 'Match 91 · Round of 16 · New York, USA
Kick-off 21:00 BST (Sunday). Knockout match — extra time and penalties possible.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Mon 6 Jul
('World Cup 2026: Round of 16 (Match 93)',
 '2026-07-06', '20:00', '22:30', 'draft', true, 0,
 'world-cup-2026-r16-match-93-2026-07-06',
 'Match 93 · Round of 16 · Dallas, USA
Kick-off 20:00 BST (Monday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Tue 7 Jul
('World Cup 2026: Round of 16 (Match 95)',
 '2026-07-07', '17:00', '19:30', 'draft', true, 0,
 'world-cup-2026-r16-match-95-2026-07-07',
 'Match 95 · Round of 16 · Atlanta, USA
Kick-off 17:00 BST (Tuesday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

('World Cup 2026: Round of 16 (Match 96)',
 '2026-07-07', '21:00', '23:30', 'draft', true, 0,
 'world-cup-2026-r16-match-96-2026-07-07',
 'Match 96 · Round of 16 · Vancouver, Canada
Kick-off 21:00 BST (Tuesday). Knockout match — extra time and penalties possible.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== QUARTER-FINALS =====

-- Thu 9 Jul
('World Cup 2026: Quarter-final (Match 97)',
 '2026-07-09', '21:00', '23:30', 'draft', true, 0,
 'world-cup-2026-qf-match-97-2026-07-09',
 'Match 97 · Quarter-final · Boston, USA
Kick-off 21:00 BST (Thursday). Knockout match — extra time and penalties possible.
May run past closing — we''ll stay open if the pub is busy.
Book a table for the best screen view. Free entry, no deposits.'),

-- Fri 10 Jul
('World Cup 2026: Quarter-final (Match 98)',
 '2026-07-10', '20:00', '22:30', 'draft', true, 0,
 'world-cup-2026-qf-match-98-2026-07-10',
 'Match 98 · Quarter-final · Los Angeles, USA
Kick-off 20:00 BST (Friday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Sat 11 Jul
('World Cup 2026: Quarter-final (Match 99)',
 '2026-07-11', '22:00', '00:30', 'draft', true, 0,
 'world-cup-2026-qf-match-99-2026-07-11',
 'Match 99 · Quarter-final · Miami, USA
Kick-off 22:00 BST (Saturday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== SEMI-FINALS =====

-- Tue 14 Jul
('World Cup 2026: Semi-final (Match 101)',
 '2026-07-14', '20:00', '22:30', 'draft', true, 0,
 'world-cup-2026-sf-match-101-2026-07-14',
 'Match 101 · Semi-final · Dallas, USA
Kick-off 20:00 BST (Tuesday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- Wed 15 Jul
('World Cup 2026: Semi-final (Match 102)',
 '2026-07-15', '20:00', '22:30', 'draft', true, 0,
 'world-cup-2026-sf-match-102-2026-07-15',
 'Match 102 · Semi-final · Atlanta, USA
Kick-off 20:00 BST (Wednesday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== THIRD-PLACE PLAYOFF =====

-- Sat 18 Jul
('World Cup 2026: Third-place Playoff (Match 103)',
 '2026-07-18', '22:00', '00:30', 'draft', true, 0,
 'world-cup-2026-3rd-place-match-103-2026-07-18',
 'Match 103 · Third-place Playoff · Miami, USA
Kick-off 22:00 BST (Saturday). Knockout match — extra time and penalties possible.
Showing on our screens with sound on.
Book a table for the best screen view. Free entry, no deposits.'),

-- ===== FINAL =====

-- Sun 19 Jul
('World Cup 2026: Final (Match 104)',
 '2026-07-19', '20:00', '22:30', 'draft', true, 0,
 'world-cup-2026-final-match-104-2026-07-19',
 'Match 104 · FIFA World Cup 2026 Final · New York, USA
Kick-off 20:00 BST (Sunday). The biggest game in football.
Extra time and penalties possible. Showing on our screens with sound on.
Book early — this one fills up fast. Free entry, no deposits.')

ON CONFLICT (slug) DO NOTHING;
