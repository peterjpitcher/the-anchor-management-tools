import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { JobForm } from '@/components/features/hiring/JobForm'
import { getJobTemplates } from '@/lib/hiring/service'

export default async function NewJobPage() {
    const canCreate = await checkUserPermission('hiring', 'create')

    if (!canCreate) {
        redirect('/unauthorized')
    }

    const templates = await getJobTemplates()

    return (
        <PageLayout
            title="Post a New Job"
            subtitle="Create a new job opportunity"
            breadcrumbs={[
                { label: 'Hiring', href: '/hiring' },
                { label: 'New Job' }
            ]}
            backButton={{
                label: 'Back to Jobs',
                href: '/hiring'
            }}
            containerSize="lg"
        >
            <div className="bg-white rounded-lg shadow sm:p-6 p-4">
                <JobForm mode="create" templates={templates} />
            </div>
        </PageLayout>
    )
}
