import { Card, CardBody, CardHeader, PageLoading } from '@/ds'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import EventTodosWidget from './EventTodosWidget'

interface EventTodosPanelProps {
  canManage: boolean
}

/**
 * Loads the outstanding todos on the server and streams them in under a
 * Suspense boundary, so a slow checklist read no longer holds the whole events
 * page back.
 */
export default async function EventTodosPanel({ canManage }: EventTodosPanelProps): Promise<React.JSX.Element> {
  const todosResult = await getChecklistTodos().catch(
    () =>
      ({ success: false, error: 'Unable to load outstanding todos' }) as Awaited<
        ReturnType<typeof getChecklistTodos>
      >,
  )

  return (
    <EventTodosWidget
      initialTodos={todosResult.items ?? []}
      canManage={canManage}
      todayIso={getTodayIsoDate()}
      loadError={todosResult.success ? null : todosResult.error ?? 'Unable to load outstanding todos'}
    />
  )
}

/** Shown in the todos column while the panel streams in. */
export function EventTodosPanelFallback(): React.JSX.Element {
  return (
    <div className="xl:sticky xl:top-6">
      <Card>
        <CardHeader title="Outstanding Todos" />
        <CardBody>
          <PageLoading inline label="Loading outstanding todos" />
        </CardBody>
      </Card>
    </div>
  )
}
