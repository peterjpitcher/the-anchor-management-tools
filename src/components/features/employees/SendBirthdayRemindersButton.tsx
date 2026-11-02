'use client'

import { useState } from 'react'
import { Button } from '@/ds'
import { toast } from '@/ds'
import { sendBirthdayReminders } from '@/app/actions/employee-birthdays'

// Long enough to read a sentence that asks the person to check with the manager.
const WARNING_DURATION_MS = 12000

export default function SendBirthdayRemindersButton() {
  const [sending, setSending] = useState(false)

  const handleSendReminders = async () => {
    setSending(true)
    try {
      const result = await sendBirthdayReminders()
      if (result.error) {
        // A reminder that may have reached the manager is a warning, not a failure: it says to
        // check with them before sending again. Only a definite refusal is shown as an error.
        if (result.uncertain) {
          toast.warning(result.error, { duration: WARNING_DURATION_MS })
        } else {
          toast.error(result.error)
        }
      } else if (result.warning) {
        // Another run holds today's reminder, so nothing was sent: it may have gone a few minutes
        // ago, and the sentence says when it can be sent from here.
        toast.warning(result.warning, { duration: WARNING_DURATION_MS })
      } else if (result.unrecorded) {
        // Sent, but not recorded: the sentence asks the person not to send it again today.
        toast.warning(result.message, { duration: WARNING_DURATION_MS })
      } else {
        toast.success(result.message || 'Birthday reminders sent')
      }
    } catch (error) {
      // The request may have failed after the server sent the reminder, so this is never
      // reported as "not sent".
      console.error('[SendBirthdayRemindersButton] The send did not answer', error)
      toast.warning(
        'The page did not hear back, so the birthday reminder may or may not have gone. Check with the manager before sending it again.',
        { duration: WARNING_DURATION_MS },
      )
    } finally {
      setSending(false)
    }
  }

  // Says what it does: today's reminder email, for birthdays exactly a week away. It was
  // "Send Weekly Reminders", but the reminder goes daily and never covers the whole week.
  return (
    <Button
      type="button"
      onClick={handleSendReminders}
      variant="primary"
      size="sm"
      loading={sending}
    >
      Email Reminder for Birthdays in 7 Days
    </Button>
  )
}
