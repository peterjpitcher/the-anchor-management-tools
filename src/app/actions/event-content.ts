'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'
import type { RetryOptions } from '@/lib/retry'
import {
  validateGeneratedContent,
  applyDeterministicRepair,
  normalizeSlug,
  capAndDeduplicate,
} from '@/lib/seo-validation'
import type { SeoValidationIssue } from '@/lib/seo-validation'
import {
  buildEventSeoFacts,
  describeKitchenServiceForEvent,
  preflightCheck,
  ANCHOR_VENUE_CONTEXT,
  CONTENT_RETRY_CONFIG,
  GENERATION_TIMEOUT_MS,
  REPAIR_TIMEOUT_MS,
  OVERALL_BUDGET_MS,
} from '@/lib/event-seo/generation'
import type { BuildFactsInput, BuildFactsDbData } from '@/lib/event-seo/generation'
import { buildGenerationMessages, buildRepairMessages } from '@/lib/event-seo/prompts'
import { getKitchenWindowForDate } from '@/services/business-hours'

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const SEO_RESPONSE_SCHEMA = {
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
      required: [
        'metaTitle', 'metaDescription', 'shortDescription', 'longDescription',
        'highlights', 'keywords', 'slug', 'imageAltText', 'faqs',
        'cancellationPolicy', 'accessibilityNotes',
      ],
      additionalProperties: false,
    },
  },
} as const

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

const PROMOTION_TIMEOUT_MS = 60_000

async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number = PROMOTION_TIMEOUT_MS,
  retryConfig: RetryOptions = RetryConfigs.api,
): Promise<Response> {
  return retry(
    async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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
          ;(err as unknown as Record<string, unknown>).status = response.status
          ;(err as unknown as Record<string, unknown>).responseBody = text
          throw err
        }

        return response
      } finally {
        clearTimeout(timeoutId)
      }
    },
    retryConfig,
  )
}

