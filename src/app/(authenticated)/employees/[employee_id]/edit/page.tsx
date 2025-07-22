'use client'

import EmployeeForm from '@/components/EmployeeForm';
import { updateEmployee } from '@/app/actions/employeeActions';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import FinancialDetailsForm from '@/components/FinancialDetailsForm';
import HealthRecordsForm from '@/components/HealthRecordsForm';
import { use, useState, useEffect, useCallback } from 'react';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Tabs } from '@/components/ui-v2/navigation/Tabs';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';

export default function EditEmployeePage({ params: paramsPromise }: { params: Promise<{ employee_id: string }> }) {
  const params = use(paramsPromise);
  const supabase = useSupabase();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [financialDetails, setFinancialDetails] = useState<EmployeeFinancialDetails | null>(null);
  const [healthRecord, setHealthRecord] = useState<EmployeeHealthRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
      if (!params?.employee_id) {
          console.error("Employee ID is missing from params");
          return notFound();
      }
      
      try {
          setIsLoading(true);
          
          // Define functions inline to use authenticated supabase client
          const getEmployee = async (id: string): Promise<Employee | null> => {
            const { data, error } = await supabase
              .from('employees')
              .select('*')
              .eq('employee_id', id)
              .maybeSingle();

            if (error) {
              console.error('Error fetching employee for edit:', error);
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
          
          const [employeeData, financialData, healthData] = await Promise.all([
              getEmployee(params.employee_id),
              getFinancialDetails(params.employee_id),
              getHealthRecord(params.employee_id),
          ]);

          if (!employeeData) {
              return notFound();
          }

          setEmployee(employeeData);
          setFinancialDetails(financialData);
          setHealthRecord(healthData);

      } catch (error) {
          console.error("Failed to load employee data", error);
          // Optionally, redirect to an error page or show a toast
      } finally {
          setIsLoading(false);
      }
  }, [params, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  if (isLoading) {
    return (
      <Page title="Edit Employee">
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading employee details...</p>
          </div>
        </div>
      </Page>
    );
  }
  
  if (!employee) {
    return (
      <Page title="Edit Employee">
        <Card>
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900">Employee not found</h3>
            <p className="mt-1 text-sm text-gray-500">The employee you&apos;re looking for doesn&apos;t exist.</p>
          </div>
        </Card>
      </Page>
    );
  }

  const tabs = [
    {
        key: 'personal',
        label: 'Personal Details',
        content: (
            <EmployeeForm 
                employee={employee} 
                formAction={updateEmployee}
                initialFormState={null}
                showTitle={false}
                showCancel={false}
              />
        )
    },
    {
        key: 'financial',
        label: 'Financial Details',
        content: <FinancialDetailsForm employeeId={employee.employee_id} financialDetails={financialDetails} />
    },
    {
        key: 'health',
        label: 'Health Records',
        content: <HealthRecordsForm employeeId={employee.employee_id} healthRecord={healthRecord} />
    }
  ];

  return (
    <Page
      title={`Edit: ${employee.first_name} ${employee.last_name}`}
      description="Update employee details"
      actions={
        <LinkButton
          href={`/employees/${employee.employee_id}`}
          variant="secondary"
        >
          Cancel
        </LinkButton>
      }
    >
      <Card>
        <Tabs items={tabs} />
      </Card>
    </Page>
  );
}