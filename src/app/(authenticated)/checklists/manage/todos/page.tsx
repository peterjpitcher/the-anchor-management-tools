import { listTodos } from '@/app/actions/checklists-todos'
import { TodosClient } from '../_components/TodosClient'

export default async function ChecklistTodosPage() {
  const res = await listTodos()
  return <TodosClient initial={res.data ?? []} error={res.error} />
}
