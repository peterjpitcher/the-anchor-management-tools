-- Update existing event categories with comprehensive SEO content and metadata
-- All content written in British English

-- Quiz Night / Pub Pursuit
UPDATE event_categories 
SET 
  name = 'Quiz Night - Pub Pursuit',
  description = 'Monthly quiz nights featuring our unique Trivial Pursuit-style format where teams compete to collect four coloured cheese wedges (Blue, Green, Orange, Pink) while answering questions across themed categories.',
  slug = 'quiz-night-pub-pursuit',
  
  -- SEO Fields
  meta_title = 'Quiz Night at The Anchor Stanwell Moor | Pub Pursuit Trivia',
  meta_description = 'Join our monthly quiz nights at The Anchor pub. £3 entry, £25 bar voucher prize, unique cheese wedge format. Every Wednesday at 7pm. Book your team now!',
  short_description = 'Monthly quiz with unique Trivial Pursuit format. Teams collect four coloured wedges (Blue, Green, Orange, Pink). £3 entry, £25 bar voucher first prize.',
  long_description = 'Experience the best quiz night in Stanwell Moor at The Anchor pub. Our unique "Pub Pursuit" format combines traditional pub quiz charm with innovative gameplay mechanics. Teams compete to collect four coloured cheese wedges (Blue, Green, Orange, Pink) by scoring 7/10 or higher in themed rounds, with power-ups and mini-challenges adding strategic depth. Wedges earn bonus points (1 wedge = +2, 2 = +4, 3 = +7, 4 = +10 points). Perfect for work teams, social groups, and families (until 9pm). With professional hosting by Peter Pitcher, themed monthly specials, and a £25 bar voucher for the winning team, it''s the highlight of the midweek calendar.',
  
  -- Keywords and Highlights
  keywords = '["pub quiz", "quiz night", "trivia night", "Stanwell Moor quiz", "pub games", "team quiz", "Wednesday quiz", "family quiz night", "quiz prizes", "Trivial Pursuit quiz"]'::jsonb,
  highlights = '["£25 bar voucher first prize", "Four coloured wedges to collect", "6 power-up questions", "Bonus points for wedges", "Family-friendly until 9pm", "Monthly themed rounds"]'::jsonb,
  
  -- Default Event Settings
  default_start_time = '19:00',
  default_end_time = '21:30',
  default_duration_minutes = 150,
  default_doors_time = '4pm',
  default_last_entry_time = NULL,
  default_capacity = 80,
  default_price = 3.00,
  default_is_free = false,
  default_performer_name = 'Peter Pitcher',
  default_performer_type = 'Person',
  default_booking_url = NULL,
  
  -- Set all image fields to NULL
  default_image_url = NULL,
  thumbnail_image_url = NULL,
  poster_image_url = NULL,
  gallery_image_urls = '[]'::jsonb,
  
  -- Updated timestamp
  updated_at = NOW()
WHERE 
  name ILIKE '%quiz%' OR 
  name = 'Quiz Night' OR 
  id IN (SELECT id FROM event_categories WHERE name ILIKE '%quiz%' LIMIT 1);

-- Tasting Nights
UPDATE event_categories 
SET 
  name = 'Tasting Nights',
  description = 'Premium spirit tasting experiences combining education, entertainment, and culinary pairings. Each event focuses on a specific spirit category with guided tastings and expert hosting.',
  slug = 'tasting-nights',
  
  -- SEO Fields
  meta_title = 'Spirit Tasting Nights at The Anchor | Premium Tasting Events',
  meta_description = 'Experience premium spirit tastings at The Anchor Stanwell Moor. £25-30 tickets include 6-7 tastings, food pairings & cocktail making. Book now!',
  short_description = 'Premium spirit tasting experiences with food pairings, education, and cocktail-making. Intimate setting for 25-35 guests.',
  long_description = 'Discover the world of premium spirits at The Anchor''s exclusive tasting nights. Our carefully curated events feature 6-7 premium spirit tastings with guided notes, educational videos, themed food pairings, and interactive cocktail-making sessions. From tequila to rum, winter warmers to spring spirits, each event is hosted by Peter Pitcher in our intimate private dining room. Perfect for spirit enthusiasts, couples seeking unique date nights, or corporate team building. Tickets include all tastings, food pairings, recipe booklets, and a themed quiz with prizes.',
  
  -- Keywords and Highlights
  keywords = '["spirit tasting", "whisky tasting", "rum tasting", "tequila tasting", "cocktail making", "food pairing", "tasting events", "premium spirits", "Stanwell Moor events", "date night ideas"]'::jsonb,
  highlights = '["6-7 premium spirit tastings", "Themed food pairings included", "Interactive cocktail-making", "Educational yet entertaining", "Take-home recipe booklets", "Intimate setting (25-35 guests)"]'::jsonb,
  
  -- Default Event Settings
  default_start_time = '19:00',
  default_end_time = '22:00',
  default_duration_minutes = 180,
  default_doors_time = '4pm',
  default_last_entry_time = NULL,
  default_capacity = 35,
  default_price = 27.50,
  default_is_free = false,
  default_performer_name = 'Peter Pitcher',
  default_performer_type = 'Person',
  default_booking_url = NULL,
  
  -- Set all image fields to NULL
  default_image_url = NULL,
  thumbnail_image_url = NULL,
  poster_image_url = NULL,
  gallery_image_urls = '[]'::jsonb,
  
  -- Updated timestamp
  updated_at = NOW()
