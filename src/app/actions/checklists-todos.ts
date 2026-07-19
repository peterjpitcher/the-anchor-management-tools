'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'

// Todos (spec 3.6 / 15). One-off, non-recurring jobs. Not scored, never an instance.
// The `checklist_todos` table is RLS deny-all, so every read/write goes through the admin
// client after checkUserPermission('checklists','manage'). Shape modelled on mileage.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoView {
  id: string
  title: string
  description: string | null
  department: string | null
  assignedEmployeeId: string | null
  assignedEmployeeName: string | null
  dueDate: string | null
  state: 'open' | 'done' | 'cancelled'
  completedByName: string | null
  completedAt: string | null
  notes: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const createTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  description: z.string().max(2000, 'Description must be 2000 characters or less').optional().or(z.literal('')),
  department: z.string().max(50).optional().or(z.literal('')),
  assignedEmployeeId: z.string().uuid('Invalid employee').optional().or(z.literal('')),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional().or(z.literal('')),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireChecklistsManage(): Promise<{ userId: string; userEmail: string }> {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { userId: user_id, userEmail: user_email ?? '' }
}

const stateRank = (state: string): number => (state === 'open' ? 0 : 1)

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listTodos(
  includeDone = false,
): Promise<{ data?: TodoView[]; error?: string }> {
  try {
    await requireChecklistsManage()
    const db = createAdminClient()

    let query = db
      .from('checklist_todos')
      .select(
        'id, title, description, department, assigned_employee_id, due_date, state, completed_by_employee_id, completed_at, notes, created_at',
      )
    if (!includeDone) {
      query = query.eq('state', 'open')
    }

    const { data: rows, error } = await query
    if (error) throw error
    const todos = rows ?? []

    // Resolve assigned/completed employee names from the employees table.
    const employeeIds = new Set<string>()
    for (const t of todos) {
      if (t.assigned_employee_id) employeeIds.add(t.assigned_employee_id as string)
      if (t.completed_by_employee_id) employeeIds.add(t.completed_by_employee_id as string)
    }
    const nameMap = new Map<string, string>()
    if (employeeIds.size > 0) {
      const { data: employees, error: empError } = await db
        .from('employees')
        .select('employee_id, first_name, last_name')
        .in('employee_id', Array.from(employeeIds))
      if (empError) throw empError
      for (const e of employees ?? []) {
        nameMap.set(
          e.employee_id as string,
          [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown',
        )
      }
    }

    const result: TodoView[] = todos.map((t) => ({
      id: t.id as string,
      title: t.title as string,
      description: (t.description as string | null) ?? null,
      department: (t.department as string | null) ?? null,
      assignedEmployeeId: (t.assigned_employee_id as string | null) ?? null,
      assignedEmployeeName: t.assigned_employee_id
        ? nameMap.get(t.assigned_employee_id as string) ?? null
        : null,
      dueDate: (t.due_date as string | null) ?? null,
      state: t.state as TodoView['state'],
      completedByName: t.completed_by_employee_id
        ? nameMap.get(t.completed_by_employee_id as string) ?? null
        : null,
      completedAt: (t.completed_at as string | null) ?? null,
      notes: (t.notes as string | null) ?? null,
      createdAt: t.created_at as string,
    }))

    // Open first (by due date, nulls last, then created), then closed rows most-recent first.
    result.sort((a, b) => {
      const sr = stateRank(a.state) - stateRank(b.state)
      if (sr !== 0) return sr
      if (a.state === 'open') {
        if (a.dueDate && b.dueDate) {
          return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt)
        }
        if (a.dueDate) return -1
        if (b.dueDate) return 1
        return a.createdAt.localeCompare(b.createdAt)
      }
      const at = a.completedAt ?? a.createdAt
      const bt = b.completedAt ?? b.createdAt
      return bt.localeCompare(at)
    })

    return { data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load todos'
    return { error: message }
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createTodo(input: {
  title: string
  description?: string
  department?: string
  assignedEmployeeId?: string
  dueDate?: string
}): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const { userId } = await requireChecklistsManage()

    const parsed = createTodoSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const db = createAdminClient()
    const { data: created, error } = await db
      .from('checklist_todos')
      .insert({
        title: parsed.data.title,
        description: parsed.data.description?.trim() || null,
        department: parsed.data.department || null,
        assigned_employee_id: parsed.data.assignedEmployeeId || null,
        due_date: parsed.data.dueDate || null,
        state: 'open',
        created_by: userId,
      })
      .select('id')
      .single()
    if (error) throw error

    await logAuditEvent({
      user_id: userId,
      operation_type: 'create',
      resource_type: 'checklist_todo',
      resource_id: created.id,
      operation_status: 'success',
      new_values: {
        title: parsed.data.title,
        department: parsed.data.department || null,
        due_date: parsed.data.dueDate || null,
      },
    })

    revalidatePath('/checklists/manage/todos')
    return { success: true, id: created.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create todo'
    return { error: message }
  }
}

export async function completeTodo(
  id: string,
  completedByEmployeeId?: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireChecklistsManage()
    const db = createAdminClient()
    const now = new Date().toISOString()

    const { data: updated, error } = await db
      .from('checklist_todos')
      .update({
        state: 'done',
        completed_by_employee_id: completedByEmployeeId || null,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('state', 'open')
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!updated) return { error: 'Todo not found or already closed' }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'checklist_todo',
      resource_id: id,
      operation_status: 'success',
      new_values: { state: 'done', completed_by_employee_id: completedByEmployeeId || null },
    })

    revalidatePath('/checklists/manage/todos')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete todo'
    return { error: message }
  }
}

export async function cancelTodo(id: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireChecklistsManage()
    const db = createAdminClient()
    const now = new Date().toISOString()

    const { data: updated, error } = await db
      .from('checklist_todos')
      .update({
        state: 'cancelled',
        updated_at: now,
      })
      .eq('id', id)
      .eq('state', 'open')
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!updated) return { error: 'Todo not found or already closed' }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'checklist_todo',
      resource_id: id,
      operation_status: 'success',
      new_values: { state: 'cancelled' },
    })

    revalidatePath('/checklists/manage/todos')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel todo'
    return { error: message }
  }
}
