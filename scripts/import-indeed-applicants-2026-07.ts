#!/usr/bin/env tsx

/**
 * One-off importer for the July 2026 Indeed applicant batch (bar + kitchen).
 *
 * Unlike `ingest-recruitment-cvs.ts` (which walks a folder and imports every CV
 * into a single target posting), this script carries a hand-verified record per
 * applicant: name, contact details, target posting, and the Indeed screener
 * answers. Contact details were read from each CV and cross-checked; anomalies
 * are recorded in the candidate `notes` field so they surface in the UI.
 *
 * It calls the same `createRecruitmentApplication` service as every other intake
 * path, so candidate dedupe (email / phone / CV hash), CV upload, text
 * extraction, AI extraction and AI scoring all behave identically to a normal
 * application.
 *
 * Screener answers are mapped to the columns the candidate drawer actually
 * renders ("Their answers", RecruitmentDashboardClient.tsx):
 *   Q1 travel            -> travel_answer               ("Travel:")
 *   Q2 pub/bar experience-> relevant_experience_answer  ("Experience:")
 *   Q3 + Q4 + Q5         -> cover_note                  ("Cover note:")
 * `availability` (jsonb) is deliberately NOT used: the drawer only renders it
 * when it is `{raw}`/`{text}`-shaped and silently drops any other shape.
 * `cover_note` is written as a single line with " · " separators because the
 * drawer markup has no `whitespace-pre-wrap` and would collapse newlines.
 *
 * Safety: dry-run by default. A real import requires --confirm, --limit, and the
 * env guards RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true +
 * ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true (project convention).
 *
 * Usage:
 *   # Preview (no DB writes, no OpenAI):
 *   npx tsx scripts/import-indeed-applicants-2026-07.ts
 *
 *   # Real import:
 *   RUN_IMPORT_INDEED_APPLICANTS_MUTATION=true \
 *   ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT=true \
 *   npx tsx scripts/import-indeed-applicants-2026-07.ts --confirm --limit 40
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import { createRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import type { RecruitmentSource } from '@/types/recruitment'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'import-indeed-applicants-2026-07'
const RUN_MUTATION_ENV = 'RUN_IMPORT_INDEED_APPLICANTS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_IMPORT_INDEED_APPLICANTS_MUTATION_SCRIPT'
const HARD_CAP = 50

const RESUME_DIR = '/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Resumes'

const POSTING_BAR = '3218e975-0797-4357-b4f3-5cb9b9b78fd4'
const POSTING_KITCHEN = '63463f4f-b252-4833-b23f-8c81eb07a687'

type Screener = {
  /** Q1: Can you reach TW19 6AQ within ~15 minutes and reliably get home after midnight finishes? */
  travel?: string
  /** Q2: Do you have at least 1 year's pub/bar experience? */
  experience?: string
  /** Q3: Are you seeking long-term employment (not temporary/student work)? */
  longTerm?: string
  /** Q4: Are you available for weekend shifts on a rota basis? */
  weekends?: string
  /** Q5: Are you comfortable working solo and handling cash/card transactions? */
  solo?: string
}

type Applicant = {
  file: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  location: string | null
  posting: 'bar' | 'kitchen'
  screener?: Screener
  /** Verification flags worth a human eye; written to candidate notes. */
  flags?: string[]
}

