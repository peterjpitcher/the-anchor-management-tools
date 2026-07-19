'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { Button, Field, Input, Textarea, Select, Modal, ModalActions } from '@/ds'
import { createChecklist, updateChecklist } from '@/app/actions/checklists-admin'
import type { AdminChecklist } from '@/app/actions/checklists-admin'
import { DEPARTMENT_OPTIONS } from './format'

interface ChecklistModalProps {
  open: boolean
  checklist?: AdminChecklist
  onClose: () => void
}

function numOrZero(s: string): number {
  const n = Number(s.trim())
  return Number.isNaN(n) ? 0 : n
}

export function ChecklistModal({ open, checklist, onClose }: ChecklistModalProps) {
  const router = useRouter()
  const isEdit = Boolean(checklist)

  const [name, setName] = useState(checklist?.name ?? '')
  const [description, setDescription] = useState(checklist?.description ?? '')
  const [department, setDepartment] = useState(checklist?.department ?? 'bar')
  const [sortOrder, setSortOrder] = useState(String(checklist?.sortOrder ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed when a different checklist (or a fresh create) is opened.
  const key = checklist?.id ?? 'new'
  const [lastKey, setLastKey] = useState(key)
  if (open && key !== lastKey) {
    setName(checklist?.name ?? '')
    setDescription(checklist?.description ?? '')
    setDepartment(checklist?.department ?? 'bar')
    setSortOrder(String(checklist?.sortOrder ?? 0))
    setError(null)
    setLastKey(key)
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        department,
        sortOrder: numOrZero(sortOrder),
      }
      const res = isEdit
        ? await updateChecklist(checklist!.id, payload)
        : await createChecklist(payload)
      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success(isEdit ? 'Checklist updated' : 'Checklist created')
      onClose()
      router.refresh()
    } catch {
      const message = 'Something went wrong saving the checklist'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="md"
      title={isEdit ? 'Edit checklist' : 'New checklist'}
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} loading={saving}>
            {isEdit ? 'Save checklist' : 'Create checklist'}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-default border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
            {error}
          </p>
        )}
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bar Opening" />
        </Field>
        <Field label="Description">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" required>
            <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort order">
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
