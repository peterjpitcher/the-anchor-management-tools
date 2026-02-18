'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getRecurringCharges } from '@/app/actions/oj-projects/recurring-charges'
import { getVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { createMileageEntry, createTimeEntry, deleteEntry, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
import { getOjProjectsEmailStatus } from '@/app/actions/oj-projects/system'
import type { InvoiceVendor } from '@/types/invoices'
import { BarChart } from '@/components/charts/BarChart'
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Edit2,
  Hourglass,
  LayoutDashboard,
  List,
  MapPin,
  Plus,
  Trash2,
  Users,
  Wallet
} from 'lucide-react'
import { cn } from '@/lib/utils'

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCurrency(value: number) {
  return `£${value.toFixed(2)}`
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const toIso = (d: Date) => {
    const copy = new Date(d.getTime())
    const offsetMinutes = copy.getTimezoneOffset()
    copy.setMinutes(copy.getMinutes() - offsetMinutes)
    return copy.toISOString().split('T')[0]
  }
  return { start: toIso(start), end: toIso(end) }
}

type EntryFormState = {
  id?: string
  entry_type: 'time' | 'mileage'
  vendor_id: string
  project_id: string
  entry_date: string
  start_time: string
  duration_hours: number
  miles: string
  work_type_id: string
  description: string
  internal_notes: string
  billable: boolean
}

function toLondonTimeHm(iso: string | null) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/London',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function StatCard({
  label,
  value,
  icon: Icon,
  colorClass = "text-blue-600",
  bgClass = "bg-blue-50"
}: {
  label: string,
  value: string,
  icon: any,
  colorClass?: string,
  bgClass?: string
}) {
  return (
    <Card className="p-4 flex items-center gap-4 border-none shadow-sm ring-1 ring-gray-200">
      <div className={cn("p-3 rounded-full", bgClass, colorClass)}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-2xl font-semibold text-gray-900">{value}</p>
      </div>
    </Card>
  )
}

