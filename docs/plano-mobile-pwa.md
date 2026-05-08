# Plano Mobile + PWA — Staxio

> Documento de planeamento. Não é implementação. Pensado como mapa de decisões e faseamento, com riscos e trade-offs explícitos.

## 1. Contexto e diagnóstico do estado atual

### 1.1 Stack confirmada

A aplicação é Angular 21 puro, com várias decisões já alinhadas com o estado da arte: `provideZonelessChangeDetection`, `ChangeDetectionStrategy.OnPush` em todos os componentes inspecionados, signals (`signal`, `computed`, `effect`), router com `withComponentInputBinding` e `withViewTransitions`, e lazy loading por `loadComponent` em todas as rotas filhas. Material 21 e CDK 21 estão instalados, `@supabase/supabase-js` para auth e dados, `chart.js` para gráficos. Build via `@angular/build:application` (esbuild), testes em Vitest.

### 1.2 PWA já parcialmente configurado

Há trabalho de base já feito que evita partir do zero:

* `@angular/service-worker` instalado, `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })` no `app.config.ts`.
* `ngsw-config.json` com dois `assetGroups` (app shell em `prefetch`, assets em `lazy/prefetch`) e um `dataGroup` para Supabase com estratégia `freshness`, `timeout: 10s`, `maxAge: 1m`, `maxSize: 100`.
* `angular.json` com `"serviceWorker": "ngsw-config.json"` no target build.
* `public/manifest.webmanifest` válido: `display: standalone`, `orientation: portrait-primary`, `theme_color: #000000`, `lang: pt-PT`, ícones de 72 a 512 px, incluindo `icon-maskable-512x512.png` com `purpose: maskable`.
* `index.html` declara `theme-color`, `apple-mobile-web-app-capable`, `apple-touch-icon`, link para o manifest e para fontes (Material Icons + Roboto + Inter).

### 1.3 Onde a aplicação ainda não é mobile

O grosso do problema está na UX, não na infra PWA. Pontos concretos identificados na inspeção:

1. **Shell (`components/shell/shell.html`)**: navegação lateral fixa de largura `var(--stx-sidebar-width)` com modo `--collapsed`. Não há `@media` que esconda a sidebar abaixo de um breakpoint mobile, nem padrão de drawer overlay para ecrãs pequenos. A topbar tem `padding: 0 1.5rem`, sem `safe-area-inset` para o notch iOS, e o utilizador (`shell__topbar-user`) aparece sempre, comendo espaço horizontal.
2. **Manual review (`manual-review.html`)**: layout em duas colunas (`review__split`) com `iframe` de preview ao lado do formulário. Em mobile é catastrófico: o iframe ou ocupa quase tudo ou colapsa sem hierarquia. Há `@media (max-width: 900px)` parcial mas não chega.
3. **Inbox list (`inbox-list.html`)**: `<table>` HTML com 7 colunas (Ficheiro, Fornecedor, Data, Valor, Estado, Destino, Ações). A 360 px desfaz qualquer leitura. Não há padrão de cartão alternativo nem coluna prioritária.
4. **Dashboard**: tem `app-stats-cards`, três charts dentro de um grid, drawer de logs e drawer de edição (overlays laterais). O drawer lateral em mobile costuma ser pior que um bottom sheet.
5. **Forms**: muitos `input` com `font-size: 0.875rem`, abaixo do limiar mágico de 16 px que evita o auto-zoom do Safari iOS quando o campo recebe foco.
6. **Viewport meta**: `width=device-width, initial-scale=1`, sem `viewport-fit=cover`. Sem isto não consegues pintar até à margem física e usar `env(safe-area-inset-*)` em iPhone com notch ou Dynamic Island.
7. **Sem CDK Layout / BreakpointObserver**: a deteção de mobile é toda por CSS, o que é aceitável, mas algumas decisões (qual o conteúdo do header, mostrar bottom nav vs drawer) ganhariam em ser feitas no TypeScript com signals reativos.
8. **Cache de Supabase muito agressivo (`maxAge: 1m`)**: bom para performance online, mas a estratégia `freshness` tenta sempre rede primeiro com `timeout: 10s`. Em transições de rede flap, há latência percetível. Sem `dataGroup` em modo `performance` para listas relativamente estáticas (definições, perfil).
9. **Sem rota offline fallback**: se a app shell falhar a carregar uma rota não cached, o utilizador recebe um erro genérico.
10. **Sem A2HS prompting custom**: o evento `beforeinstallprompt` não está intercetado, logo a instalação só acontece pelo menu do browser.
11. **Sem updates de service worker tratados em UI**: sem `SwUpdate.versionUpdates` a notificar o utilizador para recarregar quando há nova versão. Risco real de stale UI durante uma semana de uso contínuo da PWA.

