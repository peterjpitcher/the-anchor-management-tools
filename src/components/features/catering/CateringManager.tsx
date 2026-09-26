'use client'

import { useState } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Tabs, Icon } from '@/ds'
import { Button } from '@/ds'
import { Badge } from '@/ds'
import { DataTable, Column } from '@/ds'
import { Empty } from '@/ds'
import { CateringPackageModal } from './CateringPackageModal'
import { useRouter } from 'next/navigation'

interface CateringManagerProps {
    initialPackages: CateringPackage[]
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

export function CateringManager({ initialPackages }: CateringManagerProps) {
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
                <Badge tone={pkg.active ? 'success' : 'neutral'} size="sm">
                    {pkg.active ? 'Active' : 'Inactive'}
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
                    leftIcon={<Icon name="edit" size={14} />}
                >
                    Edit
                </Button>
            )
        }
    ]

    const categoryLabels: Record<string, string> = {
        food: 'Food',
        drink: 'Drinks',
        addon: 'Add-on',
        self_catering: 'Self-catering',
        other: 'Other'
    }

    const renderTable = (category: string) => {
        const packages = initialPackages.filter(pkg => pkg.category === category)
        const categoryLabel = categoryLabels[category] ?? category

        if (packages.length === 0) {
            return (
                <div className="py-12">
                    <Empty
                        icon={<Icon name="sparkles" size={48} className="text-text-subtle" />}
                        title={`No ${categoryLabel.toLowerCase()} packages yet`}
                        description="Get started by creating your first package."
                        action={
                            <Button onClick={handleAdd} leftIcon={<Icon name="plus" size={16} />}>
                                Add {categoryLabel} Package
                            </Button>
                        }
                    />
                </div>
            )
        }

        return (
            <DataTable
                columns={columns}
                data={packages}
                onRowClick={(pkg) => handleEdit(pkg)}
                clickableRows
                getRowKey={(pkg) => pkg.id}
            />
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <Button onClick={handleAdd} leftIcon={<Icon name="plus" size={16} />}>
                    Add Package
                </Button>
            </div>

            <Tabs
                variant="underline"
                items={[
                    {
                        key: 'food',
                        label: 'Food',
                        content: <div className="pt-4">{renderTable('food')}</div>
                    },
                    {
                        key: 'drink',
                        label: 'Drinks',
                        content: <div className="pt-4">{renderTable('drink')}</div>
                    },
                    {
                        key: 'addon',
                        label: 'Add-ons',
                        content: <div className="pt-4">{renderTable('addon')}</div>
                    },
                    {
                        key: 'self_catering',
                        label: 'Self-catering',
                        content: <div className="pt-4">{renderTable('self_catering')}</div>
                    },
                    {
                        key: 'other',
                        label: 'Other',
                        content: <div className="pt-4">{renderTable('other')}</div>
                    }
                ]}
            />

            <CateringPackageModal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                packageToEdit={editingPackage}
                onSuccess={handleSuccess}
            />
        </div>
    )
}
