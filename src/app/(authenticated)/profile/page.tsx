import { loadProfile } from '@/app/actions/profile'
import { ProfileClient, type Profile } from './_components/ProfileClient'

/** Loads the profile on the server so the screen arrives filled in, not as an empty shell. */
export default async function ProfilePage(): Promise<React.JSX.Element> {
  const result = await loadProfile()

  if (!result || 'error' in result) {
    return <ProfileClient initialProfile={null} initialError={result?.error || 'Failed to load profile'} />
  }

  return <ProfileClient initialProfile={result.profile as Profile} />
}
