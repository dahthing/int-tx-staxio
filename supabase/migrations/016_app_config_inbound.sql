-- Migration: 016_app_config_inbound.sql
-- Adiciona chaves de configuração para email inbound

INSERT INTO app_config (key, value) VALUES
  ('inbound_provider', 'resend'),
  ('inbound_email',    '')
ON CONFLICT (key) DO NOTHING;
