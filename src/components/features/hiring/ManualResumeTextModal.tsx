'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { submitManualResumeText } from '@/actions/hiring-retry'
import { toast } from 'sonner'

export function ManualResumeTextModal({ candidateId }: { candidateId: string }) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleSubmit = async () => {
        if (!text.trim()) {
            toast.error('Paste the resume text before saving')
            return
        }
        setIsSaving(true)
        try {
            const result = await submitManualResumeText({
                candidateId,
                resumeText: text,
            })
            if (!result.success) {
                toast.error(result.error || 'Failed to save resume text')
                return
            }
            toast.success('Resume text saved and parsed')
            setOpen(false)
            setText('')
        } catch (error) {
            toast.error('Failed to save resume text')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <>
            <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(true)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
                Paste Resume Text
            </Button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Paste Resume Text"
                description="Paste the resume text so we can re-run parsing and screening."
                size="lg"
                initialFocus={textareaRef}
            >
                <div className="space-y-4">
                    <FormGroup label="Resume text">
                        <Textarea
                            ref={textareaRef}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            rows={12}
                            placeholder="Paste the resume text here..."
                        />
                    </FormGroup>
                    <p className="text-xs text-gray-500">
                        We will re-parse this text and update the candidate profile. Make sure to include the full resume.
                    </p>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSubmit} loading={isSaving}>
                        Save and Parse
                    </Button>
                </div>
            </Modal>
        </>
    )
}
