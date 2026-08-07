import 'dotenv/config'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../../src/types/database.generated'

type CategoryUpdate = Database['public']['Tables']['event_categories']['Update']

const ACCESSIBILITY = 'The bar and dining area are step-free from the level car park. The beer garden has steps, with a ramp available on request. We do not currently have an accessible toilet. Assistance dogs are welcome. Please call 01753 682707 to discuss specific access needs.'
const NO_CHARGE_CANCELLATION = 'There is no cancellation charge. If you can no longer attend, please cancel your booking so the places can be released to other guests.'
const NON_REFUNDABLE_CANCELLATION = 'Tickets are non-refundable. If you can no longer attend, please contact us as soon as possible.'

const faq = (question: string, answer: string, sort_order: number) => ({ question, answer, sort_order })

const activeTemplates: Record<string, CategoryUpdate> = {
  'quiz-night-stanwell-moor': {
    name: 'Quiz Night',
    description: 'A friendly, family-friendly pub quiz at The Anchor in Stanwell Moor, with varied rounds, communal seating and cash payment on arrival.',
    icon: 'AcademicCapIcon',
    color: '#9333EA',
    sort_order: 1,
    is_active: true,
    default_start_time: '19:00',
    default_end_time: '21:30',
    default_duration_minutes: 150,
    default_doors_time: '18:30',
    default_last_entry_time: '19:15',
    default_capacity: 60,
    default_price: 3,
    default_is_free: false,
    default_booking_mode: 'communal',
    default_payment_mode: 'cash_only',
    default_performer_name: 'Peter Pitcher',
    default_performer_type: 'Person',
    short_description: 'Join our family-friendly pub quiz in Stanwell Moor for varied rounds, friendly competition and communal seating. Entry is £3 cash on arrival.',
    long_description: `Quiz Night at The Anchor is a friendly pub quiz in Stanwell Moor for families, friends, neighbours and work teams. The questions cover a varied mix of general knowledge, music, film, sport and popular culture, so every member of the team has a chance to contribute. It is competitive enough to be satisfying but relaxed enough for first-time teams and casual players.

The quiz starts at 7pm and normally finishes at 9.30pm. Entry is £3 per person, paid in cash on arrival. Seating is communal, so places are booked for each player rather than as a private table. Booking ahead helps us prepare the room and keep groups together where possible. Children are welcome, making this a practical family-friendly evening as well as a good midweek night out with friends.

The Anchor is in Stanwell Moor, close to Staines and Heathrow, with free on-site parking. Guests can order drinks at the bar and settle in before the first round. Each event listing gives the date, any special round details and the prizes available that month, so check the individual event before travelling.

If you are searching for a quiz night near Heathrow, a pub quiz near Staines or a welcoming local quiz in Stanwell Moor, this is an easy event to join. Bring a team or book a smaller group and enjoy an evening built around conversation, teamwork and a good range of questions. There is no cancellation charge, but please release your booking if your plans change so another team can use the space.`,
    meta_title: 'Quiz Night in Stanwell Moor | The Anchor Pub Quiz',
    meta_description: 'Join Quiz Night at The Anchor, Stanwell Moor. Family-friendly pub quiz, communal seating and £3 cash entry. Book your places online.',
    highlights: ['Family-friendly quiz', 'Varied question rounds', 'Communal seating', '£3 cash on arrival', 'Free on-site parking'],
    keywords: ['quiz night', 'pub quiz', 'Stanwell Moor quiz', 'quiz near Heathrow', 'quiz near Staines'],
    primary_keywords: ['quiz night', 'pub quiz'],
    secondary_keywords: ['family-friendly quiz', 'local pub quiz', 'trivia night', 'midweek pub events'],
    local_seo_keywords: ['Stanwell Moor quiz', 'quiz near Heathrow', 'quiz near Staines', 'The Anchor pub quiz'],
    image_alt_text: 'Quiz Night teams taking part in a pub quiz at The Anchor in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('Is Quiz Night family-friendly?', 'Yes. Quiz Night is family-friendly and children are welcome when accompanied by an adult.', 0),
      faq('How much is Quiz Night?', 'Entry is £3 per person and is paid in cash on arrival at The Anchor.', 1),
      faq('How is the seating arranged?', 'Quiz Night uses communal seating. Book the number of players attending and we will arrange the room for the teams.', 2),
      faq('What time does the quiz run?', 'The quiz starts at 7pm and normally finishes at 9.30pm. Please arrive in time to get settled.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  'tasting-nights': {
    name: 'Tasting Nights',
    description: 'Guided tasting events at The Anchor in Stanwell Moor, with communal seating, expert-friendly hosting and prepaid £45 tickets for guests aged 18 and over.',
    icon: 'BeakerIcon',
    color: '#991B1B',
    sort_order: 2,
    is_active: true,
    default_start_time: '19:00',
    default_end_time: '22:00',
    default_duration_minutes: 180,
    default_doors_time: '18:30',
    default_last_entry_time: '19:15',
    default_capacity: 25,
    default_price: 45,
    default_is_free: false,
    default_booking_mode: 'communal',
    default_payment_mode: 'prepaid',
    default_performer_name: 'Peter Pitcher',
    default_performer_type: 'Person',
    short_description: 'Explore guided spirit tastings at The Anchor in Stanwell Moor. Tickets are £45, seating is communal and every tasting event is for guests aged 18+.',
    long_description: `Tasting Nights at The Anchor are guided tasting events in Stanwell Moor for guests who want to explore drinks in a relaxed pub setting. Each evening focuses on a particular spirit, style or theme and explains the flavours, production methods and stories behind the selection. You do not need specialist knowledge: the host keeps the evening clear, social and useful for both curious beginners and experienced enthusiasts.

Tickets are £45 per person and must be paid for in advance. Tastings use communal seating, which gives the evening a shared and conversational feel while every guest keeps their own booked place. The standard event runs from 7pm to 10pm. Exact samples, food pairings and any extra activities vary by theme, so the individual event page will always explain what is included before you buy.

All Tasting Nights are strictly for guests aged 18 and over. Please tell us about relevant dietary requirements when booking and read the event details carefully, particularly where a tasting includes paired food. Tickets are non-refundable, so make sure the date and theme suit you before completing payment.

The Anchor is close to Heathrow and Staines, with free on-site parking, making it a convenient choice for a spirit tasting near Heathrow or an unusual evening out in Surrey. The smaller group size helps guests ask questions, compare notes and enjoy the experience without the formality of a classroom. Whether the theme is whisky, rum, tequila or another carefully chosen range, the aim is a well-paced tasting night with practical information, good company and time to appreciate every sample.`,
    meta_title: 'Tasting Nights Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Book a £45 guided Tasting Night at The Anchor, Stanwell Moor. Communal seating, prepaid tickets and relaxed 18+ spirit tasting events.',
    highlights: ['Guided tasting experience', '£45 prepaid ticket', 'Communal seating', 'Beginners welcome', 'Strictly 18+'],
    keywords: ['tasting nights', 'spirit tasting', 'whisky tasting', 'rum tasting', 'tasting events near Heathrow'],
    primary_keywords: ['tasting nights', 'spirit tasting'],
    secondary_keywords: ['guided tasting event', 'whisky tasting', 'rum tasting', 'drinks tasting experience'],
    local_seo_keywords: ['tasting events Stanwell Moor', 'spirit tasting near Heathrow', 'tasting night near Staines', 'The Anchor tasting events'],
    image_alt_text: 'Tasting Nights spirit flight and food pairings at The Anchor in Stanwell Moor',
    cancellation_policy: NON_REFUNDABLE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('How much is a Tasting Night ticket?', 'Tickets are £45 per person and must be paid for in advance when you book.', 0),
      faq('Are Tasting Nights suitable for beginners?', 'Yes. The evenings are guided in plain language and welcome guests with any level of tasting experience.', 1),
      faq('Are Tasting Nights over 18s only?', 'Yes. Every Tasting Night is strictly for guests aged 18 and over.', 2),
      faq('Are tasting tickets refundable?', 'No. Prepaid tasting tickets are non-refundable, so please check the date before paying.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  'bingo-night': {
    name: 'Cash Bingo',
    description: 'Traditional cash bingo at The Anchor in Stanwell Moor, with communal seating, cash payment on arrival and games for adults aged 18+, while children remain welcome.',
    icon: 'SquaresPlusIcon',
    color: '#16A34A',
    sort_order: 3,
    is_active: true,
    default_start_time: '19:00',
    default_end_time: '21:30',
    default_duration_minutes: 150,
    default_doors_time: '18:30',
    default_last_entry_time: '19:15',
    default_capacity: 60,
    default_price: 10,
    default_is_free: false,
    default_booking_mode: 'communal',
    default_payment_mode: 'cash_only',
    default_performer_name: 'Peter Pitcher',
    default_performer_type: 'Person',
    short_description: 'Play traditional Cash Bingo at The Anchor in Stanwell Moor. Books are £10 cash on arrival, players must be 18+, and children are welcome.',
    long_description: `Cash Bingo at The Anchor brings traditional paper bingo to a friendly pub in Stanwell Moor. The evening is easy to follow for regular players and complete beginners, with a clear caller, communal seating and time between games to check cards and catch up with the people around you. It is a social midweek event with real cash prizes and a relaxed local atmosphere.

A bingo book costs £10 and is paid for in cash on arrival. Players must be aged 18 or over to buy a book and take part in the games. Children are welcome to attend with their family or supervising adult, but they cannot play for cash. The standard session starts at 7pm and finishes at about 9.30pm. Book your places online so we can plan the communal seating, then bring cash for the bingo book on the night.

The game format, number of rounds and prize amounts can vary, and the individual event listing will confirm any special jackpot or themed details. The bar accepts its usual payment methods separately from the cash bingo entry. There is no cancellation fee, but cancelling an unused booking helps us offer the place to somebody else.

The Anchor is close to Heathrow and Staines and has free on-site parking. That makes Cash Bingo a convenient option for anyone searching for bingo near Heathrow, a bingo night near Staines or a traditional pub bingo event in Stanwell Moor. Come with friends or book on your own; communal seating makes it simple to join the room, follow the games and enjoy a straightforward evening of numbers, prizes and good company.`,
    meta_title: 'Cash Bingo Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Play Cash Bingo at The Anchor, Stanwell Moor. £10 cash books, communal seating and 18+ play. Children are welcome with adults. Book online.',
    highlights: ['Traditional cash bingo', '£10 cash on arrival', 'Players must be 18+', 'Children welcome', 'Communal seating'],
    keywords: ['cash bingo', 'bingo night', 'pub bingo', 'bingo near Heathrow', 'bingo near Staines'],
    primary_keywords: ['cash bingo', 'bingo night'],
    secondary_keywords: ['traditional bingo', 'pub bingo', 'cash prize bingo', 'local bingo event'],
    local_seo_keywords: ['bingo Stanwell Moor', 'bingo near Heathrow', 'bingo near Staines', 'The Anchor bingo night'],
    image_alt_text: 'Cash Bingo cards and players at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('How much does Cash Bingo cost?', 'A bingo book costs £10 and must be paid for in cash on arrival.', 0),
      faq('How old must I be to play Cash Bingo?', 'You must be aged 18 or over to buy a bingo book and play for cash prizes.', 1),
      faq('Can children come to Cash Bingo?', 'Yes. Children are welcome with a supervising adult, but only guests aged 18 and over can play.', 2),
      faq('How is seating arranged?', 'Cash Bingo uses communal seating. Book every person attending so we can prepare enough places.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  celebrations: {
    name: 'Celebrations',
    description: 'Special celebration events at The Anchor in Stanwell Moor, covering seasonal occasions, community milestones and welcoming social gatherings.',
    icon: 'CakeIcon',
    color: '#F59E0B',
    sort_order: 4,
    is_active: true,
    default_start_time: null,
    default_end_time: null,
    default_duration_minutes: null,
    default_doors_time: null,
    default_last_entry_time: null,
    default_capacity: 80,
    default_price: 0,
    default_is_free: true,
    default_booking_mode: 'table',
    default_payment_mode: 'free',
    default_performer_name: null,
    default_performer_type: null,
    short_description: 'Join special celebration events at The Anchor in Stanwell Moor, from seasonal occasions to community gatherings in a warm, friendly pub setting.',
    long_description: `Celebrations at The Anchor bring special occasions and community moments together in a welcoming pub in Stanwell Moor. This category is used for public celebration events, seasonal gatherings and one-off occasions that deserve more than an ordinary visit. Each event has its own plan, but the focus is always on a friendly room, simple booking and an atmosphere where groups can enjoy the occasion together.

Dates, times, entertainment and any food offer vary from one celebration to the next. The individual event page is therefore the place to check exactly what is included, whether booking is essential and whether there are any age restrictions for that occasion. The standard template is free to book and uses table seating, but a specific event can show different arrangements where needed. Please reserve for the correct number of guests so the team can prepare the space.

The Anchor is close to Heathrow and Staines, with free parking on site. It works well for guests looking for celebration events near Heathrow, things to do in Stanwell Moor or a relaxed local gathering without travelling into central London. Drinks are available from the bar, and event-specific food information will be shown on the relevant listing.

Because this category covers a range of special events, every listing is written with the practical details for that date. Check the start time, booking method and highlights before attending. If your plans change, cancel the booking so the places can be released to somebody else. From seasonal celebrations to community milestones, these events are designed to make The Anchor a comfortable place to meet, mark the occasion and spend time with the people who matter.`,
    meta_title: 'Celebration Events Near Heathrow | The Anchor Pub',
    meta_description: 'Find celebration events at The Anchor in Stanwell Moor, close to Heathrow and Staines. View dates, event details and book your places online.',
    highlights: ['Special one-off events', 'Welcoming pub setting', 'Free on-site parking', 'Close to Heathrow', 'Online booking'],
    keywords: ['celebrations', 'celebration events', 'special events', 'seasonal events', 'community events'],
    primary_keywords: ['celebrations', 'celebration events'],
    secondary_keywords: ['special occasions', 'seasonal events', 'community gatherings', 'local pub events'],
    local_seo_keywords: ['celebrations Stanwell Moor', 'events near Heathrow', 'events near Staines', 'The Anchor special events'],
    image_alt_text: 'Celebrations table with cake and decorations at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('What events are included under Celebrations?', 'This category covers seasonal gatherings, community occasions and other special public events at The Anchor.', 0),
      faq('Are celebration events free?', 'The standard template is free, but please check the individual event page because arrangements can vary.', 1),
      faq('Do I need to book?', 'Booking is recommended whenever an event page offers tickets or table reservations, as space may be limited.', 2),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  sport: {
    name: 'Live Sport',
    description: 'Watch selected live sport at The Anchor in Stanwell Moor with free individual tickets, a friendly pub atmosphere and easy access from Heathrow and Staines.',
    icon: 'TrophyIcon',
    color: '#16A34A',
    sort_order: 5,
    is_active: true,
    default_start_time: null,
    default_end_time: null,
    default_duration_minutes: null,
    default_doors_time: null,
    default_last_entry_time: null,
    default_capacity: 80,
    default_price: 0,
    default_is_free: true,
    default_booking_mode: 'general',
    default_payment_mode: 'free',
    default_performer_name: null,
    default_performer_type: null,
    short_description: 'Watch selected Live Sport at The Anchor in Stanwell Moor. Entry is free, but book an individual ticket so we can manage capacity for the match.',
    long_description: `Live Sport at The Anchor gives supporters a friendly pub near Heathrow where they can watch selected fixtures with other fans. We list the matches and sporting events that will receive dedicated coverage, making it easy to see what is being shown before you travel. The atmosphere is social and welcoming, whether you follow every game or simply want to join friends for a major fixture.

Entry is free, but Live Sport events use individual tickets so we can manage capacity. Book one free ticket for every person attending. A ticket reserves your place at the event; the individual listing will explain the viewing and seating arrangements for that fixture. Start and finish times follow the sporting schedule, so always check the event page for the confirmed time and arrive early enough to settle in before play begins.

The Anchor is in Stanwell Moor, close to Heathrow Airport and Staines, with free on-site parking. Drinks are available from the bar, and any food service or special match offer will be shown on the specific event listing. There is no cancellation charge, but please cancel unused tickets so other supporters can take the available places.

If you are looking for live sport near Heathrow, football on TV near Staines or a local pub showing a major match, our Live Sport listings provide the practical answer. Each page names the fixture, date and start time without relying on a fixed weekly schedule. Book your free ticket, meet other supporters and enjoy the event in a comfortable pub setting. Team allegiances may differ, but respectful, good-natured support is expected from everyone.`,
    meta_title: 'Live Sport Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Watch selected Live Sport at The Anchor, Stanwell Moor. Free individual tickets, friendly pub atmosphere and free parking near Heathrow and Staines.',
    highlights: ['Selected live fixtures', 'Free individual tickets', 'Friendly pub atmosphere', 'Free on-site parking', 'Close to Heathrow'],
    keywords: ['live sport', 'sport pub', 'football on TV', 'sport near Heathrow', 'sport near Staines'],
    primary_keywords: ['live sport', 'sport'],
    secondary_keywords: ['pub showing football', 'watch sport at a pub', 'free sports tickets', 'major match screening'],
    local_seo_keywords: ['live sport Stanwell Moor', 'sport near Heathrow', 'football near Staines', 'The Anchor live sport'],
    image_alt_text: 'Guests watching Live Sport on television at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('Do I need a ticket for Live Sport?', 'Yes. Entry is free, but every guest needs an individual ticket so we can manage capacity.', 0),
      faq('Which fixtures are being shown?', 'Check the Live Sport event listings for the confirmed fixture, date and start time.', 1),
      faq('Is there a charge to watch?', 'No. Live Sport tickets are free, and there is no cancellation charge if your plans change.', 2),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  'karaoke-night': {
    name: 'Karaoke Night',
    description: 'Free, family-friendly karaoke at The Anchor in Stanwell Moor, with communal seating, a broad song choice and a welcoming stage for every singer.',
    icon: 'MicrophoneIcon',
    color: '#9333EA',
    sort_order: 6,
    is_active: true,
    default_start_time: '20:00',
    default_end_time: '23:30',
    default_duration_minutes: 210,
    default_doors_time: '19:00',
    default_last_entry_time: null,
    default_capacity: 80,
    default_price: 0,
    default_is_free: true,
    default_booking_mode: 'communal',
    default_payment_mode: 'free',
    default_performer_name: 'Peter Pitcher',
    default_performer_type: 'Person',
    short_description: 'Sing at our free, family-friendly Karaoke Night in Stanwell Moor. Enjoy communal seating, a wide song choice and a welcoming crowd at The Anchor.',
    long_description: `Karaoke Night at The Anchor is a free, family-friendly evening for confident performers, first-time singers and everyone who enjoys supporting the people on stage. The song choice covers different decades and styles, so groups can pick familiar favourites, try something new or share a duet. The host keeps the queue moving and the atmosphere encouraging rather than competitive.

The standard Karaoke Night runs from 8pm to 11.30pm and entry is free. Seating is communal, so book the number of people attending and we will prepare the room for the shared event layout. Families are welcome. Individual event listings will flag any date-specific change to the running time or format, so please check the page before travelling.

You do not need to be an experienced singer and there is no pressure to perform. Come to sing, come to listen or do both. Songs are requested on the night through the host, and availability depends on the karaoke library and the time remaining. Drinks are available from the bar throughout the evening.

The Anchor is in Stanwell Moor, close to Heathrow and Staines, with free parking on site. It is a convenient choice for anyone searching for karaoke near Heathrow, a family-friendly karaoke night near Staines or free pub entertainment in the local area. There is no cancellation charge, but releasing an unused booking helps another group attend. Bring friends, choose a song and enjoy a relaxed Karaoke Night where applause matters more than perfect notes. New singers can take their time and ask the host for help.`,
    meta_title: 'Karaoke Night Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Join free, family-friendly Karaoke Night at The Anchor, Stanwell Moor. Communal seating, wide song choice and free parking near Heathrow.',
    highlights: ['Free entry', 'Family-friendly', 'Communal seating', 'Wide song choice', 'All singing abilities welcome'],
    keywords: ['karaoke night', 'free karaoke', 'family-friendly karaoke', 'karaoke near Heathrow', 'karaoke near Staines'],
    primary_keywords: ['karaoke night', 'karaoke'],
    secondary_keywords: ['free karaoke', 'family-friendly karaoke', 'pub karaoke', 'singing night'],
    local_seo_keywords: ['karaoke Stanwell Moor', 'karaoke near Heathrow', 'karaoke near Staines', 'The Anchor karaoke'],
    image_alt_text: 'Karaoke Night singer using a microphone at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('Is Karaoke Night family-friendly?', 'Yes. Karaoke Night is family-friendly and children are welcome with a supervising adult.', 0),
      faq('How much does Karaoke Night cost?', 'Entry is free. Please book the number of people attending so we can plan the communal seating.', 1),
      faq('Do I have to sing?', 'No. You are welcome to sing, listen or support friends without taking the microphone yourself.', 2),
      faq('What time does Karaoke Night run?', 'The standard event runs from 8pm to 11.30pm. Check the event page for any date-specific change.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  parties: {
    name: 'Parties',
    description: 'Lively party events at The Anchor in Stanwell Moor, with music, themed entertainment and a relaxed pub setting close to Heathrow and Staines.',
    icon: 'SparklesIcon',
    color: '#EC4899',
    sort_order: 7,
    is_active: true,
    default_start_time: null,
    default_end_time: null,
    default_duration_minutes: null,
    default_doors_time: null,
    default_last_entry_time: null,
    default_capacity: 100,
    default_price: 0,
    default_is_free: true,
    default_booking_mode: 'table',
    default_payment_mode: 'free',
    default_performer_name: null,
    default_performer_type: null,
    short_description: 'Find party events at The Anchor in Stanwell Moor, with music, themed entertainment and a friendly pub atmosphere near Heathrow and Staines.',
    long_description: `Parties at The Anchor are lively public events built around music, themed entertainment and a friendly pub atmosphere in Stanwell Moor. This category is used for one-off party nights rather than a fixed weekly event, so every listing has its own date, running time and entertainment details. It is the place to look for a social night out with more energy than an ordinary evening at the pub.

The standard party event is free to book and uses table reservations, but arrangements can change according to the theme. Check the individual page for the confirmed start time, age guidance, performer or DJ information and whether a ticket is needed. Book for the correct number of guests so the team can plan the room and keep groups together where possible.

The Anchor is close to Heathrow and Staines and has free on-site parking. Guests can order drinks at the bar, and any food availability or special offer will be shown on the specific event page. There is no cancellation charge for a free booking, but please cancel if the group can no longer attend so the space does not go unused.

If you are searching for party events near Heathrow, themed nights near Staines or a local pub party in Stanwell Moor, these listings provide clear information before you make plans. Expect a welcoming room, music suited to the event and practical booking details in one place. Some nights may centre on dancing, while others may include a theme, live entertainment or a seasonal reason to get together. Read the listing, gather your group and book the event that suits the kind of night you want.`,
    meta_title: 'Party Events Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Find party events at The Anchor in Stanwell Moor, close to Heathrow and Staines. View themed nights, music events and booking details.',
    highlights: ['One-off party events', 'Music and entertainment', 'Friendly pub setting', 'Free on-site parking', 'Online booking'],
    keywords: ['parties', 'party events', 'themed party nights', 'party near Heathrow', 'party near Staines'],
    primary_keywords: ['parties', 'party events'],
    secondary_keywords: ['themed party nights', 'pub party', 'music events', 'group night out'],
    local_seo_keywords: ['parties Stanwell Moor', 'party near Heathrow', 'party near Staines', 'The Anchor party events'],
    image_alt_text: 'Parties with guests dancing at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('What kind of party events do you run?', 'The programme can include themed nights, music-led events and special one-off pub parties.', 0),
      faq('Are party events free?', 'The standard template is free, but always check the individual event page for its exact booking terms.', 1),
      faq('Do I need to book my group?', 'Booking is recommended so the team can plan the room and keep groups together where possible.', 2),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  'live-music': {
    name: 'Live Music',
    description: 'Live music events at The Anchor in Stanwell Moor, featuring local performers, a welcoming pub atmosphere and free table bookings near Heathrow.',
    icon: 'MusicalNoteIcon',
    color: '#9333EA',
    sort_order: 8,
    is_active: true,
    default_start_time: '20:00',
    default_end_time: '23:00',
    default_duration_minutes: 180,
    default_doors_time: '19:00',
    default_last_entry_time: null,
    default_capacity: 100,
    default_price: 0,
    default_is_free: true,
    default_booking_mode: 'table',
    default_payment_mode: 'free',
    default_performer_name: null,
    default_performer_type: 'MusicGroup',
    short_description: 'Enjoy Live Music at The Anchor in Stanwell Moor, with local performers, free table bookings and a friendly pub setting near Heathrow and Staines.',
    long_description: `Live Music at The Anchor brings singers, bands and local performers to a welcoming pub in Stanwell Moor. The programme changes from event to event, covering different artists and styles rather than repeating one fixed show. Each listing introduces the performer and gives the date, start time and musical details you need before booking.

The standard Live Music event starts at 8pm, finishes at about 11pm and is free to attend with a table booking. A particular event may use a different running time or booking arrangement, so check its page before travelling. Reserve for the correct number of guests so the team can plan the room, and arrive in good time if you want to settle in before the performance begins.

The Anchor is close to Heathrow Airport and Staines, with free on-site parking. Drinks are available from the bar, and any food service or event-specific offer will be described on the relevant page. Free events have no cancellation charge, but please cancel an unused table so another group can book it.

For anyone searching for live music near Heathrow, bands near Staines or a local music night in Stanwell Moor, The Anchor offers an intimate alternative to a large venue. You can hear the performer properly while still enjoying the relaxed feel of a pub evening with friends. The musical style may range from acoustic songs and familiar covers to soul, rock or other live sets. Browse the current Live Music events, choose the artist that suits you and book a table for a straightforward local night out.`,
    meta_title: 'Live Music Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Enjoy Live Music at The Anchor in Stanwell Moor. Discover local performers, free table bookings and free parking close to Heathrow and Staines.',
    highlights: ['Local live performers', 'Free table booking', 'Varied music styles', 'Intimate pub setting', 'Free on-site parking'],
    keywords: ['live music', 'local bands', 'acoustic music', 'live music near Heathrow', 'live music near Staines'],
    primary_keywords: ['live music', 'music night'],
    secondary_keywords: ['local performers', 'acoustic music', 'live bands', 'pub music events'],
    local_seo_keywords: ['live music Stanwell Moor', 'live music near Heathrow', 'live music near Staines', 'The Anchor live music'],
    image_alt_text: 'Live Music performer playing guitar at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('What time does Live Music start?', 'The standard start time is 8pm, but please check the individual event page for confirmation.', 0),
      faq('Is Live Music free?', 'The standard Live Music event is free with a table booking unless its event page says otherwise.', 1),
      faq('Which artists are performing?', 'Each event page names the performer and describes the music planned for that date.', 2),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  dining: {
    name: 'Dining Events',
    description: 'Prepaid themed dinners, supper clubs and set-menu evenings at The Anchor in Stanwell Moor, sold as individual tickets with clear menus and event details.',
    icon: 'BuildingStorefrontIcon',
    color: '#991B1B',
    sort_order: 9,
    is_active: true,
    default_start_time: null,
    default_end_time: null,
    default_duration_minutes: null,
    default_doors_time: null,
    default_last_entry_time: null,
    default_capacity: 40,
    default_price: 0,
    default_is_free: false,
    default_booking_mode: 'general',
    default_payment_mode: 'prepaid',
    default_performer_name: null,
    default_performer_type: null,
    short_description: 'Discover prepaid Dining Events at The Anchor in Stanwell Moor, including themed dinners, supper clubs and special set-menu evenings near Heathrow.',
    long_description: `Dining Events at The Anchor cover themed dinners, supper clubs and special set-menu evenings in Stanwell Moor. This category is for food-led occasions with a clear menu and individual prepaid tickets, rather than ordinary table reservations. Each event has its own theme, price and running time, allowing the food and format to match the occasion.

Tickets are sold per person and must be paid for in advance. Because menus and costs vary, the individual event page will always state the ticket price, what is included and the booking deadline. Tickets are non-refundable. Please read the menu before paying and tell us about dietary requirements through the booking process so the team can confirm what can be accommodated for that particular event.

The Anchor is close to Heathrow and Staines, with free on-site parking. Dining Events take place in the pub's warm dining setting and are designed to feel special without being formal. Depending on the event, guests may enjoy a fixed menu, a themed sequence of dishes or a social supper-club format. Seating details will be confirmed on the event page.

If you are looking for dining events near Heathrow, a supper club near Staines or a themed dinner in Stanwell Moor, these listings make the practical details easy to compare. Check the date, menu, arrival time, ticket price and age guidance before buying. The changing programme means the category can be used for seasonal menus, chef-led evenings and other one-off food experiences while keeping payment and booking rules consistent. Choose the event that appeals to you, buy an individual ticket and arrive ready to enjoy a carefully planned evening around the table.`,
    meta_title: 'Dining Events Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Book prepaid Dining Events at The Anchor, Stanwell Moor. Explore themed dinners, supper clubs and set-menu evenings near Heathrow and Staines.',
    highlights: ['Prepaid individual tickets', 'Themed dinners', 'Supper clubs', 'Special set menus', 'Free on-site parking'],
    keywords: ['dining events', 'themed dinner', 'supper club', 'set-menu evening', 'dining near Heathrow'],
    primary_keywords: ['dining events', 'themed dinner'],
    secondary_keywords: ['supper club', 'set-menu evening', 'special dining experience', 'prepaid dining tickets'],
    local_seo_keywords: ['dining events Stanwell Moor', 'dining near Heathrow', 'supper club near Staines', 'The Anchor dining events'],
    image_alt_text: 'Dining Events set-menu table at The Anchor pub in Stanwell Moor',
    cancellation_policy: NON_REFUNDABLE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('What is a Dining Event?', 'Dining Events are themed dinners, supper clubs or special set-menu evenings rather than standard table bookings.', 0),
      faq('How do I pay for a Dining Event?', 'Tickets are sold individually and must be paid for online in advance.', 1),
      faq('Are Dining Event tickets refundable?', 'No. Prepaid Dining Event tickets are non-refundable, so please check the date and menu before buying.', 2),
      faq('Can dietary requirements be accommodated?', 'Check the event menu and tell us before booking so the team can confirm what is possible for that date.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
  'music-bingo': {
    name: 'Music Bingo',
    description: 'Music Bingo at The Anchor in Stanwell Moor combines song clips with bingo-style play, communal seating and £5 cash payment on arrival.',
    icon: 'MusicalNoteIcon',
    color: '#3B82F6',
    sort_order: 10,
    is_active: true,
    default_start_time: '19:00',
    default_end_time: '22:30',
    default_duration_minutes: 210,
    default_doors_time: '18:30',
    default_last_entry_time: '19:15',
    default_capacity: 60,
    default_price: 5,
    default_is_free: false,
    default_booking_mode: 'communal',
    default_payment_mode: 'cash_only',
    default_performer_name: 'Nikki Manfadge',
    default_performer_type: 'Person',
    short_description: 'Play Music Bingo at The Anchor in Stanwell Moor from 7pm to 10.30pm. Entry is £5 cash on arrival and seating is communal.',
    long_description: `Music Bingo at The Anchor swaps called numbers for recognisable song clips, giving classic bingo a lively musical twist. Listen to each track, match it to the titles or artists on your card and mark the square as the rounds progress. You do not need expert music knowledge to join in, and the changing songs give groups plenty to discuss between clips.

The event runs from 7pm to 10.30pm. Entry is £5 per person and is paid in cash on arrival. Music Bingo uses communal seating, so book every person attending and we will arrange the shared room layout. Come with friends or book a smaller group; the format makes it easy to take part together while sharing the atmosphere with the rest of the room.

Rounds, themes and prizes can change from one date to the next. The individual event page will show any special theme or practical update. Bring cash for entry, arrive in time to collect your card and settle down before the first round, and keep your ears open for the tracks you need. There is no cancellation charge, but please cancel if you cannot attend so the space can be released.

The Anchor is in Stanwell Moor, close to Heathrow and Staines, with free parking on site. It is a convenient choice for anyone searching for Music Bingo near Heathrow, a music quiz-style event near Staines or a different pub night in the local area. Expect familiar songs, friendly competition and a straightforward game that rewards recognition, luck and a good memory for music.`,
    meta_title: 'Music Bingo Near Heathrow | The Anchor Stanwell Moor',
    meta_description: 'Play Music Bingo at The Anchor, Stanwell Moor, 7pm–10.30pm. £5 cash entry, communal seating and free parking near Heathrow and Staines.',
    highlights: ['7pm to 10.30pm', '£5 cash on arrival', 'Communal seating', 'Music-led bingo rounds', 'Free on-site parking'],
    keywords: ['music bingo', 'musical bingo', 'music game night', 'music bingo near Heathrow', 'music bingo near Staines'],
    primary_keywords: ['music bingo', 'musical bingo'],
    secondary_keywords: ['music game night', 'song bingo', 'pub music games', 'interactive music event'],
    local_seo_keywords: ['music bingo Stanwell Moor', 'music bingo near Heathrow', 'music bingo near Staines', 'The Anchor music bingo'],
    image_alt_text: 'Music Bingo cards and music-themed game at The Anchor pub in Stanwell Moor',
    cancellation_policy: NO_CHARGE_CANCELLATION,
    accessibility_notes: ACCESSIBILITY,
    faqs: [
      faq('What time is Music Bingo?', 'Music Bingo runs from 7pm to 10.30pm. Please arrive before the first round starts.', 0),
      faq('How much does Music Bingo cost?', 'Entry is £5 per person and must be paid in cash on arrival.', 1),
      faq('How does Music Bingo work?', 'Listen to song clips and mark the matching titles or artists on your bingo card.', 2),
      faq('How is seating arranged?', 'Music Bingo uses communal seating. Book every person attending so we can prepare enough places.', 3),
    ],
    default_promo_sms_enabled: true,
    default_bookings_enabled: true,
  },
}

const inactiveSlugs = [
  'world-cup-2026',
  'open-mic-night',
  'nikkis-games-night',
  'nikkis-karaoke-night',
]

const generatedImages: Record<string, string> = {
  'tasting-nights': 'public/event-categories/generated/tasting-nights.webp',
  celebrations: 'public/event-categories/generated/celebrations.webp',
  sport: 'public/event-categories/generated/live-sport.webp',
  parties: 'public/event-categories/generated/parties.webp',
  'live-music': 'public/event-categories/generated/live-music.webp',
  dining: 'public/event-categories/generated/dining-events.webp',
}

function validateTemplate(slug: string, update: CategoryUpdate) {
  const wordCount = String(update.long_description || '').trim().split(/\s+/).filter(Boolean).length
  const shortLength = String(update.short_description || '').length
  const metaTitleLength = String(update.meta_title || '').length
  const metaDescriptionLength = String(update.meta_description || '').length
  const faqs = Array.isArray(update.faqs) ? update.faqs : []

  const errors = [
    wordCount < 250 ? `long description has ${wordCount} words` : null,
    shortLength < 120 || shortLength > 150 ? `short description has ${shortLength} characters` : null,
    metaTitleLength === 0 || metaTitleLength > 60 ? `meta title has ${metaTitleLength} characters` : null,
    metaDescriptionLength === 0 || metaDescriptionLength > 155 ? `meta description has ${metaDescriptionLength} characters` : null,
    faqs.length < 3 ? `only ${faqs.length} FAQs` : null,
  ].filter(Boolean)

  if (errors.length) throw new Error(`${slug}: ${errors.join(', ')}`)
}

async function main() {
  const apply = process.argv.includes('--apply')
  Object.entries(activeTemplates).forEach(([slug, update]) => validateTemplate(slug, update))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase environment variables are missing')

  const supabase = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: categories, error: loadError } = await supabase
    .from('event_categories')
    .select('id, slug, name')

  if (loadError) throw loadError
  const bySlug = new Map((categories || []).map(category => [category.slug, category]))

  const expectedSlugs = [...Object.keys(activeTemplates), ...inactiveSlugs]
  const missing = expectedSlugs.filter(slug => !bySlug.has(slug))
  if (missing.length) throw new Error(`Missing event categories: ${missing.join(', ')}`)

  if (!apply) {
    process.stdout.write(`Validated ${Object.keys(activeTemplates).length} active templates and ${inactiveSlugs.length} inactive templates.\n`)
    process.stdout.write('Run again with --apply to update the live database.\n')
    return
  }

  const imageUrls = new Map<string, string>()
  for (const [slug, relativeFile] of Object.entries(generatedImages)) {
    const category = bySlug.get(slug)!
    const file = await readFile(path.resolve(relativeFile))
    const storagePath = `categories/${category.id}/hero/template-20260806-${path.basename(relativeFile)}`
    const { error: uploadError } = await supabase.storage
      .from('event-images')
      .upload(storagePath, file, { contentType: 'image/webp', upsert: true })
    if (uploadError) throw uploadError
    imageUrls.set(slug, supabase.storage.from('event-images').getPublicUrl(storagePath).data.publicUrl)
  }

  for (const [slug, update] of Object.entries(activeTemplates)) {
    const imageUrl = imageUrls.get(slug)
    const payload: CategoryUpdate = imageUrl
      ? { ...update, default_image_url: imageUrl, poster_image_url: imageUrl, thumbnail_image_url: imageUrl }
      : update
    const { error } = await supabase.from('event_categories').update(payload).eq('slug', slug)
    if (error) throw new Error(`${slug}: ${error.message}`)
  }

  const { error: inactiveError } = await supabase
    .from('event_categories')
    .update({ is_active: false })
    .in('slug', inactiveSlugs)
  if (inactiveError) throw inactiveError

  process.stdout.write(`Updated ${Object.keys(activeTemplates).length} active templates.\n`)
  process.stdout.write(`Deactivated ${inactiveSlugs.length} unused templates.\n`)
  process.stdout.write(`Uploaded ${imageUrls.size} generated images.\n`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