WHERE 
  name ILIKE '%tasting%' OR 
  name = 'Tasting Night' OR 
  id IN (SELECT id FROM event_categories WHERE name ILIKE '%tasting%' LIMIT 1);

-- Bingo Nights
UPDATE event_categories 
SET 
  name = 'Bingo Night',
  description = 'Traditional cash bingo with a modern pub twist. Monthly events featuring 10 games with varying prize structures, creating an exciting and social atmosphere for all ages.',
  slug = 'bingo-night',
  
  -- SEO Fields
  meta_title = 'Bingo Night at The Anchor Stanwell Moor | Cash Prizes Monthly',
  meta_description = 'Play traditional cash bingo at The Anchor pub. £10 for 10 games, cash prizes & jackpots. First Thursday monthly at 6pm. All ages welcome!',
  short_description = 'Traditional cash bingo with 10 games, prizes, and progressive jackpot. Family-friendly monthly event.',
  long_description = 'Join us for traditional cash bingo at The Anchor, where classic gameplay meets modern pub atmosphere. Our monthly bingo nights feature 10 exciting games with varying prize structures, including a progressive snowball jackpot that builds each month. With just £10 for a full book covering all games, it''s affordable entertainment for the whole family. Games run from 6pm to 9pm with a 15-minute break halfway through. Cash prizes, food vouchers, and event tickets up for grabs. Children welcome with supervision. A perfect midweek social event bringing together players of all ages in a friendly, inclusive atmosphere.',
  
  -- Keywords and Highlights
  keywords = '["bingo night", "cash bingo", "bingo Stanwell Moor", "family bingo", "Thursday bingo", "pub bingo", "cash prizes", "jackpot bingo", "traditional bingo", "monthly bingo"]'::jsonb,
  highlights = '["£10 for 10 games", "Cash prizes & vouchers", "Progressive snowball jackpot", "Family-friendly event", "First Thursday monthly", "Traditional paper bingo"]'::jsonb,
  
  -- Default Event Settings
  default_start_time = '18:00',
  default_end_time = '21:00',
  default_duration_minutes = 180,
  default_doors_time = '30 mins',
  default_last_entry_time = '18:30',
  default_capacity = 100,
  default_price = 10.00,
  default_is_free = false,
  default_performer_name = 'Peter Pitcher',
  default_performer_type = 'Person',
  default_booking_url = NULL,
  
  -- Set all image fields to NULL
  default_image_url = NULL,
  thumbnail_image_url = NULL,
  poster_image_url = NULL,
  gallery_image_urls = '[]'::jsonb,
  
  -- Updated timestamp
  updated_at = NOW()
WHERE 
  name ILIKE '%bingo%' OR 
  name = 'Bingo' OR 
  id IN (SELECT id FROM event_categories WHERE name ILIKE '%bingo%' LIMIT 1);