## 2. Estratégia: mobile first ou adaptativo

Há três caminhos possíveis. A recomendação é o intermédio.

### Opção A. Refactor mobile first total

Reescrever toda a CSS começando do mobile, build up até desktop. Maximiza qualidade, mas implica reescrever shell, dashboard, manual review e forms. Trade-off mau face ao estado atual: o desktop já funciona e regredir a UX desktop num produto B2B onde o utilizador-alvo trabalha em monitor é um risco político.

### Opção B. Adaptativo com fork de templates

Manter desktop como está, criar componentes paralelos `*-mobile.component`. Trade-off mau: duplicação, drift entre as duas versões, dois sítios para corrigir bugs. Tendencialmente acaba mal.

### Opção C (recomendada). Responsive layered, com camada mobile assumida

Manter o mesmo template Angular, mas introduzir uma **camada mobile assumida**:

* CDK `BreakpointObserver` central num `LayoutService`, com `isMobile$ = signal(...)` derivado de `Breakpoints.HandsetPortrait` ou um custom `(max-width: 768px)`.
* Templates condicionais usando `@if (isMobile()) { ... } @else { ... }` apenas onde a estrutura difere mesmo (shell, manual-review split, drawers virarem bottom sheets).
* CSS sempre com mobile como base e `@media (min-width: 768px)` a aumentar densidade. Inverte-se a lógica atual.
* Componentes pequenos (badges, botões, campos) ficam responsivos por CSS sem ramificação no template.

Trade-off honesto: o `BreakpointObserver` introduz reatividade a redimensionamentos, o que é bom em browser mas pode causar uma transição visual quando o ecrã roda. Aceitável, e melhor que a alternativa.

## 3. Componentes a refatorar (prioridade alta para baixa)

### 3.1 Shell (alta)

* Em mobile (`< 768px`): sidebar deixa de ser fixa, vira **bottom navigation** com os 5 itens atuais (`/`, `/review`, `/done`, `/training`, `/settings`). 5 itens é o limite saudável; se crescer, o último vira "Mais" com bottom sheet.
* Topbar: reduzir altura para 56 px em mobile, esconder o email do utilizador (mover para `/settings`), manter apenas o logo, badge de pendentes e botão de logout (ou move-se logout para definições).
* `safe-area-inset-top` na topbar e `safe-area-inset-bottom` na bottom nav. Adicionar `viewport-fit=cover` no `index.html`.
* `dvh` em vez de `vh` (já está em vários sítios, validar todos).

### 3.2 Manual review (alta)

* Em mobile: stack vertical com **preview colapsável** no topo (acordeão) e formulário a ocupar o ecrã. Por defeito preview fechada para reduzir scroll.
* Botões de aprovar/rejeitar fixos em `position: sticky; bottom: 0` com `safe-area-inset-bottom`.
* Substituir `<iframe>` por `<object>` ou pelo viewer do Drive em mobile, ou mostrar imagem render-only do PDF (primeira página convertida server-side ou via `pdfjs-dist`). O iframe sandbox em mobile é lento e mexe-se mal com gestos.