function formatTopIssues(issues: SeoValidationIssue[]): string {
  const top = issues
    .filter(i => i.severity === 'fatal' || i.severity === 'repairable')
    .slice(0, 3)
    .map(i => i.message)
  return `Content quality check failed: ${top.join('. ')}`
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type EventSeoContentInput = {
  eventId?: string | null
  name: string
  date?: string | null
  time?: string | null
  endTime?: string | null
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

// ---------------------------------------------------------------------------
// generateEventSeoContent
// ---------------------------------------------------------------------------

export async function generateEventSeoContent(input: EventSeoContentInput): Promise<EventSeoContentResult> {
  const startTime = Date.now()
  let attemptCount = 0
  let preRepairIssueCodes: string[] = []
  let postRepairIssueCodes: string[] = []
  let repairType: 'none' | 'deterministic' | 'model' | 'both' = 'none'
  let openAiResponse: Record<string, unknown> | null = null
  let succeeded = false

  // 1. Permission check
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    return { success: false, error: 'You do not have permission to generate content.' }
  }

  // 2. Load OpenAI config
  const config = await getOpenAIConfig()
  if (!config.apiKey) {
    return { success: false, error: 'OpenAI is not configured. Add an API key in Settings.' }
  }

  // 3. Build EventSeoFacts from form input + optional DB data
  const factsInput: BuildFactsInput = {
    name: input.name,
    date: input.date,
    time: input.time,
    endTime: input.endTime,
    categoryName: input.categoryName,
    capacity: input.capacity,
    brief: input.brief,
    performerName: input.performerName,
    performerType: input.performerType,
    price: typeof input.price === 'number' ? `£${input.price.toFixed(2)}` : null,
    isFree: input.isFree,
    bookingUrl: input.bookingUrl,
    existingMetaTitle: input.existingMetaTitle,
    existingMetaDescription: input.existingMetaDescription,
    existingShortDescription: input.existingShortDescription,
    existingLongDescription: input.existingLongDescription,
    existingHighlights: input.existingHighlights,
    existingKeywords: input.existingKeywords,
    primaryKeywords: input.primaryKeywords,
    secondaryKeywords: input.secondaryKeywords,
    localSeoKeywords: input.localSeoKeywords,
  }

  let dbData: BuildFactsDbData | null = null
  if (input.eventId) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        end_time,
        capacity,
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
      const categoryName = Array.isArray((data as Record<string, unknown>).category_details)
        ? ((data as Record<string, unknown>).category_details as Array<{ name?: string }>)[0]?.name
        : ((data as Record<string, unknown>).category_details as { name?: string } | null)?.name

      dbData = {
        name: data.name,
        date: data.date,
        start_time: data.time,
        end_time: data.end_time,
        category_name: categoryName ?? null,
        capacity: data.capacity,
        description: null,
        performer_name: data.performer_name ?? null,
        performer_type: data.performer_type ?? null,
        price: typeof data.price === 'number' ? `£${data.price.toFixed(2)}` : null,
        is_free: data.is_free ?? undefined,
        booking_url: data.booking_url ?? null,
        brief: data.brief ?? null,
      }
    }
  }

  const resolvedDate = input.date?.trim() || dbData?.date?.trim() || null
  const resolvedStartTime = input.time?.trim() || dbData?.start_time?.trim() || null
  const resolvedEndTime = input.endTime?.trim() || dbData?.end_time?.trim() || null

  if (resolvedDate) {
    try {
      const kitchenWindow = await getKitchenWindowForDate(resolvedDate)
      factsInput.kitchenService = describeKitchenServiceForEvent(
        kitchenWindow,
        resolvedStartTime,
        resolvedEndTime,
      )
    } catch (error) {
      console.error('Failed to resolve kitchen hours for event content', error)
      factsInput.kitchenService =
        'Kitchen hours could not be verified. Do not say food or the menu is available.'
    }
  }

  const facts = buildEventSeoFacts(factsInput, dbData)

  // 4. Preflight check
  const preflight = preflightCheck(facts)
  if (!preflight.pass) {
    return { success: false, error: preflight.hardErrors.join('. ') }
  }

  // Validation facts used for quality gate checks
  const validationFacts = {
    name: facts.name,
    date: facts.date,
    primaryKeywords: facts.keywords.primary,
    secondaryKeywords: facts.keywords.secondary,
    localSeoKeywords: facts.keywords.local,
  }

  // Overall budget abort controller
  const overallController = new AbortController()
  const overallTimeout = setTimeout(() => overallController.abort(), OVERALL_BUDGET_MS)

  try {
    // 5. Build generation messages
    const messages = buildGenerationMessages(facts)

    // 6. Call OpenAI
    attemptCount = 1
    let response: Response
    try {
      response = await callOpenAI(config.baseUrl, config.apiKey, {
        model: config.seoModel,
        temperature: 0.7,
        messages,
        response_format: SEO_RESPONSE_SCHEMA,
        max_tokens: 4500,
      }, GENERATION_TIMEOUT_MS, CONTENT_RETRY_CONFIG)
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        overallController.signal.aborted
      ) {
        console.error('OpenAI SEO generation timed out')
        return { success: false, error: 'AI request timed out. Please try again.' }
      }
      const status = (err as Record<string, unknown>)?.status
      const body = (err as Record<string, unknown>)?.responseBody ?? ''
      if (typeof status === 'number') {
        console.error(`OpenAI SEO generation failed (${status})`, body)
        return { success: false, error: openAIErrorMessage(status, String(body)) }
      }
      console.error('OpenAI SEO generation network error', err)
      return { success: false, error: 'Unable to reach the AI service. Check your network connection and try again.' }
    }

    if (!response.ok) {
      const body = await response.text()
      console.error('OpenAI SEO generation failed', body)
      return { success: false, error: openAIErrorMessage(response.status, body) }
    }

    // 7. Parse JSON response
    const payload = await response.json()
    openAiResponse = payload
    const content = payload?.choices?.[0]?.message?.content
    if (!content) {
      return { success: false, error: 'OpenAI returned no content.' }
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
    } catch (error) {
      console.error('Failed to parse SEO content response', error)
      return { success: false, error: 'Unable to parse AI response.' }
    }

    // 8. Apply deterministic repair
    const repaired = applyDeterministicRepair(parsed, validationFacts)

    // Overwrite deterministic fields
    repaired.slug = normalizeSlug(
      facts.name,
      facts.date,
      facts.keywords.primary[0] ?? null,
    )

    if (facts.isFree) {
      repaired.cancellationPolicy = 'Free event — no cancellation policy required.'
    } else if (facts.pricingLabel) {
      repaired.cancellationPolicy = `Contact The Anchor on ${ANCHOR_VENUE_CONTEXT.phone} for cancellation and refund queries.`
    } else {
      repaired.cancellationPolicy = 'Contact The Anchor for details.'
    }

    repaired.accessibilityNotes = `The Anchor offers step-free access throughout the ground floor with an accessible toilet. For specific accessibility requirements, please call ${ANCHOR_VENUE_CONTEXT.phone}.`

    // Merge keywords: facts keywords + model-suggested, deduplicated, capped at 10
    const modelKeywords = Array.isArray(repaired.keywords)
      ? (repaired.keywords as string[]).filter((x): x is string => typeof x === 'string')
      : []
    const allKeywords = [
      ...facts.keywords.primary,
      ...facts.keywords.secondary,
      ...facts.keywords.local,
      ...modelKeywords,
    ]
    repaired.keywords = capAndDeduplicate(allKeywords, 10)

    // 9. Validate with quality gate
    const validation = validateGeneratedContent(repaired, {
      facts: validationFacts,
      requireKeywords: true,
      mode: 'final',
    })

    preRepairIssueCodes = validation.issues.map(i => i.code)

    if (validation.passed) {
      repairType = 'deterministic'
      postRepairIssueCodes = []
      succeeded = true
      return buildSuccessResult(repaired)
    }

    // 10. Model repair for remaining issues — check budget first
    const elapsedBeforeRepair = Date.now() - startTime
    if (elapsedBeforeRepair > 60_000) {
      postRepairIssueCodes = validation.issues.map(i => i.code)
      return { success: false, error: formatTopIssues(validation.issues) }
    }

    attemptCount = 2
    repairType = 'both'

    const repairMessages = buildRepairMessages(facts, repaired, validation.issues)
    let repairResponse: Response
    try {
      repairResponse = await callOpenAI(config.baseUrl, config.apiKey, {
        model: config.seoModel,
        temperature: 0.2,
        messages: repairMessages,
        response_format: SEO_RESPONSE_SCHEMA,
        max_tokens: 4500,
      }, REPAIR_TIMEOUT_MS, CONTENT_RETRY_CONFIG)
    } catch (repairErr) {
      console.warn('SEO content model repair call failed:', repairErr)
      postRepairIssueCodes = validation.issues.map(i => i.code)
      return { success: false, error: formatTopIssues(validation.issues) }
    }

    if (!repairResponse.ok) {
      postRepairIssueCodes = validation.issues.map(i => i.code)
      return { success: false, error: formatTopIssues(validation.issues) }
    }

    const repairPayload = await repairResponse.json()
    openAiResponse = repairPayload
    const repairContent = repairPayload?.choices?.[0]?.message?.content
    if (!repairContent) {
      postRepairIssueCodes = validation.issues.map(i => i.code)
      return { success: false, error: formatTopIssues(validation.issues) }
    }

    let repairParsed: Record<string, unknown>
    try {
      repairParsed = JSON.parse(
        typeof repairContent === 'string' ? repairContent : JSON.stringify(repairContent),
      )
    } catch {
      postRepairIssueCodes = validation.issues.map(i => i.code)
      return { success: false, error: formatTopIssues(validation.issues) }
    }

    // Apply deterministic repair again on the model-repaired draft
    const reRepairedDraft = applyDeterministicRepair(repairParsed, validationFacts)

    // Overwrite deterministic fields again
    reRepairedDraft.slug = normalizeSlug(
      facts.name,
      facts.date,
      facts.keywords.primary[0] ?? null,
    )
    reRepairedDraft.cancellationPolicy = repaired.cancellationPolicy
    reRepairedDraft.accessibilityNotes = repaired.accessibilityNotes

    const reRepairedModelKeywords = Array.isArray(reRepairedDraft.keywords)
      ? (reRepairedDraft.keywords as string[]).filter((x): x is string => typeof x === 'string')
      : []
    const allReRepairedKeywords = [
      ...facts.keywords.primary,
      ...facts.keywords.secondary,
      ...facts.keywords.local,
      ...reRepairedModelKeywords,
    ]
    reRepairedDraft.keywords = capAndDeduplicate(allReRepairedKeywords, 10)

    // Validate again
    const reValidation = validateGeneratedContent(reRepairedDraft, {
      facts: validationFacts,
      requireKeywords: true,
      mode: 'final',
    })

    postRepairIssueCodes = reValidation.issues.map(i => i.code)

    if (reValidation.passed) {
      succeeded = true
      return buildSuccessResult(reRepairedDraft)
    }

    // 11. NEVER fall back to invalid draft as success
    return { success: false, error: formatTopIssues(reValidation.issues) }
  } finally {
    clearTimeout(overallTimeout)

    // Observability log
    const usage = (openAiResponse as Record<string, unknown>)?.usage as Record<string, unknown> | undefined
    const promptDetails = usage?.prompt_tokens_details as Record<string, unknown> | undefined
    const choices = (openAiResponse as Record<string, unknown>)?.choices
    const firstChoice = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined

    console.warn('[event-seo-generation]', JSON.stringify({
      eventId: input.eventId ?? null,
      model: config.seoModel,
      durationMs: Date.now() - startTime,
      attemptCount,
      finishReason: firstChoice?.finish_reason ?? null,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      cachedPromptTokens: promptDetails?.cached_tokens ?? null,
      preRepairIssues: preRepairIssueCodes,
      postRepairIssues: postRepairIssueCodes,
      repairType,
      success: succeeded,
    }))
  }
}

function buildSuccessResult(draft: Record<string, unknown>): EventSeoContentResult {
  return {
    success: true,
    data: {
      metaTitle: typeof draft.metaTitle === 'string' ? draft.metaTitle : null,
      metaDescription: typeof draft.metaDescription === 'string' ? draft.metaDescription : null,
      shortDescription: typeof draft.shortDescription === 'string' ? draft.shortDescription : null,
      longDescription: typeof draft.longDescription === 'string' ? draft.longDescription : null,
      highlights: Array.isArray(draft.highlights) ? draft.highlights.filter(Boolean) : [],
      keywords: Array.isArray(draft.keywords) ? draft.keywords.filter(Boolean) : [],
      slug: typeof draft.slug === 'string' ? draft.slug : null,
      imageAltText: typeof draft.imageAltText === 'string' ? draft.imageAltText : null,
      faqs: Array.isArray(draft.faqs) ? draft.faqs : [],
      cancellationPolicy: typeof draft.cancellationPolicy === 'string' ? draft.cancellationPolicy : null,
      accessibilityNotes: typeof draft.accessibilityNotes === 'string' ? draft.accessibilityNotes : null,
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
