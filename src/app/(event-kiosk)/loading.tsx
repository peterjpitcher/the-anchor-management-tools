import { PageLoading } from '@/ds'

/**
 * Route loading for a screen outside the app shell. The page draws its own frame once its data
 * arrives, so until then this fills the viewport with the page background and the one spinner.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-bg">
      <PageLoading />
    </div>
  )
}
