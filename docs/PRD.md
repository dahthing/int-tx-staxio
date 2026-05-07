# PRD — Assistente Contabilístico

**Estado:** Em desenvolvimento
**Última actualização:** 2025-05-06

---

## Objectivo

Classificar e mover automaticamente faturas e talões de uma pasta **Inbox** na Google Drive para uma estrutura hierárquica por ano, trimestre e mês. Usa IA (Claude Vision) para extrair metadados dos documentos.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Angular 21, Signals, Zoneless, Signal Forms |
| Testes | Vitest (default Angular 21) |
| Backend | Supabase Edge Functions (Deno 2.1) |
| Base de dados | Supabase PostgreSQL |
| Realtime | Supabase Realtime → Angular Signals |
| Armazenamento docs | Google Drive (única fonte de verdade) |
| IA | Anthropic Claude Vision (claude-sonnet-4-20250514) |

---

## Estrutura de Pastas na Drive

```
ROOT/
├── Inbox_Contabilidade/     ← fonte de entrada
├── Contabilidade/
│   └── {ANO}/
│       ├── Q1/ → JAN, FEV, MAR
│       ├── Q2/ → ABR, MAI, JUN
│       ├── Q3/ → JUL, AGO, SET
│       └── Q4/ → OUT, NOV, DEZ
└── Internacional/
    └── {ANO}/
        └── (mesma estrutura)
```

---

## Regras de Classificação

### Nacional
- NIF PT válido (9 dígitos + checksum)
- País emissor: Portugal

### Internacional
- NIF não-PT **ou** país fora de PT **ou** moeda não-EUR
- Qualquer combinação → pasta `Internacional/`

### Prioridade de extracção de metadados
1. ATCUD / QR Code (canónico para docs PT)
2. OCR estruturado via Claude Vision
3. Fallback: edição manual no dashboard

---

## Regras de Ficheiros

- **Renomeação:** `YYYY-MM-DD_fornecedor_valor.ext`
- **Conflito:** adiciona sufixo `_1`, `_2`, etc.
- **Falha de extracção:** move para `_nao_classificados/` + entra na fila de revisão

---

## Fluxo Principal

```
Utilizador faz scan → Drive App → Inbox_Contabilidade
        ↓
[Dashboard] botão "Processar" ou webhook automático
        ↓
Edge Function /classify
  → lê PDF da Drive
  → Claude Vision extrai: data, NIF, fornecedor, valor, país
  → determina: nacional ou internacional
  → gera path destino
        ↓
Edge Function /move
  → renomeia ficheiro
  → cria pastas se não existem
  → move na Drive
  → regista em processing_logs (Supabase)
        ↓
Dashboard actualiza via Supabase Realtime
```

---

## Fases

- [ ] **Fase 1** — Schema SQL + Edge Function /classify (testes primeiro)
- [ ] **Fase 2** — Edge Function /move
- [ ] **Fase 3** — Angular: Dashboard + InboxList + LogViewer
- [ ] **Fase 4** — Angular: MetadataForm (edição manual)
- [ ] **Fase 5** — Webhook Drive (automação completa)

---

## Decisões Registadas

Ver [[Decisoes]]
