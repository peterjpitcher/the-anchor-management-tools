'use client'

import { useState } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { ArrowPathIcon } from '@heroicons/react/20/solid'
import { retryCandidateParsing } from '@/actions/hiring-retry'
import { toast } from 'sonner'

export function RetryParsingButton({ candidateId }: { candidateId: string }) {
    const [isLoading, setIsLoading] = useState(false)

    const handleRetry = async () => {
        setIsLoading(true)
        try {
            const result = await retryCandidateParsing(candidateId)
            if (result.success) {
                toast.success('Parsing retried. Check back in a moment.')
            } else {
                toast.error(result.error || 'Failed to retry parsing')
            }
        } catch (error) {
            toast.error('An error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Button
            size="sm"
            variant="ghost"
            onClick={handleRetry}
            disabled={isLoading}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
            <ArrowPathIcon className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Retrying...' : 'Retry Parsing'}
        </Button>
    )
}