-- Drag Nights / Drag Cabaret
UPDATE event_categories 
SET 
  name = 'Drag Cabaret with Nikki Manfadge',
  description = 'High-energy, adult-oriented cabaret entertainment featuring resident drag queen Nikki Manfadge. Interactive shows combining comedy, games, music, and audience participation.',
  slug = 'drag-cabaret-nikki-manfadge',
  
  -- SEO Fields
  meta_title = 'Drag Cabaret Night at The Anchor | Nikki Manfadge Show',
  meta_description = 'Experience outrageous drag cabaret with Nikki Manfadge at The Anchor. FREE entry, monthly Fridays, adult comedy & games. 18+ only. Book now!',
  short_description = 'Outrageous drag cabaret with comedy, games, and audience participation. FREE entry, 18+ only.',
  long_description = 'Get ready for an unforgettable night of adult entertainment with Nikki Manfadge at The Anchor''s monthly drag cabaret! Our resident queen brings her unique brand of unfiltered comedy, outrageous games, and spontaneous energy to create a night like no other. From "Play Your Cards Right" with a drag twist to hilarious "Dear Deirdre" advice segments, every show is unpredictable and responds to the crowd''s energy. With FREE entry (booking recommended), karaoke opportunities, photo ops, and non-stop laughs, it''s the perfect night out for hen parties, birthdays, or anyone seeking alternative entertainment. Standing and singing actively encouraged! 18+ only due to adult content and strong language.',
  
  -- Keywords and Highlights
  keywords = '["drag show", "drag cabaret", "Nikki Manfadge", "drag queen", "LGBTQ events", "adult entertainment", "comedy night", "cabaret show", "Stanwell Moor nightlife", "Friday night entertainment"]'::jsonb,
  highlights = '["FREE entry", "Monthly Friday shows", "Interactive games & comedy", "Adult humour throughout", "Photo opportunities", "18+ only event"]'::jsonb,
  
  -- Default Event Settings
  default_start_time = '19:00',
  default_end_time = '23:00',
  default_duration_minutes = 240,
  default_doors_time = '4pm',
  default_last_entry_time = NULL,
  default_capacity = 120,
  default_price = 0.00,
  default_is_free = true,
  default_performer_name = 'Nikki Manfadge',
  default_performer_type = 'Person',
  default_booking_url = NULL,
  
  -- Set all image fields to NULL
  default_image_url = NULL,
  thumbnail_image_url = NULL,
  poster_image_url = NULL,
  gallery_image_urls = '[]'::jsonb,
  
  -- Updated timestamp
  updated_at = NOW()
WHERE 
  name ILIKE '%drag%' OR 
  name ILIKE '%cabaret%' OR 
  id IN (SELECT id FROM event_categories WHERE name ILIKE '%drag%' OR name ILIKE '%cabaret%' LIMIT 1);


-- Karaoke Night (if category exists)
UPDATE event_categories 
SET 
  name = 'Karaoke Night',
  description = 'Weekly karaoke sessions with professional equipment, extensive song library, and a supportive crowd. All abilities welcome!',
  slug = 'karaoke-night',
  
  -- SEO Fields
  meta_title = 'Karaoke Night at The Anchor | Thursday Karaoke Stanwell Moor',
  meta_description = 'Sing your heart out at The Anchor''s karaoke nights. Professional equipment, huge song library, FREE entry. Every Thursday from 8pm!',
  short_description = 'Weekly karaoke with professional setup and extensive song library. FREE entry, all welcome!',
  long_description = 'Thursday nights at The Anchor come alive with our popular karaoke sessions! Whether you''re a shower singer or seasoned performer, our welcoming crowd and professional setup create the perfect environment to shine. With state-of-the-art equipment, an extensive song library covering all genres and decades, and experienced hosts to support you, it''s the highlight of the week for many regulars. FREE entry means you can spend more on Dutch courage! From power ballads to rap battles, duets to group performances, anything goes. Join our supportive community of music lovers every Thursday from 8pm.',
  
  -- Keywords and Highlights
  keywords = '["karaoke night", "Thursday karaoke", "pub karaoke", "sing karaoke", "karaoke Stanwell", "free karaoke", "karaoke bar", "singing night", "open mic", "Thursday night out"]'::jsonb,
  highlights = '["FREE entry", "Professional equipment", "Huge song library", "Every Thursday", "Supportive atmosphere", "All abilities welcome"]'::jsonb,
  
  -- Default Event Settings
  default_start_time = '20:00',
  default_end_time = '23:30',
  default_duration_minutes = 210,
  default_doors_time = '1 hour',
  default_capacity = 80,
  default_price = 0.00,
  default_is_free = true,
  default_performer_name = 'Peter Pitcher',
  default_performer_type = 'Person',
  default_booking_url = NULL,
  
  -- Set all image fields to NULL
  default_image_url = NULL,
  thumbnail_image_url = NULL,
  poster_image_url = NULL,
  gallery_image_urls = '[]'::jsonb,
  
  -- Updated timestamp
  updated_at = NOW()
