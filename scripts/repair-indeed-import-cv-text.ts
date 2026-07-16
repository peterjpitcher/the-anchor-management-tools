#!/usr/bin/env tsx

/**
 * Repairs CV text for three candidates from the July 2026 Indeed import whose
 * PDFs defeated the normal `pdf2json` extraction path, then re-runs AI
 * extraction and scoring so their scores reflect their actual CVs.
 *
 * Why they failed:
 *   - Amin Chaudhry / Newmun Limbu: the PDF is a single scanned JPEG with no
 *     text layer, so there is nothing for pdf2json to read. The import stored a
 *     46-character stub and the AI scored them on the screener answers alone
 *     (Amin) or on nothing at all (Newmun -> score 0, "reject").
 *   - Sulav Chaudhary: the PDF has a malformed XRef stream header that pdf2json
 *     rejects outright, though poppler reads it cleanly. Extraction status was
 *     left "failed" with empty cv_text, and he scored 10 ("reject").
 *
 * Both Newmun Limbu and Sulav Chaudhary are working sous/head chefs, so those
 * scores are false negatives caused by tooling, not by their applications. This
 * matters because the hiring manager triages on the AI score.
 *
 * The replacement text below was transcribed from each CV (visually for the two
 * scanned PDFs, via `pdftotext -layout` for Sulav's). Nothing is invented: it is
 * a faithful rendering of what each CV prints. The candidate note records that
 * the text was transcribed rather than machine-extracted.
 *
 * Safety: dry-run by default. A real run requires --confirm and the env guards
 * RUN_REPAIR_CV_TEXT_MUTATION=true + ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT=true.
 *
 * Usage:
 *   npx tsx scripts/repair-indeed-import-cv-text.ts
 *   RUN_REPAIR_CV_TEXT_MUTATION=true ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT=true \
 *     npx tsx scripts/repair-indeed-import-cv-text.ts --confirm
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { rescoreRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'repair-indeed-import-cv-text'
const RUN_MUTATION_ENV = 'RUN_REPAIR_CV_TEXT_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_REPAIR_CV_TEXT_MUTATION_SCRIPT'

const AMIN_CV = `AMIN CHAUDHRY
5 Waterside, 12 Thames Street, Staines-upon-Thames, Surrey TW18 4SD
Phone: +447383378021 | Email: aminchaudhry@icloud.com | Nationality: British

PROFESSIONAL SUMMARY
Dedicated professional with expertise in food and beverage service, table service, and customer service. Demonstrates exceptional time management, problem-solving, communication, and organisational skills. Committed to delivering high-quality service and enhancing customer satisfaction. Aims to leverage skills in a dynamic environment to contribute to team success and career growth.

WORK HISTORY
Waiter, 02/2025 - Current
Topgolf - Addlestone, Surrey
- Enhanced customer satisfaction by promptly attending to queries and requests.
- Remained calm under pressure, ensuring better performance during peak hours.
- Liaised with kitchen staff for prompt order delivery to customers.
- Helped reduce waiting times by swiftly clearing tables after use.

Delivery rider, 10/2024 - 02/2025
Uber Eats - London, Surrey
- Ensured timely delivery by adhering strictly to scheduled routes and stops.
- Maintained vehicle cleanliness for professional representation of the company.
- Achieved customer satisfaction with prompt and courteous service.
- Loaded goods onto vehicle to ensure safe transport.

Waiter, 01/2023 - 05/2024
Gauchos Steak House - Lahore, Pakistan
- Enhanced customer satisfaction by promptly attending to queries and requests.
- Managed table settings for optimal dining experience.
- Ensured cleanliness of restaurant area with regular sweeping and wiping.
- Handled payment transactions to guarantee smooth customer checkout process.

EDUCATION
GCSEs, 2021 - 2024 - Lahore Grammar School Defence, Lahore
A-Levels, 2024 - Current - Strode's College, London

SKILLS
Food and beverage service; Table service; Customer service; Time management; Problem-solving; Communication; Organisation

LANGUAGES
Urdu (Fluent); Hindi (Upper intermediate); Punjabi (Elementary)`

const NEWMUN_CV = `NEWMUN LIMBU
Phone (as printed on CV): 782-519-2111 | Email: newmunlinbu@gmail.com | Feltham TW14 8AA

SUMMARY
Quality-driven Sous Chef maintains complete understanding of kitchen operations, equipment and sanitation. Demonstrates organizational skills, budgeting experience and full knowledge of financial reports. Hires, trains and manages staff to provide employees with adequate guidance and resources to accomplish established objectives.

SKILLS
Time management; Effective communication; Customer service; Team collaboration; Team leadership; Staff supervision; Kitchen management; Food safety

EXPERIENCE
Sous Chef
Rincs Roadside | South Harrow | Jan 2024 - Dec 2025
- Assisted in preparing high-quality dishes for diverse menu offerings.
- Collaborated with chefs to ensure timely food preparation and presentation.
- Managed kitchen inventory and ordered supplies to maintain stock levels.
- Maintained cleanliness and organization in the kitchen environment.
- Monitored food storage practices to adhere to safety standards.

Sous Chef
Okawari | London | Jan 2026 - Current
- Communicated effectively with team members to optimize workflow efficiency.
- Ensured food preparation and presentation met high standards of quality and sanitation.
- Complied with all health department regulations regarding proper food handling methods.
- Coordinated ordering, receiving, storage, and distribution of food items.
- Directed kitchen staff in day-to-day operations including food production, sanitation, safety practices, and personnel management.

EDUCATION
BSc Business Management - University of Roehampton | Roehampton, London

CERTIFICATION
Food safety and hygiene Level 2`

const SULAV_CV = `SULAV CHAUDHARY
Address: 22 Rushdene Crescent, Northolt, United Kingdom, UB5 6NE
Phone: +44 7350141709 | Email: sulavchadhary006@gmail.com

PROFESSIONAL SUMMARY
Confident Sous Chef with experience in reputable, high-end hospitality environments. Motivated and organised to complete tasks to high-quality standards in pressured conditions. Builds positive rapport and relationships for improved team productivity.
Highly-motivated Sous Chef with dedicated work ethic and can-do attitude seeks opportunity to build upon strong menu creation, preparation and presentation skills. Thrives under pressure to run productive stations with high-quality output. Coaches junior kitchen members to uplift team capabilities.
Enthusiastic individual seeks opportunity in fast-paced kitchen to develop chef skills. Creative and skilled in food preparation and presentation for quality results. Organised with excellent timekeeping skills to meet demands of busy service environments.

WORK HISTORY
Head chef, 08/2025 to 04/2026
Garari - Hayes, England
- Instituted a rotation system to minimise food waste.
- Improved kitchen efficiency by streamlining cooking processes.
- Maintained exemplary hygiene standards in the kitchen area.
- Developed seasonal menus to offer variety and freshness in dishes served.
- Managed all aspects of the kitchen, ensuring smooth operation.
- Directed the preparation of special dishes for events and holidays.
- Trained junior staff for optimal performance and skill development.
- Set kitchen standards governing cooking procedures, garnishes and food presentation.

EDUCATION
Bachelor of Business Administration, Applied Management, 06/2025 - Current
BPP University - England

SKILLS
Kitchen hygiene standards compliance; Health and safety consciousness; Indian spices identification; Presentation of food items; Authentic recipe creation; Commercial kitchen equipment operation; Managing multiple orders; Deep-fryer handling; Main course designing; Food pairing capacity; Restaurant operations understanding; Indian cuisine mastery`

type Repair = {
  name: string
  email: string
  cvText: string
  /** Why the normal extraction path failed, recorded on the candidate. */
  reason: string
}

