# Candidate CV Parsing Discovery (parse_cv)

## Scope
This document captures the end-to-end CV parsing flow, including job queue handling, resume parsing, data writes, and debugging controls. It includes code excerpts for review.

## Entry Points And Triggers
- CV parsing is queued when a resume is provided:
  - `src/lib/hiring/service.ts` (application submission flow)
  - `src/app/hiring/applications/[applicationId]/confirm/page.tsx` (server action on confirmation page)
  - `src/app/api/hiring/applications/[applicationId]/confirm/route.ts` (API confirmation endpoint)
- Jobs are executed by the unified job queue processor:
  - `src/app/api/jobs/process/route.ts` (cron + authorized processing)
  - `src/app/api/jobs/process-now/route.ts` (manual trigger)

## High-Level Flow (Happy Path)
1. Resume file uploaded to Supabase Storage (`hiring-docs` bucket).
2. Candidate record and document record created (if applicable).
3. `parse_cv` job enqueued with `candidateId` + resume location.
4. Job processor claims job (RPC `claim_jobs`) and sets lease/processing token.
5. `parse_cv` handler downloads resume data from storage or URL.
6. `parseResumeWithUsage()` extracts text or images and calls OpenAI for structured data.
7. Candidate record updated with `parsed_data` and inferred fields.
8. Candidate profile version record written, `current_profile_version_id` updated.
9. `hiring_candidate_events` entry inserted (`event_type: 'cv_parsed'`).
10. `ai_usage_events` entry inserted (if OpenAI usage returned).
11. If `applicationId` present, `screen_application` job is enqueued.

## Job Queue Processing Details
- Job types are processed via `UnifiedJobQueue`.
- `parse_cv` jobs are claimed first, limited to 1 per batch to reduce load.
- Lease + heartbeat:
  - `processing_token` and `lease_expires_at` are set on claim.
  - Heartbeats refresh lease every `JOB_QUEUE_HEARTBEAT_MS` (default 30s).
- Timeout protection:
  - `JOB_QUEUE_TIMEOUT_MS` default 120000ms.
  - `withTimeout()` rejects if execution exceeds timeout.
- Stale job reset:
  - `JOB_QUEUE_STALE_MINUTES` default 30m.
  - Stale `processing` jobs reset to `pending` (or `failed` if max attempts reached).

## Resume Parsing Pipeline
- Supported types:
  - `application/pdf` (PDF)
  - `application/msword` (DOC)
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
  - `image/*` (JPG/PNG/GIF)
  - `text/*`
- PDF handling:
  - `pdf-parse` extracts text.
  - If extracted text length < 50 chars, fallback to OCR-style rendering using Puppeteer + PDF.js and pass images to OpenAI.
- DOC/DOCX handling:
  - `mammoth.extractRawText()`.
- Image handling:
  - Base64 image passed directly to OpenAI.
- Text handling:
  - UTF-8 buffer to string.
- Model call:
  - OpenAI Chat Completions with function call `extract_candidate_profile`.
  - Schema enforces required fields `first_name`, `last_name`, `email`.
  - `temperature: 0.1`.
- Output normalization:
  - Primary email lowercased, secondary emails deduped.
  - Token usage cost estimated from a pricing map.

## Data Writes (Tables/Buckets)
- Supabase Storage:
  - `hiring-docs` bucket (resume files)
- Tables:
  - `jobs` (status + lease metadata)
  - `hiring_candidates` (parsed_data + profile fields)
  - `hiring_candidate_documents` (resume metadata)
  - `hiring_candidate_profile_versions` (versioned parsed data)
  - `hiring_candidate_events` (auditing)
  - `ai_usage_events` (token usage + cost)

## Debugging Controls
- `HIRING_PARSE_DEBUG=1` enables detailed parse logging (via `logParseDebug()`).
- `JOB_QUEUE_DEBUG=1` enables job queue logs.
- In development, `logger.info()` is used for parse/job logs.

