'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIConfig } from '@/lib/openai/config'

type EventSeoContentInput = {
  eventId?: string | null
  name: string
  date?: string | null
  time?: string | null
  categoryName?: string | null
  capacity?: number | null
  brief?: string | null
  performerName?: string | null
  performerType?: string | null
  price?: number | null
  isFree?: boolean
  bookingUrl?: string | null
  existingShortDescription?: string | null
  existingLongDescription?: string | null
  existingMetaTitle?: string | null
  existingMetaDescription?: string | null
  existingHighlights?: string[]
  existingKeywords?: string[]
}

type EventSeoContentResult = {
  success: true
  data: {
    metaTitle: string | null
    metaDescription: string | null
    shortDescription: string | null
    longDescription: string | null
    highlights: string[]
    keywords: string[]
    slug: string | null
  }
} | {
  success: false
  error: string
}

type EventPromotionContentResult = {
  success: true
  data: {
    facebook: {
      name: string
      storyParagraphs: string[]
      bulletPoints: string[]
      cta: string
      plainText: string
    }
    googleBusinessProfile: {
      title: string
      description: string
    }
  }
} | {
  success: false
  error: string
}

function buildEventSummary(input: EventSeoContentInput): string {
  const payload = {
    name: input.name,
    date: input.date || null,
    start_time: input.time || null,
    category: input.categoryName || null,
    capacity: input.capacity ?? null,
    pricing: input.isFree ? 'Free' : (typeof input.price === 'number' ? `£${input.price.toFixed(2)}` : null),
    performer_name: input.performerName || null,
    performer_type: input.performerType || null,
    booking_url: input.bookingUrl || null,
    brief: input.brief || null,
    existing_short_description: input.existingShortDescription || null,
    existing_long_description: input.existingLongDescription || null,
    existing_meta_title: input.existingMetaTitle || null,
    existing_meta_description: input.existingMetaDescription || null,
    existing_highlights: input.existingHighlights && input.existingHighlights.length > 0 ? input.existingHighlights : [],
    existing_keywords: input.existingKeywords && input.existingKeywords.length > 0 ? input.existingKeywords : []
  }
  return JSON.stringify(payload, null, 2)
}

