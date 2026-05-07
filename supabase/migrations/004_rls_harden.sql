-- Migration: 004_rls_harden.sql
-- Fase 11: Hardening RLS — políticas explícitas de escrita para anon

-- ============================================================
-- processing_queue: anon só pode ler (SELECT já existe)
-- Nega explicitamente INSERT/UPDATE/DELETE para anon
-- ============================================================
CREATE POLICY "deny_anon_insert_queue"
  ON processing_queue FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_anon_update_queue"
  ON processing_queue FOR UPDATE
  TO anon
  USING (false);

CREATE POLICY "deny_anon_delete_queue"
  ON processing_queue FOR DELETE
  TO anon
  USING (false);

-- ============================================================
-- processing_logs: anon só pode ler
-- ============================================================
CREATE POLICY "deny_anon_insert_logs"
  ON processing_logs FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_anon_delete_logs"
  ON processing_logs FOR DELETE
  TO anon
  USING (false);

-- ============================================================
-- app_config: anon só pode ler
-- ============================================================
CREATE POLICY "deny_anon_insert_config"
  ON app_config FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_anon_update_config"
  ON app_config FOR UPDATE
  TO anon
  USING (false);

CREATE POLICY "deny_anon_delete_config"
  ON app_config FOR DELETE
  TO anon
  USING (false);

-- ============================================================
-- Nota: authenticated role (Supabase Auth) também só lê.
-- Writes são sempre feitas via service_role nas Edge Functions.
-- ============================================================
CREATE POLICY "auth_read_queue"
  ON processing_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_read_logs"
  ON processing_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_read_config"
  ON app_config FOR SELECT
  TO authenticated
  USING (true);
