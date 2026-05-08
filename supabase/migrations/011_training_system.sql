-- 011_training_system.sql
-- ALTER TYPE ADD VALUE cannot run inside a transaction in Postgres

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'invoice_issued' AND enumtypid = 'doc_type'::regtype) THEN
    ALTER TYPE doc_type ADD VALUE 'invoice_issued';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'receipt_issued' AND enumtypid = 'doc_type'::regtype) THEN
    ALTER TYPE doc_type ADD VALUE 'receipt_issued';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'quote_issued' AND enumtypid = 'doc_type'::regtype) THEN
    ALTER TYPE doc_type ADD VALUE 'quote_issued';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS training_examples (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id        TEXT NOT NULL,
  file_name      TEXT,
  doc_type       TEXT NOT NULL,
  is_my_doc      BOOLEAN NOT NULL DEFAULT false,
  my_doc_kind    TEXT CHECK (my_doc_kind IN ('invoice_issued', 'receipt_issued', 'quote_issued', null)),
  supplier       TEXT,
  nif            TEXT,
  raw_extract    JSONB,
  user_label     TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE processing_queue ADD COLUMN IF NOT EXISTS is_my_doc BOOLEAN DEFAULT false;

ALTER TABLE training_examples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'training_examples' AND policyname = 'auth_all_training'
  ) THEN
    CREATE POLICY "auth_all_training" ON training_examples FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'training_examples' AND policyname = 'service_all_training'
  ) THEN
    CREATE POLICY "service_all_training" ON training_examples FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
