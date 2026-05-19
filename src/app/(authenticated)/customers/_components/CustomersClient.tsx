'use client'

import { useEffect, useState, useMemo, useCallback, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Customer } from '@/types/database'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import dynamic from 'next/dynamic'

const CustomerImport = dynamic(
  () => import('@/components/features/customers/CustomerImport').then(mod => mod.CustomerImport),
  { ssr: false }
)
import { CustomerName } from '@/components/features/customers/CustomerName'
import { CustomerLabelDisplay } from '@/components/features/customers/CustomerLabelDisplay'
import type { CustomerLabelAssignment } from '@/app/actions/customer-labels'
import type { CustomerCategoryStats, CustomerListResult } from '@/app/actions/customers'
import {
  createCustomer as createCustomerAction,
  updateCustomer as updateCustomerAction,
  deleteCustomer as deleteCustomerAction,
  importCustomers as importCustomersAction,
  getCustomerList,
} from '@/app/actions/customers'

import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Stat,
  Badge,
  Button,
  Avatar,
  Checkbox,
  SearchInput,
  Select,
  Skeleton,
  Empty,
  ConfirmDialog,
  IconButton,
  Tabs,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
} from '@/ds'

/* ---------- Toast helper (re-use existing) ---------- */
import { toast } from '@/ds'

