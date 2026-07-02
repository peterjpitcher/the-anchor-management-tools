import { z } from 'zod'

export const feedbackSubmissionSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comments: z.string().trim().max(4000).optional(),
  customerName: z.string().trim().max(200).optional(),
  customerEmail: z.string().trim().email().max(320).optional().or(z.literal('')),
  customerPhone: z.string().trim().max(40).optional(),
  contactConsent: z.boolean().optional().default(false),
  honeypot: z.string().optional()
})

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>
