# Decisões de Arquitectura

## D001 — Google Drive como única fonte de verdade
**Data:** 2025-05-06
**Decisão:** Sem suporte a ficheiros locais. Drive é a única fonte.
**Razão:** O utilizador já usa a app Drive para scan → PDF. Elimina File System Access API e toda a complexidade de uploads.
**Trade-off:** Dependência total na Drive API / conectividade.

---

## D002 — Supabase Edge Functions como backend
**Data:** 2025-05-06
**Decisão:** Edge Functions (Deno 2.1) em vez de servidor dedicado.
**Razão:** Chave Anthropic não pode estar no frontend. Edge Functions são serverless, sem infra, custo ~zero para o volume esperado.
**Trade-off:** Cold start ~200ms. Aceitável para processamento pontual (não tempo-real).

---

## D003 — Processamento manual com botão + log auditável
**Data:** 2025-05-06
**Decisão:** MVP com trigger manual no dashboard. Webhook na Fase 5.
**Razão:** Reduz complexidade inicial. Webhook requer renovação TTL 7 dias.
**Trade-off:** Utilizador tem de abrir app para processar.

---

## D004 — Falha de extracção → fila _nao_classificados
**Data:** 2025-05-06
**Decisão:** Ficheiros com extracção falhada vão para pasta `_nao_classificados/` na Drive + entram numa fila de revisão visível no dashboard.
**Razão:** Não bloquear o processamento dos restantes ficheiros.

---

## D005 — 100% Signals + RxJS apenas para HTTP
**Data:** 2025-05-06
**Decisão:** Estado da aplicação 100% em Signals Angular 21. RxJS apenas para HttpClient e streams de eventos.
**Razão:** Zoneless + Signals é o padrão idiomático Angular 21. Evita mistura de paradigmas.

---

## D006 — Vitest como test runner
**Data:** 2025-05-06
**Decisão:** Vitest (default Angular 21). Sem Karma, sem Jest.
**Razão:** Default do Angular CLI v21. Mais rápido, melhor DX.

---

## D007 — Obsidian /docs como segundo cérebro
**Data:** 2025-05-06
**Decisão:** Pasta `/docs` dentro do projecto Angular. Obsidian aponta para esta pasta.
**Razão:** Claude no VSCode usa estes ficheiros como contexto em cada sessão, sem precisar de reler o projecto inteiro.

---

## D008 — Path selector: tree-picker live da Drive
**Data:** 2026-05-08
**Decisão:** Usar tree-picker live da Drive (edge function `list-folders`) em vez de dropdown de `folder_config`.
**Razão:** Flexibilidade para navegar qualquer nível da hierarquia de pastas.

---

## D009 — Training: regras determinísticas + few-shot
**Data:** 2026-05-08
**Decisão:** Detectar documentos próprios com NIF 514084235 deterministicamente; usar few-shot com `training_examples` para casos ambíguos.
**Razão:** Regras NIF têm 100% de precisão nos casos claros; few-shot cobre edge cases sem fine-tuning.

---

## D010 — Re-mover documentos concluídos
**Data:** 2026-05-08
**Decisão:** Ao mudar pasta de um documento `done`, chamar edge function `move-existing` que move o ficheiro físico na Drive.
**Razão:** Manter Drive como fonte de verdade (D001); metadados e ficheiro físico devem estar sincronizados.

---

## D011 — SaaS: Supabase project por cliente
**Data:** 2026-05-08
**Decisão:** Cada cliente tem o seu projecto Supabase dedicado (DB, Auth, Storage separados).
**Razão:** Máximo isolamento de dados; compliance GDPR simplificado; portabilidade de dados por cliente.

---

## D012 — SaaS: OAuth Google por cliente
**Data:** 2026-05-08
**Decisão:** Cada cliente autentica a sua própria Google Drive via OAuth user token.
**Razão:** Elimina dependência de Service Account partilhada; melhor controlo de acesso; standard para SaaS multi-tenant.
