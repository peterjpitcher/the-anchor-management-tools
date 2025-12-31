-- Create Enums
CREATE TYPE "public"."hiring_job_status" AS ENUM ('draft', 'open', 'closed', 'archived');
CREATE TYPE "public"."hiring_application_stage" AS ENUM (
  'new',
  'screening',
  'screened',
  'interview_scheduled',
  'interviewed',
  'offer',
  'hired',
  'rejected',
  'withdrawn'
);
CREATE TYPE "public"."hiring_candidate_source" AS ENUM (
  'website',
  'indeed',
  'linkedin',
  'referral',
  'walk_in',
  'agency',
  'other'
);

-- Job Templates
CREATE TABLE "public"."hiring_job_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "title" text NOT NULL,
  "description" text, -- JSON or HTML content
  "prerequisites" jsonb DEFAULT '[]'::jsonb, -- Essential checks
  "screening_config" jsonb DEFAULT '{}'::jsonb, -- Validation rules/questions
  "email_templates" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "created_by" uuid REFERENCES auth.users(id)
);

-- Jobs (Postings)
CREATE TABLE "public"."hiring_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "slug" text UNIQUE, -- for website URL
  "title" text NOT NULL,
  "status" "public"."hiring_job_status" DEFAULT 'draft'::"public"."hiring_job_status" NOT NULL,
  "location" text DEFAULT 'The Anchor, TW19 6AQ',
  "employment_type" text, -- Full-time, Part-time, etc.
  "salary_range" text,
  "description" text, -- HTML
  "requirements" jsonb DEFAULT '[]'::jsonb,
  "screening_questions" jsonb DEFAULT '[]'::jsonb,
  "posting_date" timestamp with time zone,
  "closing_date" timestamp with time zone,
  "template_id" uuid REFERENCES "public"."hiring_job_templates"("id"),
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "created_by" uuid REFERENCES auth.users(id)
);

-- Candidates
CREATE TABLE "public"."hiring_candidates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "location" text,
  "resume_url" text, -- Path in storage
  "parsed_data" jsonb DEFAULT '{}'::jsonb, -- AI extracted data
  "search_vector" tsvector, -- For full text search
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
-- Create index for deduplication checks
CREATE INDEX idx_candidates_email ON "public"."hiring_candidates" ("email");
CREATE INDEX idx_candidates_phone ON "public"."hiring_candidates" ("phone");

-- Applications
CREATE TABLE "public"."hiring_applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "job_id" uuid REFERENCES "public"."hiring_jobs"("id") NOT NULL,
  "candidate_id" uuid REFERENCES "public"."hiring_candidates"("id") NOT NULL,
  "stage" "public"."hiring_application_stage" DEFAULT 'new'::"public"."hiring_application_stage" NOT NULL,
  "source" "public"."hiring_candidate_source" DEFAULT 'website'::"public"."hiring_candidate_source",
  "ai_score" integer, -- 0-10
  "ai_recommendation" text,
  "ai_screening_result" jsonb, -- detailed analysis
  "screener_answers" jsonb, -- from website form
  "interview_date" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  UNIQUE("job_id", "candidate_id")
);

-- Notes
CREATE TABLE "public"."hiring_notes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "entity_type" text NOT NULL CHECK (entity_type IN ('candidate', 'application')),
  "entity_id" uuid NOT NULL,
  "content" text NOT NULL,
  "author_id" uuid REFERENCES auth.users(id) NOT NULL,
  "is_private" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

-- Enable RLS
ALTER TABLE "public"."hiring_job_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."hiring_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."hiring_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."hiring_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."hiring_notes" ENABLE ROW LEVEL SECURITY;

-- Policies (Simplified for now - authenticated users with permissions)
-- Realistically we should check for specific permissions, but for this migration we'll start broad for authenticated staff
CREATE POLICY "Staff can view templates" ON "public"."hiring_job_templates" FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can manage templates" ON "public"."hiring_job_templates" FOR ALL TO authenticated USING (true);

CREATE POLICY "Public read open jobs" ON "public"."hiring_jobs" FOR SELECT USING (status = 'open');
CREATE POLICY "Staff manage jobs" ON "public"."hiring_jobs" FOR ALL TO authenticated USING (true);

-- Candidates: Staff can view all, Create allowed for public (application flow)
CREATE POLICY "Staff view candidates" ON "public"."hiring_candidates" FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert candidates" ON "public"."hiring_candidates" FOR INSERT WITH CHECK (true); -- Public/Server allow
CREATE POLICY "Staff update candidates" ON "public"."hiring_candidates" FOR UPDATE TO authenticated USING (true);

-- Applications: Staff view all, Create allowed for public
CREATE POLICY "Staff view applications" ON "public"."hiring_applications" FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert applications" ON "public"."hiring_applications" FOR INSERT WITH CHECK (true);
CREATE POLICY "Staff update applications" ON "public"."hiring_applications" FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Staff manage notes" ON "public"."hiring_notes" FOR ALL TO authenticated USING (true);


-- Update Employees Check Constraint
-- We need to drop the existing check and add a new one that includes 'Prospective'
-- NOTE: We wrap this in a DO block to safely handle constraint names
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Find constraints on employees table related to status
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND conname LIKE '%status%' LOOP
        EXECUTE 'ALTER TABLE "public"."employees" DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- Clean up legacy data now that constraints are gone
UPDATE "public"."employees" SET "status" = 'Inactive' WHERE "status" = 'Former';

-- Re-add the constraint with the new value
ALTER TABLE "public"."employees" 
ADD CONSTRAINT "employees_status_check" 
CHECK (status IN ('Active', 'Inactive', 'Suspended', 'Prospective'));
