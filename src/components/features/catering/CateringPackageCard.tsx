'use client'

import { CateringPackage } from '@/types/private-bookings'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { PencilIcon } from '@heroicons/react/24/outline'

interface CateringPackageCardProps {
    package: CateringPackage
    onEdit: (pkg: CateringPackage) => void
}

export function CateringPackageCard({ package: pkg, onEdit }: CateringPackageCardProps) {
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: 'GBP'
        }).format(amount)
    }

    const getServingStyleLabel = (style: string) => {
        const styles: Record<string, string> = {
            'buffet': 'Buffet',
            'sit-down': 'Sit Down Meal',
            'canapes': 'Canapés',
            'drinks': 'Drinks Package',
            'pizza': 'Pizza',
            'other': 'Other'
        }
        return styles[style] || style
    }

    return (
        <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
            <div className="p-5 flex flex-col flex-1 gap-4">
                {/* Header */}
                <div className="flex justify-between items-start gap-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-gray-900 group-hover:text-green-600 transition-colors">
                                {pkg.name}
                            </h3>
                            <Badge variant={pkg.active ? 'success' : 'secondary'} size="sm">
                                {pkg.active ? 'Active' : 'Inactive'}
                            </Badge>
                        </div>
                        <p className="text-sm text-gray-500 font-medium">
                            {getServingStyleLabel(pkg.serving_style || 'other')}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="font-bold text-gray-900 text-lg">
                            {pkg.pricing_model === 'variable' && <span className="text-sm">Price on Request</span>}
                            {pkg.pricing_model === 'menu_priced' && <span className="text-sm">Priced from our menu</span>}
                            {pkg.pricing_model === 'free' && <span className="text-sm">No catering charge</span>}
                            {['per_head', 'total_value', 'per_jar', 'per_tray'].includes(pkg.pricing_model || '') && (
                                formatCurrency(pkg.cost_per_head)
                            )}
                        </div>
                        <div className="text-xs text-gray-500 uppercase tracking-wider">
                            {pkg.pricing_model === 'total_value' && 'Total'}
                            {pkg.pricing_model === 'variable' && 'Variable'}
                            {pkg.pricing_model === 'menu_priced' && 'Variable'}
                            {pkg.pricing_model === 'free' && 'Free'}
                            {pkg.pricing_model === 'per_head' && 'Per Person'}
                            {pkg.pricing_model === 'per_jar' && 'Per Jar'}
                            {pkg.pricing_model === 'per_tray' && 'Per Tray'}
                        </div>
                    </div>
                </div>

                {/* Description */}
                {pkg.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">
                        {pkg.description}
                    </p>
                )}

                <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                    <div>
                        {pkg.minimum_guests ? (
                            <span>Min {pkg.minimum_guests} guests</span>
                        ) : (
                            <span>No minimum</span>
                        )}
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(pkg)}
                        leftIcon={<PencilIcon className="h-3.5 w-3.5" />}
                    >
                        Edit
                    </Button>
                </div>
            </div>
        </Card>
    )
}
