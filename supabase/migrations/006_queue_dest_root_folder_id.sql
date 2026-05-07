-- Migration: 006_queue_dest_root_folder_id.sql
-- Staxio — Adiciona dest_root_folder_id à processing_queue

-- O dest_root_folder_id substitui a lógica is_international + env vars DRIVE_*
-- Guarda o folder_id Drive da pasta raiz para o /move usar directamente.

ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS dest_root_folder_id TEXT;
