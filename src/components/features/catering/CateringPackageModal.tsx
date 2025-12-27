'use client'

import { useState, useEffect } from 'react'
import { CateringPackage } from '@/types/private-bookings'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { createCateringPackage, updateCateringPackage, deleteCateringPackage } from '@/app/actions/privateBookingActions'
import { TrashIcon } from '@heroicons/react/24/outline'

interface CateringPackageModalProps {
    open: boolean
    onClose: () => void
    packageToEdit?: CateringPackage | null
    onSuccess: () => void
}

export function CateringPackageModal({
    open,
    onClose,
    packageToEdit,
    onSuccess
}: CateringPackageModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedPricingModel, setSelectedPricingModel] = useState<string>('per_head')

    // Reset state when opening/closing
    useEffect(() => {
        if (open) {
            setError(null)
            setSelectedPricingModel(packageToEdit?.pricing_model || 'per_head')
        }
    }, [open, packageToEdit])

    const isEditing = !!packageToEdit

    const handleSubmit = async (formData: FormData) => {
        setIsSubmitting(true)
        setError(null)

        try {
            let result

            const parseCost = (value: FormDataEntryValue | null) => {
                const parsed = parseFloat(value as string)
                return isNaN(parsed) ? 0 : parsed
            }

            if (isEditing && packageToEdit) {
                // Need to append the ID for update
                formData.append('packageId', packageToEdit.id)

                result = await updateCateringPackage(packageToEdit.id, {
                    name: formData.get('name') as string,
                    serving_style: formData.get('serving_style') as string,
                    category: formData.get('category') as 'food' | 'drink' | 'addon',
                    per_head_cost: parseCost(formData.get('cost_per_head')),
                    pricing_model: formData.get('pricing_model') as any,
                    minimum_order: parseInt(formData.get('minimum_guests') as string) || null,
                    description: formData.get('description') as string || null,
                    includes: formData.get('dietary_notes') as string || null,
                    is_active: formData.get('active') === 'on'
                })
            } else {
                result = await createCateringPackage({
                    name: formData.get('name') as string,
                    serving_style: formData.get('serving_style') as string,
                    category: formData.get('category') as 'food' | 'drink' | 'addon',
                    per_head_cost: parseCost(formData.get('cost_per_head')),
                    pricing_model: formData.get('pricing_model') as any,
                    minimum_order: parseInt(formData.get('minimum_guests') as string) || null,
                    description: formData.get('description') as string || null,
                    includes: formData.get('dietary_notes') as string || null,
                    is_active: formData.get('active') === 'on'
                })
            }

            if (result.error) {
                setError(result.error)
            } else {
                onSuccess()
                onClose()
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!packageToEdit || !confirm('Are you sure you want to delete this package? This cannot be undone.')) return

        setIsDeleting(true)
        try {
            const result = await deleteCateringPackage(packageToEdit.id)
            if (result.error) {
                setError(result.error)
            } else {
                onSuccess()
                onClose()
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred')
        } finally {
            setIsDeleting(false)
        }
    }

    const categoryOptions = [
        { value: 'food', label: 'Food' },
        { value: 'drink', label: 'Drinks' },
        { value: 'addon', label: 'Add-ons' }
    ]

    const servingStyleOptions = [
        { value: 'buffet', label: 'Buffet' },
        { value: 'sit-down', label: 'Sit Down Meal' },
        { value: 'canapes', label: 'Canapés' },
        { value: 'drinks', label: 'Drinks Package' },
        { value: 'pizza', label: 'Pizza' },
        { value: 'other', label: 'Other' }
    ]

    const pricingModelOptions = [
        { value: 'per_head', label: 'Per Person' },
        { value: 'total_value', label: 'Total Value' },
        { value: 'per_jar', label: 'Per Jar' },
        { value: 'per_tray', label: 'Per Tray' },
        { value: 'menu_priced', label: 'Menu Priced' },
        { value: 'free', label: 'Free / No Charge' },
        { value: 'variable', label: 'Variable / Price on Request' }
    ]

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={isEditing ? 'Edit Package' : 'Add New Package'}
            size="lg"
        >
            <form action={handleSubmit} className="space-y-6">
                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormGroup label="Package Name" required className="md:col-span-2">
                        <Input
                            name="name"
                            defaultValue={packageToEdit?.name}
                            required
                            placeholder="e.g., Classic Buffet"
                        />
                    </FormGroup>

                    <FormGroup label="Category" required>
                        <Select
                            name="category"
                            defaultValue={packageToEdit?.category || 'food'}
                            required
                            options={categoryOptions}
                        />
                    </FormGroup>

                    <FormGroup label="Serving Style" required>
                        <Select
                            name="serving_style"
                            defaultValue={packageToEdit?.serving_style || 'buffet'}
                            required
                            options={servingStyleOptions}
                        />
                    </FormGroup>

                    <FormGroup
                        label={['variable', 'menu_priced'].includes(selectedPricingModel) ? "Default / Estimate Price (£) (Optional)" : "Price (£)"}
                        required={!['variable', 'menu_priced', 'free'].includes(selectedPricingModel)}
                        className={selectedPricingModel === 'free' ? 'opacity-50 pointer-events-none' : ''}
                    >
                        <Input
                            type="number"
                            name="cost_per_head"
                            defaultValue={packageToEdit?.cost_per_head}
                            required={!['variable', 'menu_priced', 'free'].includes(selectedPricingModel)}
                            min="0"
                            step="0.01"
                            placeholder={['variable', 'menu_priced'].includes(selectedPricingModel) ? "0.00" : "25.00"}
                            disabled={selectedPricingModel === 'free'}
                        />
                    </FormGroup>

                    <FormGroup label="Pricing Model" required>
                        <Select
                            name="pricing_model"
                            defaultValue={packageToEdit?.pricing_model || 'per_head'}
                            required
                            options={pricingModelOptions}
                            onChange={(e) => {
                                setSelectedPricingModel(e.target.value)
                            }}
                        />
                    </FormGroup>

                    <FormGroup label="Minimum Guests">
                        <Input
                            type="number"
                            name="minimum_guests"
                            defaultValue={packageToEdit?.minimum_guests || ''}
                            min="0"
                            placeholder="20"
                        />
                    </FormGroup>

                    <div className="flex items-center pt-6">
                        <Checkbox
                            name="active"
                            label="Active"
                            defaultChecked={packageToEdit?.active ?? true}
                        />
                    </div>
                </div>

                <FormGroup label="Description">
                    <Textarea
                        name="description"
                        defaultValue={packageToEdit?.description || ''}
                        rows={2}
                        placeholder="Brief description of the package..."
                    />
                </FormGroup>

                <FormGroup label="Dietary Information & Includes">
                    <Textarea
                        name="dietary_notes"
                        defaultValue={packageToEdit?.dietary_notes || ''}
                        rows={4}
                        placeholder="What's included in this package? e.g. Vegetarian options, specific dishes..."
                    />
                </FormGroup>

                <ModalActions align="between">
                    {isEditing ? (
                        <Button
                            type="button"
                            variant="danger"
                            onClick={handleDelete}
                            disabled={isSubmitting || isDeleting}
                            leftIcon={<TrashIcon className="h-4 w-4" />}
                        >
                            Delete
                        </Button>
                    ) : (
                        <div /> /* Spacer */
                    )}

                    <div className="flex gap-3">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting || isDeleting}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={isSubmitting} disabled={isSubmitting || isDeleting}>
                            {isEditing ? 'Save Changes' : 'Create Package'}
                        </Button>
                    </div>
                </ModalActions>
            </form>
        </Modal>
    )
}
