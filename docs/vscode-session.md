# Staxio — Sessão de Verificação e Implementação

## Contexto
Lê os ficheiros @docs/Setup.md e verifica o que está implementado vs o que foi definido nesta sessão.

---

## O que foi definido nesta sessão e precisa de verificação/implementação

### 1. Migration 005 — verificar se existe
Ficheiro: `supabase/migrations/005_suppliers_folders_doctype.sql`

Se não existir, criar com:
- Tabela `suppliers` (name, nif, keywords[], type, auto_detected, active)
- Tabela `folder_config` (key, label, folder_id, folder_name, parent_key, auto_create, editable)
- Coluna `doc_type` na `processing_queue`
- Dados iniciais:

**suppliers:**
- EasyPay → keywords: ['easypay'] → type: ecommerce
- Awartsian → keywords: ['awartsian'] → type: ecommerce
- Gemmams → keywords: ['gemmams'] → type: ecommerce
- CGD → keywords: ['caixa geral', 'cgd'] → type: bank
- PayPal → keywords: ['paypal'] → type: bank
- Revolut → keywords: ['revolut'] → type: bank

**folder_config (IDs reais):**
- root → 1klmq4RPuov5T9KJeYz7ffOH-avXIptN7
- inbox → 1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7
- internacional → 1gonX4rK5wP5N_7615tOdUw1E1EFs7iOo
- faturas_vendas → 1ZHYr7mXTFifFMO9FNRWo6dzqWw3iVv8d
- extratos → 1Bul9s71rvh0ijYjhKNRF9gMNJ2tFDMpN
- compras → 1G7OOdefj6aod2AHLypzhs-yxettbxEr5
- taloes_1t / 2t / 3t / 4t → auto_create: true, folder_id: null

---

### 2. classify.utils.ts — verificar lógica de doc_type

Deve existir e implementar:

**DocType:**
```
issued | ecommerce | bank_statement | supplies | international | received | unknown
```

**Lógica de classificação (por prioridade):**
1. `issuerNif === companyNif (514084235)` → issued
2. `confidence < 0.6` → unknown
3. `currency !== EUR` → international
4. `nif não-PT` → international
5. `country fora PT` → international
6. `supplier match keywords ecommerce` → ecommerce
7. `supplier match keywords bank` → bank_statement
8. `supplier match keywords supplies` → supplies
9. `!nif && !country` → unknown
10. resto → received

**buildDestPath deve gerar:**
- issued → `Faturas Vendas/{MÊS}/`
- bank_statement → `Extratos Bancarios/{MÊS}/`
- supplies → `Compras & Materias Primas/{MÊS}/`
- international → `Internacional/{ANO}/{MÊS}/`
- ecommerce → `{ANO}/Faturas e Talões {Q}T/eCommerce/`
- received → `{ANO}/Faturas e Talões {Q}T/{MÊS}/`
- unknown → `_aguardar_validacao`

---

### 3. Edge Function /classify — verificar integração

Deve:
- Ler `suppliers` da tabela Supabase (não hardcoded)
- Ler `folder_config` da tabela Supabase (não hardcoded)
- Passar `companyNif = '514084235'` na classificação
- Guardar `doc_type` na `processing_queue`
- Quando detecta fornecedor novo (auto_detected), inserir em `suppliers` com `auto_detected: true`

---

### 4. Edge Function /move — verificar criação de pastas dinâmicas

Deve criar automaticamente as pastas na Drive se não existirem:
- `{ANO}/Faturas e Talões {Q}T/` — por trimestre
- `{ANO}/Faturas e Talões {Q}T/{MÊS}/`
- `{ANO}/Faturas e Talões {Q}T/eCommerce/`
- `Faturas Vendas/{MÊS}/`
- `Extratos Bancarios/{MÊS}/`
- `Compras & Materias Primas/{MÊS}/`
- `Internacional/{ANO}/{MÊS}/`
- `_aguardar_validacao/`

Quando cria pasta trimestral, actualiza `folder_id` na `folder_config`.

---

### 5. SettingsComponent — verificar secções

Deve ter:
- **Pastas Drive** — tabela com todas as entradas de `folder_config` editáveis
- **Fornecedores** — lista de `suppliers` com:
  - Toggle activo/inactivo
  - Edição de keywords
  - Edição de type (ecommerce / normal / bank / supplies)
  - Adicionar novo fornecedor
  - Badge "Auto-detectado" nos detectados pela IA
- **Processamento** — toggle pg_cron + botão "Processar agora"

---

### 6. ManualReviewComponent — verificar filtro por doc_type unknown

Deve listar itens com `status = manual_review OR error OR (status = pending AND doc_type = unknown)`.

---

### 7. Testes — correr e verificar

```bash
pnpm test:edge
pnpm test
```

Todos devem estar verdes. Se algum falhar, corrige antes de avançar.

---

### 8. Deploy — após verificação

```bash
pnpm dlx supabase db push
pnpm functions:deploy
```

---

## Regras de Arquitectura (nunca violar)
- Standalone components, zero NgModules
- `inject()` nunca constructor injection
- `@if/@for` nunca `*ngIf/*ngFor`
- Signals privados expostos como `asReadonly()`
- Signal Forms para formulários
- Testes Vitest primeiro

---

## Instrução
Verifica cada ponto acima. Para cada um:
1. Se já existe e está correcto → confirma com ✅
2. Se não existe ou está incompleto → implementa imediatamente (testes primeiro)
3. No final apresenta resumo do estado de cada ponto
