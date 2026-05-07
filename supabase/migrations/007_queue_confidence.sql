-- Migration: 007_queue_confidence.sql
-- Staxio — Adiciona coluna confidence à processing_queue

ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3) DEFAULT 0.8;
