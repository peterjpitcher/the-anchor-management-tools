'use client'

import { useState } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { PlusIcon, SparklesIcon, PencilIcon } from '@heroicons/react/24/outline'
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
                    <p className="font-medium text-gray-900">{pkg.name}</p>
                    {pkg.summary && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{pkg.summary}</p>
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
                <span className="font-medium text-gray-900 whitespace-nowrap">{formatPrice(pkg)}</span>
            )
        },
        {
            key: 'minimum_guests',
            header: 'Min Guests',
            sortable: true,
            align: 'center',
            hideOnMobile: true,
            cell: (pkg: CateringPackage) => (
                <span className="text-gray-700">{pkg.minimum_guests ?? '—'}</span>
            )
        },
        {
            key: 'status',
            header: 'Status',
            align: 'center',
            cell: (pkg: CateringPackage) => (
                <Badge variant={pkg.active ? 'success' : 'secondary'} size="sm">
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
                    leftIcon={<PencilIcon className="h-3.5 w-3.5" />}
                >
                    Edit
                </Button>
            )
        }
    ]

    const renderTable = (category: string) => {
        const packages = initialPackages.filter(pkg => pkg.category === category)

        if (packages.length === 0) {
            return (
                <div className="py-12">
                    <EmptyState
                        icon={<SparklesIcon className="h-12 w-12 text-gray-400" />}
                        title={`No ${category} packages yet`}
                        description="Get started by creating your first package."
                        action={
                            <Button onClick={handleAdd} leftIcon={<PlusIcon className="h-4 w-4" />}>
                                Add {category === 'addon' ? 'Add-on' : category} Package
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
                <Button onClick={handleAdd} leftIcon={<PlusIcon className="h-4 w-4" />}>
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
