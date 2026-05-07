-- Migration: 001_initial_schema.sql
-- Staxio — Schema inicial

CREATE TYPE processing_status AS ENUM (
  'pending',
  'processing',
  'done',
  'error',
  'manual_review'
);

CREATE TYPE log_action AS ENUM (
  'classify',
  'move',
  'manual_edit',
  'error'
);

-- ============================================================
-- TABLE: processing_queue
-- ============================================================
CREATE TABLE processing_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id          TEXT NOT NULL UNIQUE,
  file_name        TEXT NOT NULL,
  inbox_folder_id  TEXT NOT NULL,
  status           processing_status NOT NULL DEFAULT 'pending',
  doc_date         DATE,
  supplier         TEXT,
  value            NUMERIC(12, 2),
  nif              TEXT,
  country          TEXT,
  currency         TEXT DEFAULT 'EUR',
  is_international BOOLEAN DEFAULT false,
  dest_year        SMALLINT,
  dest_quarter     SMALLINT CHECK (dest_quarter BETWEEN 1 AND 4),
  dest_month       TEXT,
  dest_path        TEXT,
  dest_file_name   TEXT,
  error_message    TEXT,
  attempts         SMALLINT DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: processing_logs
-- ============================================================
CREATE TABLE processing_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id      UUID REFERENCES processing_queue(id) ON DELETE SET NULL,
  file_id       TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  action        log_action NOT NULL,
  origin_path   TEXT,
  dest_path     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: app_config
-- ============================================================
CREATE TABLE app_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value) VALUES
  ('drive_inbox_folder_id',        '1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7'),
  ('drive_root_folder_id',         '1klmq4RPuov5T9KJeYz7ffOH-avXIptN7'),
  ('drive_internacional_folder_id','1gonX4rK5wP5N_7615tOdUw1E1EFs7iOo');

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_queue_status  ON processing_queue(status);
CREATE INDEX idx_queue_created ON processing_queue(created_at DESC);
CREATE INDEX idx_logs_queue_id ON processing_logs(queue_id);
CREATE INDEX idx_logs_created  ON processing_logs(created_at DESC);
CREATE INDEX idx_logs_file_id  ON processing_logs(file_id);

-- ============================================================
-- TRIGGER: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_updated_at
  BEFORE UPDATE ON processing_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_queue"  ON processing_queue FOR SELECT USING (true);
CREATE POLICY "anon_read_logs"   ON processing_logs  FOR SELECT USING (true);
CREATE POLICY "anon_read_config" ON app_config       FOR SELECT USING (true);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE processing_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE processing_queue;
