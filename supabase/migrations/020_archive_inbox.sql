-- Migration: 020_archive_inbox
-- Adiciona suporte para inbox separado de ficheiros antigos (Archive_Files)

-- Coluna source em processing_queue para distinguir fluxo corrente vs arquivo
ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'current';

-- Pastas do arquivo em folder_config (IDs preenchidos via UI Settings)
INSERT INTO folder_config (key, label, folder_id, folder_name, parent_key, auto_create, editable)
VALUES
  ('inbox_archive', 'Inbox Archive Files', NULL, 'Inbox_Archive_Files', NULL, false, true),
  ('archive_root',  'Raiz Archive_Files',  NULL, 'Archive_Files',        NULL, false, true)
ON CONFLICT (key) DO NOTHING;
