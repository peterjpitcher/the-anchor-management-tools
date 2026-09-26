'use client'

import { useState } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Alert, Badge, Button, Card, DataTable, Empty, Icon, PageLayout, Tabs, type Column } from '@/ds'
import { CateringPackageModal } from './CateringPackageModal'
import { useRouter } from 'next/navigation'
import { PB_BACK_TO_LIST, PB_SETTINGS_NAV } from '@/app/(authenticated)/private-bookings/_shared/nav'
import { settingsActiveLabel, settingsActiveTone } from '@/app/(authenticated)/private-bookings/_shared/status-ui'

interface CateringManagerProps {
    initialPackages: CateringPackage[]
    /** A failed load of the packages: the page shows the error, never an empty list. */
    loadError?: string | null
    /** The error a create, update or delete redirected back with (?error=). */
    errorMessage?: string | null
}

const layoutProps = {
    title: 'Catering Packages',
    subtitle: 'Manage food and drink options for private events',
    backButton: PB_BACK_TO_LIST,
    navItems: PB_SETTINGS_NAV,
}

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

export function CateringManager({ initialPackages, loadError = null, errorMessage = null }: CateringManagerProps) {
    const router = useRouter()
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
                <span className="text-text">{pkg.minimum_guests ?? '—'}</span>
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
        // Title Case: these name the Empty state's "Add ... Package" button.
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
                        description="Get started by creating your first package."
                        action={
                            <Button onClick={handleAdd} icon={<Icon name="plus" size={16} />}>
                                Add {categoryLabel} Package
                            </Button>
                        }
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
                    Add Package
                </Button>
            }
        >
            {errorMessage && (
                <Alert tone="danger" title="Error">
                    {errorMessage}
                </Alert>
            )}

            <Tabs
                tabs={[
                    { id: 'food', label: 'Food', content: renderTable('food') },
                    { id: 'drink', label: 'Drinks', content: renderTable('drink') },
                    { id: 'addon', label: 'Add-Ons', content: renderTable('addon') },
                    { id: 'self_catering', label: 'Self-Catering', content: renderTable('self_catering') },
                    { id: 'other', label: 'Other', content: renderTable('other') },
                ]}
            />

            <CateringPackageModal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                packageToEdit={editingPackage}
                onSuccess={handleSuccess}
            />
        </PageLayout>
    )
}
