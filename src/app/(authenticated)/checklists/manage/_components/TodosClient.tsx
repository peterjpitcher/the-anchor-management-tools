'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Modal,
  PageLayout,
  Select,
  Switch,
  Textarea,
  toast,
} from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { listTodos, createTodo, completeTodo, cancelTodo, type TodoView } from '@/app/actions/checklists-todos'
import { CHECKLISTS_MANAGE_LAYOUT } from '../../_shared/nav'
import { CHECKLIST_TODO_STATUS } from '../../_shared/status-ui'

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'No department' },
  { value: 'bar', label: 'Bar' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'runner', label: 'Runner' },
  { value: 'host', label: 'Host' },
  { value: 'cleaning', label: 'Cleaning' },
]

function departmentLabel(dept: string): string {
  if (!dept) return ''
  return dept.charAt(0).toUpperCase() + dept.slice(1)
}

function formatDueDate(iso: string): string {
  return formatDateInLondon(iso, { day: '2-digit', month: 'short', year: 'numeric' })
}

interface TodosClientProps {
  initial: TodoView[]
  error?: string
}

export function TodosClient({ initial, error }: TodosClientProps) {
  const router = useRouter()
  const [todos, setTodos] = useState<TodoView[]>(initial)
  const [showClosed, setShowClosed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)

  // New-todo form state.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState('')
  const [dueDate, setDueDate] = useState('')

  const reload = useCallback(async (includeDone: boolean) => {
    const res = await listTodos(includeDone)
    if (res.error) {
      toast.error(res.error)
      return
    }
    setTodos(res.data ?? [])
  }, [])

  function handleToggleClosed(next: boolean) {
    setShowClosed(next)
    void reload(next)
  }

  function resetForm() {
    setTitle('')
    setDescription('')
    setDepartment('')
    setDueDate('')
  }

  async function handleCreate() {
    if (title.trim() === '') {
      toast.error('Enter a title')
      return
    }
    setSubmitting(true)
    const res = await createTodo({
      title: title.trim(),
      description: description.trim() || undefined,
      department: department || undefined,
      dueDate: dueDate || undefined,
    })
    setSubmitting(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Todo added')
    setModalOpen(false)
    resetForm()
    await reload(showClosed)
    router.refresh()
  }

  async function handleDone(id: string) {
    const res = await completeTodo(id)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Marked done')
    await reload(showClosed)
    router.refresh()
  }

  async function handleCancel(id: string) {
    const res = await cancelTodo(id)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Todo cancelled')
    await reload(showClosed)
    router.refresh()
  }

  if (error) {
    return (
      <PageLayout {...CHECKLISTS_MANAGE_LAYOUT}>
        <Alert tone="danger" title="Could not load todos">
          {error}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      {...CHECKLISTS_MANAGE_LAYOUT}
      headerActions={
        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
          New Todo
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <Switch
          checked={showClosed}
          onChange={handleToggleClosed}
          label="Show completed and cancelled"
        />
      </div>

      {todos.length === 0 ? (
        <Card>
          <Empty title="No todos" description="There is nothing to do here right now." />
        </Card>
      ) : (
        <div className="space-y-2">
          {todos.map((todo) => {
            const isOpen = todo.state === 'open'
            return (
              <Card key={todo.id}>
                <CardBody className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text">{todo.title}</span>
                      {todo.department && (
                        <Badge tone="neutral">{departmentLabel(todo.department)}</Badge>
                      )}
                      {todo.state !== 'open' && (
                        <Badge tone={CHECKLIST_TODO_STATUS[todo.state].tone}>
                          {CHECKLIST_TODO_STATUS[todo.state].label}
                        </Badge>
                      )}
                    </div>
                    {todo.description && (
                      <p className="mt-1 text-xs text-text-muted">{todo.description}</p>
                    )}
                    <p className="mt-1 text-xs text-text-soft">
                      {todo.dueDate ? `Due ${formatDueDate(todo.dueDate)}` : 'No due date'}
                      {todo.assignedEmployeeName ? ` · Assigned to ${todo.assignedEmployeeName}` : ''}
                      {todo.state === 'done' && todo.completedByName
                        ? ` · Completed by ${todo.completedByName}`
                        : ''}
                    </p>
                  </div>
                  {isOpen && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handleDone(todo.id)}>
                        Mark Done
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setCancelId(todo.id)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Todo"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} loading={submitting} disabled={submitting}>
              Add Todo
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing"
              disabled={submitting}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label="Department">
            <Select
              options={DEPARTMENT_OPTIONS}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        onConfirm={async () => {
          if (cancelId) await handleCancel(cancelId)
        }}
        title="Cancel Todo"
        message="Cancel this todo?"
        confirmLabel="Cancel Todo"
        cancelLabel="Keep It"
        tone="danger"
      />
    </PageLayout>
  )
}