const REPAIRS: Repair[] = [
  {
    name: 'Amin Chaudhry',
    email: 'aminchaudhry@icloud.com',
    cvText: AMIN_CV,
    reason: 'CV is a scanned image with no text layer; CV text was transcribed from the document by hand on import.',
  },
  {
    name: 'Newmun Limbu',
    email: 'newmunlinbu@gmail.com',
    cvText: NEWMUN_CV,
    reason: 'CV is a scanned image with no text layer; CV text was transcribed from the document by hand on import. His first AI score of 0 reflected the empty extraction, not his application.',
  },
  {
    name: 'Sulav Chaudhary',
    email: 'sulavchadhary006@gmail.com',
    cvText: SULAV_CV,
    reason: 'CV PDF has a malformed XRef header that the automatic extractor rejects; CV text was recovered with a different PDF reader on import. His first AI score of 10 reflected the failed extraction, not his application.',
  },
]

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') return JSON.stringify(error)
  return String(error)
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION' : 'DRY RUN'} starting`)

  const supabase = createAdminClient()

  for (const repair of REPAIRS) {
    const { data: candidate, error } = await supabase
      .from('recruitment_candidates')
      .select('id, first_name, last_name, email, notes, cv_extraction_status, cv_text')
      .eq('email_normalized', repair.email.toLowerCase())
      .maybeSingle()

    if (error) throw error
    if (!candidate) {
      console.error(`[${SCRIPT_NAME}] SKIP ${repair.name}: candidate not found for ${repair.email}`)
      continue
    }

    const { data: apps, error: appsError } = await supabase
      .from('recruitment_applications')
      .select('id, status, ai_score, ai_recommendation')
      .eq('candidate_id', candidate.id)
      .not('job_posting_id', 'is', null)
      .order('created_at', { ascending: false })

    if (appsError) throw appsError
    const application = apps?.[0]
    if (!application) {
      console.error(`[${SCRIPT_NAME}] SKIP ${repair.name}: no scoreable application`)
      continue
    }

    if (!confirm) {
      console.log(`[${SCRIPT_NAME}] DRY RUN ${repair.name}: would replace cv_text (${(candidate.cv_text ?? '').length} -> ${repair.cvText.length} chars), status ${candidate.cv_extraction_status} -> done, then rescore application ${application.id} (currently score ${application.ai_score}, ${application.ai_recommendation}).`)
      continue
    }

    // Clear extracted_data so the rescore path re-derives it from the repaired text.
    const note = `${candidate.notes ?? ''} Check: ${repair.reason}`.trim()
    const { error: updateError } = await supabase
      .from('recruitment_candidates')
      .update({
        cv_text: repair.cvText,
        cv_extraction_status: 'done',
        extracted_data: null,
        cv_summary: null,
        notes: note,
      })
      .eq('id', candidate.id)

    if (updateError) throw updateError

    try {
      const result = await rescoreRecruitmentApplication(application.id, null, supabase)
      console.log(`[${SCRIPT_NAME}] OK  ${repair.name}: ${application.ai_score} (${application.ai_recommendation}) -> ${result.application.ai_score} (${result.application.ai_recommendation})${result.scoringError ? ` scoring-error=${result.scoringError}` : ''}`)
    } catch (rescoreError) {
      console.error(`[${SCRIPT_NAME}] FAIL ${repair.name} rescore: ${describeError(rescoreError)}`)
    }
  }

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm (+ env guards) to apply.`)
    return
  }
  console.log(`[${SCRIPT_NAME}] done`)
}

// ---- Mutation guards (project convention) ----
if (process.argv.includes('--confirm')) {
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
