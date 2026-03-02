import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const steps: { table: string; description: string }[] = [
    { table: 'timeclock_sessions',      description: 'Clock-in/out records' },
    { table: 'reconciliation_notes',    description: 'Payroll notes' },
    { table: 'payroll_month_approvals', description: 'Payroll approval snapshots' },
    { table: 'rota_email_log',          description: 'Email audit log' },
    { table: 'payroll_periods',         description: 'Custom payroll period dates' },
    { table: 'leave_days',              description: 'Leave day rows' },
    { table: 'leave_requests',          description: 'Leave requests' },
    { table: 'rota_weeks',              description: 'Rota weeks (cascades to rota_shifts)' },
  ];

  for (const step of steps) {
    const { error, count } = await supabase
      .from(step.table)
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // match-all condition

    if (error) {
      console.error(`✗ ${step.table}: ${error.message}`);
    } else {
      console.log(`✓ ${step.table} (${step.description}): ${count ?? 0} rows deleted`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
