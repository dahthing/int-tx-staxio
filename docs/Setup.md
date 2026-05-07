# Staxio — Contexto Completo para Claude VSCode

## Stack
- Angular 21, Signals 100%, Zoneless, Signal Forms
- RxJS apenas para HTTP (HttpClient)
- Vitest (default Angular 21)
- Supabase (PostgreSQL + Edge Functions Deno 2.1 + Realtime)
- Google Drive API (única fonte de documentos)
- Anthropic Claude Vision (claude-sonnet-4-20250514)
- pnpm como package manager
- NIF empresa: 514084235 (Cosmosdesígnio LDA / TargX)

## Drive Folder IDs (fixos)
| Key | Pasta | ID |
|---|---|---|
| root | Staxio | 1klmq4RPuov5T9KJeYz7ffOH-avXIptN7 |
| inbox | Inbox_Contabilidade | 1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7 |
| internacional | Internacional | 1gonX4rK5wP5N_7615tOdUw1E1EFs7iOo |
| faturas_vendas | Faturas Vendas | 1ZHYr7mXTFifFMO9FNRWo6dzqWw3iVv8d |
| extratos | Extratos Bancarios | 1Bul9s71rvh0ijYjhKNRF9gMNJ2tFDMpN |
| compras | Compras & Materias Primas | 1G7OOdefj6aod2AHLypzhs-yxettbxEr5 |

## Drive Folders (criadas automaticamente pelo Staxio)
- `{ANO}/Faturas e Talões {Q}T/` → criada por trimestre
- `{ANO}/Faturas e Talões {Q}T/{MÊS}/` → criada por mês
- `{ANO}/Faturas e Talões {Q}T/eCommerce/` → criada por trimestre
- `Faturas Vendas/{MÊS}/`
- `Extratos Bancarios/{MÊS}/`
- `Compras & Materias Primas/{MÊS}/`
- `Internacional/{ANO}/{MÊS}/`

## Supabase Project
- URL: https://uwjajsukgdulyvjjeazd.supabase.co
- Automação: pg_cron a cada 5 minutos

---

## Regras de Arquitectura — NUNCA VIOLAR
- Standalone components, zero NgModules
- `inject()` nunca constructor injection
- `@if/@for/@switch` nunca `*ngIf/*ngFor`
- Signals privados `_name = signal()` expostos como `_name.asReadonly()`
- `effect()` apenas para side effects
- `computed()` para todas as derivações
- Signal Forms para todos os formulários
- `OnPush` em todos os componentes
- Testes Vitest primeiro, implementação depois

---

## Lógica de Classificação (doc_type)

| Condição | doc_type | Destino |
|---|---|---|
| NIF emitente = 514084235 | issued | Faturas Vendas/{MÊS}/ |
| Fornecedor: easypay, awartsian, gemmams | ecommerce | {ANO}/Faturas e Talões {Q}T/eCommerce/ |
| CGD, PayPal, Revolut | bank_statement | Extratos Bancarios/{MÊS}/ |
| Material gemmams | supplies | Compras & Materias Primas/{MÊS}/ |
| NIF não-PT / país fora PT / moeda ≠ EUR | international | Internacional/{ANO}/{MÊS}/ |
| Confiança < 0.6 / sem NIF e sem país | unknown | _aguardar_validacao → revisão manual |
| Resto | received | {ANO}/Faturas e Talões {Q}T/{MÊS}/ |

## Tabela suppliers (gerível pelo utilizador)
- `name`, `nif`, `keywords[]`, `type` (ecommerce/normal/bank/supplies)
- `auto_detected: true` quando detectado pela primeira vez pela IA
- Novos fornecedores detectados são adicionados automaticamente para revisão
- Editável no Settings UI

---

## FEITO

### Supabase
- [x] Migration 001: processing_queue, processing_logs, app_config, RLS, Realtime
- [x] Migration 003: pg_cron a cada 5 minutos
- [x] Migration 005: suppliers, folder_config, doc_type enum
- [x] Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, ANTHROPIC_API_KEY, DRIVE_*_FOLDER_ID, COMPANY_NIF

### Edge Functions
- [x] /classify v2 — detecção doc_type, suppliers, folder_config dinâmica
- [x] /move — cria pastas Drive automaticamente por trimestre/mês
- [x] /config — GET + PATCH app_config e folder_config

### Angular
- [x] app.config.ts, models, services, interceptors
- [x] DashboardComponent + estatísticas
- [x] InboxListComponent
- [x] LogViewerComponent (Realtime)
- [x] MetadataFormComponent (Signal Forms)
- [x] ManualReviewComponent
- [x] SettingsComponent (folder_config: root, inbox, internacional, faturas_vendas, extratos, compras + suppliers)
- [x] Angular Material 21, tema Staxio, dark/light
- [x] Shell layout sidebar + top bar
- [x] Auth (Supabase email/password)
- [x] PWA (Fase 12)
- [x] App a correr em localhost:4200

---

## A FAZER

### Fase 10 — Deploy VPS ⏸ STANDBY
> VPS própria com domínio. Com domínio → substituir pg_cron por Drive Push Webhook.

- [ ] Dockerfile + nginx para Angular
- [ ] Docker Compose
- [ ] GitHub Actions: lint + testes + build + deploy SSH
- [ ] SSL Let's Encrypt
- [ ] Domínio verificado Google Cloud → webhook

---

## Comandos úteis

```bash
pnpm dev                    # Tudo local (localhost:4200)
pnpm test:edge              # Vitest Edge Functions
pnpm test                   # Vitest Angular
pnpm test:all               # Ambos
pnpm supabase:reset         # Recria DB local
pnpm supabase:studio        # localhost:54323
pnpm functions:deploy       # Deploy produção
pnpm dlx supabase db push   # Migration produção
```
