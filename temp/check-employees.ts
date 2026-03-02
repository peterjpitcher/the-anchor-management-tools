import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Employees from the Excel file
const EXCEL_EMPLOYEES = [
  { name: 'Billy Summers',       email: 'billy@orangejelly.co.uk' },
  { name: 'Daniel Villanis',     email: 'danielrvillanis@gmail.com' },
  { name: 'Diane Gleeson',       email: 'knight_diane@ymail.com' },
  { name: 'Harry Gilbert',       email: 'harry.gilbertmail@gmail.com' },
  { name: 'Harry Jefferyes',     email: 'harry.jefferyes@gmail.com' },
  { name: 'Jacob Hambridge',     email: 'jacob.a.hambridge@gmail.com' },
  { name: 'Jamie Chaplin',       email: 'chaplinjamie59@gmail.com' },
  { name: 'Jazz Forsey',         email: 'jazzysparkle82@hotmail.com' },
  { name: 'Jordon Bownman',      email: 'welchjordan37@gmail.com' },
  { name: 'Lance Marlow',        email: 'marlow92@gmail.com' },
  { name: 'Laura Bradshaw',      email: 'laurabradshaw2005@icloud.com' },
  { name: 'Lauren Harding',      email: 'laurenhardi@icloud.com' },
  { name: 'Leanne Breach',       email: 'leannebreach92@outlook.com' },
  { name: 'Mandy Jones',         email: 'mandyj42@outlook.com' },
  { name: 'Maria Gurtatowska',   email: 'marysia.gurtatowska123@gmail.com' },
  { name: 'Niamh Woods',         email: 'niamhwoods1@outlook.com' },
  { name: 'Oakley McNulty',      email: 'oakley.mcnulty2007@gmail.com' },
  { name: 'Paige Pantlin',       email: 'paigepantlin@gmail.com' },
  { name: 'Rebecca Gibbons',     email: 'b.e.c.k.a@hotmail.co.uk' },
  { name: 'Ryan Bond',           email: 'ryan.bond100@gmail.com' },
  { name: 'Sean low',            email: 'jasonnick27@icloud.com' },
  { name: 'Sharon Morris-Latham',email: 's.morris-latham71@hotmail.co.uk' },
];

async function main() {
  const { data: dbEmployees, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, status');

  if (error) {
    console.error('DB error:', error.message);
    return;
  }

  console.log(`DB employees: ${dbEmployees.length}`);
  console.log('');

  // Build lookup by email (lowercased)
  const dbByEmail = new Map(dbEmployees.map(e => [e.email_address?.toLowerCase(), e]));

  const matched: typeof EXCEL_EMPLOYEES = [];
  const notFound: typeof EXCEL_EMPLOYEES = [];

  for (const emp of EXCEL_EMPLOYEES) {
    const dbMatch = dbByEmail.get(emp.email.toLowerCase());
    if (dbMatch) {
      matched.push(emp);
      console.log(`✓ MATCH: ${emp.name} <${emp.email}> → DB: ${dbMatch.first_name} ${dbMatch.last_name} [${dbMatch.status}] (${dbMatch.employee_id}) email: ${dbMatch.email_address}`);
    } else {
      notFound.push(emp);
    }
  }

  console.log(`\n✗ NOT FOUND in DB (${notFound.length}):`);
  for (const emp of notFound) {
    console.log(`  ${emp.name} <${emp.email}>`);
  }

  console.log(`\nDB employees NOT in Excel (may be irrelevant or new):`);
  for (const db of dbEmployees) {
    const inExcel = EXCEL_EMPLOYEES.some(e => e.email.toLowerCase() === db.email_address?.toLowerCase());
    if (!inExcel) {
      console.log(`  ${db.first_name} ${db.last_name} <${db.email_address}> [${db.status}]`);
    }
  }
}

main().catch(console.error);
