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

            const getString = (key: string) => formData.get(key) as string || null

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
                    summary: getString('summary'),
                    includes: getString('includes'),
                    served: getString('served'),
                    good_to_know: getString('good_to_know'),
                    guest_description: getString('guest_description'),
                    dietary_notes: getString('dietary_notes'),
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
                    summary: getString('summary'),
                    includes: getString('includes'),
                    served: getString('served'),
                    good_to_know: getString('good_to_know'),
                    guest_description: getString('guest_description'),
                    dietary_notes: getString('dietary_notes'),
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

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Package Details</h3>

                    <FormGroup label="Summary" help="One-line overview shown to staff">
                        <Textarea
                            name="summary"
                            defaultValue={packageToEdit?.summary || ''}
                            rows={2}
                            placeholder="e.g. A hearty BBQ spread served buffet-style."
                        />
                    </FormGroup>

                    <FormGroup label="Includes" help="What guests receive">
                        <Textarea
                            name="includes"
                            defaultValue={packageToEdit?.includes || ''}
                            rows={2}
                            placeholder="e.g. Beef burger, chicken drumstick, pork sausage, potato salad, coleslaw and fresh leaf salad."
                        />
                    </FormGroup>

                    <FormGroup label="Served" help="How the food is presented or served">
                        <Textarea
                            name="served"
                            defaultValue={packageToEdit?.served || ''}
                            rows={2}
                            placeholder="e.g. Buffet-style — guests help themselves."
                        />
                    </FormGroup>

                    <FormGroup label="Good to Know" help="Dietary options, advance notice requirements, etc.">
                        <Textarea
                            name="good_to_know"
                            defaultValue={packageToEdit?.good_to_know || ''}
                            rows={2}
                            placeholder="e.g. Vegetarian option available at the same price. Advance notice required."
                        />
                    </FormGroup>

                    <FormGroup label="Guest-Friendly Description" help="Shown to customers on the booking form">
                        <Textarea
                            name="guest_description"
                            defaultValue={packageToEdit?.guest_description || ''}
                            rows={3}
                            placeholder="e.g. Enjoy a delicious spread of BBQ classics including burgers, chicken, sausages and fresh salads — all laid out for guests to help themselves."
                        />
                    </FormGroup>

                    <FormGroup label="Dietary Notes" help="Allergen information or dietary flags for the kitchen">
                        <Textarea
                            name="dietary_notes"
                            defaultValue={packageToEdit?.dietary_notes || ''}
                            rows={2}
                            placeholder="e.g. Contains gluten, dairy. Vegan option available on request."
                        />
                    </FormGroup>
                </div>

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
