'use client'

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Employee, EmployeeAttachment, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database';
import DeleteEmployeeButton from '@/components/DeleteEmployeeButton';
import EmployeeNotesList from '@/components/EmployeeNotesList';
import AddEmployeeNoteForm from '@/components/AddEmployeeNoteForm';
import EmployeeAttachmentsList from '@/components/EmployeeAttachmentsList';
import AddEmployeeAttachmentForm from '@/components/AddEmployeeAttachmentForm';
import { Suspense, use, useState, useEffect, useCallback } from 'react';
import EmergencyContactsTab from '@/components/EmergencyContactsTab';
import FinancialDetailsTab from '@/components/FinancialDetailsTab';
import HealthRecordsTab from '@/components/HealthRecordsTab';
import RightToWorkTab from '@/components/RightToWorkTab';
import OnboardingChecklistTab from '@/components/OnboardingChecklistTab';
import { formatDate } from '@/lib/dateUtils';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { EmployeeAuditTrail } from '@/components/EmployeeAuditTrail';
import { EmployeeRecentChanges } from '@/components/EmployeeRecentChanges';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Tabs } from '@/components/ui-v2/navigation/Tabs';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

export const dynamic = 'force-dynamic';

export default function EmployeeDetailPage({ params: paramsPromise }: { params: Promise<{ employee_id: string }> }) {
  const params = use(paramsPromise);
  const supabase = useSupabase();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [attachments, setAttachments] = useState<EmployeeAttachment[] | null>(null);
  const [attachmentCategoriesMap, setAttachmentCategoriesMap] = useState<Map<string, string>>(new Map());
  const [financialDetails, setFinancialDetails] = useState<EmployeeFinancialDetails | null>(null);
  const [healthRecord, setHealthRecord] = useState<EmployeeHealthRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);


  const loadData = useCallback(async () => {
    if (!params.employee_id) {
        return notFound();
    }
    try {
        setIsLoading(true);
        
        // Define functions inline to avoid dependency issues
        const getEmployee = async (id: string): Promise<Employee | null> => {
          const { data, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching employee:', error);
            return null;
          }
          return data;
        };

        const getEmployeeAttachments = async (employeeId: string): Promise<EmployeeAttachment[] | null> => {
          const { data, error } = await supabase
            .from('employee_attachments')
            .select('*')
            .eq('employee_id', employeeId)
            .order('uploaded_at', { ascending: false });
          if (error) {
            console.error('Error fetching employee attachments:', error);
            return null;
          }
          return data;
        };

        const getFinancialDetails = async (employeeId: string): Promise<EmployeeFinancialDetails | null> => {
          const { data, error } = await supabase
            .from('employee_financial_details')
            .select('*')
            .eq('employee_id', employeeId)
            .maybeSingle();
          if (error) { 
            console.error('Error fetching financial details:', error);
          }
          return data;
        };

        const getHealthRecord = async (employeeId: string): Promise<EmployeeHealthRecord | null> => {
          const { data, error } = await supabase
            .from('employee_health_records')
            .select('*')
            .eq('employee_id', employeeId)
            .maybeSingle();
          if (error) { 
            console.error('Error fetching health record:', error);
          }
          return data;
        };

        const getAttachmentCategories = async (): Promise<Map<string, string>> => {
          const { data, error } = await supabase
            .from('attachment_categories')
            .select('category_id, category_name') as {
              data: { category_id: string; category_name: string }[] | null;
              error: unknown;
            };
          const map = new Map<string, string>();
          if (error) {
            console.error('Error fetching attachment categories:', error);
            return map;
          }
          data?.forEach((cat) => map.set(cat.category_id, cat.category_name));
          return map;
        };
        
        const [emp, att, catMap, fin, health] = await Promise.all([
            getEmployee(params.employee_id),
            getEmployeeAttachments(params.employee_id),
            getAttachmentCategories(),
            getFinancialDetails(params.employee_id),
            getHealthRecord(params.employee_id),
        ]);

        if (!emp) {
            return notFound();
        }

        setEmployee(emp);
        setAttachments(att);
        setAttachmentCategoriesMap(catMap);
        setFinancialDetails(fin);
        setHealthRecord(health);

    } catch (error) {
        console.error("Failed to load employee data", error);
    } finally {
        setIsLoading(false);
    }
  }, [params.employee_id, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  if (isLoading) {
    return (
      <PageWrapper>
        <PageHeader title="Employee Details" />
        <PageContent>
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <Spinner size="lg" />
              <p className="mt-4 text-gray-600">Loading employee details...</p>
            </div>
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  if (!employee) {
    return notFound();
  }

  const displayFields = [
    { label: 'Full Name', value: `${employee.first_name} ${employee.last_name}` },
    { label: 'Email Address', value: employee.email_address, isEmail: true },
    { label: 'Job Title', value: employee.job_title },
    { label: 'Employment Status', value: employee.status, isBadge: true },
    { label: 'Start Date', value: employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A' },
    { label: 'End Date', value: employee.employment_end_date ? formatDate(employee.employment_end_date) : 'N/A' },
    { label: 'Date of Birth', value: employee.date_of_birth ? formatDate(employee.date_of_birth) : 'N/A' },
    { label: 'Phone Number', value: employee.phone_number || 'N/A', isPhone: true },
    { label: 'Address', value: employee.address || 'N/A', isFullWidth: true },
  ];

  const tabs = [
    {
      key: 'details',
      label: 'Details',
      content: (
        <dl className="divide-y divide-gray-200">
          {displayFields.map((field, index) => (
            <div
              key={index}
              className={`py-3 flex flex-col sm:grid sm:grid-cols-4 sm:gap-4 ${field.isFullWidth ? 'sm:grid-cols-1' : ''}`}
            >
              <dt className="text-sm font-medium text-gray-500 mb-1 sm:mb-0">{field.label}</dt>
              <dd className={`text-sm text-gray-900 ${field.isFullWidth ? '' : 'sm:col-span-3'}`}>
                {field.isBadge ? (
                  <Badge 
                    variant={employee.status === 'Active' ? 'success' : 
                             employee.status === 'Prospective' ? 'info' : 
                             'error'}
                  >
                    {field.value}
                  </Badge>
                ) : field.isEmail ? (
                    <a href={`mailto:${field.value}`} className="text-blue-600 hover:text-blue-900 break-all">{field.value}</a>
                ) : field.isPhone ? (
                    <a href={`tel:${field.value}`} className="text-blue-600 hover:text-blue-900">{field.value}</a>
                ) : field.isFullWidth ? (
                    <span className="break-words">{field.value}</span>
                ) : (
                    field.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )
    },
    {
      key: 'emergency',
      label: 'Emergency Contacts',
      content: <EmergencyContactsTab employeeId={employee.employee_id} />
    },
    {
      key: 'financial',
      label: 'Financial Details',
      content: <FinancialDetailsTab financialDetails={financialDetails} />
    },
    {
      key: 'health',
      label: 'Health Records',
      content: <HealthRecordsTab healthRecord={healthRecord} />
    },
    {
      key: 'right-to-work',
      label: 'Right to Work',
      content: <RightToWorkTab employeeId={employee.employee_id} />
    },
    {
      key: 'onboarding',
      label: 'Onboarding',
      content: <OnboardingChecklistTab employeeId={employee.employee_id} />
    },
    {
      key: 'audit',
      label: 'Audit Trail',
      content: <EmployeeAuditTrail 
        employeeId={employee.employee_id} 
        employeeName={`${employee.first_name} ${employee.last_name}`} 
      />
    }
  ];

  return (
    <PageWrapper>
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        subtitle={employee.job_title}
        backButton={{
          label: 'Back to Employees',
          href: '/employees'
        }}
        actions={
          <div className="flex items-center gap-x-3">
            <NavGroup>
              <NavLink href={`/employees/${employee.employee_id}/edit`}>
                Edit
              </NavLink>
            </NavGroup>
            <DeleteEmployeeButton
              employeeId={employee.employee_id}
              employeeName={`${employee.first_name} ${employee.last_name}`}
            />
          </div>
        }
      />
      <PageContent>
        <EmployeeRecentChanges employeeId={employee.employee_id} />

        <Card>
          <Tabs items={tabs} />
        </Card>

        {/* Employee Notes Section */}
        <Section 
          title="Employee Notes"
          description="Record of time-stamped updates and comments."
        >
          <Card>
            <AddEmployeeNoteForm employeeId={employee.employee_id} />
            <div className="mt-6">
              <Suspense fallback={
                <div className="text-center py-4">
                  <Spinner />
                  <p className="mt-2 text-gray-500">Loading notes...</p>
                </div>
              }>
                <EmployeeNotesList employeeId={employee.employee_id} />
              </Suspense>
            </div>
          </Card>
        </Section>

        {/* Employee Attachments Section */}
        <Section 
          title="Employee Attachments"
          description="Scanned documents and other attached files."
          actions={
            <Link
              href="/settings/categories"
              className="text-xs sm:text-sm text-blue-600 hover:text-blue-900 whitespace-nowrap"
            >
              Manage Categories
            </Link>
          }
        >
          <Card>
            <AddEmployeeAttachmentForm 
              employeeId={employee.employee_id} 
              onSuccess={loadData}
            />
            <div className="mt-6">
              <EmployeeAttachmentsList
                employeeId={employee.employee_id}
                attachments={attachments}
                categoriesMap={attachmentCategoriesMap}
                onDelete={loadData}
              />
            </div>
          </Card>
        </Section>
      </PageContent>
    </PageWrapper>
  );
} 
