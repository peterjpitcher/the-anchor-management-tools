import EmployeeForm from '@/components/EmployeeForm';
import { addEmployee } from '@/app/actions/employeeActions';

export default function NewEmployeePage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">
        <EmployeeForm 
          formAction={addEmployee} 
          initialFormState={null} // Or provide a default initial state if needed
        />
      </div>
    </div>
  );
} 