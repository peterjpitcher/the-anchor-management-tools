-- Seed default rota configuration values into system_settings.
-- ON CONFLICT DO NOTHING so existing customisations are preserved on re-run.

INSERT INTO system_settings (key, value, description)
VALUES
  (
    'rota_holiday_year_start_month',
    '{"value": 4}',
    'Month the holiday year starts (1 = January, 4 = April for the UK tax year)'
  ),
  (
    'rota_holiday_year_start_day',
    '{"value": 6}',
    'Day of the month the holiday year starts'
  ),
  (
    'rota_default_holiday_days',
    '{"value": 25}',
    'Default annual holiday allowance in days — used when an employee has no personal override set'
  ),
  (
    'rota_manager_email',
    '{"value": ""}',
    'Email address that receives rota manager alerts (unpublished rota warnings sent on Sundays)'
  ),
  (
    'payroll_accountant_email',
    '{"value": ""}',
    'Email address that receives payroll export emails'
  ),
  (
    'rota_wage_target_percent',
    '{"value": 25}',
    'Target scheduled wages as a percentage of sales target for rota planning'
  )
ON CONFLICT (key) DO NOTHING;