## Key Configuration
- OpenAI:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_HIRING_PARSER_MODEL` (default `gpt-4o`)
- Job queue:
  - `JOB_QUEUE_TIMEOUT_MS` (default 120000)
  - `JOB_QUEUE_STALE_MINUTES` (default 30)
  - `JOB_QUEUE_LEASE_SECONDS` (default derived from timeout)
  - `JOB_QUEUE_HEARTBEAT_MS` (default 30000)
- Puppeteer:
  - Uses `@sparticuz/chromium` when `process.env.VERCEL` is set.

## Known External Dependencies
- OpenAI API (model call for structured extraction).
- `unpkg.com` CDN (loads `pdfjs-dist` UMD build for PDF rendering).
- Puppeteer headless Chromium (PDF rendering).

## Code Excerpts

### 1) Queue Enqueue (Service Submission)
`src/lib/hiring/service.ts`
```ts
// 4. Enqueue CV Parsing Job if resume provided
if (input.candidate.resumeUrl || resumeStoragePath) {
    try {
        const { jobQueue } = await import('@/lib/unified-job-queue')
        await jobQueue.enqueue('parse_cv', {
            candidateId,
            resumeUrl: input.candidate.resumeUrl,
            storagePath: resumeStoragePath,
            documentId,
            applicationId,
            jobId: input.jobId,
        })
    } catch (queueError) {
        console.error('Failed to enqueue CV parsing job:', queueError)
    }
}
```

### 2) Queue Enqueue (Candidate Confirmation Flow)
`src/app/hiring/applications/[applicationId]/confirm/page.tsx`
```ts
if (hasFile) {
  const { jobQueue } = await import('@/lib/unified-job-queue')
  await jobQueue.enqueue('parse_cv', {
    candidateId: currentApp.candidate_id,
    resumeUrl,
    storagePath,
    documentId,
    applicationId: currentApp.id,
    jobId: currentApp.job_id,
  })
}
```

### 3) Job Processing Entry Point
`src/app/api/jobs/process/route.ts`
```ts
const batchSize = parseInt(request.nextUrl.searchParams.get('batch') || '30')
await jobQueue.processJobs(batchSize)
```

### 4) Job Claiming RPC (Supabase)
`supabase/migrations/20260414000000_job_queue_claiming.sql`
```sql
CREATE OR REPLACE FUNCTION public.claim_jobs(
  batch_size integer,
  job_types text[] DEFAULT NULL,
  lease_seconds integer DEFAULT NULL
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lease_interval interval;
BEGIN
  IF batch_size IS NULL OR batch_size <= 0 THEN
    RETURN;
  END IF;

  lease_interval := make_interval(secs => COALESCE(lease_seconds, 120));

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.jobs
    WHERE status = 'pending'
      AND scheduled_for <= NOW()
      AND (job_types IS NULL OR type = ANY(job_types))
      AND COALESCE(attempts, 0) < COALESCE(max_attempts, 3)
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  UPDATE public.jobs AS j
  SET status = 'processing',
      started_at = NOW(),
      processing_token = gen_random_uuid(),
      lease_expires_at = NOW() + lease_interval,
      last_heartbeat_at = NOW(),
      attempts = COALESCE(j.attempts, 0) + 1,
      updated_at = NOW()
  FROM candidates
  WHERE j.id = candidates.id
  RETURNING j.*;
END;
$$;
```

### 5) `parse_cv` Handler
`src/lib/unified-job-queue.ts`
```ts
case 'parse_cv': {
  const { parseResumeWithUsage } = await import('@/lib/hiring/parsing')
  const { createAdminClient } = await import('@/lib/supabase/admin')

  const supabase = createAdminClient()
  const candidateId = payload.candidateId as string | undefined
  const resumeUrl = payload.resumeUrl as string | undefined
  const storagePath = payload.storagePath as string | undefined
  const documentId = payload.documentId as string | undefined
  const applicationId = payload.applicationId as string | null | undefined
  const jobId = payload.jobId as string | null | undefined

  if (!candidateId) {
    throw new Error('Missing candidateId for parse_cv job')
  }

  const candidateResponse = await supabase
    .from('hiring_candidates')
    .select('email, secondary_emails, first_name, last_name, phone, location, current_profile_version_id')
    .eq('id', candidateId)
    .single()

  if (candidateResponse.error) {
    throw new Error(`Candidate not found: ${candidateResponse.error.message}`)
  }

  const candidate = candidateResponse.data

  const documentResponse = documentId
    ? await supabase
      .from('hiring_candidate_documents')
      .select('*')
      .eq('id', documentId)
      .single()
    : null

  const document = documentResponse?.data ?? null

  const resolvedStoragePath =
    storagePath || (document?.storage_path && !document.storage_path.startsWith('http') ? document.storage_path : undefined)
  const resolvedResumeUrl =
    resumeUrl || (document?.storage_path?.startsWith('http') ? document.storage_path : undefined)

  let buffer: Buffer
  let contentType: string

  const guessContentType = (fileName?: string | null) => {
    const extension = fileName?.split('.').pop()?.toLowerCase()
    switch (extension) {
      case 'pdf':
        return 'application/pdf'
      case 'doc':
        return 'application/msword'
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      case 'gif':
        return 'image/gif'
      default:
        return 'application/octet-stream'
    }
  }

  if (resolvedStoragePath) {
    const { data, error } = await supabase.storage
      .from('hiring-docs')
      .download(resolvedStoragePath)

    if (error || !data) {
      throw new Error(`Failed to download resume from storage: ${error?.message || 'Unknown error'}`)
    }

    const arrayBuffer = await data.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
    contentType = data.type || document?.mime_type || guessContentType(document?.file_name)
  } else if (resolvedResumeUrl && resolvedResumeUrl.startsWith('http')) {
    const fetchRes = await fetch(resolvedResumeUrl, { cache: 'no-store' })
    if (!fetchRes.ok) throw new Error(`Failed to download resume: ${fetchRes.statusText}`)
    const arrayBuffer = await fetchRes.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
    contentType = fetchRes.headers.get('content-type') || 'application/pdf'
  } else {
    throw new Error('Resume URL or storage path is required')
  }

  const parseResult = await parseResumeWithUsage(buffer, contentType)
  const parsedData = parseResult.parsedData

  const isPlaceholderEmail = (value?: string | null) =>
    !value || value.startsWith('pending-') || value.endsWith('@hiring.temp')

  const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || ''

  const updates: Record<string, any> = {
    parsed_data: parsedData
  }

  if ((candidate.first_name === 'Parsing' || !candidate.first_name) && parsedData.first_name) {
    updates.first_name = parsedData.first_name
  }
  if ((candidate.last_name === 'CV...' || !candidate.last_name) && parsedData.last_name) {
    updates.last_name = parsedData.last_name
  }
  if (isPlaceholderEmail(candidate.email) && parsedData.email) {
    updates.email = parsedData.email
  }
  if (!candidate.phone && parsedData.phone) {
    updates.phone = parsedData.phone
  }
  if (!candidate.location && parsedData.location) {
    updates.location = parsedData.location
  }

  const secondaryEmails = new Set<string>(Array.isArray(candidate.secondary_emails) ? candidate.secondary_emails : [])
  const parsedPrimaryEmail = normalizeEmail(parsedData.email)
  const existingPrimaryEmail = normalizeEmail(candidate.email)

  if (parsedPrimaryEmail && parsedPrimaryEmail !== existingPrimaryEmail && !isPlaceholderEmail(candidate.email)) {
    secondaryEmails.add(parsedPrimaryEmail)
  }

  if (Array.isArray(parsedData.secondary_emails)) {
    parsedData.secondary_emails.forEach((email) => {
      const normalized = normalizeEmail(email)
      if (normalized && normalized !== existingPrimaryEmail) {
        secondaryEmails.add(normalized)
      }
    })
  }

  if (secondaryEmails.size > 0) {
    updates.secondary_emails = Array.from(secondaryEmails)
  }

  const { error: updateError } = await supabase
    .from('hiring_candidates')
    .update(updates)
    .eq('id', candidateId)

  if (updateError) throw new Error(`Failed to update candidate: ${updateError.message}`)

  await supabase.from('hiring_candidate_events').insert({
    candidate_id: candidateId,
    application_id: applicationId || null,
    job_id: jobId || null,
    event_type: 'cv_parsed',
    source: 'system',
    metadata: {
      document_id: document?.id || documentId || null,
      resume_url: resolvedResumeUrl || null,
      storage_path: resolvedStoragePath || null,
    },
  })

  if (parseResult.usage) {
    const usage = parseResult.usage
    const contextParts = ['hiring_parsing', candidateId]
    if (document?.id || documentId) {
      contextParts.push(String(document?.id || documentId))
    }
    const context = contextParts.join(':')
    await (supabase.from('ai_usage_events') as any).insert([
      {
        context,
        model: usage.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost: usage.cost,
      },
    ])
  }

  if (applicationId) {
    await this.enqueue(
      'screen_application',
      { applicationId },
      { unique: `screen_application:${applicationId}` }
    )
  }
  return parsedData
}
```

### 6) Resume Parsing Implementation
`src/lib/hiring/parsing.ts`
```ts
const MIN_TEXT_LENGTH = 50
const MAX_TEXT_CHARS = 12000
const MAX_OCR_PAGES = 4
const OCR_SCALE = 1.5

async function renderPdfToImages(buffer: Buffer) {
  let browser: Browser | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent('<html><body></body></html>')

    // Use a CDN for UMD build compatible with script tag injection (pdfjs-dist v5 has no UMD)
    await page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js' })

    const pdfBase64 = buffer.toString('base64')

    const images = await page.evaluate(async ({ pdfBase64, maxPages, scale }) => {
      const pdfjsLib = (window as any).pdfjsLib
      if (!pdfjsLib) {
        throw new Error('PDF.js failed to load')
      }

      const binary = atob(pdfBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }

      const loadingTask = pdfjsLib.getDocument({ data: bytes, disableWorker: true })
      const pdf = await loadingTask.promise
      const pageCount = Math.min(pdf.numPages, maxPages)
      const results: string[] = []

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) {
          continue
        }
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: context, viewport }).promise
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1]
        if (base64) {
          results.push(base64)
        }
      }

      return results
    }, { pdfBase64, maxPages: MAX_OCR_PAGES, scale: OCR_SCALE })

    return images
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

