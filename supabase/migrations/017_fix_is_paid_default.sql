-- Migration: 017_fix_is_paid_default.sql
-- is_paid DEFAULT false fazia com que TODOS os documentos históricos
-- aparecessem como "por pagar". Repõe NULL (desconhecido) para entradas
-- que nunca foram reconciliadas (reconciliadas ficam TRUE).

UPDATE processing_queue
SET is_paid = NULL
WHERE is_paid = false;

ALTER TABLE processing_queue
  ALTER COLUMN is_paid SET DEFAULT NULL;
