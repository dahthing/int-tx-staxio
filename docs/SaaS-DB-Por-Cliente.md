# Supabase — DB por Cliente

## Opções Analisadas

| Opção | Descrição | Prós | Contras |
|---|---|---|---|
| **A** | Shared DB + RLS por `tenant_id` | Simples, barato, fácil de migrar | Risco de data leak por bug de RLS; performance partilhada; compliance GDPR mais complexo |
| **B** | Schema por tenant (`tenant_abc.processing_queue`) | Isolamento médio, uma DB | Supabase não suporta bem multi-schema nativamente; migrações complexas |
| **C** | **Supabase project por cliente** ← ESCOLHIDA | Máximo isolamento; GDPR simples; portabilidade | Custo ~€25/mês por tenant; provisioning mais complexo |
| **D** | Híbrido (shared free, dedicated enterprise) | Optimiza custo | Duas arquitecturas para manter; complexidade duplicada |

---

## Opção C — Implementação Prática

### Provisioning via Management API

Quando um cliente se regista, um script/edge function cria o projecto automaticamente:

```typescript
// POST https://api.supabase.com/v1/projects
const response = await fetch('https://api.supabase.com/v1/projects', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: `staxio-${tenantSlug}`,
    organization_id: ORG_ID,
    plan: 'pro',
    region: 'eu-central-1', // Frankfurt — GDPR
    db_pass: crypto.randomUUID(),
  }),
});
const project = await response.json();
// { id, anon_key, service_role_key, db_host, ... }
```

Após criação:
1. Aplicar migrations: `supabase db push --db-url postgresql://...`
2. Guardar credenciais cifradas na Admin DB:

```sql
-- Admin DB: tabela tenants
INSERT INTO tenants (slug, supabase_url, anon_key, service_role_key_enc, region, created_at)
VALUES ($1, $2, $3, encrypt($4, $KEY), 'eu-central-1', now());
```

### Routing Aplicacional

**Admin DB** (Supabase interno partilhado):

```sql
CREATE TABLE tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,          -- ex: "empresa-abc"
  custom_domain text,                          -- ex: "contabilidade.empresa.pt"
  supabase_url  text NOT NULL,
  anon_key      text NOT NULL,
  service_role_key_enc text NOT NULL,          -- cifrado com KMS
  plan          text NOT NULL DEFAULT 'starter',
  region        text NOT NULL DEFAULT 'eu-central-1',
  created_at    timestamptz DEFAULT now()
);
```

**Angular — Tenant Client Factory:**

```typescript
// tenant-client.factory.ts
export function createTenantClient(tenantConfig: TenantConfig): SupabaseClient {
  return createClient(tenantConfig.supabaseUrl, tenantConfig.anonKey, {
    auth: { persistSession: true, storageKey: `staxio_${tenantConfig.slug}` },
  });
}

// No login flow:
// 1. Resolver tenant pelo subdomínio/domínio
// 2. GET /api/tenant-config?slug=empresa-abc (endpoint admin)
// 3. Instanciar client com as credenciais do tenant
// 4. Injectar via DI ou signal global
```

**Edge Functions** — recebem contexto do tenant:

```typescript
// Em cada edge function que opera dados do tenant:
const tenantUrl = req.headers.get('x-tenant-url');
const tenantKey = req.headers.get('x-tenant-service-key'); // decifrado pelo gateway
const supabase = createClient(tenantUrl, tenantKey);
```

### Migrations Multi-tenant

Script TypeScript que itera todos os tenants e aplica a migration:

```typescript
// scripts/migrate-all-tenants.ts
import { createClient } from '@supabase/supabase-js';

const adminDb = createClient(ADMIN_SUPABASE_URL, ADMIN_SERVICE_KEY);
const { data: tenants } = await adminDb.from('tenants').select('*');

for (const tenant of tenants) {
  const tenantKey = decrypt(tenant.service_role_key_enc);
  // Aplicar via supabase CLI ou dbmate
  await exec(`supabase db push --db-url ${buildDbUrl(tenant, tenantKey)}`);
  console.log(`✓ ${tenant.slug} migrado`);
}
```

**Estratégias de rollout:**
- **Rolling por tenant:** migra um a um, reverte se falhar. Seguro, lento.
- **Blue-green:** mantém schema v1 e v2 compatíveis durante transição. Complexo mas zero downtime.
- **Ferramentas:** `supabase-cli`, `dbmate`, `atlas` (suporta multi-target nativamente).

### Auth Cross-tenant

- **Supabase Auth é por projecto** — cada tenant tem o seu sistema de autenticação isolado.
- Utilizadores não partilham sessões entre tenants (correcto para SaaS B2B).
- **Google OAuth:** redirect URI centralizada com routing por tenant:
  - `https://staxio.app/auth/callback?tenant=empresa-abc`
  - O callback resolve o tenant, troca o code pelo token e guarda na DB do tenant.
- **SSO futuro (Enterprise):** Auth Hub central com JWT cross-validation ou SAML proxy.

### Custos Estimados

| Item | Custo |
|---|---|
| Supabase Pro por tenant | ~€25/mês |
| Supabase Free tier (trial) | €0 — mas limitado: 500MB DB, 1GB storage, pausado após 1 semana inactiva |
| Supabase Management API | Incluído no plano da organização |
| **Break-even** | Plano Starter €19/mês não cobre o custo de infra — Starter deve ser €29+ ou usar Free tier apenas para trial curto |

Ver pricing do Staxio em [[SaaS-Roadmap]].

> **Atenção:** Supabase Free tier pausa projectos após 1 semana de inactividade. Não adequado para clientes em produção. Usar apenas para demos/trials de 14 dias.

### Backup e Restore

- **Supabase Pro:** PITR (Point-in-Time Recovery) activado por defeito — recovery até ao segundo.
- **Export manual:**
  ```bash
  supabase db dump --db-url postgresql://postgres:<pass>@<host>:5432/postgres \
    --file backup-empresa-abc-$(date +%Y%m%d).sql
  ```
- **Script de backup periódico:** cron job que exporta para S3/Drive do cliente com retenção configurável.
- **GDPR — direito ao apagamento:** `DROP` do projecto Supabase via Management API apaga tudo de forma irrecuperável.

### Drive por Cliente

- Cada cliente liga a sua própria Google Drive via **Google OAuth user token** (ver [[SaaS-Roadmap]] D012).
- Tokens OAuth (`access_token`, `refresh_token`) armazenados **cifrados na DB do próprio tenant** — nunca na Admin DB.
- **Service Account centralizada deixa de ser necessária** após migração SaaS.
- Scopes necessários: `https://www.googleapis.com/auth/drive` (ou scope mais restrito se possível).
- Renovação do `access_token` feita pela edge function com o `refresh_token` guardado.

---

## Recomendação

Começar com a **Opção C desde o início** para evitar refactor de RLS depois. O custo de infra obriga a ajustar o pricing (Starter ≥ €29/mês ou trial limitado a Free tier).

Implementar uma **abstracção "tenant client factory"** em Angular e nas edge functions que recebe as credenciais do tenant e devolve um `SupabaseClient` configurado — toda a lógica de negócio usa esta abstracção sem saber qual é o projecto Supabase por baixo.

---

## Links

[[SaaS-Roadmap]]
[[Arquitectura]]
[[Decisoes]]
