'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIConfig } from '@/lib/openai/config'

type EventSeoContentInput = {
  name: string
  date?: string | null
  time?: string | null
  categoryName?: string | null
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
  const lines: string[] = []
  lines.push(`Event name: ${input.name}`)
  if (input.date) lines.push(`Event date: ${input.date}`)
  if (input.time) lines.push(`Event time: ${input.time}`)
  if (input.categoryName) lines.push(`Category: ${input.categoryName}`)
  if (input.performerName) lines.push(`Performer: ${input.performerName}`)
  if (input.performerType) lines.push(`Performer type: ${input.performerType}`)
  if (input.isFree !== undefined) {
    if (input.isFree) {
      lines.push('Pricing: Free entry (tickets still required)')
    } else if (typeof input.price === 'number') {
      lines.push(`Pricing: £${input.price.toFixed(2)} per ticket`)
    }
  }
  if (input.bookingUrl) lines.push(`Ticket URL: ${input.bookingUrl}`)
  if (input.existingShortDescription) lines.push(`Existing short description: ${input.existingShortDescription}`)
  if (input.existingLongDescription) lines.push(`Existing long description: ${input.existingLongDescription}`)
  if (input.existingHighlights && input.existingHighlights.length > 0) {
    lines.push(`Existing highlights: ${input.existingHighlights.join('; ')}`)
  }
  if (input.existingKeywords && input.existingKeywords.length > 0) {
    lines.push(`Existing keywords: ${input.existingKeywords.join(', ')}`)
  }
  if (input.brief) {
    lines.push('Campaign brief:')
    lines.push(input.brief)
  }
  return lines.join('\n')
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

  const summary = buildEventSummary(input)

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
            'You are an expert hospitality marketer crafting SEO-friendly website content for events. Keep outputs concise, engaging, and aligned with UK English.',
        },
        {
          role: 'user',
          content: [
            'Create fresh SEO copy for this event based on the details below.',
            'Priorities:',
            '- Position the experience vividly for a night out.',
            '- Highlight any unique draws from the brief.',
            '- Build urgency to secure tickets immediately.',
            '- If a ticket link is provided, reference it explicitly once in the short and long descriptions (e.g. "Grab tickets at https://...").',
            '- Keep the meta description under 155 characters and focus on urgency (no raw URLs there).',
            '- Provide 3-5 highlights and 6-10 keyword phrases.',
            '',
            summary,
            '',
            'Return JSON with keys metaTitle, metaDescription, shortDescription, longDescription, highlights (string array), keywords (string array).',
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
            },
            required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords'],
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
