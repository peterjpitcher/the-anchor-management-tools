import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ResetPasswordForm from './reset-password-form'

export default async function ResetPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login?redirectedFrom=%2Fauth%2Freset')
  }

  return <ResetPasswordForm email={user.email ?? undefined} />
}
