-- P&L targets and manual actuals storage
BEGIN;

CREATE TABLE IF NOT EXISTS pl_targets (
  metric_key TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '3m', '12m')),
  target_value NUMERIC(14, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric_key, timeframe)
);

CREATE TABLE IF NOT EXISTS pl_manual_actuals (
  metric_key TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '3m', '12m')),
  value NUMERIC(14, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric_key, timeframe)
);

COMMIT;
