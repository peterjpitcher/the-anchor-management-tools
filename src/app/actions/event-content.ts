'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'
import { validateGeneratedContent } from '@/lib/seo-validation'

const OPENAI_TIMEOUT_MS = 60_000

function openAIErrorMessage(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.error?.message ?? ''
  } catch { /* ignore parse failure */ }

  switch (true) {
    case status === 401:
      return 'OpenAI API key is invalid or expired. Check the API key in Settings.'
    case status === 403:
      return 'OpenAI access denied. The API key may not have permission for this model.'
    case status === 404:
      return `The configured AI model was not found. ${detail || 'Check model settings.'}`
    case status === 429:
      return 'AI rate limit reached. Please wait a moment and try again.'
    case status >= 500:
      return 'The AI service is temporarily unavailable. Please try again shortly.'
    default:
      return `AI request failed (${status}). ${detail || 'Please try again.'}`
  }
}

async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  return retry(
    async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (response.status >= 500) {
          const text = await response.text()
          const err = new Error(`OpenAI ${response.status}: ${text}`)
          ;(err as any).status = response.status
          ;(err as any).responseBody = text
          throw err
        }

        return response
      } finally {
        clearTimeout(timeoutId)
      }
    },
    RetryConfigs.api
  )
}

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
  primaryKeywords?: string[]
  secondaryKeywords?: string[]
  localSeoKeywords?: string[]
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
    imageAltText: string | null
    faqs: { question: string; answer: string }[]
    cancellationPolicy: string | null
    accessibilityNotes: string | null
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

  const keywordContext = [
    mergedInput.primaryKeywords?.length ? `PRIMARY KEYWORDS (MUST appear in: title, meta description, slug, first paragraph of long description, image alt text): ${mergedInput.primaryKeywords.join(', ')}` : '',
    mergedInput.secondaryKeywords?.length ? `SECONDARY KEYWORDS (MUST appear in: long description body, at least 2 highlights, at least 2 FAQ questions): ${mergedInput.secondaryKeywords.join(', ')}` : '',
    mergedInput.localSeoKeywords?.length ? `LOCAL SEO KEYWORDS (MUST appear in: long description venue paragraph, at least 1 FAQ answer): ${mergedInput.localSeoKeywords.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  let response: Response
  try {
    response = await callOpenAI(baseUrl, apiKey, {
      model: eventsModel,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert hospitality marketer for "The Anchor", a popular pub and venue near Heathrow in Stanwell Moor, Surrey. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Write detailed, engaging content aligned with UK English. Longer descriptions rank better and help customers decide — never sacrifice depth for brevity. Use only the supplied event fields and the VENUE CONTEXT block for facts. Never invent venue, price, capacity, time, performer, or category details beyond what is provided. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
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
            '- Keep the meta title UNDER 40 characters. The website appends "| The Anchor Stanwell Moor" automatically. Front-load the primary keyword. Example: "Live Music — Jessica Lovelock" (32 chars).',
            '- **Short Description**: Write a compelling 120-300 character summary used as the OG description and event card text. Must be at least 120 characters.',
            '- Keep the meta description under 155 characters, focusing on the hook and call to action.',
            '- **Long Description SEO**: Generate a rich, informative description of MINIMUM 450 words (aim for 500) formatted in plain text (no markdown). Structure as 5-6 distinct paragraphs separated by double newlines (\\n\\n):',
            '  1. Opening hook with event name, date, and primary keywords (70-80 words)',
            '  2. What to expect — the experience, sounds, energy, and vibe (80-90 words)',
            '  3. Performer or entertainment details — who they are, their style, why they are worth seeing (80-90 words)',
            '  4. Food, drink, and venue atmosphere — use the VENUE CONTEXT facts below (70-80 words)',
            '  5. Practical info and booking — why to reserve, capacity hints, pricing context (70-80 words)',
            '  6. Local context — use VENUE CONTEXT location facts, transport links, nearby areas (70-80 words)',
            '  Each paragraph must be a complete thought. Do NOT write one long wall of text. No single paragraph over 120 words.',
            '- Do NOT use Markdown formatting (no bold **, italics _, or links []()). Return clean plain text.',
            '- Do NOT invent missing details; if absent, leave that field blank.',
            '- Provide 3-5 punchy highlights and 6-10 targeted keyword phrases.',
            '- **Slug**: Generate a URL-friendly slug (lowercase, alphanumeric, hyphens only, no spaces or special chars). The slug MUST incorporate the primary keyword and the date. Example: if primary keyword is "live music" and event is on 2026-05-23, slug could be "live-music-jessica-lovelock-2026-05-23". Do NOT just use the event name if it lacks the primary keyword.',
            '',
            'VENUE CONTEXT (use these verified facts only — do not invent others):',
            '- Venue name: The Anchor',
            '- Address: Horton Road, Stanwell Moor, Surrey, TW19 6AQ',
            '- Phone: 01753 682707',
            '- Area: near Heathrow Airport, bordering West Drayton and Staines-upon-Thames',
            '- Transport: 7 minutes from Heathrow Terminal 5, free parking (20 spaces)',
            '- Ground-floor venue with step-free access from car park',
            '- Dog and family friendly',
            '- Kitchen serves pizza on event nights',
            '',
            ...(keywordContext ? [
              'KEYWORD PLACEMENT RULES:',
              '- Primary keywords: front-load in meta title, use in first clause of meta description, include in slug, place in first paragraph of long description, include in image alt text',
              '- Secondary keywords: weave into long description body paragraphs, include in at least 2 highlights, use in at least 2 FAQ questions',
              '- Local SEO keywords: use in venue/directions paragraph of long description, include in at least 1 FAQ answer',
              '- No keyword stuffing — each keyword used 1-2 times maximum per field',
              '- Natural language only — skip a keyword rather than force it',
              '',
              keywordContext,
              '',
            ] : []),
            'IMAGE ALT TEXT: Write a descriptive alt text for the event\'s hero image (~125 characters). The alt text MUST start with or contain the first primary keyword phrase. Example: if primary keyword is "live music", write "Live music performance by Jessica Lovelock at The Anchor pub near Heathrow"',
            '',
            'FAQS: Generate 3-5 frequently asked questions and answers about this event:',
            '- Event logistics (time, booking, parking): use local SEO keywords in answers',
            '- Event experience (what to expect, who it\'s for): use secondary keywords in questions',
            '- Pricing/value (cost, what\'s included): use primary keywords naturally',
            '- Questions should be 10-15 words, answers 30-60 words',
            '',
            'CANCELLATION POLICY: Based on the event type:',
            '- If free entry: "Free entry — no booking or registration required."',
            '- If paid/ticketed: "Tickets are non-refundable but may be transferred to another person. Please contact us at least 24 hours before the event for any changes."',
            '- Return null if unsure.',
            '',
            'ACCESSIBILITY NOTES: Using ONLY the venue facts from VENUE CONTEXT above, write 1-2 sentences about accessibility. Mention step-free access and the phone number for specific requirements. Do NOT claim features not listed in VENUE CONTEXT. Example: "The Anchor is a ground-floor venue with step-free access from the car park. Please call 01753 682707 to discuss any specific accessibility requirements."',
            '',
            summary,
            '',
            'Return JSON with keys metaTitle, metaDescription, shortDescription, longDescription, highlights (string array), keywords (string array), slug (string), imageAltText (string), faqs (array of {question, answer}), cancellationPolicy (string or null), accessibilityNotes (string or null). All fields must be strings (or arrays); use "" for missing values.',
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'event_seo_content',
          strict: true,
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
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
              },
              slug: { type: ['string', 'null'] },
              imageAltText: { type: ['string', 'null'] },
              faqs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    question: { type: 'string' },
                    answer: { type: 'string' },
                  },
                  required: ['question', 'answer'],
                  additionalProperties: false,
                },
              },
              cancellationPolicy: { type: ['string', 'null'] },
              accessibilityNotes: { type: ['string', 'null'] },
            },
            required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug', 'imageAltText', 'faqs', 'cancellationPolicy', 'accessibilityNotes'],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 4500,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error('OpenAI SEO generation timed out')
      return { success: false, error: 'AI request timed out. Please try again.' }
    }
    const status = (err as any)?.status
    const body = (err as any)?.responseBody ?? ''
    if (typeof status === 'number') {
      console.error(`OpenAI SEO generation failed (${status})`, body)
      return { success: false, error: openAIErrorMessage(status, body) }
    }
    console.error('OpenAI SEO generation network error', err)
    return { success: false, error: 'Unable to reach the AI service. Check your network connection and try again.' }
  }

  if (!response.ok) {
    const body = await response.text()
    console.error('OpenAI SEO generation failed', body)
    return { success: false, error: openAIErrorMessage(response.status, body) }
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
    imageAltText: string | null
    faqs: { question: string; answer: string }[]
    cancellationPolicy: string | null
    accessibilityNotes: string | null
  }
  try {
    parsed = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (error) {
    console.error('Failed to parse SEO content response', error)
    return { success: false, error: 'Unable to parse AI response.' }
  }

  // --- Post-generation validation with single retry ---
  const validation = validateGeneratedContent(parsed)

  if (!validation.passed) {
    console.warn('SEO content validation failed, retrying:', validation.issues)

    try {
      const retryResponse = await callOpenAI(baseUrl, apiKey, {
        model: eventsModel,
        temperature: 0.5, // lower temperature for corrective retry
        messages: [
          {
            role: 'system',
            content:
              'You are an expert hospitality marketer for "The Anchor", a popular pub and venue near Heathrow in Stanwell Moor, Surrey. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Write detailed, engaging content aligned with UK English. Longer descriptions rank better and help customers decide — never sacrifice depth for brevity. Use only the supplied event fields and the VENUE CONTEXT block for facts. Never invent venue, price, capacity, time, performer, or category details beyond what is provided. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
          },
          {
            role: 'user',
            content: summary,
          },
          {
            role: 'assistant',
            content: JSON.stringify(parsed),
          },
          {
            role: 'user',
            content: `The response has these issues — fix them and return the complete JSON again:\n${validation.issues.map(i => `- ${i}`).join('\n')}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'event_seo_content',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                metaTitle: { type: ['string', 'null'] },
                metaDescription: { type: ['string', 'null'] },
                shortDescription: { type: ['string', 'null'] },
                longDescription: { type: ['string', 'null'] },
                highlights: { type: 'array', items: { type: 'string' } },
                keywords: { type: 'array', items: { type: 'string' } },
                slug: { type: ['string', 'null'] },
                imageAltText: { type: ['string', 'null'] },
                faqs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { question: { type: 'string' }, answer: { type: 'string' } },
                    required: ['question', 'answer'],
                    additionalProperties: false,
                  },
                },
                cancellationPolicy: { type: ['string', 'null'] },
                accessibilityNotes: { type: ['string', 'null'] },
              },
              required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug', 'imageAltText', 'faqs', 'cancellationPolicy', 'accessibilityNotes'],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 4500,
      })

      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json()
        const retryContent = retryPayload?.choices?.[0]?.message?.content
        if (retryContent) {
          try {
            const retryParsed = JSON.parse(typeof retryContent === 'string' ? retryContent : JSON.stringify(retryContent))
            const retryValidation = validateGeneratedContent(retryParsed)
            if (retryValidation.passed) {
              parsed = retryParsed
              console.warn('SEO content retry succeeded')
            } else {
              console.warn('SEO content retry still has issues, using original:', retryValidation.issues)
            }
          } catch {
            console.warn('Failed to parse retry response, using original')
          }
        }
      }
    } catch (retryErr) {
      console.warn('SEO content retry failed, using original:', retryErr)
    }
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
      imageAltText: parsed.imageAltText || null,
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs : [],
      cancellationPolicy: parsed.cancellationPolicy || null,
      accessibilityNotes: parsed.accessibilityNotes || null,
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
                'You are a top-tier hospitality copywriter who writes irresistible Facebook Event listings for pubs and venues. Your copy makes people stop scrolling and hit "Interested". You write in UK English. You use emojis naturally to add energy and visual appeal — in the event name and throughout the description. You NEVER use markdown — no asterisks, no bold, no italic, no bullet symbols. Plain text only.',
            },
            {
              role: 'user',
              content: [
                'Write ONE Facebook Event name and ONE Facebook Event description for the event details below.',
                '',
                'Tone & style:',
                '- Write like you are talking to a mate, not a customer. Warm, fun, confident.',
                '- Open with a hook that creates excitement or curiosity in the first line.',
                '- Paint a picture — what will the evening feel, sound, taste like?',
                '- Keep it tight. Short punchy paragraphs. No waffle.',
                '- Use emojis to add energy and break up the text visually (in the event name too).',
                '- Build urgency naturally — make people feel they will miss out.',
                '- End with a single clear call to action (but do NOT include any URL).',
                '',
                'Structure (use blank lines between every section for readability when pasted into Facebook):',
                '- 1-2 lines of hook / atmosphere.',
                '',
                '- A short paragraph selling the experience.',
                '',
                '- A "Need to know" section with an emoji header line, then each detail on its own line prefixed with an emoji (e.g. 📅 Date: ...). Use a blank line before and after this section.',
                '',
                '- A punchy closing CTA line.',
                '',
                'Hard constraints:',
                '- STRICTLY plain text. No markdown whatsoever: no **, no *, no _, no #, no - bullets, no []().',
                '- Do not include raw URLs anywhere.',
                '- Do not invent details not provided (no ages, dress codes, set times, pricing unless given).',
                '- Stay faithful to the brief — do not exaggerate or add claims not supported by the details.',
                '- When mentioning a host or performer, use their FIRST NAME only (e.g. "Peter" not "Peter Pitcher").',
                '- Keep the event name concise and enticing (aim < 70 characters).',
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
                'You are a top-tier hospitality copywriter who writes compelling Google Business Profile Event listings for pubs and venues. Your copy drives clicks and bookings. You write in UK English. You use emojis naturally to add energy and visual appeal. You NEVER use markdown — no asterisks, no bold, no italic, no bullet symbols. Plain text only.',
            },
            {
              role: 'user',
              content: [
                'Write ONE Google Business Profile (GBP) Event title and ONE GBP Event description for the event details below.',
                '',
                'Tone & style:',
                '- Warm, confident, inviting. Make people want to be there.',
                '- First 120 characters must hook — this is often the only preview shown.',
                '- Sell the experience, not just the facts.',
                '- Use emojis to add energy and visual appeal.',
                '- Stay faithful to the brief — do not exaggerate or invent.',
                '- When mentioning a host or performer, use their FIRST NAME only (e.g. "Peter" not "Peter Pitcher").',
                '- Include "The Anchor" naturally.',
                '- End with a clear call to action (but do NOT include any URL).',
                '',
                'Structure (use blank lines between sections for readability):',
                '- 1-2 short paragraphs selling the experience.',
                '- A compact details block with each detail on its own line prefixed with an emoji (e.g. 📅 Date: ...). Blank line before and after this block.',
                '- A punchy closing CTA.',
                '',
                'Hard constraints:',
                '- STRICTLY plain text. No markdown whatsoever: no **, no *, no _, no #, no - bullets, no []().',
                '- Do not include raw URLs anywhere.',
                '- Do not invent missing details.',
                '- Keep the description under 1500 characters.',
                '- Keep the title concise and enticing (aim < 80 characters).',
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

  let response: Response
  try {
    response = await callOpenAI(baseUrl, apiKey, {
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
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error('OpenAI promotion generation timed out')
      return { success: false, error: 'AI request timed out. Please try again.' }
    }
    const status = (err as any)?.status
    const body = (err as any)?.responseBody ?? ''
    if (typeof status === 'number') {
      console.error(`OpenAI promotion generation failed (${status})`, body)
      return { success: false, error: openAIErrorMessage(status, body) }
    }
    console.error('OpenAI promotion generation network error', err)
    return { success: false, error: 'Unable to reach the AI service. Check your network connection and try again.' }
  }

  if (!response.ok) {
    const body = await response.text()
    console.error('OpenAI promotion generation failed', body)
    return { success: false, error: openAIErrorMessage(response.status, body) }
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