/* ---------- SVG Icons ---------- */
const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
)
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
)
const MessageIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CustomersClientProps {
  initialData: CustomerListResult
  initialPage: number
  initialPageSize: number
  initialSearch: string
  initialShowDeactivated: boolean
  canManageCustomers: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomersClient({
  initialData,
  initialPage,
  initialPageSize,
  initialSearch,
  initialShowDeactivated,
  canManageCustomers,
}: CustomersClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [customers, setCustomers] = useState<Customer[]>(initialData.customers)
  const [totalCount, setTotalCount] = useState(initialData.totalCount)
  const [customerPreferences, setCustomerPreferences] = useState<
    Record<string, CustomerCategoryStats[]>
  >(initialData.customerPreferences)
  const [customerLabels, setCustomerLabels] = useState<
    Record<string, CustomerLabelAssignment[]>
  >(initialData.customerLabels)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    initialData.unreadCounts
  )

  const [searchTerm, setSearchTerm] = useState(initialSearch)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [showDeactivated, setShowDeactivated] = useState(initialShowDeactivated)
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Form / UI state
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [, startTransition] = useTransition()

  // URL sync
  const pushParams = useCallback(
    (updates: { page?: number; search?: string; deactivated?: boolean; size?: number }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (updates.page !== undefined) {
        if (updates.page <= 1) params.delete('page')
        else params.set('page', String(updates.page))
      }
      if (updates.search !== undefined) {
        if (updates.search === '') params.delete('search')
        else params.set('search', updates.search)
      }
      if (updates.deactivated !== undefined) {
        if (!updates.deactivated) params.delete('deactivated')
        else params.set('deactivated', '1')
      }
      if (updates.size !== undefined) {
        if (updates.size === 50) params.delete('size')
        else params.set('size', String(updates.size))
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      })
    },
    [pathname, router, searchParams]
  )

  // Data fetching
  const fetchPage = useCallback(
    async (opts: { page: number; size: number; search: string; deactivated: boolean }) => {
      setIsFetching(true)
      try {
        const result = await getCustomerList({
          page: opts.page, pageSize: opts.size, searchTerm: opts.search, showDeactivated: opts.deactivated,
        })
        setCustomers(result.customers)
        setTotalCount(result.totalCount)
        setCustomerPreferences(result.customerPreferences)
        setCustomerLabels(result.customerLabels)
        setUnreadCounts(result.unreadCounts)
        if (result.error) toast.error(result.error)
      } catch {
        toast.error('Failed to load customers')
      } finally {
        setIsFetching(false)
      }
    },
    []
  )

  const isFirstMount = useMemo(() => ({ value: true }), [])
  useEffect(() => {
    if (isFirstMount.value) { isFirstMount.value = false; return }
    fetchPage({ page: currentPage, size: pageSize, search: searchTerm, deactivated: showDeactivated })
  }, [currentPage, fetchPage, isFirstMount, pageSize, searchTerm, showDeactivated])

  // Filter handlers
  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term); setCurrentPage(1); pushParams({ search: term, page: 1 })
  }, [pushParams])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page); pushParams({ page })
  }, [pushParams])

  const handleFilterChange = useCallback((deactivated: boolean) => {
    setShowDeactivated(deactivated); setCurrentPage(1); pushParams({ deactivated, page: 1 })
  }, [pushParams])

  const refreshCurrentPage = useCallback(() => {
    fetchPage({ page: currentPage, size: pageSize, search: searchTerm, deactivated: showDeactivated })
  }, [currentPage, fetchPage, pageSize, searchTerm, showDeactivated])

  const totalPages = Math.ceil(totalCount / pageSize)

  // CRUD handlers (preserved from original)
  const handleCreateCustomer = useCallback(
    async (customerData: Omit<Customer, 'id' | 'created_at'>) => {
      if (!canManageCustomers) { toast.error('You do not have permission to manage customers.'); return }
      try {
        const formData = new FormData()
        formData.append('first_name', customerData.first_name)
        formData.append('last_name', customerData.last_name ?? '')
        formData.append('mobile_number', customerData.mobile_number ?? '')
        formData.append('default_country_code', '44')
        if (customerData.email) formData.append('email', customerData.email)
        formData.append('sms_opt_in', 'on')
        const result = await createCustomerAction(formData)
        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Failed to create customer'); return
        }
        toast.success('Customer created successfully')
        setShowForm(false); refreshCurrentPage()
      } catch { toast.error('Failed to create customer') }
    },
    [canManageCustomers, refreshCurrentPage]
  )

  const handleUpdateCustomer = useCallback(
    async (customerData: Omit<Customer, 'id' | 'created_at'>) => {
      if (!editingCustomer || !canManageCustomers) return
      try {
        const formData = new FormData()
        formData.append('first_name', customerData.first_name)
        formData.append('last_name', customerData.last_name ?? '')
        formData.append('mobile_number', customerData.mobile_number ?? '')
        formData.append('default_country_code', '44')
        if (customerData.email) formData.append('email', customerData.email)
        formData.append('sms_opt_in', editingCustomer.sms_opt_in !== false ? 'on' : 'off')
        const result = await updateCustomerAction(editingCustomer.id, formData)
        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Failed to update customer'); return
        }
        toast.success('Customer updated successfully')
        setEditingCustomer(null); setShowForm(false); refreshCurrentPage()
      } catch { toast.error('Failed to update customer') }
    },
    [canManageCustomers, editingCustomer, refreshCurrentPage]
  )

  const handleDeleteCustomer = useCallback(
    async (customer: Customer) => {
      if (!canManageCustomers) { toast.error('You do not have permission.'); return }
      setDeleteTarget(customer)
    },
    [canManageCustomers]
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const result = await deleteCustomerAction(deleteTarget.id)
      if ('error' in result && result.error) throw new Error(result.error)
      toast.success('Customer deleted successfully'); refreshCurrentPage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete customer')
    } finally { setDeleteTarget(null) }
  }, [deleteTarget, refreshCurrentPage])

  const handleImportCustomers = useCallback(
    async (customersData: Omit<Customer, 'id' | 'created_at'>[]) => {
      if (!canManageCustomers) { toast.error('You do not have permission.'); return }
      try {
        const result = await importCustomersAction(
          customersData.map(c => ({
            first_name: c.first_name, last_name: c.last_name ?? '', mobile_number: c.mobile_number ?? '', email: c.email ?? undefined,
          }))
        )
        if ('error' in result && result.error) {
          toast.error(typeof result.error === 'string' ? result.error : 'Failed to import customers'); return
        }
        if (!('success' in result) || !result.success) { toast.error('Failed to import customers'); return }
        const skippedTotal = (result.skippedInvalid ?? 0) + (result.skippedDuplicateInFile ?? 0) + (result.skippedExisting ?? 0)
        let msg = `Imported ${result.created ?? 0} customers`
        if (skippedTotal > 0) msg += ` (${skippedTotal} skipped)`
        toast.success(msg); setShowImport(false); refreshCurrentPage()
      } catch { toast.error('Failed to import customers') }
    },
    [canManageCustomers, refreshCurrentPage]
  )

  const openCreateCustomer = useCallback(() => {
    if (!canManageCustomers) { toast.error('No permission.'); return }
    setEditingCustomer(null); setShowForm(true)
  }, [canManageCustomers])

  const openImportCustomers = useCallback(() => {
    if (!canManageCustomers) { toast.error('No permission.'); return }
    setShowImport(true)
  }, [canManageCustomers])

  const startEditCustomer = useCallback((customer: Customer) => {
    if (!canManageCustomers) { toast.error('No permission.'); return }
    setEditingCustomer(customer); setShowForm(true)
  }, [canManageCustomers])

  // Toggle selection
  const toggleSel = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === customers.length ? new Set() : new Set(customers.map(c => c.id))
    )
  }, [customers])

  // --- Form/Import subviews ---
  if (showForm || editingCustomer) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: editingCustomer ? 'Edit Customer' : 'New Customer' }]}
          title={editingCustomer ? 'Edit Customer' : 'Create New Customer'}
        />
        <Card>
          <CardBody>
            <CustomerForm
              customer={editingCustomer ?? undefined}
              onSubmit={editingCustomer ? handleUpdateCustomer : handleCreateCustomer}
              onCancel={() => { setShowForm(false); setEditingCustomer(null) }}
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  if (showImport) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Import' }]}
          title="Import Customers"
          subtitle="Import multiple customers from a CSV file"
        />
        <CustomerImport
          onImportComplete={handleImportCustomers}
          onCancel={() => setShowImport(false)}
          existingCustomers={customers}
        />
      </div>
    )
  }

  // --- Main list view ---
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: 'Customers' }]}
        title="Customers"
        subtitle={`${totalCount.toLocaleString()} customers`}
        actions={
          canManageCustomers ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={openImportCustomers}>Import</Button>
              <Button variant="primary" size="sm" icon={<PlusIcon />} onClick={openCreateCustomer}>
                Add customer
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Total customers" value={totalCount.toLocaleString()} />
        <Stat label="SMS Active" value={String(customers.filter(c => c.sms_opt_in !== false).length)} />
        <Stat label="SMS Deactivated" value={String(customers.filter(c => c.sms_opt_in === false).length)} />
        <Stat label="This page" value={String(customers.length)} hint={`of ${totalCount}`} />
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'active', label: 'SMS Active' },
          { id: 'deactivated', label: 'Deactivated' },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          setTab(id)
          if (id === 'deactivated') handleFilterChange(true)
          else handleFilterChange(false)
        }}
      />

      {/* Filter/Search bar + Table */}
      <Card>
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <SearchInput
            value={searchTerm}
            onChange={handleSearch}
            placeholder="Search by name, phone, or email..."
            className="w-80"
          />
          <div className="flex-1" />
          {selected.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">{selected.size} selected</span>
              <Button size="sm" icon={<MessageIcon />}>SMS</Button>
              <Button size="sm">Email</Button>
            </div>
          ) : (
            <span className="text-xs text-text-muted">
              {customers.length} of {totalCount.toLocaleString()}
            </span>
          )}
        </div>

        {isFetching ? (
          <CardBody>
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </CardBody>
        ) : customers.length === 0 ? (
          <CardBody>
            <Empty
              title="No customers found"
              description="Adjust your search or add a new customer."
              action={
                canManageCustomers ? (
                  <Button size="sm" onClick={openCreateCustomer}>Add Customer</Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9">
                    <Checkbox aria-label="Select all" checked={selected.size === customers.length && customers.length > 0} onChange={toggleAll} />
                  </TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead>Preferences</TableHead>
                  <TableHead>Contact</TableHead>
                  {canManageCustomers && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map(customer => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Checkbox aria-label="Select customer" checked={selected.has(customer.id)} onChange={() => toggleSel(customer.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={`${customer.first_name} ${customer.last_name || ''}`} size="md" />
                        <div>
                          <Link href={`/customers/${customer.id}`} className="text-[13px] font-semibold text-text-strong hover:text-primary">
                            <CustomerName customer={customer} />
                          </Link>
                          {unreadCounts[customer.id] > 0 && (
                            <Badge tone="primary" className="ml-1.5">{unreadCounts[customer.id]}</Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <CustomerLabelDisplay assignments={customerLabels[customer.id] || []} />
                      </div>
                    </TableCell>
                    <TableCell>
                      {customerPreferences[customer.id]?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {customerPreferences[customer.id].slice(0, 2).map(pref => (
                            <Badge key={pref.category_id} tone="success">
                              {pref.event_categories.name}
                              {pref.times_attended > 1 && <span className="ml-0.5">x{pref.times_attended}</span>}
                            </Badge>
                          ))}
                          {customerPreferences[customer.id].length > 2 && (
                            <span className="text-xs text-text-subtle">+{customerPreferences[customer.id].length - 2}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-subtle">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-[11px] text-text-muted">
                        {customer.mobile_number || '--'}
                        {customer.email && <div>{customer.email}</div>}
                      </div>
                      {customer.sms_opt_in === false && <Badge tone="danger">SMS off</Badge>}
                    </TableCell>
                    {canManageCustomers && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <IconButton icon={<PencilIcon />} label="Edit" size="sm" onClick={() => startEditCustomer(customer)} />
                          <IconButton icon={<TrashIcon />} label="Delete" size="sm" variant="danger" onClick={() => handleDeleteCustomer(customer)} />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={totalCount}
                pageSize={pageSize}
                onPageChange={handlePageChange}
              />
            )}
          </>
        )}
      </Card>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Customer"
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.first_name}${deleteTarget.last_name ? ` ${deleteTarget.last_name}` : ''}? This will also delete all their bookings.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
