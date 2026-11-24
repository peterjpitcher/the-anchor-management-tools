// A draft that meets every rule in section 5 of
// tasks/spec-2026-11-24-event-seo-generation.md, for Sleigh My Name (Friday
// 11 December 2026, 7pm, £5). Tests copy it and break one thing at a time.

export const SLEIGH_FACTS = {
  name: 'Sleigh My Name: Festive Music Bingo',
  date: '2026-12-11',
  primaryKeywords: ['christmas music bingo'],
  secondaryKeywords: ['music bingo', 'drag bingo', 'musical bingo', 'music bingo night'],
  localSeoKeywords: ['Stanwell Moor', 'Staines', 'Heathrow', 'Feltham'],
}

const LONG_DESCRIPTION = [
  'Sleigh My Name: Festive Music Bingo is a night of Christmas music bingo at The Anchor, Stanwell Moor, on Friday 11 December 2026. It starts at 7pm and finishes at 10pm. Entry is £5 a person, paid in cash on arrival.',
  'There are two rounds of music bingo, both built around Christmas. You hear a clip, find the title or the artist on your card and mark it off. Expect Christmas number ones, cheesy singalongs and the party songs that only come out in December. You do not need to know every track: recognising a few is plenty, and the room usually helps.',
  'Nikki hosts, as she does at all of our music bingo nights. She keeps the games quick, the chat cheeky and the room singing. Teams earn extra points for dressing up, and a Christmas jumper counts. It is the most festive of the drag bingo nights we run, and the musical bingo rounds are written for a big crowd.',
  'Booking is through the form on this page, or by phone on 01753 682707. Seating is communal, so book a place for everyone in your group and we will keep you together where we can. The full dinner menu is served from 4pm until 9pm, so there is time to eat before the first round.',
  'The Anchor is on Horton Road in Stanwell Moor, a few minutes from Staines and Heathrow. There are 20 free parking spaces, and the pub is a short taxi ride from Feltham and Ashford.',
].join('\n\n')

export function validDraft(): Record<string, unknown> {
  return {
    metaTitle: 'Christmas Music Bingo',
    metaDescription:
      'Christmas music bingo with Nikki on Friday 11 December 2026 at 7pm, at The Anchor, Stanwell Moor. Entry is £5 cash. Book on this page.',
    shortDescription:
      'Two rounds of Christmas music bingo with Nikki at The Anchor, Stanwell Moor, on Friday 11 December 2026, with festive number ones.',
    longDescription: LONG_DESCRIPTION,
    highlights: [
      'Two rounds of festive music bingo',
      'Hosted by Nikki with points for costumes',
      'Dinner served from 4pm to 9pm',
      'Entry £5, cash on arrival',
    ],
    slug: 'christmas-sleigh-my-name-festive-music-bingo-2026-12-11',
    imageAltText: 'Nikki holding a microphone in front of a room of music bingo players wearing Christmas jumpers',
    faqs: [
      {
        question: 'Is there christmas music bingo near Staines in December?',
        answer:
          'Yes. Sleigh My Name is our Christmas music bingo night on Friday 11 December 2026 at The Anchor in Stanwell Moor, about ten minutes from Staines. It runs from 7pm to 10pm.',
      },
      {
        question: 'Do I need to know a lot of music?',
        answer:
          'No. Each clip is short and the songs are the Christmas ones most people know. Recognising a few is enough to mark your card, and plenty of teams win on singing along rather than knowing every artist.',
      },
      {
        question: 'Can children come?',
        answer:
          'Yes, children are welcome with a supervising adult. After 9pm, under-18s can stay as long as their parents are with them. Anyone can play, and a family team often does well on the newer songs.',
      },
      {
        question: 'How do I get to The Anchor?',
        answer:
          'The Anchor is on Horton Road in Stanwell Moor, TW19 6AQ. There are 20 free parking spaces on site, and it is a short taxi ride from Staines, Feltham, Ashford and Heathrow Terminal 5.',
      },
    ],
    cancellationPolicy: 'Contact The Anchor on 01753 682707 for cancellation and refund queries.',
    accessibilityNotes: 'Step free from the car park.',
  }
}
