-- Migration: 010_queue_auth_write_policies.sql
-- Adiciona políticas de escrita para utilizadores autenticados na processing_queue e processing_logs
-- O cliente Angular usa o role 'authenticated' (Supabase Auth JWT)

CREATE POLICY "auth_insert_queue"
  ON processing_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_queue"
  ON processing_queue FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_delete_queue"
  ON processing_queue FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "auth_insert_logs"
  ON processing_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
