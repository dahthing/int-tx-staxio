-- Reconcile bank transactions with supplier invoices
-- Matches: same amount (±0.01), txn_date >= doc_date, similar counterparty/supplier
CREATE OR REPLACE FUNCTION reconcile_transactions()
RETURNS TABLE(matched INT, unmatched INT) AS $$
DECLARE
  txn RECORD;
  inv RECORD;
  matched_count INT := 0;
  unmatched_count INT := 0;
BEGIN
  FOR txn IN
    SELECT * FROM bank_transactions
    WHERE is_reconciled = false AND amount < 0  -- debits only
  LOOP
    -- Try to find matching invoice
    SELECT * INTO inv
    FROM processing_queue
    WHERE
      status = 'done'
      AND is_paid = false
      AND is_my_doc = false
      AND value IS NOT NULL
      AND ABS(value - ABS(txn.amount)) <= 0.01
      AND (doc_date IS NULL OR doc_date::date <= txn.txn_date)
      AND doc_type IN ('received', 'ecommerce', 'international', 'bank_statement', 'supplies')
    ORDER BY
      -- prefer closer match: same supplier keyword in description
      CASE WHEN txn.description ILIKE '%' || COALESCE(supplier, '') || '%' THEN 0 ELSE 1 END,
      doc_date DESC
    LIMIT 1;

    IF FOUND THEN
      -- Mark transaction as reconciled
      UPDATE bank_transactions SET
        is_reconciled = true,
        reconciled_queue_id = inv.id
      WHERE id = txn.id;

      -- Mark invoice as paid
      UPDATE processing_queue SET
        is_paid = true,
        payment_date = txn.txn_date,
        payment_ref = txn.reference
      WHERE id = inv.id;

      matched_count := matched_count + 1;
    ELSE
      unmatched_count := unmatched_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT matched_count, unmatched_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
