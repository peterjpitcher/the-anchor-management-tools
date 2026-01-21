'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'
import { createWorkType, disableWorkType, getWorkTypes, updateWorkType } from '@/app/actions/oj-projects/work-types'
import {
  Briefcase,
  Check,
  LayoutDashboard,
  List,
  Plus,
  Save,
  Settings2,
  Trash2,
  Users
} from 'lucide-react'

export default function OJWorkTypesPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('oj_projects', 'view')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canCreate = hasPermission('oj_projects', 'create')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workTypes, setWorkTypes] = useState<any[]>([])

  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }
    load()
  }, [permissionsLoading, canView])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await getWorkTypes()
      if (res.error) throw new Error(res.error)
      setWorkTypes(res.workTypes || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work types')
    } finally {
      setLoading(false)
    }
  }

  async function addWorkType(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreate) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('name', name)
      const res = await createWorkType(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Work type added')
      setName('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add work type')
    } finally {
      setSaving(false)
    }
  }

  async function saveRow(row: any) {
    if (!canEdit) return
    const fd = new FormData()
    fd.append('id', row.id)
    fd.append('name', row.name)
    fd.append('sort_order', String(row.sort_order ?? 0))
    fd.append('is_active', String(!!row.is_active))
    const res = await updateWorkType(fd)
    if (res.error) throw new Error(res.error)
  }

  async function disableRow(id: string) {
    if (!canEdit) return
    const fd = new FormData()
    fd.append('id', id)
    const res = await disableWorkType(fd)
    if (res.error) throw new Error(res.error)
  }

  if (permissionsLoading || loading) {
    return <PageLayout title="Work Types" subtitle="OJ Projects" loading loadingLabel="Loading Work Types…" />
  }

  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', active: true, icon: <List className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title="Work Types"
      subtitle="Categorize time entries"
      navItems={navItems}
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* List Column */}
        <div className="md:col-span-2">
          <Card
            header={
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-gray-400" />
                <CardTitle>Active Work Types</CardTitle>
              </div>
            }
          >
            {workTypes.length === 0 ? (
              <div className="text-center py-6 text-gray-500">No work types found.</div>
            ) : (
              <div className="space-y-3">
                {workTypes.map((wt) => (
                  <div key={wt.id} className="group border rounded-md p-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-white hover:bg-gray-50 transition-colors">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                      <div className="sm:col-span-2">
                        <Input
                          value={wt.name}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setWorkTypes((prev) => prev.map((p) => (p.id === wt.id ? { ...p, name: e.target.value } : p)))
                          }
                          className="bg-transparent border-transparent hover:border-gray-200 focus:bg-white transition-colors"
                          placeholder="Type Name"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="0"
                          value={wt.sort_order ?? 0}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setWorkTypes((prev) =>
                              prev.map((p) => (p.id === wt.id ? { ...p, sort_order: e.target.valueAsNumber } : p))
                            )
                          }
                          className="bg-transparent border-transparent hover:border-gray-200 focus:bg-white transition-colors"
                          placeholder="Order"
                          leftElement={<span className="text-gray-400 pl-2 text-xs">#</span>}
                        />
                        <select
                          className="w-24 border-transparent bg-transparent hover:border-gray-200 focus:bg-white rounded-md px-2 py-1.5 text-sm disabled:cursor-not-allowed transition-colors"
                          value={wt.is_active ? 'yes' : 'no'}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setWorkTypes((prev) =>
                              prev.map((p) => (p.id === wt.id ? { ...p, is_active: e.target.value === 'yes' } : p))
                            )
                          }
                        >
                          <option value="yes">Active</option>
                          <option value="no">Inactive</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        className="text-green-600 hover:text-green-700 hover:bg-green-50"
                        disabled={!canEdit}
                        onClick={async () => {
                          try {
                            await saveRow(wt)
                            toast.success('Saved')
                            await load()
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Failed to save')
                          }
                        }}
                        title="Save Changes"
                        aria-label="Save changes"
                      >
                        <Save className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-700 hover:bg-red-50"
                        disabled={!canEdit}
                        onClick={async () => {
                          try {
                            await disableRow(wt.id)
                            toast.success('Disabled')
                            await load()
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Failed to disable')
                          }
                        }}
                        title="Disable"
                        aria-label="Disable work type"
                      >
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Create Column */}
        <div>
          <Card
            header={
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-gray-400" />
                <CardTitle>Add New</CardTitle>
              </div>
            }
          >
            <form onSubmit={addWorkType} className="space-y-4">
              <FormGroup label="Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={!canCreate} placeholder="e.g. Development" />
              </FormGroup>
              <Button type="submit" loading={saving} disabled={!canCreate || saving} className="w-full">
                Add Work Type
              </Button>
              {!canCreate && (
                <div className="text-xs text-gray-500 text-center">Read-only access.</div>
              )}
            </form>
          </Card>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-600">
            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Usage Tips
            </h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Work types help categorize billable time on invoices.</li>
              <li>Common types: Development, Design, Meeting, Support.</li>
              <li>Sort order determines the display order in dropdowns.</li>
            </ul>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