async function extractCandidateProfile(openai: OpenAI, content: any, model: string) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are an expert recruiter and CV parser.
Extract the candidate's details from the resume text and/or images.
Pick the most likely personal email as "email" and place all other emails in "secondary_emails".
Be precise. If you cannot find a field, leave it null or omit it.
Normalize dates to YYYY-MM format if possible.`
      },
      {
        role: 'user',
        content
      }
    ],
    functions: [
      {
        name: 'extract_candidate_profile',
        description: 'Extract structured candidate data from resume content',
        parameters: CANDIDATE_SCHEMA
      }
    ],
    function_call: { name: 'extract_candidate_profile' },
    temperature: 0.1,
  })

  const functionArgs = response.choices[0].message.function_call?.arguments
  if (!functionArgs) {
    throw new Error('Model failed to generate structured data')
  }

  return {
    parsed: JSON.parse(functionArgs) as ParsedCandidateData,
    usage: response.usage ?? null,
    model: response.model || model,
  }
}

export async function parseResumeWithUsage(buffer: Buffer, mimeType: string): Promise<{
  parsedData: ParsedCandidateData
  usage?: ParsingUsage
  model: string
}> {
  let text = ''
  let images: string[] = []
  let imageMimeType: string | undefined

  try {
    const baseMimeType = mimeType.split(';')[0].trim().toLowerCase()
    imageMimeType = baseMimeType.startsWith('image/') ? baseMimeType : undefined

    if (baseMimeType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer })
      const data = await parser.getText()
      text = data.text
      await parser.destroy()
    } else if (
      baseMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      baseMimeType === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (baseMimeType.startsWith('image/')) {
      images = [buffer.toString('base64')]
    } else if (baseMimeType.startsWith('text/')) {
      text = buffer.toString('utf-8')
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }

    if (baseMimeType === 'application/pdf' && (!text || text.trim().length < MIN_TEXT_LENGTH)) {
      images = await renderPdfToImages(buffer)
      imageMimeType = 'image/png'
    }
  } catch (err) {
    console.error('Error extracting text from file:', err)
    throw new Error('Failed to extract text from file')
  }

  const trimmedText = text?.trim()
  const textForModel = trimmedText
    ? trimmedText.slice(0, MAX_TEXT_CHARS)
    : ''

  if (!textForModel && images.length === 0) {
    throw new Error('Extracted content is empty')
  }

  const { apiKey } = await getOpenAIConfig()

  if (!apiKey) {
    console.warn('OpenAI parsing skipped: No API Key')
    throw new Error('OpenAI API key not configured')
  }

  const openai = new OpenAI({ apiKey })
  const model = process.env.OPENAI_HIRING_PARSER_MODEL || 'gpt-4o'

  try {
    const content = buildUserContent(textForModel || null, images, imageMimeType)
    const parsedResponse = await extractCandidateProfile(openai, content, model)
    const normalized = normalizeParsedData(parsedResponse.parsed)
    const usagePayload = parsedResponse.usage
    const promptTokens = usagePayload?.prompt_tokens ?? 0
    const completionTokens = usagePayload?.completion_tokens ?? 0
    const totalTokens = usagePayload?.total_tokens ?? (promptTokens + completionTokens)
    const usage = usagePayload
      ? {
        model: parsedResponse.model,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: calculateOpenAICost(parsedResponse.model, promptTokens, completionTokens),
      }
      : undefined

    return {
      parsedData: normalized,
      usage,
      model: parsedResponse.model,
    }
  } catch (error) {
    console.error('OpenAI parsing error:', error)
    throw new Error('Failed to parse resume with AI')
  }
}
```

