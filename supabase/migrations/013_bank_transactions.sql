-- Bank transactions extracted from bank statement PDFs
CREATE TABLE bank_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id        UUID NOT NULL REFERENCES processing_queue(id) ON DELETE CASCADE,
  txn_date        DATE NOT NULL,
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,  -- negative = debit, positive = credit
  balance         NUMERIC(12,2),
  reference       TEXT,
  counterparty    TEXT,                    -- parsed entity name from description
  is_reconciled   BOOLEAN DEFAULT false,
  reconciled_queue_id UUID REFERENCES processing_queue(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bank_txn_queue    ON bank_transactions(queue_id);
CREATE INDEX idx_bank_txn_date     ON bank_transactions(txn_date);
CREATE INDEX idx_bank_txn_reconcil ON bank_transactions(is_reconciled);

-- Payment tracking on invoices
ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS is_paid      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS payment_ref  TEXT;

-- RLS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_bank_txn"   ON bank_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_bank_txn" ON bank_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_bank_txn" ON bank_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_bank_txn" ON bank_transactions FOR DELETE TO authenticated USING (true);
