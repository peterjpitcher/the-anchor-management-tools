import { redirect, notFound } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { JobForm } from '@/components/features/hiring/JobForm'
import { getJobById, getJobTemplates } from '@/lib/hiring/service'

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const canEdit = await checkUserPermission('hiring', 'edit')

    if (!canEdit) {
        redirect('/unauthorized')
    }

    const [job, templates] = await Promise.all([
        getJobById(id),
        getJobTemplates()
    ])

    if (!job) {
        notFound()
    }

    return (
        <PageLayout
            title={`Edit Job: ${job.title}`}
            subtitle="Update job details"
            breadcrumbs={[
                { label: 'Hiring', href: '/hiring' },
                { label: job.title, href: `/hiring/${id}` }, // Might not exist yet (view page), but breadcrumb is nice
                { label: 'Edit' }
            ]}
            backButton={{
                label: 'Back to Jobs',
                href: '/hiring'
            }}
        >
            <div className="bg-white rounded-lg shadow sm:p-6 p-4">
                <JobForm mode="edit" initialData={job} templates={templates} />
            </div>
        </PageLayout>
    )
}
