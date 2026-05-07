-- Migration: 008_suppliers_write_policies.sql
-- Adiciona políticas de escrita para utilizadores autenticados na tabela suppliers

CREATE POLICY "auth_insert_suppliers"
  ON suppliers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_suppliers"
  ON suppliers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "auth_delete_suppliers"
  ON suppliers FOR DELETE
  TO authenticated
  USING (true);