// ---------------------------------------------------------------------------
// The batch. Contact details are as printed on each CV (cross-checked per CV);
// `location` prefers the applicant's stated Indeed profile location, falling
// back to the CV where Indeed gave none.
// ---------------------------------------------------------------------------
const APPLICANTS: Applicant[] = [
  // ---- Bar ----
  {
    file: 'ResumeHarryKnight.pdf',
    firstName: 'Harry', lastName: 'Knight',
    email: 'knightharry086@gmail.com', phone: null, location: 'Crawley, West Sussex',
    posting: 'bar',
    screener: { travel: 'Yes', experience: '2 years', longTerm: 'Long term', weekends: 'Yes', solo: 'Yes' },
    flags: ['No phone number on the CV — email is the only contact route.'],
  },
  {
    file: 'ResumePaulForster.pdf',
    firstName: 'Paul', lastName: 'Forster',
    email: 'fosterpaul390@yahoo.com', phone: '07495 558229', location: 'Egham, Surrey',
    posting: 'bar',
    screener: { travel: 'Yes I drive', experience: 'Yes Eusc about 7 years', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Name spelling unconfirmed: Indeed profile says "Paul Forster" but the CV is printed "Paul Foster" and his email is fosterpaul390@ — confirm which is correct.'],
  },
  {
    file: 'ResumeAlfieCampbell.pdf',
    firstName: 'Alfie', lastName: 'Campbell',
    email: 'alfiecampbellikw2y_psp@indeedemail.com', phone: '+447508864736', location: 'Walton-on-Thames',
    posting: 'bar',
    screener: {
      travel: 'Yes',
      experience: 'In multiple locations it adds up to around a year',
      longTerm: 'Yes preferably full time but am ok with part time',
      weekends: 'Yes i am available weekends and weekdays anytime',
      solo: 'Yes i am',
    },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire.'],
  },
  {
    file: 'ResumeConnorFitzhenry.pdf',
    firstName: 'Connor', lastName: 'Fitzhenry',
    email: 'brian.fitzhenry14@gmail.com', phone: '07907823860', location: 'Staines-upon-Thames',
    posting: 'bar',
    screener: {
      travel: 'Yes I commute to this location and finishing hours are no issue for me.',
      experience: 'Yes I have over 2 years of bar experiences.',
      longTerm: 'I am looking for full time employment and my availability is fully flexible',
      weekends: 'Yes I am available fair weekends.',
      solo: 'Yes. I have managed to gain experience with cash handling in previous roles.',
    },
    flags: ['Email local part is "brian.fitzhenry14" but the applicant is Connor Fitzhenry — may be a family member\'s address; confirm before emailing.'],
  },
  {
    file: 'ResumeChelseaGartland.pdf',
    firstName: 'Chelsea', lastName: 'Gartland',
    email: 'chelseagartland93hv8_7tt@indeedemail.com', phone: '+44 7479 079271', location: 'Staines-upon-Thames',
    posting: 'bar',
    screener: {
      travel: 'Yes', experience: 'Yes nearly 2 years', longTerm: 'Long term employment',
      weekends: 'Yes and I could cover anyone that are not in or on sick', solo: 'Yes',
    },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire.'],
  },
  {
    file: 'ResumeSanjitSinghDari.pdf',
    firstName: 'Sanjit Singh', lastName: 'Dari',
    email: 'sanjitsinghdari7y3i8_mdc@indeedemail.com', phone: '+447405621955', location: 'Hounslow South',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Long term', weekends: 'Ys', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire.'],
  },
  {
    file: 'ResumeAlexavierAldred.pdf',
    firstName: 'Alexavier', lastName: 'Aldred',
    email: 'aldredalexavier999@gmail.com', phone: '+44 7999 249338', location: 'Nottingham',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Indeed profile location is Nottingham, yet he answered "Yes" to reaching TW19 6AQ within ~15 minutes — worth checking he is actually local. CV prints no address.'],
  },
  {
    file: 'ResumeSamanthaMorilloProaño.pdf',
    firstName: 'Samantha', lastName: 'Morillo Proaño',
    email: 'samabi@outlook.es', phone: '07501000867', location: 'Reading',
    posting: 'bar',
    screener: {
      travel: "I live a little far away but it never implies a problem of punctuality, I don't mind finishing late.",
      experience: 'Yes', weekends: 'Yes', solo: 'Yes',
    },
    flags: ['Did not answer the long-term employment screener question on Indeed.'],
  },
  {
    file: 'ResumeNishthaTanna.pdf',
    firstName: 'Nishtha', lastName: 'Tanna',
    email: 'nishthatanna@gmail.com', phone: '+44 (0) 7886 093 155', location: null,
    posting: 'bar',
    screener: { travel: 'No', experience: 'No', longTerm: 'No', weekends: 'Yes', solo: 'Yes' },
    flags: ['Answered No to travel, No to 1 year bar experience and No to long-term work. CV shows volunteer roles only.'],
  },
  {
    file: 'ResumeKayleyWilcox.pdf',
    firstName: 'Kayley', lastName: 'Wilcox',
    email: 'kayleyw189@gmail.com', phone: '07555 098278', location: 'Feltham, Middlesex',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
  },
  {
    file: 'ResumeAminChaudhry.pdf',
    firstName: 'Amin', lastName: 'Chaudhry',
    email: 'aminchaudhry@icloud.com', phone: '+447383378021', location: 'Staines-upon-Thames',
    posting: 'bar',
    screener: {
      travel: 'Yes have my own mode of transportation',
      experience: 'Yes I have experience on both bar and waitering',
      longTerm: 'Yes I am I have a fully flexible schedule with need to also picking up shifts during the week as well',
      weekends: 'Yes', solo: 'Yes I am',
    },
    flags: ['CV is a scanned image with no text layer — contact details were read visually and the automatic CV text extraction will not populate.'],
  },
  {
    file: 'ResumeJaineetKhurana.pdf',
    firstName: 'Jaineet Singh', lastName: 'Khurana',
    email: 'Khuranajaineet76@gmail.com', phone: '+447715405897', location: 'London TW5',
    posting: 'bar',
    flags: ['Submitted a CV only — answered none of the Indeed screener questions. CV shows retail customer service, no bar or kitchen experience.'],
  },
  {
    file: 'ResumeYashBissessur.pdf',
    firstName: 'Yash', lastName: 'Bissessur',
    email: 'yash12b@hotmail.com', phone: '+44 7931627028', location: 'High Wycombe',
    posting: 'bar',
    screener: {
      travel: 'No put under an hour and can comfortably get back after midnight',
      experience: 'No', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes',
    },
    flags: ['CV contains his National Insurance number and date of birth — more personal data than we asked for; consider redacting the stored CV.'],
  },
  {
    file: 'ResumeHenryCabicoTamondong.pdf',
    firstName: 'Henry', lastName: 'Cabico Tamondong',
    email: 'hxch.cabico54@gmail.com', phone: '+44 7592912976', location: 'Egham, Surrey',
    posting: 'bar',
    screener: {
      travel: 'Yes, 1 bus takes me directly to the location in less than 20. Or a car ride to the location which is 6 mins.',
      experience: 'Yes, as a polar events bartender',
      longTerm: 'Yes, Long-term employment, I intend to stay local in Egham for the duration of my degree',
      weekends: "Yes, I'm available for the rota basis on all days as mentioned",
      solo: 'Yes',
    },
  },
  {
    file: 'ResumeDenverScotton.pdf',
    firstName: 'Denver', lastName: 'Scotton',
    email: 'denverscotton968k6_j5j@indeedemail.com', phone: '+447847854370', location: 'Chertsey',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'No', longTerm: 'No', weekends: 'Yes', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire.'],
  },
  {
    file: 'ResumeJackCRIPPS.pdf',
    firstName: 'Jack', lastName: 'Cripps',
    email: 'Jackcripps13@outlook.com', phone: '+44 7926 926827', location: 'Colnbrook, Slough',
    posting: 'bar',
    screener: {
      travel: 'Yes but due to current circumstances I would only be able to finish shifts at 8pm which is subject to change in September',
      experience: 'Yes I have just under 2 years experience',
      longTerm: 'Looking for a long-term job',
      weekends: 'Yes would be available until 8pm due to current circumstances due to change in September',
      solo: 'Yes I have worked busy shifts in Twickenham having to operate tills handling cash and card payments while not making mistakes',
    },
    flags: ['Can only work until 8pm until September — cannot cover late finishes before then.'],
  },
  {
    file: 'ResumeZaraHarb.pdf',
    firstName: 'Zara', lastName: 'Harb',
    email: 'zaraharb2008@gmail.com', phone: '07385 165750', location: 'Laleham',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Existing talent-pool record was stored under the mis-parsed name "Zarah Arb"; this import corrects it to Zara Harb.'],
  },
  {
    file: 'ResumeMarghlaraKhakwani.pdf',
    firstName: 'Marghlara', lastName: 'Khakwani',
    email: null, phone: '07578662900', location: 'Englefield Green',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['No email address on the CV — phone is the only contact route. CV hospitality experience is one waitressing role; the rest is tutoring.'],
  },
  {
    file: 'ResumeNITHINSAGARBURUGUPALLY (1).pdf',
    firstName: 'Nithin Sagar', lastName: 'Burugupally',
    email: 'nithinburugupallyih8ko_id9@indeedemail.com', phone: '+44 7366 299601', location: 'Feltham',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Long-term', weekends: 'Yes', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire. An earlier record for him existed with no CV and no application; this import attaches both.'],
  },
  {
    file: 'ResumeRosieDemiWestmoreland-Burns.pdf',
    firstName: 'Rosie Demi', lastName: 'Westmoreland-Burns',
    email: 'rosiewb14@gmail.com', phone: '07884021334', location: 'Weybridge',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'Yes', longTerm: 'Long term', weekends: 'Yes', solo: 'Yes' },
  },
  {
    file: 'ResumeLenaHalton.pdf',
    firstName: 'Lena', lastName: 'Halton',
    email: 'lenahaltonebv2k_s2n@indeedemail.com', phone: '+44 7534 530647', location: 'Aldershot',
    posting: 'bar',
    screener: { travel: 'Aldershot = 25 minutes Own vehicle', experience: '4 years', longTerm: 'Yes', weekends: 'Yes', solo: 'Yes' },
    flags: ['Email is an Indeed relay address, not a personal inbox — it may expire. Travels 25 minutes by car, not 15.'],
  },
  {
    file: 'ResumeDylhanSinghKhatkar.pdf',
    firstName: 'Dylhan', lastName: 'Singh Khatkar',
    email: 'dylhank@hotmail.com', phone: '07432278619', location: 'Ashford, Surrey',
    posting: 'bar',
    screener: { travel: 'Yes', experience: 'No', longTerm: 'Yes long term employment', weekends: 'Yes', solo: 'Yes' },
  },
  {
    file: 'ResumeChibuenyiIfe-Ogbonna.pdf',
    firstName: 'Chibuenyi', lastName: 'Ife-Ogbonna',
    email: 'chibs234@gmail.com', phone: '07495529410', location: 'Uxbridge',
    posting: 'bar',
    screener: { travel: 'Yed', experience: 'Yes', longTerm: 'Long term', weekends: 'Yes', solo: 'Yes' },
    flags: ['Already existed as a June talent-pool record; this import adds his Bar Staff application.'],
  },
  {
    file: 'ResumeThomasPanrucker.pdf',
    firstName: 'Thomas', lastName: 'Panrucker',
    email: 'Thomas.panrucker@outlook.com', phone: '07492821616', location: 'Staines-upon-Thames',
    posting: 'bar',
    screener: {
      travel: 'Yes, TW184JX is my postal code.',
      experience: 'While living abroad in Japan i helped out in the local bar as i knew the owner. I lived there for over a year. My product knowledge is potentially lacking however i am quick to learn and eager for a position like this.',
      longTerm: 'I am seeking part time employment as i will be studying in September.',
      weekends: 'Yes', solo: 'Yes',
    },
    flags: ['Seeking part-time only from September (studying). No formal hospitality work history on the CV.'],
  },

  // ---- Kitchen (in the resumes folder but not on the bar applicant list) ----
  {
    file: 'ResumeChopraKumarRamesh.pdf',
    firstName: 'Chopra Kumar', lastName: 'Ramesh',
    email: 'ramesh-chopra@hotmail.co.uk', phone: '07771866143', location: 'Ashford',
    posting: 'kitchen',
    flags: ['Name order unconfirmed: CV header prints "Chopra Kumar Ramesh" but his email is ramesh-chopra@ — he may be Ramesh Chopra with the surname printed first.'],
  },
  {
    file: 'ResumeJEETPATEL.pdf',
    firstName: 'Jeet', lastName: 'Patel',
    email: 'jeetp4075@gmail.com', phone: '+44 (0)7352 696538', location: 'East London',
    posting: 'kitchen',
    flags: ['CV is tailored to Burger King, not this pub. Hospitality experience is in India, no UK work history. States availability Wed/Thu/Sat/Sun only, ~20 hours.'],
  },
  {
    file: 'ResumeKrishKhanal.pdf',
    firstName: 'Krish', lastName: 'Khanal',
    email: 'khanalkrish352@gmail.com', phone: '07352131581', location: 'Northolt, London',
    posting: 'kitchen',
  },
  {
    file: 'ResumeMadhanSalupala.pdf',
    firstName: 'Madhan', lastName: 'Salupala',
    email: 'madhansalupala@gmail.com', phone: '07344549335', location: 'East Ham, London',
    posting: 'kitchen',
    flags: ['CV has internal contradictions: summary says MSc AI at University of East London, education section says MSc Data Science at University of Hertfordshire; study and work dates overlap.'],
  },
  {
    file: 'ResumeNEWMUNLIMBU.pdf',
    firstName: 'Newmun', lastName: 'Limbu',
    email: 'newmunlinbu@gmail.com', phone: null, location: 'Feltham',
    posting: 'kitchen',
    flags: [
      'No usable phone number: the CV prints "782-519-2111", which is a North American format (Nova Scotia area code) and cannot be dialled from the UK. Ask him for a UK number.',
      'CV is a scanned image with no text layer — details were read visually and automatic CV text extraction will not populate.',
      'Email is spelled "newmunlinbu" while his name is printed "LIMBU" — verify before emailing.',
    ],
  },
  {
    file: 'ResumeRiteshRanaMagar.pdf',
    firstName: 'Ritesh', lastName: 'Rana Magar',
    email: 'riteshranamagar320@gmail.com', phone: '07771642381', location: 'Feltham, London',
    posting: 'kitchen',
    flags: [
      'CV lists a second email (rihannarocks50@gmail.com) as an alternative — confirm which he prefers.',
      'On a student visa (Nepalese national) — hour restrictions apply, right-to-work check needed.',
      'CV objective is written for a care home role, not a pub.',
    ],
  },
  {
    file: 'ResumeSONAKHANMORADI.pdf',
    firstName: 'Sona', lastName: 'Khanmoradi',
    email: 'sonakhanmoradi80@gmail.com', phone: '07822859825', location: 'Hounslow',
    posting: 'kitchen',
    flags: ['No hospitality work history — 21 years as an anaesthesia practitioner in Iran; kitchen claim rests on a Feb 2026 Level 2 Food Hygiene certificate. English listed as intermediate, currently on an ESOL Entry 1 course.'],
  },
  {
    file: 'ResumeSulavChaudhary.pdf',
    firstName: 'Sulav', lastName: 'Chaudhary',
    email: 'sulavchadhary006@gmail.com', phone: '+44 7350141709', location: 'Northolt',
    posting: 'kitchen',
    flags: ['Email is spelled "sulavchadhary" while his name is printed "CHAUDHARY" — verify before emailing.'],
  },
]

