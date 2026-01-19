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
    type: EventPromotionContentType
    content:
      | {
        name: string
        description: string
      }
      | {
        title: string
        description: string
      }
  }
} | {
  success: false
  error: string
}

export type EventPromotionContentType =
  | 'facebook_event'
  | 'google_business_profile_event'
  | 'opentable_experience'

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

export type EventPromotionInput = {
  eventId: string
  contentType: EventPromotionContentType
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function generateEventPromotionContent({
  eventId,
  contentType,
}: EventPromotionInput): Promise<EventPromotionContentResult> {
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
      end_time,
      doors_time,
      last_entry_time,
      duration_minutes,
      capacity,
      price,
      is_free,
      brief,
      short_description,
      long_description,
      booking_url,
      performer_name,
      performer_type,
      category:event_categories(name)
    `)
    .eq('id', eventId)
    .single()

  if (error || !event) {
    console.error('Failed to load event for promotion copy', error)
    return { success: false, error: 'Event not found.' }
  }

  const categoryRecord =
    !event.category || Array.isArray(event.category)
      ? null
      : (event.category as { name?: string | null })

  const categoryName = categoryRecord?.name ?? null

  const hasBookingUrl = Boolean(event.booking_url && String(event.booking_url).trim().length > 0)
  const priceLabel =
    event.is_free ? 'Free' : typeof event.price === 'number' ? `£${event.price.toFixed(2)}` : null

  const detailLines = [
    'Venue: The Anchor',
    `Event name: ${event.name}`,
    event.date ? `Event date: ${event.date}` : null,
    event.time ? `Event start time: ${event.time}` : null,
    event.end_time ? `Event end time: ${event.end_time}` : null,
    event.doors_time ? `Doors time: ${event.doors_time}` : null,
    event.last_entry_time ? `Last entry time: ${event.last_entry_time}` : null,
    typeof event.duration_minutes === 'number' ? `Duration (minutes): ${event.duration_minutes}` : null,
    categoryName ? `Category: ${categoryName}` : null,
    event.performer_name ? `Performer: ${event.performer_name}` : null,
    event.performer_type ? `Performer type: ${event.performer_type}` : null,
    typeof event.capacity === 'number' ? `Capacity: ${event.capacity}` : null,
    priceLabel ? `Price: ${priceLabel}` : null,
    event.short_description ? `Short description: ${event.short_description}` : null,
    event.long_description ? `Long description: ${event.long_description}` : null,
    event.brief ? `Brief details:\n${event.brief}` : null,
    hasBookingUrl ? 'Booking link available: yes (do not include any URL)' : 'Booking link available: no',
  ].filter(Boolean)

  const { messages, schemaName, schema, maxTokens, temperature } = (() => {
    switch (contentType) {
      case 'facebook_event':
        return {
          schemaName: 'facebook_event_copy',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['name', 'description'],
            additionalProperties: false,
          },
          temperature: 0.8,
          maxTokens: 700,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert hospitality marketer. Write high-performing Facebook Event copy in UK English that is vivid, clear, and conversion-focused.',
            },
            {
              role: 'user',
              content: [
                'Write ONE Facebook Event name and ONE Facebook Event description for the event details below.',
                '',
                'Best practices to follow:',
                '- Hook quickly in the first 1-2 lines (mobile-first).',
                '- Use short paragraphs and line breaks for readability.',
                '- Include a short "Need to know" section with only facts provided (no guessing).',
                '- End with a clear call to action (but do NOT include any URL).',
                '',
                'Hard constraints:',
                '- Output must be plain text (no markdown).',
                '- Do not include raw URLs anywhere.',
                '- Do not invent missing details (no ages, dress codes, set times, pricing, inclusions unless provided).',
                '- Keep the event name concise (aim < 70 characters).',
                '',
                'Event details:',
                detailLines.join('\n'),
                '',
                'Return JSON with keys { name, description }.',
              ].join('\n'),
            },
          ],
        }
      case 'google_business_profile_event':
        return {
          schemaName: 'gbp_event_copy',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['title', 'description'],
            additionalProperties: false,
          },
          temperature: 0.7,
          maxTokens: 600,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert hospitality marketer. Write conversion-focused Google Business Profile Event copy in UK English.',
            },
            {
              role: 'user',
              content: [
                'Write ONE Google Business Profile (GBP) Event title and ONE GBP Event description for the event details below.',
                '',
                'Best practices to follow:',
                '- Make the first 120 characters compelling (it often appears as the preview).',
                '- Be scannable: 1-2 short paragraphs, then a compact details block if useful.',
                '- Include "The Anchor" naturally (already provided in details).',
                '- End with a clear call to action (but do NOT include any URL).',
                '',
                'Hard constraints:',
                '- Output must be plain text (no markdown).',
                '- Do not include raw URLs anywhere.',
                '- Do not invent missing details.',
                '- Keep the description under 1500 characters.',
                '- Keep the title concise (aim < 80 characters).',
                '',
                'Event details:',
                detailLines.join('\n'),
                '',
                'Return JSON with keys { title, description }.',
              ].join('\n'),
            },
          ],
        }
      case 'opentable_experience':
        return {
          schemaName: 'opentable_experience_copy',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['title', 'description'],
            additionalProperties: false,
          },
          temperature: 0.7,
          maxTokens: 900,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert hospitality marketer. Write an OpenTable Experience title and description in UK English that sells the experience clearly and elegantly.',
            },
            {
              role: 'user',
              content: [
                'Write ONE OpenTable Experience title and ONE OpenTable Experience description for the event details below.',
                '',
                'Best practices to follow:',
                '- Keep the title simple and clear (no hype, no ALL CAPS).',
                '- The description should read like premium hospitality copy: sensory, specific, and benefit-led.',
                '- Use paragraph format only (no bullet points, no headings).',
                '- Build a natural arc: hook → what to expect → key practical info → call to action.',
                '',
                'Hard constraints:',
                '- Output must be plain text (no markdown).',
                '- Do not include raw URLs anywhere.',
                '- Do not invent missing details.',
                '- Title: aim 3–7 words and < 60 characters.',
                '- Description: paragraph format, around 1500 characters (target 1400–1600).',
                '',
                'Event details:',
                detailLines.join('\n'),
                '',
                'Return JSON with keys { title, description }.',
              ].join('\n'),
            },
          ],
        }
    }
  })()

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: eventsModel,
      temperature,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          schema,
        },
      },
      max_tokens: maxTokens,
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

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    console.error('Failed to parse promotion content response', error)
    return { success: false, error: 'Unable to parse AI response.' }
  }

  const contentResult = (() => {
    switch (contentType) {
      case 'facebook_event':
        return {
          name: normalizeString(parsed.name),
          description: normalizeString(parsed.description),
        }
      case 'google_business_profile_event':
      case 'opentable_experience':
        return {
          title: normalizeString(parsed.title),
          description: normalizeString(parsed.description),
        }
    }
  })()

  return {
    success: true,
    data: {
      type: contentType,
      content: contentResult,
    },
  }
}
