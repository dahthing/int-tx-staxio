-- Migration: 021_atcud
-- Adiciona coluna ATCUD (Código Único de Documento) à processing_queue
-- Obrigatório em documentos fiscais PT desde 2023. Null para docs antigos ou estrangeiros.

ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS atcud TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_processing_queue_atcud
  ON processing_queue(atcud)
  WHERE atcud IS NOT NULL;