### 3.3 Inbox list (alta)

* Em mobile: substituir `<table>` por **lista de cartões** (mantendo o mesmo componente Angular, condicional no template). Cada cartão mostra ficheiro + fornecedor em duas linhas, valor e badge de estado em linha inferior, e ação primária à direita (Mover). Esconder destino e data secundária por defeito; expandir on tap.
* Em desktop manter a tabela atual.
* Reaproveitar `track entry.id` que já existe.

### 3.4 Dashboard (média)

* Em mobile: empilhar `app-stats-cards` em grid de 2 colunas (atualmente já há `@media (max-width: 700px)`).
* Charts: stack vertical, reduzir altura para 200 px, considerar lazy `@defer (on viewport)` em vez do `on idle` atual para os charts não consumirem CPU em mobile à entrada.
* Drawers laterais → bottom sheet em mobile (CDK `MatBottomSheet` já vem com Material).

### 3.5 Forms e inputs (média)

* `font-size: 16px` mínimo em todos os `input`/`textarea`/`select` para evitar zoom iOS.
* `inputmode` semântico: `inputmode="decimal"` em valor, `inputmode="numeric"` em NIF, `type="email"` onde aplicável.
* `autocomplete` correto.
* Touch targets mínimo 44×44 px (WCAG 2.5.5). Botões pequenos atuais `btn--sm` com `padding: 0.25rem 0.625rem` ficam abaixo desse mínimo, redimensionar em mobile.

### 3.6 Tooltips, hovers, focus (baixa)

Em touch não há hover. Material tooltips devem ser substituídos por labels visíveis ou long-press helpers. Validar todos os `matTooltip` críticos.

### 3.7 Charts (baixa)

`chart.js` em mobile precisa de `responsive: true`, `maintainAspectRatio: false`, e legendas no topo em vez de à direita. Considerar simplificar séries quando `isMobile()`.

## 4. Plano PWA detalhado

### 4.1 Web manifest

O manifest atual está perto do correto. Ajustes propostos:

* Adicionar `id: "/?source=pwa"` ou similar para identificar instâncias instaladas vs browser.
* Adicionar `scope: "/"` explícito.
* Adicionar `categories: ["business", "productivity", "finance"]`.
* Adicionar `screenshots` (recomendado para Chrome/Android install dialog) com `form_factor: "narrow"` e `"wide"`.
* Considerar `shortcuts` para atalhos diretos do ícone na home: "Revisão pendente", "Dashboard".
* Validar que `start_url: "/"` redireciona para login se sem sessão; se a app tiver auth obrigatório, manter `/` é correto.

### 4.2 Service worker (Angular SW)

A `ngsw-config.json` precisa de mais granularidade:

* `assetGroups.app` em `installMode: prefetch` está bem. Assegurar que inclui `/index.csr.html` ou similar se houver SSR; aqui não há.
* Adicionar um `assetGroup` separado para fontes externas (`https://fonts.googleapis.com/**` e `https://fonts.gstatic.com/**`) com `installMode: lazy` e `updateMode: prefetch`. Em alternativa, **self-host** das fontes (recomendado, ver §6).
* `dataGroups` adicionais:
    * `supabase-static` para tabelas de catálogo raramente alteradas (definições, países, planos): `strategy: performance`, `maxAge: 24h`, `maxSize: 50`.
    * Manter `supabase-api` em `freshness` para inbox/queue, mas baixar `timeout` para `5s` e considerar `maxAge: 5m` para tolerar offline curto.
* Evitar cache de operações `POST/PUT/PATCH/DELETE`: o Angular SW só faz cache de `GET` por defeito, mas validar.

### 4.3 Offline fallback