// Already in the ATS with a Bar Staff application of their own — importing them
// again would only create a `declined_duplicate` row, so they are left alone.
const DELIBERATELY_SKIPPED = [
  { name: 'Allyssa Lougher', reason: 'already has a Bar Staff application (ai_screened, 13 Jul)' },
  { name: 'Jack Piper', reason: 'already has a Bar Staff application (rejected, 13 Jul)' },
]

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }
  return Number(trimmed)
}

type Args = { confirm: boolean; dryRun: boolean; limit: number | null; skipAi: boolean; delayMs: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false, dryRun: true, limit: null, skipAi: false, delayMs: 400 }
  let wantsDryRun = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--confirm' || arg === '--commit') { args.confirm = true; continue }
    if (arg === '--dry-run') { wantsDryRun = true; continue }
    if (arg === '--no-ai') { args.skipAi = true; continue }
    if (arg === '--limit') { args.limit = parsePositiveInt(argv[i + 1] ?? null); i += 1; continue }
    if (arg.startsWith('--limit=')) { args.limit = parsePositiveInt(arg.slice('--limit='.length) ?? null); continue }
  }
  args.dryRun = wantsDryRun || !args.confirm
  return args
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Supabase/provider errors are often plain objects carrying code/details/hint
// rather than Error instances, so a bare `error.message` loses the cause.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const anyErr = error as Record<string, unknown>
    const parts = [error.message || error.name]
    for (const key of ['code', 'status', 'statusCode', 'details', 'hint']) {
      if (anyErr[key] != null) parts.push(`${key}=${String(anyErr[key])}`)
    }
    if (anyErr.cause != null) parts.push(`cause=${describeError(anyErr.cause)}`)
    return parts.filter(Boolean).join(' ')
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const parts: string[] = []
    for (const key of ['message', 'error', 'code', 'status', 'statusCode', 'name', 'details', 'hint']) {
      const value = obj[key]
      if (value != null) parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    }
    return parts.length ? parts.join(' ') : JSON.stringify(obj)
  }
  return String(error)
}

