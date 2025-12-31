import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'
import { createJob, submitApplication, getJobApplications } from '@/lib/hiring/service'

async function verifyHiringFlow() {
    console.log('🚀 Starting Verification of Hiring Flow...')

    const admin = createAdminClient()
    const timestamp = Date.now()
    const jobSlug = `test-job-${timestamp}`
    const candidateEmail = `test.candidate.${timestamp}@example.com`

    try {
        // 1. Create a Job
        console.log('\nTesting Job Creation...')
        const job = await createJob({
            title: `Test Job ${timestamp}`,
            slug: jobSlug,
            status: 'open',
            location: 'The Anchor',
            description: 'A test job for verification',
            employment_type: 'Full-time'
        })
        console.log('✅ Job Created:', job.id, job.title)

        // 2. Submit Application
        console.log('\nTesting Application Submission...')
        const appResult = await submitApplication({
            jobId: job.id,
            candidate: {
                firstName: 'Test',
                lastName: 'Candidate',
                email: candidateEmail,
                phone: '07700900000',
                resumeUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', // Public dummy PDF
                screenerAnswers: { 'q1': 'answer 1' }
            }
        })

        if (!appResult.success) {
            throw new Error(`Application failed: ${appResult.error}`)
        }
        console.log('✅ Application Submitted:', appResult.applicationId)

        // 3. Verify Database Records
        console.log('\nVerifying Database Records...')

        // Check Application
        const { data: application, error: appError } = await admin
            .from('hiring_applications')
            .select('*, candidate:hiring_candidates(*)')
            .eq('id', appResult.applicationId!)
            .single()

        if (appError) throw appError
        if (!application) throw new Error('Application not found in DB')

        console.log('✅ Application Record Found:', application.id)
        if (application.candidate) {
            // Explicitly cast or check the property
            const candidate = application.candidate as any
            console.log('✅ Candidate Record Found:', candidate.email)
        } else {
            throw new Error('Candidate relation missing')
        }

        // 4. Verify Service Query
        console.log('\nVerifying Service Query...')
        const apps = await getJobApplications(job.id)
        if (apps.length !== 1) {
            throw new Error(`Expected 1 application, found ${apps.length}`)
        }
        console.log('✅ Service Query returned correct application count')

        // 5. Cleanup
        console.log('\nCleaning up...')
        await admin.from('hiring_applications').delete().eq('id', application.id)
        await admin.from('hiring_candidates').delete().eq('id', application.candidate_id) // Type safe access
        await admin.from('hiring_jobs').delete().eq('id', job.id)
        console.log('✅ Cleanup complete')

        console.log('\n🎉 VERIFICATION SUCCESSFUL!')

    } catch (error) {
        console.error('\n❌ VERIFICATION FAILED:', error)
        process.exit(1)
    }
}

verifyHiringFlow()