* Criar uma rota `/offline` com componente leve que diga "Sem ligação. A última vista permanece disponível".
* No `ngsw-config.json` declarar `navigationUrls` para distinguir navegações.
* Considerar que Supabase auth precisa de rede para refrescar o token. Em offline, tratar token expirado com gracioso fallback (mostrar UI cached, banner de "modo offline").

### 4.4 Update do service worker

Implementar `SwUpdate.versionUpdates` num `UpdateService`:

* Subscrever `versionUpdates`, filtrar `VERSION_READY`.
* Mostrar `MatSnackBar` com ação "Atualizar". Ao clicar, `document.location.reload()`.
* Adicionar `setInterval` para `checkForUpdate()` a cada 6 horas em sessões longas.

### 4.5 Add to Home Screen (A2HS)

* Capturar `beforeinstallprompt` num service global, guardar em signal.
* Mostrar um pequeno banner discreto, dispensável, quando o utilizador é elegível e ainda não instalou. Melhor sítio: `/dashboard` no fundo (acima da bottom nav), apenas uma vez por sessão.
* Dismissal persistido em `localStorage` para não chatear.
* iOS Safari não suporta `beforeinstallprompt`. Detetar `navigator.standalone === false` + iOS e mostrar instruções textuais ("Partilhar → Adicionar ao ecrã principal").

### 4.6 Push notifications (opcional, fase 3)

* `SwPush` está disponível com Angular. Backend Supabase pode emitir via edge functions com web-push.
* iOS: a partir do iOS 16.4 suporta web push, **mas só em PWAs instaladas no ecrã principal**. Para utilizadores em browser não instalado, push silencioso falha. Limitação importante.
* Casos de uso prováveis: novo documento em revisão, classificação concluída.
* Trade-off: requer subscription gerida no Supabase, certificados VAPID, UI de gestão. Não é trivial. Adiar para fase 3 só se houver use case com ROI claro.

## 5. UX mobile típicos a aplicar

* **Bottom navigation** persistente com 5 itens, ícones do Material já usados (`dashboard`, `rate_review`, `task_alt`, `model_training`, `settings`). Active state com cor primária e linha superior; badge no item atual quando há pendentes/erros.
* **Bottom sheets** em vez de drawers laterais para logs, edição, picker de pasta.
* **Pull to refresh** opcional no dashboard e na inbox para forçar reload da queue. Implementar com listener de touch ou usar `ngx-pull-to-refresh` (mas avaliar peso).
* **Gestos**: swipe lateral em items da inbox para ações rápidas (Mover, Retentar). Útil mas não crítico, fase 2.
* **Safe area insets**: `env(safe-area-inset-top|right|bottom|left)` em topbar, bottom nav, modais, snackbars. Combinado com `viewport-fit=cover`.
* **Viewport meta** no `index.html`: `width=device-width, initial-scale=1, viewport-fit=cover`. Não bloquear zoom (`user-scalable=no` é mau para acessibilidade).
* **Prevenção de zoom em inputs iOS**: `font-size: 16px` em todos os inputs.
* **Tap delay**: garantir `touch-action: manipulation` nos botões críticos.
* **Estados de loading**: já há `skeleton` em uso, manter; em mobile considerar reduzir o número de linhas mostradas.
* **Snackbars**: `verticalPosition: 'bottom'` já está, mas validar que não fica por baixo da bottom nav. Pode precisar de offset.
* **Modos de cor**: `prefers-color-scheme` para dark mode. O `theme-color` está fixo em `#000000`, sugere já dark; confirmar.

## 6. Performance, Lighthouse e budgets

A meta é Lighthouse mobile com Performance ≥ 90, PWA ≥ 100.

