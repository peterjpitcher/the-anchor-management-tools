import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

import PerformerSubmissionClient from './performer-submission-client'
import type { PerformerSubmission } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function PerformerSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('performer_submissions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    if (error && error.code !== 'PGRST116') {
      console.error('Error loading performer submission:', error)
    }
    notFound()
  }

  return <PerformerSubmissionClient submission={data as PerformerSubmission} />
}

