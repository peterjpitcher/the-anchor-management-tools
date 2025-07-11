import EmployeeForm from '@/components/EmployeeForm';
import { addEmployee } from '@/app/actions/employeeActions';

export default function NewEmployeePage() {
  return (
    <EmployeeForm 
      formAction={addEmployee} 
      initialFormState={null} // Or provide a default initial state if needed
    />
  );
} 