* **Self-host fontes**: substituir `https://fonts.googleapis.com/...` por fontes locais em `/public/fonts/` com `font-display: swap` e `preload` da regular. Elimina round trips para domínios externos e melhora LCP.
* **`@defer` agressivo** em rotas pesadas: `manual-review` preview, charts, training. Já há `@defer (on idle)` no dashboard; estender.
* **Code splitting** já existe (lazy routes). Validar que componentes Material só carregados se usados.
* **OnPush + signals**: já em uso, manter disciplina.
* **Imagens**: `loading="lazy"` e `decoding="async"` em todos os `<img>`. Não vi `<img>` no inspecionado, mas validar avatares e logos.
* **Bundle budget atual**: `initial maximumWarning: 500kB, maximumError: 1MB`. Em mobile 3G é apertado. Medir após split mobile e ajustar.
* **`@angular/material` tree-shaking**: importar só o módulo necessário (já está, `MatIconModule`, `MatTooltipModule`, etc.). Não usar `MatModule` global.
* **Pré-cache controlado**: `assetGroups.app` em prefetch faz com que tudo seja descarregado no primeiro acesso. Para uma PWA isto é bom; só vigiar o tamanho do bundle inicial.

### Lighthouse mobile checklist

* `viewport` correto (corrigir com `viewport-fit=cover`).
* `theme-color` presente (já está).
* Manifest válido + ícone 192 e 512 com `purpose any` e maskable (já está).
* Service worker registado (já está, em produção).
* HTTPS obrigatório.
* Splash screen automática derivada do manifest (já gerada).
* Sem `noscript` warnings.
* Imagens com tamanhos definidos (largura/altura).
* Acessibilidade ≥ 90: contraste de texto, labels em todos os inputs, focus visible.
* SEO: meta description já presente.

## 7. Testes

* **Vitest** unitário, já configurado, manter para serviços e signals.
* **Playwright (já existe `.playwright-mcp/`)** para e2e cross-device. Configurar projetos `mobile-chrome` (Pixel 7) e `mobile-safari` (iPhone 14 emulado).
* **Lighthouse CI** num passo do CircleCI (já há `.circleci/`). Falhar build se score PWA < 90 ou Performance < 80.
* **Chrome DevTools device toolbar** durante desenvolvimento. iPhone SE (375 px) é o caso pior comum.
* **Teste real**: instalar a PWA num iPhone físico e Android físico, validar A2HS, push (se for fase 3), comportamento offline (avião).
* **Acessibilidade**: rodar axe-core nas rotas principais. WCAG 2.1 AA é o alvo.

## 8. Faseamento sugerido

Estimativas relativas, não em horas absolutas. "S" pequeno, "M" médio, "L" grande.

### Fase 1. MVP mobile (esforço total: M-L)

Objetivo: PWA instalável com UX mobile aceitável nas rotas críticas.

1. Viewport `viewport-fit=cover` + `safe-area-insets` no shell. (S)
2. `LayoutService` com `BreakpointObserver` + signal `isMobile`. (S)
3. Refactor shell: bottom nav em mobile, esconder sidebar, ajustar topbar. (M)
4. Refactor inbox-list: cartões em mobile, tabela em desktop. (M)
5. Refactor manual-review: stack vertical + preview colapsável + ações sticky. (M)
6. Inputs com `font-size: 16px` e `inputmode`. (S)
7. `SwUpdate` com snackbar de atualização. (S)
8. Atualizar `manifest.webmanifest` com `scope`, `id`, `categories`, `screenshots`, `shortcuts`. (S)
9. Self-host fontes. (S)
10. Lighthouse audit + correções de baixo esforço. (S)

### Fase 2. Polimento e offline (esforço total: M)

11. Bottom sheets em vez de drawers para logs e edição. (M)
12. A2HS prompt custom + instruções iOS. (S)
13. Rota `/offline` + `navigationUrls` no SW. (S)
14. `dataGroups` adicionais granulares no SW. (S)
15. Pull to refresh no dashboard e na inbox. (S)
16. Swipe actions na inbox (mobile). (M)
17. Charts mobile-tuned (legendas, alturas, simplificação). (S)
18. Playwright projetos mobile + Lighthouse CI. (M)

### Fase 3. Avançado (esforço total: M-L, opcional)