/**
 * Q3/Q4/Q5 have no dedicated column, so they are folded into `cover_note`.
 * Single line, " · " separated: the drawer renders cover_note without
 * `whitespace-pre-wrap`, so newlines would collapse into a run-on paragraph.
 */
function buildCoverNote(screener: Screener | undefined): string | null {
  if (!screener) return null
  const parts: string[] = []
  if (screener.longTerm) parts.push(`Long-term employment: ${screener.longTerm}`)
  if (screener.weekends) parts.push(`Weekend shifts on a rota: ${screener.weekends}`)
  if (screener.solo) parts.push(`Comfortable solo + cash/card: ${screener.solo}`)
  if (parts.length === 0) return null
  return `Indeed screener — ${parts.join(' · ')}`
}

function buildNotes(applicant: Applicant, importedOn: string): string {
  const lines = [`Imported from the Indeed applicant batch on ${importedOn}. Source file: ${applicant.file}.`]
  if (!applicant.screener) lines.push('No Indeed screener answers were provided.')
  for (const flag of applicant.flags ?? []) lines.push(`Check: ${flag}`)
  return lines.join(' ')
}

type ImportResult = {
  file: string
  name: string
  posting: 'bar' | 'kitchen'
  status: 'imported' | 'failed'
  candidateId?: string
  candidateEmail?: string | null
  applicationId?: string
  applicationStatus?: string
  aiScore?: number | null
  aiRecommendation?: string | null
  extractionStatus?: string
  cvExtractionError?: string | null
  scoringError?: string | null
  error?: string
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const bar = APPLICANTS.filter(a => a.posting === 'bar')
  const kitchen = APPLICANTS.filter(a => a.posting === 'kitchen')

  // Fail fast on a bad dataset rather than half-importing it.
  const problems: string[] = []
  const seenFiles = new Set<string>()
  const seenEmails = new Set<string>()
  for (const a of APPLICANTS) {
    if (seenFiles.has(a.file)) problems.push(`duplicate file entry: ${a.file}`)
    seenFiles.add(a.file)
    if (a.email) {
      const key = a.email.toLowerCase()
      if (seenEmails.has(key)) problems.push(`duplicate email: ${a.email}`)
      seenEmails.add(key)
    }
    if (!a.email && !a.phone) problems.push(`${a.file}: neither email nor phone — candidate would be unreachable`)
    const coverNote = buildCoverNote(a.screener)
    if (coverNote && coverNote.length > 12000) problems.push(`${a.file}: cover_note exceeds 12000 chars`)
    if (a.screener?.travel && a.screener.travel.length > 4000) problems.push(`${a.file}: travel_answer exceeds 4000 chars`)
    if (a.screener?.experience && a.screener.experience.length > 4000) problems.push(`${a.file}: relevant_experience_answer exceeds 4000 chars`)
    try {
      await fs.access(path.join(RESUME_DIR, a.file))
    } catch {
      problems.push(`${a.file}: CV file not found in ${RESUME_DIR}`)
    }
  }
  if (problems.length > 0) {
    console.error(`[${SCRIPT_NAME}] dataset validation failed:`)
    problems.forEach(p => console.error(`    - ${p}`))
    throw new Error(`[${SCRIPT_NAME}] ${problems.length} dataset problem(s); nothing was written`)
  }

  console.log(`[${SCRIPT_NAME}] applicants: ${APPLICANTS.length} (bar ${bar.length}, kitchen ${kitchen.length})`)
  console.log(`[${SCRIPT_NAME}] deliberately skipped: ${DELIBERATELY_SKIPPED.length}`)
  DELIBERATELY_SKIPPED.forEach(s => console.log(`    - ${s.name} — ${s.reason}`))
  console.log(`[${SCRIPT_NAME}] AI extraction + scoring: ${args.skipAi ? 'OFF' : 'ON'}`)

  await fs.mkdir(path.resolve('temp'), { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (args.dryRun) {
    const preview = APPLICANTS.map(a => ({
      file: a.file,
      name: `${a.firstName} ${a.lastName}`,
      email: a.email,
      phone: a.phone,
      location: a.location,
      posting: a.posting,
      travel_answer: a.screener?.travel ?? null,
      relevant_experience_answer: a.screener?.experience ?? null,
      cover_note: buildCoverNote(a.screener),
      notes: buildNotes(a, timestamp.slice(0, 10)),
    }))
    const previewPath = path.resolve('temp', `indeed-applicants-import-preview-${timestamp}.json`)
    await fs.writeFile(previewPath, JSON.stringify({ applicants: preview, skipped: DELIBERATELY_SKIPPED }, null, 2), 'utf-8')
    console.log(`[${SCRIPT_NAME}] DRY RUN: would import ${APPLICANTS.length} applicant(s). No DB writes, no OpenAI calls.`)
    preview.forEach(p => console.log(`    - [${p.posting}] ${p.name} <${p.email ?? 'no-email'}> ${p.phone ?? 'no-phone'}`))
    console.log(`[${SCRIPT_NAME}] Preview written: ${previewPath}`)
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm --limit <n> (+ env guards) to import.`)
    return
  }

  // ---- Mutation guards (project convention) ----
  if (!args.confirm) throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  if (args.limit === null) throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  if (args.limit > HARD_CAP) throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  const targets = APPLICANTS.slice(0, args.limit)
  if (APPLICANTS.length > targets.length) {
    console.log(`[${SCRIPT_NAME}] WARNING: ${APPLICANTS.length} applicants but --limit ${args.limit} caps this run to ${targets.length}.`)
  }

  const consentAt = new Date().toISOString()
  const source: RecruitmentSource = 'job_board'
  const results: ImportResult[] = []

  let index = 0
  for (const applicant of targets) {
    index += 1
    const name = `${applicant.firstName} ${applicant.lastName}`
    const filePath = path.join(RESUME_DIR, applicant.file)

    try {
      const buffer = await fs.readFile(filePath)
      const result = await createRecruitmentApplication(
        {
          candidate: {
            first_name: applicant.firstName,
            last_name: applicant.lastName,
            email: applicant.email,
            phone: applicant.phone,
            location: applicant.location,
            source,
            consent_source: 'indeed_application',
            consent_at: consentAt,
            // They applied via Indeed for this role; they did not opt in to
            // marketing SMS or to being kept on file for future vacancies.
            sms_consent: false,
            future_recruitment_consent: false,
            notes: buildNotes(applicant, consentAt.slice(0, 10)),
          },
          job_posting_id: applicant.posting === 'bar' ? POSTING_BAR : POSTING_KITCHEN,
          source,
          cover_note: buildCoverNote(applicant.screener),
          relevant_experience_answer: applicant.screener?.experience ?? null,
          travel_answer: applicant.screener?.travel ?? null,
        },
        {
          cvUpload: {
            buffer,
            fileName: applicant.file,
            mimeType: 'application/pdf',
            sizeBytes: buffer.length,
          },
          uploadKind: 'admin',
          currentUserId: null,
          skipAi: args.skipAi,
        },
      )

      results.push({
        file: applicant.file,
        name,
        posting: applicant.posting,
        status: 'imported',
        candidateId: result.candidate.id,
        candidateEmail: result.candidate.email,
        applicationId: result.application.id,
        applicationStatus: result.application.status,
        aiScore: result.application.ai_score ?? null,
        aiRecommendation: result.application.ai_recommendation ?? null,
        extractionStatus: result.candidate.cv_extraction_status,
        cvExtractionError: result.cvExtractionError,
        scoringError: result.scoringError,
      })

      const flags = [
        `status:${result.application.status}`,
        `extract:${result.candidate.cv_extraction_status}`,
        result.application.ai_score != null ? `score:${result.application.ai_score}` : null,
        result.cvExtractionError ? 'extract-err' : null,
        result.scoringError ? 'score-err' : null,
      ].filter(Boolean).join(' ')
      console.log(`[${SCRIPT_NAME}] [${index}/${targets.length}] OK  [${applicant.posting}] ${name} <${result.candidate.email ?? 'no-email'}> (${flags})`)
    } catch (error) {
      const message = describeError(error)
      results.push({ file: applicant.file, name, posting: applicant.posting, status: 'failed', error: message })
      console.error(`[${SCRIPT_NAME}] [${index}/${targets.length}] FAIL [${applicant.posting}] ${name} -> ${message}`)
    }

    await sleep(args.delayMs)
  }

  const resultsPath = path.resolve('temp', `indeed-applicants-import-results-${timestamp}.json`)
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8')

  const imported = results.filter(r => r.status === 'imported')
  const failed = results.filter(r => r.status === 'failed')
  const duplicates = imported.filter(r => r.applicationStatus === 'declined_duplicate')

  console.log('')
  console.log(`[${SCRIPT_NAME}] imported: ${imported.length}, failed: ${failed.length}, duplicate applications: ${duplicates.length}`)
  console.log(`[${SCRIPT_NAME}] unique candidates: ${new Set(imported.map(r => r.candidateId)).size}`)
  console.log(`[${SCRIPT_NAME}] CV extraction failures: ${imported.filter(r => r.extractionStatus !== 'done').length}`)
  console.log(`[${SCRIPT_NAME}] scoring failures: ${imported.filter(r => r.scoringError).length}`)
  console.log(`[${SCRIPT_NAME}] Results written: ${resultsPath}`)
  if (failed.length > 0) {
    console.error(`[${SCRIPT_NAME}] FAILURES:`)
    failed.forEach(f => console.error(`    - ${f.name}: ${f.error}`))
  }
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
