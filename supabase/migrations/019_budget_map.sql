-- Add status + notes to existing budget_forecasts
ALTER TABLE budget_forecasts
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'delayed')),
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Expand section enum to include tax + extra
ALTER TABLE budget_forecasts
  DROP CONSTRAINT IF EXISTS budget_forecasts_section_check;

ALTER TABLE budget_forecasts
  ADD CONSTRAINT budget_forecasts_section_check
    CHECK (section IN ('revenue', 'cost', 'people', 'tax', 'extra'));
