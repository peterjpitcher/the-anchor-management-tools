'use client'

import { useState } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { PlusIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { CateringPackageCard } from './CateringPackageCard'
import { CateringPackageModal } from './CateringPackageModal'
import { useRouter } from 'next/navigation'

interface CateringManagerProps {
    initialPackages: CateringPackage[]
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

    const filterPackages = (category: string) => {
        return initialPackages.filter(pkg => pkg.category === category)
    }

    const renderPackageList = (category: string) => {
        const packages = filterPackages(category)

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in duration-500">
                {packages.map(pkg => (
                    <CateringPackageCard
                        key={pkg.id}
                        package={pkg}
                        onEdit={handleEdit}
                    />
                ))}

                {/* Quick Add Card */}
                <button
                    onClick={handleAdd}
                    className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all group h-full min-h-[200px]"
                >
                    <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-3">
                        <PlusIcon className="h-5 w-5 text-gray-500 group-hover:text-green-600" />
                    </div>
                    <span className="font-medium text-gray-900 group-hover:text-green-700">Add New Package</span>
                </button>
            </div>
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
                        content: <div className="pt-6">{renderPackageList('food')}</div>
                    },
                    {
                        key: 'drink',
                        label: 'Drinks',
                        content: <div className="pt-6">{renderPackageList('drink')}</div>
                    },
                    {
                        key: 'addon',
                        label: 'Add-ons',
                        content: <div className="pt-6">{renderPackageList('addon')}</div>
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
