'use client'

import EmployeeForm from '@/components/EmployeeForm';
import { updateEmployee } from '@/app/actions/employeeActions';
import { supabase } from '@/lib/supabase';
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Tabs } from '@/components/ui/Tabs';
import FinancialDetailsForm from '@/components/FinancialDetailsForm';
import HealthRecordsForm from '@/components/HealthRecordsForm';
import { use, useState, useEffect, useCallback } from 'react';

async function getEmployee(id: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('employee_id', id)
    .single();

  if (error) {
    console.error('Error fetching employee for edit:', error);
    return null;
  }
  return data;
}

async function getFinancialDetails(employeeId: string): Promise<EmployeeFinancialDetails | null> {
    const { data, error } = await supabase
        .from('employee_financial_details')
        .select('*')
        .eq('employee_id', employeeId)
        .single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching financial details:', error);
    }
    return data;
}

async function getHealthRecord(employeeId: string): Promise<EmployeeHealthRecord | null> {
    const { data, error } = await supabase
        .from('employee_health_records')
        .select('*')
        .eq('employee_id', employeeId)
        .single();
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching health record:', error);
    }
    return data;
}

export default function EditEmployeePage({ params: paramsPromise }: { params: Promise<{ employee_id: string }> }) {
  const params = use(paramsPromise);
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
  }, [params]);

  useEffect(() => {
    loadData();
  }, [loadData]);


  if (isLoading) {
    return <div>Loading employee details...</div>
  }
  
  if (!employee) {
    // This can be a more user-friendly component than just returning null
    return <div>Employee not found.</div>;
  }

  const tabs = [
    {
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
        label: 'Financial Details',
        content: <FinancialDetailsForm employeeId={employee.employee_id} financialDetails={financialDetails} />
    },
    {
        label: 'Health Records',
        content: <HealthRecordsForm employeeId={employee.employee_id} healthRecord={healthRecord} />
    }
  ];

  return (
    <div className="space-y-6">
       <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Edit: {employee.first_name} {employee.last_name}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Update details below or{' '}
                <Link href={`/employees/${employee.employee_id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                  cancel and return to view
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
}