export async function generateEventSeoContent(input: EventSeoContentInput): Promise<EventSeoContentResult> {
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    return { success: false, error: 'You do not have permission to generate content.' }
  }

  const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()

  if (!apiKey) {
    return { success: false, error: 'OpenAI is not configured. Add an API key in Settings.' }
  }

  const supabase = await createClient()

  let dbEvent: Partial<EventSeoContentInput> = {}
  if (input.eventId) {
    const { data } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        category:category_id,
        category_details:event_categories(name),
        performer_name,
        performer_type,
        price,
        is_free,
        booking_url,
        brief
      `)
      .eq('id', input.eventId)
      .maybeSingle()

    if (data) {
      dbEvent = {
        name: data.name,
        date: data.date,
        time: data.time,
        capacity: data.capacity,
        categoryName: Array.isArray((data as any).category_details)
          ? (data as any).category_details[0]?.name
          : (data as any).category_details?.name,
        performerName: data.performer_name || undefined,
        performerType: data.performer_type || undefined,
        price: data.price ?? undefined,
        isFree: data.is_free ?? undefined,
        bookingUrl: data.booking_url ?? undefined,
        brief: data.brief ?? undefined,
      }
    }
  }

  const mergedInput: EventSeoContentInput = {
    ...input,
    ...dbEvent,
    name: dbEvent.name ?? input.name,
    date: dbEvent.date ?? input.date,
    time: dbEvent.time ?? input.time,
    capacity: dbEvent.capacity ?? input.capacity,
    categoryName: dbEvent.categoryName ?? input.categoryName,
    performerName: dbEvent.performerName ?? input.performerName,
    performerType: dbEvent.performerType ?? input.performerType,
    price: dbEvent.price ?? input.price,
    isFree: dbEvent.isFree ?? input.isFree,
    bookingUrl: dbEvent.bookingUrl ?? input.bookingUrl,
    brief: dbEvent.brief ?? input.brief,
  }

  const summary = buildEventSummary(mergedInput)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: eventsModel,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert hospitality marketer for "The Anchor", a popular pub and venue. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Keep outputs concise, engaging, and aligned with UK English. Use only the supplied event fields and never invent venue, price, capacity, time, performer, or category details. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
        },
        {
          role: 'user',
          content: [
            'Create fresh, optimised SEO copy for this event based on the details JSON below.',
            'Priorities:',
            '- Position the experience vividly for a great night out at The Anchor.',
            '- Highlight unique selling points and benefits (e.g., atmosphere, exclusive drinks, entertainment value).',
            '- Build urgency to secure tickets or book a table immediately.',
            '- Use persuasive language that drives conversion.',
            '- If booking_url is provided, reference booking explicitly but do not include raw URLs.',
            '- **Long Description SEO**: Generate a comprehensive description (300+ words) formatted in plain text (no markdown) but structured logically with paragraphs. Focus on ranking for relevant keywords by covering the atmosphere, what to expect, and why it is a must-attend.',
            '- Do NOT use Markdown formatting (no bold **, italics _, or links []()). Return clean plain text.',
            '- Do NOT invent missing details; if absent, leave that field blank.',
            '- Keep the meta description under 155 characters, focusing on the hook and call to action.',
            '- Provide 3-5 punchy highlights and 6-10 targeted keyword phrases.',
            '- **Slug**: Generate a URL-friendly slug (lowercase, alphanumeric, hyphens only, no spaces or special chars) based on the event name and date. Example: "six-nations-2026-england-vs-wales".',
            '',
            summary,
            '',
            'Return JSON with keys metaTitle, metaDescription, shortDescription, longDescription, highlights (string array), keywords (string array), slug (string). All fields must be strings (or arrays of strings); use "" for missing values.',
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'event_seo_content',
          schema: {
            type: 'object',
            properties: {
              metaTitle: { type: ['string', 'null'] },
              metaDescription: { type: ['string', 'null'] },
              shortDescription: { type: ['string', 'null'] },
              longDescription: { type: ['string', 'null'] },
              highlights: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 6,
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                minItems: 6,
                maxItems: 12,
              },
              slug: { type: ['string', 'null'] },
            },
            required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug'],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 900,
    }),
  })

  if (!response.ok) {
    console.error('OpenAI SEO generation failed', await response.text())
    return { success: false, error: 'OpenAI request failed.' }
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) {
    return { success: false, error: 'OpenAI returned no content.' }
  }

  let parsed: {
    metaTitle: string | null
    metaDescription: string | null
    shortDescription: string | null
    longDescription: string | null
    highlights: string[]
    keywords: string[]
    slug: string | null
  }
  try {
    parsed = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    console.error('Failed to parse SEO content response', error)
    return { success: false, error: 'Unable to parse AI response.' }
  }

  return {
    success: true,
    data: {
      metaTitle: parsed.metaTitle ?? null,
      metaDescription: parsed.metaDescription ?? null,
      shortDescription: parsed.shortDescription ?? null,
      longDescription: parsed.longDescription ?? null,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter(Boolean) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [],
      slug: parsed.slug ?? null,
    },
  }
}

type EventPromotionInput = {
  eventId: string
  ticketUrl?: string | null
}

export async function generateEventPromotionContent({ eventId, ticketUrl }: EventPromotionInput): Promise<EventPromotionContentResult> {
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    return { success: false, error: 'You do not have permission to generate content.' }
  }

  const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()

  if (!apiKey) {
    return { success: false, error: 'OpenAI is not configured. Add an API key in Settings.' }
  }

  const supabase = await createClient()
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id,
      name,
      date,
      time,
      brief,
      short_description,
      long_description,
      booking_url,
      performer_name,
      performer_type,
      facebook_event_name,
      facebook_event_description,
      gbp_event_title,
      gbp_event_description,
      category:event_categories(name)
    `)
    .eq('id', eventId)
    .single()

  if (error || !event) {
    console.error('Failed to load event for promotion copy', error)
    return { success: false, error: 'Event not found.' }
  }

  const callToActionLink = ticketUrl?.trim() || event.booking_url || null
  const categoryRecord =
    !event.category || Array.isArray(event.category)
      ? null
      : (event.category as { name?: string | null })

  const categoryName = categoryRecord?.name ?? null
  const detailLines = [
    `Event name: ${event.name}`,
    event.date ? `Event date: ${event.date}` : null,
    event.time ? `Event time: ${event.time}` : null,
    categoryName ? `Category: ${categoryName}` : null,
    event.performer_name ? `Performer: ${event.performer_name}` : null,
    event.performer_type ? `Performer type: ${event.performer_type}` : null,
    event.short_description ? `Short description: ${event.short_description}` : null,
    event.long_description ? `Long description: ${event.long_description}` : null,
    event.brief ? `Brief details:\n${event.brief}` : null,
    callToActionLink ? `Ticket link: ${callToActionLink}` : 'Ticket link: [Ticket link will be provided separately]',
  ].filter(Boolean)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: eventsModel,
      temperature: 0.75,
      messages: [
        {
          role: 'system',
          content:
            'You are a hospitality marketing expert who writes compelling promotional copy for social and local listings. Use UK English.',
        },
        {
          role: 'user',
          content: [
            'Create two promotional assets for the event below:',
            '1. Facebook Event name and description that follow best-performing patterns.',
            '2. Google Business Profile event title and description optimised for conversions.',
            '',
            'Essential requirements:',
            '- Make the Facebook description punchy, sensory, and tailored to a fun night out in UK English.',
            '- For Facebook, return JSON with fields name, story_paragraphs (array, 2-3 items), bullet_points (array, 3-5 items for a "Need to Know" list), and cta (single sentence).',
            '- Story paragraphs should feel emotional and immersive; bullet points must cover key logistics; CTA must quote the ticket link verbatim if available.',
            '- Build urgency to secure tickets immediately.',
            '- Keep the Google Business Profile description within 750 characters.',
            '',
            detailLines.join('\n'),
            '',
            'Return JSON with keys facebook { name, story_paragraphs, bullet_points, cta } and googleBusinessProfile { title, description }.',
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'event_promotion_content',
          schema: {
            type: 'object',
            properties: {
              facebook: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  story_paragraphs: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 3,
                  },
                  bullet_points: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 3,
                    maxItems: 6,
                  },
                  cta: { type: 'string' },
                },
                required: ['name', 'story_paragraphs', 'bullet_points', 'cta'],
              },
              googleBusinessProfile: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['title', 'description'],
              },
            },
            required: ['facebook', 'googleBusinessProfile'],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 800,
    }),
  })

  if (!response.ok) {
    console.error('OpenAI promotion generation failed', await response.text())
    return { success: false, error: 'OpenAI request failed.' }
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) {
    return { success: false, error: 'OpenAI returned no content.' }
  }

  let parsed: {
    facebook: {
      name: string
      story_paragraphs?: unknown
      bullet_points?: unknown
      cta?: unknown
    }
    googleBusinessProfile: { title: string; description: string }
  }
  try {
    parsed = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    console.error('Failed to parse promotion content response', error)
    return { success: false, error: 'Unable to parse AI response.' }
  }

  const facebookStoryParagraphs = Array.isArray(parsed.facebook?.story_paragraphs)
    ? (parsed.facebook.story_paragraphs as unknown[])
      .map((paragraph) => (typeof paragraph === 'string' ? paragraph.trim() : ''))
      .filter(Boolean)
    : []

  const facebookBulletPoints = Array.isArray(parsed.facebook?.bullet_points)
    ? (parsed.facebook.bullet_points as unknown[])
      .map((bullet) => (typeof bullet === 'string' ? bullet.trim() : ''))
      .filter(Boolean)
    : []

  const facebookCta = typeof parsed.facebook?.cta === 'string' ? parsed.facebook.cta.trim() : ''

  const plainSections: string[] = []
  if (facebookStoryParagraphs.length) {
    plainSections.push(facebookStoryParagraphs.join('\n\n'))
  }
  if (facebookBulletPoints.length) {
    plainSections.push(['Need to Know:', ...facebookBulletPoints.map((point) => `- ${point}`)].join('\n'))
  }
  if (facebookCta) {
    plainSections.push(facebookCta)
  }

  const facebookPlainText = plainSections.join('\n\n').trim()

  const { error: updateError } = await supabase
    .from('events')
    .update({
      facebook_event_name: parsed.facebook?.name ?? null,
      facebook_event_description: facebookPlainText || null,
      gbp_event_title: parsed.googleBusinessProfile?.title ?? null,
      gbp_event_description: parsed.googleBusinessProfile?.description ?? null,
    })
    .eq('id', eventId)

  if (updateError) {
    console.error('Failed to save promotional content to event', updateError)
    return { success: false, error: 'Failed to save promotional content.' }
  }

  return {
    success: true,
    data: {
      facebook: {
        name: parsed.facebook?.name ?? '',
        storyParagraphs: facebookStoryParagraphs,
        bulletPoints: facebookBulletPoints,
        cta: facebookCta,
        plainText: facebookPlainText,
      },
      googleBusinessProfile: {
        title: parsed.googleBusinessProfile?.title ?? '',
        description: parsed.googleBusinessProfile?.description ?? '',
      },
    },
  }
}
