'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui-v2/forms/Button'
import { TrashIcon } from '@heroicons/react/24/outline'
import { DeleteConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { deleteCandidateAction } from '@/actions/hiring'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface DeleteCandidateButtonProps {
    candidateId: string
    candidateName: string
}

export function DeleteCandidateButton({ candidateId, candidateName }: DeleteCandidateButtonProps) {
    const [open, setOpen] = useState(false)
    const router = useRouter()

    const handleDelete = async () => {
        try {
            const result = await deleteCandidateAction(candidateId)
            if (!result.success) {
                toast.error(result.error || 'Failed to delete candidate')
                throw new Error(result.error || 'Failed to delete candidate')
            }
            toast.success('Candidate deleted successfully')
            router.push('/hiring')
        } catch (error: any) {
            throw error
        }
    }

    return (
        <>
            <Button
                variant="ghost"
                className="text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10"
                onClick={() => setOpen(true)}
                title="Delete Candidate"
            >
                <TrashIcon className="w-5 h-5" />
            </Button>

            <DeleteConfirmDialog
                open={open}
                onClose={() => setOpen(false)}
                onDelete={handleDelete}
                itemName={candidateName}
                itemType="candidate"
            />
        </>
    )
}
