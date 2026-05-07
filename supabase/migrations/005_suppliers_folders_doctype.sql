-- Migration: 005_suppliers_folders_doctype.sql
-- Staxio — Fornecedores, configuração de pastas, tipos de documento

-- ============================================================
-- ENUM: tipo de documento (expande processing_status existente)
-- ============================================================
CREATE TYPE doc_type AS ENUM (
  'received',       -- fatura recebida normal
  'issued',         -- fatura emitida por nós (NIF 514084235)
  'ecommerce',      -- easypay, awartsian, gemmams, etc.
  'bank_statement', -- extrato CGD, PayPal, Revolut
  'supplies',       -- compras & matérias primas gemmams
  'international',  -- NIF não-PT ou país fora PT
  'unknown'         -- baixa confiança → aguardar validação
);

-- ============================================================
-- Adiciona doc_type à processing_queue
-- ============================================================
ALTER TABLE processing_queue
  ADD COLUMN IF NOT EXISTS doc_type doc_type DEFAULT 'unknown';

-- ============================================================
-- TABLE: suppliers
-- Lista de fornecedores conhecidos, auto-actualizada pelo /classify
-- ============================================================
CREATE TABLE suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  nif            TEXT,
  keywords       TEXT[] DEFAULT '{}',   -- termos para detecção
  type           TEXT NOT NULL CHECK (type IN ('ecommerce', 'normal', 'bank', 'supplies')),
  auto_detected  BOOLEAN DEFAULT false, -- true = detectado pela IA, false = manual
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fornecedores iniciais conhecidos
INSERT INTO suppliers (name, nif, keywords, type, auto_detected) VALUES
  ('EasyPay',  null, ARRAY['easypay', 'easy pay'],           'ecommerce', false),
  ('Awartsian', null, ARRAY['awartsian'],                     'ecommerce', false),
  ('Gemmams',  null, ARRAY['gemmams', 'gem mams'],            'ecommerce', false),
  ('CGD',      null, ARRAY['caixa geral', 'cgd', 'caixa geral de depositos'], 'bank', false),
  ('PayPal',   null, ARRAY['paypal', 'pay pal'],              'bank',      false),
  ('Revolut',  null, ARRAY['revolut'],                        'bank',      false);

-- ============================================================
-- TABLE: folder_config
-- Configuração completa de pastas Drive, gerível pelo Settings
-- ============================================================
CREATE TABLE folder_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT NOT NULL UNIQUE,   -- identificador interno
  label        TEXT NOT NULL,          -- nome legível para o Settings UI
  folder_id    TEXT,                   -- Google Drive folder ID
  folder_name  TEXT,                   -- nome da pasta na Drive
  parent_key   TEXT,                   -- chave da pasta pai (para hierarquia)
  auto_create  BOOLEAN DEFAULT false,  -- Staxio cria automaticamente se não existir
  editable     BOOLEAN DEFAULT true,   -- editável no Settings UI
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pastas fixas (IDs reais)
INSERT INTO folder_config (key, label, folder_id, folder_name, parent_key, auto_create, editable) VALUES
  ('root',          'Staxio (root)',            '1klmq4RPuov5T9KJeYz7ffOH-avXIptN7', 'Staxio',                    null,   false, true),
  ('inbox',         'Inbox',                    '1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7', 'Inbox_Contabilidade',       'root', false, true),
  ('internacional', 'Internacional',            '1gonX4rK5wP5N_7615tOdUw1E1EFs7iOo', 'Internacional',             'root', false, true),
  ('faturas_vendas','Faturas Vendas',           '1ZHYr7mXTFifFMO9FNRWo6dzqWw3iVv8d', 'Faturas Vendas',            'root', false, true),
  ('extratos',      'Extratos Bancários',       '1Bul9s71rvh0ijYjhKNRF9gMNJ2tFDMpN', 'Extratos Bancarios',        'root', false, true),
  ('compras',       'Compras & Matérias Primas','1G7OOdefj6aod2AHLypzhs-yxettbxEr5', 'Compras & Materias Primas', 'root', false, true);

-- Pastas automáticas (criadas pelo Staxio conforme necessário)
INSERT INTO folder_config (key, label, folder_id, folder_name, parent_key, auto_create, editable) VALUES
  ('taloes_1t', 'Faturas e Talões 1T', null, 'Faturas e Talões 1T', 'root', true, false),
  ('taloes_2t', 'Faturas e Talões 2T', null, 'Faturas e Talões 2T', 'root', true, false),
  ('taloes_3t', 'Faturas e Talões 3T', null, 'Faturas e Talões 3T', 'root', true, false),
  ('taloes_4t', 'Faturas e Talões 4T', null, 'Faturas e Talões 4T', 'root', true, false);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_suppliers_keywords ON suppliers USING GIN(keywords);
CREATE INDEX idx_suppliers_nif      ON suppliers(nif) WHERE nif IS NOT NULL;
CREATE INDEX idx_suppliers_type     ON suppliers(type);
CREATE INDEX idx_folder_config_key  ON folder_config(key);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_folder_config_updated_at
  BEFORE UPDATE ON folder_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE suppliers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_suppliers"     ON suppliers     FOR SELECT USING (true);
CREATE POLICY "anon_read_folder_config" ON folder_config FOR SELECT USING (true);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE suppliers;
ALTER PUBLICATION supabase_realtime ADD TABLE folder_config;
