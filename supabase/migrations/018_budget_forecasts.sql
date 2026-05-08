CREATE TABLE IF NOT EXISTS budget_forecasts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year           INT NOT NULL,
  month          INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  section        TEXT NOT NULL CHECK (section IN ('revenue', 'cost', 'people')),
  category       TEXT NOT NULL,
  owner          TEXT,
  forecast_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (year, month, section, category)
);

ALTER TABLE budget_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_budget"
  ON budget_forecasts FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write_budget"
  ON budget_forecasts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