### 7) OpenAI Config Source
`src/lib/openai/config.ts`
```ts
export async function getOpenAIConfig(options: { forceRefresh?: boolean } = {}): Promise<OpenAIConfig> {
  const envApiKey = process.env.OPENAI_API_KEY?.trim() || null
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim()

  const settingsOverrides = await loadConfigFromSettings()

  const apiKey = envApiKey ?? settingsOverrides.apiKey ?? null
  const baseUrl = envBaseUrl ?? settingsOverrides.baseUrl ?? DEFAULT_BASE_URL
  const receiptsModel = settingsOverrides.receiptsModel ?? DEFAULT_RECEIPTS_MODEL
  const eventsModel = settingsOverrides.eventsModel ?? DEFAULT_EVENTS_MODEL

  cachedConfig = { apiKey, baseUrl, receiptsModel, eventsModel }
  cacheExpiresAt = now + 5 * 60 * 1000

  return cachedConfig
}
```

## Notes For Review
- `parseResumeWithUsage()` uses `getOpenAIConfig()` but only consumes `apiKey`; `baseUrl` overrides are not applied here.
- PDF image rendering relies on a remote CDN for `pdfjs-dist` (network dependency).
- `withTimeout()` rejects after `JOB_QUEUE_TIMEOUT_MS` but does not cancel the underlying Puppeteer/OpenAI work.
- `maxDuration` for `/api/jobs/process` is 60s, which can be lower than `JOB_QUEUE_TIMEOUT_MS` (120s).
