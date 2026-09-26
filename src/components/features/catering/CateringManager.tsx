'use client'

import { useState } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Alert, Badge, Button, Card, DataTable, Empty, Icon, PageLayout, Segmented, type Column, type HeaderNavItem } from '@/ds'
import { CateringPackageModal } from './CateringPackageModal'
import { useRouter } from 'next/navigation'
import { PB_BACK_TO_LIST, PB_SETTINGS_TITLE } from '@/app/(authenticated)/private-bookings/_shared/nav'
import { settingsActiveLabel, settingsActiveTone } from '@/app/(authenticated)/private-bookings/_shared/status-ui'

interface CateringManagerProps {
    initialPackages: CateringPackage[]
    /** A failed load of the packages: the page shows the error, never an empty list. */
    loadError?: string | null
    /** The error a create, update or delete redirected back with (?error=). */
    errorMessage?: string | null
    /** The settings tab row, already filtered by permission (privateBookingSettingsNav). */
    navItems: HeaderNavItem[]
}

// The settings tab row is this page's one tab row, so the categories switch with a Segmented.
const CATEGORY_OPTIONS = [
    { id: 'food', label: 'Food' },
    { id: 'drink', label: 'Drinks' },
    { id: 'addon', label: 'Add-Ons' },
    { id: 'self_catering', label: 'Self-Catering' },
    { id: 'other', label: 'Other' },
]

const formatPrice = (pkg: CateringPackage): string => {
    const amount = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pkg.cost_per_head)
    switch (pkg.pricing_model) {
        case 'per_head':    return `${amount} / person`
        case 'per_jar':     return `${amount} / jar`
        case 'per_tray':    return `${amount} / tray`
        case 'total_value': return `${amount} total`
        case 'variable':    return 'Price on request'
        case 'menu_priced': return 'Menu priced'
        case 'free':        return 'No charge'
        default:            return amount
    }
}

export function CateringManager({ initialPackages, loadError = null, errorMessage = null, navItems }: CateringManagerProps) {
    const router = useRouter()
    const [category, setCategory] = useState(CATEGORY_OPTIONS[0].id)
    const layoutProps = {
        title: PB_SETTINGS_TITLE,
        subtitle: 'Catering: packages for private events',
        backButton: PB_BACK_TO_LIST,
        navItems,
    }
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingPackage, setEditingPackage] = useState<CateringPackage | null>(null)

    const handleAdd = () => {
        setEditingPackage(null)
        setIsModalOpen(true)
    }

    const handleEdit = (pkg: CateringPackage) => {
        setEditingPackage(pkg)
        setIsModalOpen(true)
    }

    const handleSuccess = () => {
        router.refresh()
    }

    const columns: Column<CateringPackage>[] = [
        {
            key: 'name',
            header: 'Package',
            sortable: true,
            cell: (pkg: CateringPackage) => (
                <div>
                    <p className="font-medium text-text">{pkg.name}</p>
                    {pkg.summary && (
                        <p className="text-sm text-text-muted mt-0.5 line-clamp-1">{pkg.summary}</p>
                    )}
                </div>
            )
        },
        {
            key: 'price',
            header: 'Price',
            sortable: true,
            sortFn: (a: CateringPackage, b: CateringPackage) => a.cost_per_head - b.cost_per_head,
            hideOnMobile: true,
            cell: (pkg: CateringPackage) => (
                <span className="font-medium text-text whitespace-nowrap">{formatPrice(pkg)}</span>
            )
        },
        {
            key: 'minimum_guests',
            header: 'Min Guests',
            sortable: true,
            align: 'center',
            hideOnMobile: true,
            cell: (pkg: CateringPackage) => (
                <span className="text-text">{pkg.minimum_guests ?? 'None'}</span>
            )
        },
        {
            key: 'status',
            header: 'Status',
            align: 'center',
            cell: (pkg: CateringPackage) => (
                <Badge tone={settingsActiveTone(pkg.active)} size="sm">
                    {settingsActiveLabel(pkg.active)}
                </Badge>
            )
        },
        {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (pkg: CateringPackage) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(pkg)}
                    icon={<Icon name="edit" size={14} />}
                >
                    Edit
                </Button>
            )
        }
    ]

    const categoryLabels: Record<string, string> = {
        food: 'Food',
        drink: 'Drinks',
        addon: 'Add-On',
        self_catering: 'Self-Catering',
        other: 'Other'
    }

    const renderTable = (category: string) => {
        const packages = initialPackages.filter(pkg => pkg.category === category)
        const categoryLabel = categoryLabels[category] ?? category

        if (packages.length === 0) {
            return (
                <Card>
                    <Empty
                        size="sm"
                        icon={<Icon name="sparkles" size={48} />}
                        title={`No ${categoryLabel.toLowerCase()} packages yet`}
                        description="Create your first package with New Package."
                    />
                </Card>
            )
        }

        return (
            <Card padding="none">
                <DataTable
                    columns={columns}
                    data={packages}
                    onRowClick={(pkg) => handleEdit(pkg)}
                    clickableRows
                    bordered={false}
                    getRowKey={(pkg) => pkg.id}
                />
            </Card>
        )
    }

    if (loadError) {
        return <PageLayout {...layoutProps} error={loadError} />
    }

    return (
        <PageLayout
            {...layoutProps}
            headerActions={
                <Button size="sm" variant="primary" onClick={handleAdd} icon={<Icon name="plus" size={16} />}>
                    New Package
                </Button>
            }
        >
            {errorMessage && (
                <Alert tone="danger" title="Error">
                    {errorMessage}
                </Alert>
            )}

            <div className="flex flex-wrap items-end gap-3">
                <Segmented
                    aria-label="Package category"
                    options={CATEGORY_OPTIONS}
                    value={category}
                    onChange={setCategory}
                    className="max-w-full overflow-x-auto"
                />
            </div>

            {renderTable(category)}

            <CateringPackageModal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                packageToEdit={editingPackage}
                onSuccess={handleSuccess}
            />
        </PageLayout>
    )
}