19. Push notifications (Web Push + iOS 16.4+). (L)
20. Background sync para fila offline (operações pendentes quando volta a haver rede). (L)
21. Share Target (receber PDFs partilhados de outras apps para enviar à inbox). (M)
22. File System Access API para uploads diretos do dispositivo. (M)

## 9. Riscos e pontos de atenção

* **Auth Supabase em PWA offline**. O token JWT expira tipicamente em 1h. Sem rede, o refresh falha. Em offline, é preciso decidir: bloquear toda a UI atrás de `auth ok`, ou permitir vista cached read-only quando o utilizador estava previamente autenticado. Recomendação: read-only com banner "modo offline, sem sincronização".
* **iOS push é restrito**. Só funciona em PWAs instaladas no ecrã principal a partir do iOS 16.4. Não dependa de push como canal principal de notificação até a base de utilizadores ter ≥ 90% iOS 16.4+, que já é razoável em 2026 mas medível.
* **Atualizações de service worker silenciosas**. Sem `SwUpdate` exposto na UI, o utilizador pode ficar dias com a versão antiga. Risco de bugs reportados que já estão corrigidos. Mitigado pelo passo 7 da fase 1.
* **Cache busting**. `outputHashing: "all"` está ativo em produção, bom. Mas se houver assets estáticos referenciados manualmente no HTML, validar que têm hash ou versão.
* **Iframe de preview em mobile**. Pode comer memória rapidamente em iPhones antigos. Avaliar limite de tamanho do PDF antes de mostrar inline.
* **Material density**. `@angular/material` por defeito é desktop-density. Em mobile considerar densidade -1 ou -2 em alguns componentes (tooltips são desnecessários, snackbars maiores).
* **Drift entre desktop e mobile**. Manter um único template responsive evita; se for forçoso ramificar com `@if (isMobile())`, documentar a divergência.
* **Realtime do Supabase**. `subscribeRealtime()` no shell mantém uma WebSocket aberta. Em mobile, se o sistema operativo suspende o tab, a subscription cai. Adicionar `visibilitychange` listener para resubscrever.
* **Memory pressure** em iOS Safari mobile com gráficos pesados. Simplificar charts em mobile, considerar throttle de re-render.
* **Acessibilidade não pode regredir**. A versão atual tem boa diligência (`aria-label`, `role`, `aria-live`). Em mobile, focus order e skip links têm de ser revistos.
* **Splash screen**. Não há `<meta>` específico para Apple splash; em iOS PWA isto é manual com `apple-touch-startup-image` em vários tamanhos. Avaliar se vale o esforço (ferramentas como pwa-asset-generator automatizam).
* **Quotas de storage**. O Angular SW + cache do browser podem chegar a centenas de MB com PDFs cached. Definir limites em `dataGroups.maxSize` é crítico.

## 10. Decisões a confirmar com o utilizador antes de implementar

1. Bottom nav vs drawer hambúrguer: bottom nav é a recomendação, mas se houver intenção de chegar a 7+ secções, drawer pode escalar melhor.
2. Tema dark forçado vs `prefers-color-scheme`: o `theme-color: #000000` sugere dark; confirmar se queres modo claro também.
3. iOS A2HS: instruir o utilizador ou não? Custa pouco mostrar e ajuda muito a adoção.
4. Push notifications na fase 3 ou nunca? Depende do roadmap de produto.
5. Preview de PDF em mobile: iframe vs imagem render vs link externo (Drive viewer). Cada um tem trade-off de UX, peso e fiabilidade.
6. Background sync para mover pendentes em offline: vale a complexidade ou aceita-se que ações offline simplesmente falham com retry manual?

---

**Próximo passo recomendado**: validar este plano, decidir se queres avançar com Fase 1 e em que ordem. Posso depois preparar as user stories técnicas, começando pelo `LayoutService` + viewport fix, que são o alicerce de tudo o resto.
