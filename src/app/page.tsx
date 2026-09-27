import { redirect } from 'next/navigation'

/** The app has no home page of its own: the root sends everyone to the dashboard. */
export default function Home(): never {
  redirect('/dashboard')
}