export default function OJProjectsDashboardPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('oj_projects', 'view')
  const canCreate = hasPermission('oj_projects', 'create')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [monthKey, setMonthKey] = useState(() => getTodayIsoDate().slice(0, 7))

  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [workTypes, setWorkTypes] = useState<any[]>([])
  const [monthEntries, setMonthEntries] = useState<any[]>([])
  const [recentEntries, setRecentEntries] = useState<any[]>([])


  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; senderEmail: string | null } | null>(null)

  const [vendorSettings, setVendorSettings] = useState<any | null>(null)
  const [vendorRecurringCharges, setVendorRecurringCharges] = useState<any[]>([])

  const [entryType, setEntryType] = useState<'time' | 'mileage'>('time')
  const [vendorId, setVendorId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [entryDate, setEntryDate] = useState(getTodayIsoDate())
  const [startTime, setStartTime] = useState('09:00')
  const [durationHoursInput, setDurationHoursInput] = useState('1')
  const [workTypeId, setWorkTypeId] = useState('')
  const [miles, setMiles] = useState<number>(0)
  const [description, setDescription] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [billable, setBillable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState<EntryFormState>({
    entry_type: 'time',
    vendor_id: '',
    project_id: '',
    entry_date: '',
    start_time: '09:00',
    duration_hours: 1.0,
    miles: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
  })

  // Work History Graph Logic (Moved to Top Level)
  const [historyRange, setHistoryRange] = useState<30 | 60 | 90>(30)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const historyData = useMemo(() => {
    if (!recentEntries.length) return []

    const now = new Date()
    const cutoffDate = new Date()
    cutoffDate.setDate(now.getDate() - historyRange)

    // Filter entries first
    const relevantEntries = recentEntries.filter(e => {
      const entryDate = new Date(e.entry_date)
      if (vendorId && e.vendor_id !== vendorId) return false
      return entryDate >= cutoffDate && entryDate <= now && e.entry_type === 'time'
    })

    const dataMap = new Map<string, number>()
    const formatLabel = (date: Date) => {
      if (historyRange === 30) return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) // 21 Jan
      if (historyRange === 60) {
        // Weekly: "w/c 21 Jan"
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Adjust to Monday
        const monday = new Date(date)
        monday.setDate(diff)
        return `w/c ${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      }
      return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) // Jan 26
    }

    // Sort Key generation for correct ordering
    const getSortKey = (date: Date) => {
      if (historyRange === 30) return date.toISOString().split('T')[0] // YYYY-MM-DD
      if (historyRange === 60) {
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1)
        const monday = new Date(date)
        monday.setDate(diff)
        return monday.toISOString().split('T')[0]
      }
      return date.toISOString().slice(0, 7) // YYYY-MM
    }

    relevantEntries.forEach(e => {
      const date = new Date(e.entry_date)
      const key = getSortKey(date)
      const hours = Number(e.duration_minutes_rounded || 0) / 60
      dataMap.set(key, (dataMap.get(key) || 0) + hours)
    })

    const chartData: { key: string; label: string; value: number; color: string }[] = []
    const iter = new Date(cutoffDate)

    // Normalize start date based on granularity
    if (historyRange === 60) {
      const day = iter.getDay()
      const diff = iter.getDate() - day + (day === 0 ? -6 : 1)
      iter.setDate(diff)
    } else if (historyRange === 90) {
      iter.setDate(1) // Start of month
    }

    while (iter <= now) {
      const key = getSortKey(iter)
      const label = formatLabel(iter)

      // Check if we already added this key (for weekly/monthly iterations)
      if (!chartData.find(d => d.key === key)) {
        chartData.push({
          key, // for sorting/checking
          label,
          value: dataMap.get(key) || 0,
          color: '#3B82F6' // default blue
        })
      }

      // Increment
      if (historyRange === 30) iter.setDate(iter.getDate() + 1)
      else if (historyRange === 60) iter.setDate(iter.getDate() + 7)
      else iter.setMonth(iter.getMonth() + 1)
    }

    return chartData
  }, [recentEntries, historyRange, vendorId])


  const selectedMonth = useMemo(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
    if (!match) return monthRange(new Date())

    const year = Number(match[1])
    const monthIndex = Number(match[2]) - 1
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return monthRange(new Date())

    return monthRange(new Date(year, monthIndex, 1))
  }, [monthKey])

  const monthTotals = useMemo(() => {
    const totals = {
      hours: 0,
      unbilled_inc_vat: 0,
      billed_inc_vat: 0,
      paid_inc_vat: 0,
    }

    for (const entry of monthEntries) {
      if (!entry?.entry_date) continue
      if (vendorId && entry.vendor_id !== vendorId) continue

      let incVat = 0
      if (entry.entry_type === 'time') {
        const minutes = Number(entry.duration_minutes_rounded || 0)
        const hours = minutes / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        const vatRate = Number(entry.vat_rate_snapshot || 0)
        const exVat = hours * rate
        incVat = exVat + exVat * (vatRate / 100)
        totals.hours += hours
      } else if (entry.entry_type === 'mileage') {
        const milesVal = Number(entry.miles || 0)
        const rate = Number(entry.mileage_rate_snapshot || 0.42)
        incVat = milesVal * rate
      }

      incVat = roundCurrency(incVat)
      if (entry.status === 'paid') totals.paid_inc_vat += incVat
      else if (entry.status === 'billed') totals.billed_inc_vat += incVat
      else totals.unbilled_inc_vat += incVat
    }

    totals.unbilled_inc_vat = roundCurrency(totals.unbilled_inc_vat)
    totals.billed_inc_vat = roundCurrency(totals.billed_inc_vat)
    totals.paid_inc_vat = roundCurrency(totals.paid_inc_vat)
    totals.hours = roundCurrency(totals.hours)

    return totals
  }, [monthEntries])

  const selectedVendorName = useMemo(() => vendors.find((v) => v.id === vendorId)?.name || '', [vendors, vendorId])

  const selectedVendorSummary = useMemo(() => {
    if (!vendorId) return null

    const billableEntries = monthEntries.filter((e) => e.vendor_id === vendorId && e.billable !== false)

    let hours = 0
    let timeIncVat = 0
    let mileageIncVat = 0

    for (const entry of billableEntries) {
      if (entry.entry_type === 'time') {
        const minutes = Number(entry.duration_minutes_rounded || 0)
        const entryHours = minutes / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        const vatRate = Number(entry.vat_rate_snapshot || 0)
        const exVat = entryHours * rate
        const incVat = exVat + exVat * (vatRate / 100)
        hours += entryHours
        timeIncVat += incVat
      } else if (entry.entry_type === 'mileage') {
        const milesVal = Number(entry.miles || 0)
        const rate = Number(entry.mileage_rate_snapshot || 0.42)
        mileageIncVat += milesVal * rate
      }
    }

    const activeCharges = vendorRecurringCharges.filter((c) => c.is_active !== false)
    const recurringIncVat = activeCharges.reduce((acc, c) => {
      const exVat = Number(c.amount_ex_vat || 0)
      const vatRate = Number(c.vat_rate || 0)
      return acc + exVat + exVat * (vatRate / 100)
    }, 0)

    const totalIncVat = timeIncVat + mileageIncVat + recurringIncVat

    const billingMode = vendorSettings?.billing_mode === 'cap' ? 'cap' : 'full'
    const cap = billingMode === 'cap' && typeof vendorSettings?.monthly_cap_inc_vat === 'number'
      ? Number(vendorSettings.monthly_cap_inc_vat)
      : null

    const retainerHours = typeof vendorSettings?.retainer_included_hours_per_month === 'number'
      ? Number(vendorSettings.retainer_included_hours_per_month)
      : null

    return {
      billingMode,
      cap_inc_vat: cap != null ? roundCurrency(cap) : null,
      retainer_hours: retainerHours != null ? roundCurrency(retainerHours) : null,
      hours: roundCurrency(hours),
      time_inc_vat: roundCurrency(timeIncVat),
      mileage_inc_vat: roundCurrency(mileageIncVat),
      recurring_inc_vat: roundCurrency(recurringIncVat),
      total_inc_vat: roundCurrency(totalIncVat),
    }
  }, [monthEntries, vendorId, vendorRecurringCharges, vendorSettings])

  const vendorProjects = useMemo(() => {
    const entryPeriod = entryDate.slice(0, 7)
    const list = projects.filter((p) => p.vendor_id === vendorId)
    return [...list].sort((a: any, b: any) => {
      const aIsCurrentRetainer = !!a?.is_retainer && String(a?.retainer_period_yyyymm || '') === entryPeriod
      const bIsCurrentRetainer = !!b?.is_retainer && String(b?.retainer_period_yyyymm || '') === entryPeriod
      if (aIsCurrentRetainer !== bIsCurrentRetainer) return aIsCurrentRetainer ? -1 : 1

      const aRetainer = !!a?.is_retainer
      const bRetainer = !!b?.is_retainer
      if (aRetainer !== bRetainer) return aRetainer ? 1 : -1

      const aPeriod = String(a?.retainer_period_yyyymm || '')
      const bPeriod = String(b?.retainer_period_yyyymm || '')
      if (aRetainer && bRetainer && aPeriod !== bPeriod) return bPeriod.localeCompare(aPeriod)

      return String(a?.project_name || '').localeCompare(String(b?.project_name || ''))
    })
  }, [projects, vendorId, entryDate])

  const filteredProjects = useMemo(() => {
    if (!vendorId) return []
    return projects
      .filter((p) => p.vendor_id === vendorId && p.status === 'active')
      .sort((a, b) => a.project_name.localeCompare(b.project_name))
  }, [projects, vendorId])

  const filteredRecentEntries = useMemo(() => {
    if (!vendorId) return recentEntries
    return recentEntries.filter(e => e.vendor_id === vendorId)
  }, [recentEntries, vendorId])

  const selectedProject = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) || null : null),
    [projects, projectId]
  )

  const selectedProjectHours = useMemo(() => {
    if (!projectId) return null
    let minutes = 0
    for (const entry of monthEntries) {
      if (entry?.project_id !== projectId) continue
      if (entry?.entry_type !== 'time') continue
      minutes += Number(entry?.duration_minutes_rounded || 0)
    }
    return roundCurrency(minutes / 60)
  }, [monthEntries, projectId])

  const selectedProjectBudgetHours = useMemo(() => {
    if (!selectedProject) return null
    const raw = (selectedProject as any)?.budget_hours
    const num = raw != null ? Number(raw) : NaN
    if (!Number.isFinite(num) || num <= 0) return null
    return roundCurrency(num)
  }, [selectedProject])

  const selectedVendorRetainerProject = useMemo(() => {
    if (!vendorId) return null
    const period = monthKey
    return (
      projects.find(
        (p: any) =>
          String(p?.vendor_id || '') === vendorId &&
          !!p?.is_retainer &&
          String(p?.retainer_period_yyyymm || '') === period
      ) || null
    )
  }, [projects, vendorId, monthKey])

  const selectedVendorRetainerUsage = useMemo(() => {
    if (!selectedVendorRetainerProject) return null

    let minutes = 0
    for (const entry of monthEntries) {
      if (String(entry?.project_id || '') !== String(selectedVendorRetainerProject.id || '')) continue
      if (entry?.entry_type !== 'time') continue
      minutes += Number(entry?.duration_minutes_rounded || 0)
    }

    const hours = roundCurrency(minutes / 60)
    const budgetRaw = (selectedVendorRetainerProject as any)?.budget_hours ?? null
    const budgetNum = budgetRaw != null ? Number(budgetRaw) : NaN
    const budgetHours = Number.isFinite(budgetNum) && budgetNum > 0 ? roundCurrency(budgetNum) : null

    return { hours, budget_hours: budgetHours }
  }, [selectedVendorRetainerProject, monthEntries])

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }

    load()
  }, [permissionsLoading, canView, monthKey])

  useEffect(() => {
    if (!vendorId) {
      setVendorSettings(null)
      setVendorRecurringCharges([])
      return
    }

    let active = true

    async function loadVendorMeta() {
      try {
        const [settingsRes, chargesRes] = await Promise.all([
          getVendorBillingSettings(vendorId),
          getRecurringCharges(vendorId),
        ])

        if (!active) return

        if (settingsRes.error) throw new Error(settingsRes.error)
        if (chargesRes.error) throw new Error(chargesRes.error)

        setVendorSettings(settingsRes.settings || null)
        setVendorRecurringCharges(chargesRes.charges || [])
      } catch (err) {
        if (!active) return
        toast.error(err instanceof Error ? err.message : 'Failed to load client settings')
        setVendorSettings(null)
        setVendorRecurringCharges([])
      }
    }

    loadVendorMeta()
    return () => {
      active = false
    }
  }, [vendorId])

  useEffect(() => {
    if (!vendorId) return

    const entryPeriod = entryDate.slice(0, 7)
    const current = projectId ? projects.find((p) => p.id === projectId) || null : null
    const shouldAutoSelect =
      !projectId || (!!current?.is_retainer && String((current as any)?.retainer_period_yyyymm || '') !== entryPeriod)

    if (!shouldAutoSelect) return

    const retainerProject =
      projects.find(
        (p: any) =>
          String(p?.vendor_id || '') === vendorId &&
          !!p?.is_retainer &&
          String(p?.retainer_period_yyyymm || '') === entryPeriod
      ) || null

    if (retainerProject?.id) {
      setProjectId(String(retainerProject.id))
    }
  }, [projects, vendorId, entryDate, projectId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [vendorsRes, projectsRes, workTypesRes, monthEntriesRes, recentEntriesRes, emailStatusRes] = await Promise.all([
        getVendors(),
        getProjects({ status: 'active' }),
        getWorkTypes(),
        getEntries({ startDate: selectedMonth.start, endDate: selectedMonth.end, limit: 500 }),
        getEntries({ limit: 1000 }), // Increased limit for history graph
        getOjProjectsEmailStatus(),
      ])

      if (vendorsRes.error || !vendorsRes.vendors) throw new Error(vendorsRes.error || 'Failed to load vendors')
      if (projectsRes.error || !projectsRes.projects) throw new Error(projectsRes.error || 'Failed to load projects')
      if (workTypesRes.error || !workTypesRes.workTypes) throw new Error(workTypesRes.error || 'Failed to load work types')
      if (monthEntriesRes.error || !monthEntriesRes.entries) throw new Error(monthEntriesRes.error || 'Failed to load entries')
      if (recentEntriesRes.error || !recentEntriesRes.entries) throw new Error(recentEntriesRes.error || 'Failed to load entries')

      setVendors(vendorsRes.vendors)
      setProjects(projectsRes.projects)
      setWorkTypes(workTypesRes.workTypes)
      setMonthEntries(monthEntriesRes.entries)
      setRecentEntries(recentEntriesRes.entries)

      if (!emailStatusRes.error) {
        setEmailStatus({
          configured: !!(emailStatusRes as any).configured,
          senderEmail: (emailStatusRes as any).senderEmail ?? null,
        })
      } else {
        setEmailStatus(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      setEmailStatus(null)
    } finally {
      setLoading(false)
    }
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreate) {
      toast.error('You do not have permission to add entries')
      return
    }
    if (!vendorId || !projectId) {
      toast.error('Please select a client and a project')
      return
    }

    const parsedDurationHours = Number.parseFloat(durationHoursInput.trim())
    if (entryType === 'time' && (!Number.isFinite(parsedDurationHours) || parsedDurationHours <= 0)) {
      toast.error('Duration must be greater than 0')
      return
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', vendorId)
      fd.append('project_id', projectId)
      fd.append('entry_date', entryDate)
      fd.append('description', description)
      fd.append('internal_notes', internalNotes)
      fd.append('billable', String(billable))

      let res: any
      if (entryType === 'time') {
        fd.append('start_time', startTime)
        fd.append('duration_minutes', String(parsedDurationHours * 60))
        if (workTypeId) fd.append('work_type_id', workTypeId)
        res = await createTimeEntry(fd)
      } else {
        fd.append('miles', String(miles))
        res = await createMileageEntry(fd)
      }

      if (res?.error) throw new Error(res.error)

      toast.success('Entry added')
      if (res?.warning) {
        toast.warning(String(res.warning))
      }
      setDescription('')
      setInternalNotes('')
      setMiles(0)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add entry')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(entry: any) {
    if (!canEdit) {
      toast.error('You do not have permission to edit entries')
      return
    }
    if (entry.status !== 'unbilled') {
      toast.error('Only unbilled entries can be edited')
      return
    }

    const durationMinutes = Number(entry.duration_minutes_raw ?? entry.duration_minutes_rounded ?? 60)
    const durationHoursValue = durationMinutes > 0 ? durationMinutes / 60 : 1

    setEditForm({
      id: entry.id,
      entry_type: entry.entry_type,
      vendor_id: entry.vendor_id,
      project_id: entry.project_id,
      entry_date: entry.entry_date,
      start_time: toLondonTimeHm(entry.start_at) || '09:00',
      duration_hours: durationHoursValue,
      miles: entry.miles != null ? String(entry.miles) : '',
      work_type_id: entry.work_type_id || '',
      description: entry.description || '',
      internal_notes: entry.internal_notes || '',
      billable: entry.billable ?? true,
    })
    setIsEditOpen(true)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (!editForm.id) return

    setEditSaving(true)
    try {
      const fd = new FormData()
      fd.append('id', editForm.id)
      fd.append('entry_type', editForm.entry_type)
      fd.append('vendor_id', editForm.vendor_id)
      fd.append('project_id', editForm.project_id)
      fd.append('entry_date', editForm.entry_date)
      fd.append('description', editForm.description)
      fd.append('internal_notes', editForm.internal_notes)
      fd.append('billable', String(editForm.billable))

      if (editForm.entry_type === 'time') {
        fd.append('start_time', editForm.start_time)
        fd.append('duration_minutes', String(editForm.duration_hours * 60))
        fd.append('work_type_id', editForm.work_type_id || '')
      } else {
        fd.append('miles', editForm.miles)
      }

      const res = await updateEntry(fd)
      if (res?.error) throw new Error(res.error)

      toast.success('Entry updated')
      if ((res as any)?.warning) {
        toast.warning(String((res as any).warning))
      }
      setIsEditOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entry')
    } finally {
      setEditSaving(false)
    }
  }

  async function removeEntry(entry: any) {
    if (!canDelete) {
      toast.error('You do not have permission to delete entries')
      return
    }
    if (entry.status !== 'unbilled') {
      toast.error('Only unbilled entries can be deleted')
      return
    }
    if (!window.confirm('Delete this entry? This cannot be undone.')) return

    try {
      const fd = new FormData()
      fd.append('id', String(entry.id))
      const res = await deleteEntry(fd)
      if (res?.error) throw new Error(res.error)

      toast.success('Entry deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry')
    }
  }

  if (permissionsLoading || loading) {
    return (
      <PageLayout title="OJ Projects" subtitle="Time tracking and billing" loading loadingLabel="Loading OJ Projects…" />
    )
  }




  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', active: true, icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title="OJ Projects"
      subtitle="Log time and mileage against client projects"
      navItems={navItems}
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}
      {emailStatus && !emailStatus.configured && (
        <Alert
          variant="warning"
          className="mb-6"
          title="Email service not configured"
          description="Automated billing can create invoices, but emails will fail to send until Microsoft Graph is configured."
        />
      )}

      {/* Hero Stats */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-4 h-4" />
            <span className="font-medium">Summary for</span>
            <Input
              type="month"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className="py-1 px-2 h-auto text-sm w-auto"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Users className="w-4 h-4" />
            <span className="font-medium">Client</span>
            <Select
              value={vendorId}
              onChange={(e) => {
                const nextVendor = e.target.value
                setVendorId(nextVendor)
                // Auto-select retainer logic moved to useEffect
              }}
              className="py-1 px-2 h-auto text-sm w-[200px]"
            >
              <option value="">All Clients</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Hours"
            value={monthTotals.hours.toFixed(2)}
            icon={Clock}
            colorClass="text-blue-600"
            bgClass="bg-blue-50"
          />
          <StatCard
            label="Unbilled"
            value={formatCurrency(monthTotals.unbilled_inc_vat)}
            icon={Hourglass}
            colorClass="text-amber-600"
            bgClass="bg-amber-50"
          />
          <StatCard
            label="Billed"
            value={formatCurrency(monthTotals.billed_inc_vat)}
            icon={CheckCircle2}
            colorClass="text-green-600"
            bgClass="bg-green-50"
          />
          <StatCard
            label="Paid"
            value={formatCurrency(monthTotals.paid_inc_vat)}
            icon={Wallet}
            colorClass="text-purple-600"
            bgClass="bg-purple-50"
          />
        </div>

        {/* Quick Actions Row */}
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" className="bg-white shadow-sm ring-1 ring-gray-200 text-gray-700" onClick={() => router.push('/oj-projects/projects?new=1')}>
            <Plus className="w-4 h-4 mr-2" /> New Project
          </Button>
          <Button variant="secondary" size="sm" className="bg-white shadow-sm ring-1 ring-gray-200 text-gray-700" onClick={() => router.push('/oj-projects/clients')}>
            <Users className="w-4 h-4 mr-2" /> Manage Clients
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Quick Entry Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Work History Graph */}
            {/* Work History Graph */}
            <Card className="border-none shadow-sm ring-1 ring-gray-200 overflow-hidden">
              <div
                className="bg-gray-50/50 p-4 border-b border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              >
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h2 className="font-semibold text-gray-900">Work History</h2>
                </div>
                <div className="flex items-center gap-3">
                  {isHistoryOpen && (
                    <div className="flex bg-gray-100 p-0.5 rounded-lg" onClick={(e) => e.stopPropagation()}>
                      {[30, 60, 90].map((range) => (
                        <button
                          key={range}
                          type="button"
                          onClick={() => setHistoryRange(range as any)}
                          className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                            historyRange === range ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                          )}
                        >
                          {range} Days
                        </button>
                      ))}
                    </div>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full">
                    {isHistoryOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </Button>
                </div>
              </div>

              {isHistoryOpen && (
                <div className="p-6 h-[300px]">
                  <BarChart
                    data={historyData}
                    height={300}
                    color="#3B82F6"
                    showValues={historyRange === 30} // Only show values if not too crowded, or rely on component auto-hide
                    formatType="number"
                  />
                </div>
              )}
            </Card>
            <Card className="border-none shadow-sm ring-1 ring-gray-200 overflow-hidden">
              <div className="bg-gray-50/50 p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
                    <Plus className="w-4 h-4" />
                  </div>
                  <h2 className="font-semibold text-gray-900">Quick Entry</h2>
                </div>
                <div className="flex bg-gray-100 p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setEntryType('time')}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                      entryType === 'time' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Time
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType('mileage')}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                      entryType === 'mileage' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Mileage
                  </button>
                </div>
              </div>

              <div className="p-6">
                {(vendors.length === 0 || projects.length === 0 || (vendorId && vendorProjects.length === 0)) ? (
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-100 text-amber-900 text-sm">
                    <p className="font-medium mb-1">Setup Required</p>
                    <p className="opacity-80 mb-3">
                      {vendors.length === 0
                        ? "You need to add a client first."
                        : projects.length === 0
                          ? "You need to add a project first."
                          : "This client has no active projects."
                      }
                    </p>
                    <div className="flex gap-2">
                      {vendors.length === 0 && (
                        <Button size="sm" variant="secondary" onClick={() => router.push('/oj-projects/clients')}>Add Client</Button>
                      )}
                      {(projects.length === 0 || (vendorId && vendorProjects.length === 0)) && (
                        <Button size="sm" variant="secondary" onClick={() => router.push('/oj-projects/projects?new=1')}>Add Project</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={submitEntry} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormGroup label="Date" required>
                        <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                      </FormGroup>

                      <FormGroup label="Client" required>
                        <Select
                          value={vendorId}
                          onChange={(e) => {
                            const nextVendor = e.target.value
                            setVendorId(nextVendor)
                            const entryPeriod = entryDate.slice(0, 7)
                            const retainerProject =
                              projects.find(
                                (p: any) =>
                                  String(p?.vendor_id || '') === nextVendor &&
                                  !!p?.is_retainer &&
                                  String(p?.retainer_period_yyyymm || '') === entryPeriod
                              ) || null
                            setProjectId(retainerProject?.id ? String(retainerProject.id) : '')
                          }}
                          required
                        >
                          <option value="">Select a client...</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </Select>
                      </FormGroup>

                      <FormGroup label="Project" required>
                        <Select
                          value={projectId}
                          onChange={(e) => setProjectId(e.target.value)}
                          required
                          disabled={!vendorId}
                        >
                          <option value="">Select a project...</option>
                          {vendorProjects.map((p: any) => (
                            <option key={p.id} value={p.id}>
                              {p.project_code} — {p.project_name}{p.is_retainer && p.retainer_period_yyyymm ? ` (${p.retainer_period_yyyymm})` : ''}
                            </option>
                          ))}
                        </Select>
                      </FormGroup>

                      {selectedProjectBudgetHours != null && selectedProjectHours != null && (
                        <div className="md:col-span-2">
                          {selectedProjectHours > selectedProjectBudgetHours ? (
                            <div className="bg-red-50 text-red-800 text-xs p-3 rounded-md border border-red-100">
                              <strong>Hours Exceeded:</strong> {selectedProjectHours.toFixed(2)}h / {selectedProjectBudgetHours.toFixed(2)}h
                            </div>
                          ) : (
                            (() => {
                              const usage = selectedProjectBudgetHours > 0 ? selectedProjectHours / selectedProjectBudgetHours : 0
                              if (usage >= 0.9) {
                                return (
                                  <div className="bg-orange-50 text-orange-800 text-xs p-3 rounded-md border border-orange-100">
                                    <strong>Approaching Hours Limit:</strong> {selectedProjectHours.toFixed(2)}h ({Math.round(usage * 100)}% of {selectedProjectBudgetHours.toFixed(2)}h)
                                  </div>
                                )
                              }
                              return (
                                <div className="bg-gray-50 text-gray-700 text-xs p-3 rounded-md border border-gray-100">
                                  Hours: {selectedProjectHours.toFixed(2)}h / {selectedProjectBudgetHours.toFixed(2)}h
                                </div>
                              )
                            })()
                          )}
                        </div>
                      )}

                      {entryType === 'time' ? (
                        <>
                          <div className="flex gap-3">
                            <FormGroup label="Start" required className="flex-1">
                              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                            </FormGroup>
                            <FormGroup label="Duration" required className="flex-1">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={durationHoursInput}
                                onChange={(e) => setDurationHoursInput(e.target.value)}
                                required
                                rightElement={<span className="text-gray-500 text-xs mr-3">h</span>}
                              />
                            </FormGroup>
                          </div>

                          <FormGroup label="Work Type">
                            <Select value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)}>
                              <option value="">Unspecified</option>
                              {workTypes.filter((w) => w.is_active).map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </Select>
                          </FormGroup>
                        </>
                      ) : (
                        <FormGroup label="Miles" required>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={miles}
                            onChange={(e) => setMiles(parseFloat(e.target.value) || 0)}
                            required
                            rightElement={<span className="text-gray-500 text-xs mr-3">mi</span>}
                          />
                        </FormGroup>
                      )}
                    </div>

                    <FormGroup label="Description">
                      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you do?" />
                    </FormGroup>

                    <div className="flex items-center justify-between pt-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={billable}
                          onChange={(e) => setBillable(e.target.checked)}
                        />
                        Billable
                      </label>

                      <Button type="submit" loading={saving} disabled={!canCreate || saving}>
                        Add Entry
                      </Button>
                    </div>

                    {/* Internal notes revealed if needed or usually collapsed? keeping clear for now */}
                    <details className="text-xs text-gray-500">
                      <summary className="cursor-pointer hover:text-gray-700">Add internal notes...</summary>
                      <Textarea
                        className="mt-2"
                        value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        rows={2}
                        placeholder="Internal-only notes (not client-facing)"
                      />
                    </details>
                  </form>
                )}
              </div>
            </Card>

            <div className="pt-2">
              <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center justify-between">
                <span>Recent Activity</span>
                <Button variant="ghost" size="sm" onClick={() => router.push('/oj-projects/entries')} className="text-xs">
                  View All
                </Button>
              </h3>

              <div className="bg-white rounded-lg shadow-sm ring-1 ring-gray-200 overflow-hidden">
                {filteredRecentEntries.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No entries found</div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client/Project</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredRecentEntries.slice(0, 10).map(entry => (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span>{formatDateDdMmmmYyyy(entry.entry_date)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="font-medium">{entry.vendor?.name}</div>
                            <div className="text-gray-500 text-xs">{entry.project?.project_name}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="flex items-center gap-1.5">
                              {entry.entry_type === 'time' ? <Clock className="w-3.5 h-3.5 text-gray-400" /> : <MapPin className="w-3.5 h-3.5 text-gray-400" />}
                              {entry.entry_type === 'time' ? `${(entry.duration_minutes_rounded || 0) / 60}h` : `${entry.miles} mi`}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{entry.description || '-'}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize",
                              entry.status === 'paid' ? "bg-green-100 text-green-800" :
                                entry.status === 'billed' ? "bg-blue-100 text-blue-800" :
                                  "bg-gray-100 text-gray-800"
                            )}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEdit(entry)}
                                disabled={!canEdit || entry.status !== 'unbilled'}
                                title={entry.status === 'unbilled' ? 'Edit entry' : 'Only unbilled entries can be edited'}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                                  canEdit && entry.status === 'unbilled'
                                    ? "border-gray-200 text-gray-700 hover:bg-gray-50"
                                    : "border-gray-100 text-gray-300 cursor-not-allowed"
                                )}
                              >
                                <Edit2 className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removeEntry(entry)}
                                disabled={!canDelete || entry.status !== 'unbilled'}
                                title={entry.status === 'unbilled' ? 'Delete entry' : 'Only unbilled entries can be deleted'}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                                  canDelete && entry.status === 'unbilled'
                                    ? "border-red-200 text-red-700 hover:bg-red-50"
                                    : "border-gray-100 text-gray-300 cursor-not-allowed"
                                )}
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Client Meta */}
          <div className="space-y-6">
            {vendorId && selectedVendorSummary ? (
              <Card className="border-none shadow-sm ring-1 ring-gray-200 overflow-hidden bg-gradient-to-br from-white to-gray-50">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">{selectedVendorName}</h3>
                  <div className="text-xs text-gray-500 mt-1">
                    Billing: {selectedVendorSummary.billingMode === 'cap' ? 'Monthly Cap' : 'Full'}
                    {selectedVendorSummary.cap_inc_vat != null && ` • £${selectedVendorSummary.cap_inc_vat}`}
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {/* Mini stats for the client */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-2.5 rounded-lg ring-1 ring-gray-100">
                      <div className="text-xs text-gray-500 mb-1">Log Hours</div>
                      <div className="text-lg font-semibold text-gray-900">{selectedVendorSummary.hours.toFixed(2)}</div>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg ring-1 ring-gray-100">
                      <div className="text-xs text-gray-500 mb-1">Total (Inc VAT)</div>
                      <div className="text-lg font-semibold text-gray-900">{formatCurrency(selectedVendorSummary.total_inc_vat)}</div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Time</span>
                      <span className="font-medium text-gray-900">{formatCurrency(selectedVendorSummary.time_inc_vat)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Mileage</span>
                      <span className="font-medium text-gray-900">{formatCurrency(selectedVendorSummary.mileage_inc_vat)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Recurring</span>
                      <span className="font-medium text-gray-900">{formatCurrency(selectedVendorSummary.recurring_inc_vat)}</span>
                    </div>
                  </div>

                  {/* Alerts */}
                  {selectedVendorRetainerUsage?.budget_hours != null &&
                    selectedVendorRetainerUsage.hours > selectedVendorRetainerUsage.budget_hours && (
                      <div className="bg-orange-50 text-orange-800 text-xs p-3 rounded-md border border-orange-100">
                        <strong>Retainer Exceeded:</strong> {selectedVendorRetainerUsage.hours.toFixed(2)}h / {selectedVendorRetainerUsage.budget_hours.toFixed(2)}h
                      </div>
                    )}

                  {selectedVendorRetainerUsage?.budget_hours != null &&
                    selectedVendorRetainerUsage.hours <= selectedVendorRetainerUsage.budget_hours &&
                    (() => {
                      const usage = selectedVendorRetainerUsage.budget_hours > 0
                        ? selectedVendorRetainerUsage.hours / selectedVendorRetainerUsage.budget_hours
                        : 0

                      if (usage >= 0.9) {
                        return (
                          <div className="bg-orange-50 text-orange-800 text-xs p-3 rounded-md border border-orange-100">
                            <strong>Approaching Retainer:</strong> {selectedVendorRetainerUsage.hours.toFixed(2)}h ({Math.round(usage * 100)}% of {selectedVendorRetainerUsage.budget_hours.toFixed(2)}h)
                          </div>
                        )
                      }
                      return null
                    })()}

                  {selectedVendorSummary.billingMode === 'cap' && selectedVendorSummary.cap_inc_vat != null &&
                    (() => {
                      const cap = selectedVendorSummary.cap_inc_vat as number
                      const usage = cap > 0 ? selectedVendorSummary.total_inc_vat / cap : 0

                      if (selectedVendorSummary.total_inc_vat > cap) {
                        return (
                          <div className="bg-red-50 text-red-800 text-xs p-3 rounded-md border border-red-100">
                            <strong>Cap Exceeded:</strong> Total £{selectedVendorSummary.total_inc_vat.toFixed(2)} vs Cap £{cap.toFixed(2)}
                          </div>
                        )
                      }

                      if (usage >= 0.9) {
                        return (
                          <div className="bg-orange-50 text-orange-800 text-xs p-3 rounded-md border border-orange-100">
                            <strong>Approaching Cap:</strong> £{selectedVendorSummary.total_inc_vat.toFixed(2)} ({Math.round(usage * 100)}% of £{cap.toFixed(2)})
                          </div>
                        )
                      }

                      if (usage >= 0.8) {
                        return (
                          <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-md border border-amber-100">
                            <strong>Cap Usage:</strong> £{selectedVendorSummary.total_inc_vat.toFixed(2)} ({Math.round(usage * 100)}% of £{cap.toFixed(2)})
                          </div>
                        )
                      }

                      return (
                        <div className="text-xs text-gray-600">
                          Cap headroom: {formatCurrency(roundCurrency(cap - selectedVendorSummary.total_inc_vat))}
                        </div>
                      )
                    })()}
                </div>
              </Card>
            ) : (
              <Card className="border-none shadow-sm ring-1 ring-gray-200 p-4 bg-white">
                <h3 className="font-semibold text-gray-900 mb-3">Client Summary</h3>
                <div className="text-sm text-gray-500 mb-4">Select a client to view their monthly performance.</div>
                <FormGroup>
                  <Select
                    value={vendorId}
                    onChange={(e) => {
                      const nextVendor = e.target.value
                      setVendorId(nextVendor)
                      const entryPeriod = entryDate.slice(0, 7)
                      const retainerProject =
                        projects.find(
                          (p: any) =>
                            String(p?.vendor_id || '') === nextVendor &&
                            !!p?.is_retainer &&
                            String(p?.retainer_period_yyyymm || '') === entryPeriod
                        ) || null
                      setProjectId(retainerProject?.id ? String(retainerProject.id) : '')
                    }}
                  >
                    <option value="">Choose a client...</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
              </Card>
            )}



            {vendorId && filteredProjects.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Active Projects</h3>
                <div className="space-y-3">
                  {filteredProjects.map((project) => {
                    const isRetainer = !!project.is_retainer

                    // Budget Logic: Prefer Hours, fall back to Money
                    const budgetHours = Number(project.budget_hours || 0)
                    const budgetMoney = Number(project.budget_ex_vat || 0)

                    const hasHoursBudget = budgetHours > 0
                    const hasMoneyBudget = budgetMoney > 0

                    let usedDisplay = `${Number(project.total_hours_used || 0).toFixed(2)}h used`
                    let remainingDisplay: React.ReactNode = <span className="text-gray-400 italic">No budget</span>
                    let progress = 0

                    if (hasHoursBudget) {
                      const used = Number(project.total_hours_used || 0)
                      const remaining = Math.max(0, budgetHours - used)
                      progress = Math.min(100, (used / budgetHours) * 100)

                      usedDisplay = `${used.toFixed(2)}h used`
                      remainingDisplay = (
                        <span className={cn(
                          "font-medium",
                          remaining < 2 ? "text-orange-600" : "text-gray-900"
                        )}>
                          {remaining.toFixed(2)}h left
                        </span>
                      )
                    } else if (hasMoneyBudget) {
                      const used = Number(project.total_spend_ex_vat || 0)
                      const remaining = Math.max(0, budgetMoney - used)
                      progress = Math.min(100, (used / budgetMoney) * 100)

                      usedDisplay = `${formatCurrency(used)} used`
                      remainingDisplay = (
                        <span className={cn(
                          "font-medium",
                          remaining < (budgetMoney * 0.1) ? "text-orange-600" : "text-gray-900"
                        )}>
                          {formatCurrency(remaining)} left
                        </span>
                      )
                    }

                    // For retainers, check if it's the current period
                    const isCurrentRetainer = isRetainer && project.retainer_period_yyyymm === monthKey

                    return (
                      <Card key={project.id} className="p-4 flex flex-col gap-3 border-none shadow-sm ring-1 ring-gray-200 hover:ring-gray-300 transition-all bg-white">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h4 className="font-medium text-gray-900 text-sm truncate" title={project.project_name}>
                                {project.project_name}
                              </h4>
                            </div>
                            <p className="text-[10px] text-gray-500 font-mono">{project.project_code}</p>
                          </div>
                          {isRetainer && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded-full font-medium border whitespace-nowrap",
                              isCurrentRetainer
                                ? "bg-blue-50 text-blue-700 border-blue-100"
                                : "bg-gray-50 text-gray-600 border-gray-100"
                            )}>
                              {project.retainer_period_yyyymm || 'Retainer'}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1.5 mt-auto">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">{usedDisplay}</span>
                            {remainingDisplay}
                          </div>

                          {(hasHoursBudget || hasMoneyBudget) && (
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-500",
                                  progress > 100 ? "bg-red-500" :
                                    progress > 90 ? "bg-orange-500" :
                                      "bg-blue-600"
                                )}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[10px] h-6 px-2 ml-auto"
                            onClick={() => router.push(`/oj-projects/projects/${project.id}`)}
                          >
                            View
                          </Button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Entry">
        <form onSubmit={saveEdit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Type" required>
              <Select
                value={editForm.entry_type}
                onChange={(e) => setEditForm({ ...editForm, entry_type: e.target.value as any })}
                required
                disabled
              >
                <option value="time">Time</option>
                <option value="mileage">Mileage</option>
              </Select>
            </FormGroup>

            <FormGroup label="Date" required>
              <Input
                type="date"
                value={editForm.entry_date}
                onChange={(e) => setEditForm({ ...editForm, entry_date: e.target.value })}
                required
              />
            </FormGroup>

            <FormGroup label="Client" required>
              <Select
                value={editForm.vendor_id}
                onChange={(e) => setEditForm({ ...editForm, vendor_id: e.target.value, project_id: '' })}
                required
              >
                <option value="">Select a client</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Project" required>
              <Select
                value={editForm.project_id}
                onChange={(e) => setEditForm({ ...editForm, project_id: e.target.value })}
                required
                disabled={!editForm.vendor_id}
              >
                <option value="">Select a project</option>
                {projects
                  .filter((p) => p.vendor_id === editForm.vendor_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_code} — {p.project_name}
                    </option>
                  ))}
              </Select>
            </FormGroup>

            {editForm.entry_type === 'time' ? (
              <>
                <FormGroup label="Start" required>
                  <Input
                    type="time"
                    value={editForm.start_time}
                    onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })}
                    required
                  />
                </FormGroup>
                <FormGroup label="Duration (h)" required>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={editForm.duration_hours}
                    onChange={(e) => setEditForm({ ...editForm, duration_hours: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </FormGroup>

                <FormGroup label="Work Type">
                  <Select
                    value={editForm.work_type_id}
                    onChange={(e) => setEditForm({ ...editForm, work_type_id: e.target.value })}
                  >
                    <option value="">Unspecified</option>
                    {workTypes
                      .filter((w) => w.is_active)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </Select>
                </FormGroup>
              </>
            ) : (
              <FormGroup label="Miles" required>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={editForm.miles}
                  onChange={(e) => setEditForm({ ...editForm, miles: e.target.value })}
                  required
                />
              </FormGroup>
            )}

            <div className="md:col-span-2 pt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={editForm.billable}
                  onChange={(e) => setEditForm({ ...editForm, billable: e.target.checked })}
                />
                Billable Entry
              </label>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Description">
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </FormGroup>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Internal Notes">
                <Textarea
                  value={editForm.internal_notes}
                  onChange={(e) => setEditForm({ ...editForm, internal_notes: e.target.value })}
                  rows={3}
                />
              </FormGroup>
            </div>
          </div>

          <ModalActions>
            <Button type="button" variant="secondary" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={editSaving} disabled={!canEdit || editSaving}>
              Save Changes
            </Button>
          </ModalActions>
        </form>
      </Modal>

    </PageLayout>
  )
}