WHERE 
  name ILIKE '%karaoke%' OR 
  name = 'Karaoke' OR 
  id IN (SELECT id FROM event_categories WHERE name ILIKE '%karaoke%' LIMIT 1);

-- Add any missing default values to all categories
UPDATE event_categories
SET
  default_event_status = COALESCE(default_event_status, 'scheduled'),
  default_reminder_hours = COALESCE(default_reminder_hours, 24),
  is_active = COALESCE(is_active, true),
  updated_at = NOW()
WHERE 
  default_event_status IS NULL OR 
  default_reminder_hours IS NULL OR
  is_active IS NULL;

-- Add FAQs for Quiz Night
UPDATE event_categories
SET
  faqs = '[
    {"question": "How do teams work?", "answer": "Teams can be 2-8 people, with 4-6 being ideal. You can form teams on arrival or book as a team.", "sort_order": 1},
    {"question": "What are the four coloured wedges?", "answer": "Blue, Green, Orange, and Pink wedges representing themed rounds. Score 7/10 or higher to earn each wedge. Wedges give bonus points: 1=+2, 2=+4, 3=+7, 4=+10 points.", "sort_order": 2},
    {"question": "Can children participate?", "answer": "Yes! Families are welcome until 9pm. We have easier questions mixed in for younger players.", "sort_order": 3},
    {"question": "Do we need to book?", "answer": "Booking is recommended but walk-ins are welcome if space allows. Book online or call us.", "sort_order": 4},
    {"question": "What are the power-ups?", "answer": "First-to-answer questions that give advantages like extra points, stealing points from rivals, blocking their wedges, or free drink vouchers.", "sort_order": 5}
  ]'::jsonb
WHERE slug = 'quiz-night-pub-pursuit';

-- Add FAQs for Tasting Nights
UPDATE event_categories
SET
  faqs = '[
    {"question": "What''s included in the ticket?", "answer": "All spirit tastings (6-7), themed food pairings, educational materials, and cocktail-making session.", "sort_order": 1},
    {"question": "Are there vegetarian options?", "answer": "Yes, we cater for dietary requirements. Please inform us when booking.", "sort_order": 2},
    {"question": "Can I buy bottles afterwards?", "answer": "Some featured spirits may be available to purchase. Ask your host on the night.", "sort_order": 3},
    {"question": "Is this suitable for beginners?", "answer": "Absolutely! Our events are educational and welcoming to all experience levels.", "sort_order": 4},
    {"question": "What''s the dress code?", "answer": "Smart casual. No need to dress up, just come comfortable and ready to enjoy!", "sort_order": 5}
  ]'::jsonb
WHERE slug = 'tasting-nights';

-- Add FAQs for Bingo
UPDATE event_categories
SET
  faqs = '[
    {"question": "How much does it cost?", "answer": "£10 cash for a book covering all 10 games. Dabbers are £1.50 each.", "sort_order": 1},
    {"question": "Do I need to bring cash?", "answer": "Yes, we only accept cash for bingo books and dabbers. The bar accepts cards.", "sort_order": 2},
    {"question": "How does the snowball work?", "answer": "It starts at £20 and builds each month. You must attend 3 consecutive games to be eligible.", "sort_order": 3},
    {"question": "Are children allowed?", "answer": "Yes, children are welcome but must be supervised and remain seated during games.", "sort_order": 4},
    {"question": "What are the prizes?", "answer": "Cash prizes, food/drink vouchers, and event tickets. Game 10 is our big jackpot game!", "sort_order": 5}
  ]'::jsonb
WHERE slug = 'bingo-night';

-- Add FAQs for Drag Cabaret
UPDATE event_categories
SET
  faqs = '[
    {"question": "Is this suitable for hen parties?", "answer": "Absolutely! Nikki loves hen parties. Let us know when booking for special attention!", "sort_order": 1},
    {"question": "What''s the age restriction?", "answer": "Strictly 18+ due to adult content and strong language throughout the show.", "sort_order": 2},
    {"question": "Do I need to book?", "answer": "Booking is strongly recommended as these shows often sell out. Entry is FREE!", "sort_order": 3},
    {"question": "Can I take photos?", "answer": "Yes! Photos are encouraged and Nikki loves doing photo ops after the show.", "sort_order": 4},
    {"question": "What should I expect?", "answer": "Adult humour, audience interaction, games, and non-stop entertainment. Come ready to laugh!", "sort_order": 5}
  ]'::jsonb
WHERE slug = 'drag-cabaret-nikki-manfadge';