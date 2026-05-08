# SaaS Roadmap — Staxio

## Decisões Tomadas

| # | Tema | Decisão | Rationale |
|---|---|---|---|
| 1 | Pricing | Planos tiered: Starter / Pro / Enterprise | Permite crescimento incremental do cliente sem lock-in imediato |
| 2 | Google Drive Auth | OAuth user token por cliente | Elimina dependência de Service Account partilhada; cada cliente controla o seu acesso |
| 3 | Isolamento de dados | Supabase project por cliente (DB separada) | Máximo isolamento; compliance GDPR simplificado; portabilidade por cliente |
| 4 | Multi-utilizador | RBAC completo: owner / editor / viewer | Permite equipas colaborar sem expor dados entre roles |
| 5 | GDPR | RGPD compliant, só metadados no Supabase, cifra em repouso, retenção configurável por cliente | Cumpre requisitos legais EU; minimização de dados |
| 6 | Domínio | `app.staxio.app` base; subdomínio `cliente.staxio.app` e domínio próprio como add-ons pagos | Branding base gratuito; domínio próprio como alavanca de upgrade |
| 7 | Billing | Stripe Checkout + Portal | Standard SaaS; self-service para upgrade/downgrade/cancelamento |
| 8 | Monitoring | Sentry, dashboard por cliente no admin, alertas email, logs de auditoria visíveis ao cliente | Observabilidade completa; transparência para o cliente |

---

## Planos Propostos

### Starter — ~€19/mês
- Até 100 documentos/mês processados
- 1 utilizador (owner)
- 1 pasta Drive monitorizada
- Subdomínio `cliente.staxio.app`
- Suporte por email (72h)
- Retenção de logs: 30 dias

### Pro — ~€49/mês
- Até 500 documentos/mês processados
- Até 5 utilizadores (owner + editors + viewers)
- Múltiplas pastas Drive monitorizadas
- Subdomínio incluído; domínio próprio como add-on (~€9/mês)
- Suporte por email (24h)
- Retenção de logs: 90 dias
- Exportação de relatórios CSV/PDF

### Enterprise — Preço por acordo
- Documentos ilimitados
- Utilizadores ilimitados
- RBAC granular
- Domínio próprio incluído
- White-label (logo/cores do cliente)
- SLA 99,9% com suporte dedicado
- Retenção de logs: configurável (até 7 anos para compliance)
- Onboarding assistido
- Contrato + NDA

---

## Arquitectura de Alto Nível

### Tenant Provisioning
Quando um cliente se regista, o sistema cria automaticamente:
1. Um novo **Supabase project** dedicado (via Management API) com DB, Auth e Storage próprios.
2. Um registo na **Admin DB** (Supabase partilhado interno) na tabela `tenants` com `supabase_url`, `anon_key`, `service_role_key` cifrados.
3. Subdomínio DNS `cliente.staxio.app` apontado para a aplicação Angular.

### Routing Aplicacional
- O frontend Angular resolve o tenant pelo subdomínio (ou domínio próprio).
- No login, o app busca as credenciais Supabase do tenant na Admin DB e instancia um `SupabaseClient` dedicado.
- Todas as chamadas de dados usam o client do tenant — nunca a Admin DB.

### Google Drive por Cliente
- Cada cliente liga a sua Drive via **Google OAuth 2.0** (não Service Account).
- Os tokens OAuth são armazenados cifrados na DB do próprio tenant.
- Redirect URI: `staxio.app/auth/callback?tenant=<slug>`

### Edge Functions
- Deploy partilhado (Supabase project central ou por tenant).
- Recebem `supabase_url` + `service_role_key` do tenant por header/env para operar na DB correcta.

### Billing
- Stripe Checkout para subscrições.
- Webhooks Stripe actualizam o estado do plano na Admin DB.
- Portal Stripe para self-service do cliente.

---

## Fases de Implementação

### Fase 1 — MVP SaaS (Core)
**Objectivo:** primeiro cliente pago a funcionar end-to-end.

- [ ] Registo/login com Supabase Auth (email + password)
- [ ] Provisioning automático de tenant (Supabase Management API)
- [ ] Admin DB com tabela `tenants`
- [ ] Onboarding: ligar Google Drive via OAuth
- [ ] Stripe Checkout para plano Starter/Pro
- [ ] Subdomínio automático `cliente.staxio.app`
- [ ] Funcionalidade core de classificação (já existe) adaptada a multi-tenant

**Duração estimada:** 6–8 semanas

### Fase 2 — Features
**Objectivo:** retenção e upgrade de clientes.

- [ ] RBAC: owner / editor / viewer com convites por email
- [ ] Dashboard admin por cliente (documentos, erros, uso)
- [ ] Sentry integrado com tenant context
- [ ] Alertas email (erros de classificação, quota a ~80%)
- [ ] Logs de auditoria visíveis ao cliente
- [ ] Exportação CSV/PDF de relatórios
- [ ] Domínio próprio como add-on (DNS + TLS automático)
- [ ] Retenção de logs configurável

**Duração estimada:** 6–10 semanas

### Fase 3 — Enterprise
**Objectivo:** clientes grandes e revendedores.

- [ ] White-label (logo, cores, domínio próprio incluído)
- [ ] SLA formal com monitorização uptime
- [ ] Onboarding assistido e contrato
- [ ] SSO (SAML/OIDC) para empresas com IdP próprio
- [ ] API pública para integração com ERP/contabilidade
- [ ] Relatórios avançados e dashboards customizáveis
- [ ] Suporte multi-região (EU residency garantida)

**Duração estimada:** 12+ semanas

---

## Open Issues / Perguntas em Aberto

- **Limites de documentos:** como contar? Por PDF processado com sucesso, ou por tentativa?
- **Trial gratuito:** quantos dias? Com cartão ou sem?
- **Gestão de overages:** bloquear ao atingir limite, cobrar por excesso, ou notificar apenas?
- **Migrações multi-tenant:** estratégia de rollout quando há breaking schema changes (ver [[SaaS-DB-Por-Cliente]])
- **Região Supabase:** EU (Frankfurt) por defeito para GDPR? Cliente pode escolher?
- **Cancelamento:** o que acontece à DB do tenant? Período de graça antes de destruir?
- **Free tier / trial:** usar Supabase Free tier para trials tem limite de 2 projectos activos na org — pode ser um bloqueio.
- **Domínio próprio:** wildcard SSL com Let's Encrypt ou Cloudflare? Quem gere o DNS do cliente?

---

## Links

[[Arquitectura]]
[[Decisoes]]
[[SaaS-DB-Por-Cliente]]
