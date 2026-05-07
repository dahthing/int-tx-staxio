---
name: angular-project
description: Project-specific Angular skill override. Extends angular-senior with this project's version and API protocol.
---

## Project Context

- **Angular version**: 21.2.x
- **API protocol**: REST (Supabase REST via @supabase/supabase-js SDK — NOT raw HttpClient)
- **State management**: Signals only (signal, computed, effect)
- **HTTP client**: @supabase/supabase-js (wraps fetch internally) + HttpClient for Edge Functions
- **Auth pattern**: Supabase anon key (public read, service role write via Edge Functions)
- **Realtime**: Supabase Realtime channels for processing_queue and processing_logs

## Version-Specific Rules (Angular 21 = Angular 20+ rules)

- Standalone components mandatory, no NgModules
- signal-based inputs: input(), output(), model(), viewChild()
- New control flow: @if, @for, @switch, @defer
- inject() over constructor injection everywhere
- Zoneless: provideExperimentalZonelessChangeDetection()
- provideRouter with withComponentInputBinding() and withViewTransitions()
- Do NOT set standalone: true in decorators (default in v20+)
- Do NOT use @HostBinding / @HostListener — use host: {} in @Component

## API-Specific Rules

- Use @supabase/supabase-js client for all DB reads (from(), select(), eq(), etc.)
- Never use raw fetch or HttpClient for Supabase DB — always use the SDK
- Edge Functions (/classify, /move) are called via HttpClient POST
- Supabase Realtime: subscribe to processing_queue and processing_logs in a service
- Always type responses with project models (QueueEntry, ProcessingLog)

## Project Conventions

- Component file structure: standalone, co-located (ts + html + scss in same folder)
- Style approach: SCSS
- Test runner: Vitest (vitest.config.edge.ts for Edge Functions; Angular test TBD)
- Notable libraries: @supabase/supabase-js ^2.x
- No i18n — app is internal tooling, PT language hardcoded
- No Transloco — skip all i18n checklist items
- Signals private with # prefix, exposed via asReadonly()
- RxJS only for HttpClient observables, converted with toSignal()

## Domain Models (from schema)

### processing_status enum
'pending' | 'processing' | 'done' | 'error' | 'manual_review'

### log_action enum
'classify' | 'move' | 'manual_edit' | 'error'

### QueueEntry (processing_queue table)
id, file_id, file_name, inbox_folder_id, status, doc_date, supplier, value,
nif, country, currency, is_international, dest_year, dest_quarter, dest_month,
dest_path, dest_file_name, error_message, attempts, created_at, updated_at

### ProcessingLog (processing_logs table)
id, queue_id, file_id, file_name, action, origin_path, dest_path,
status ('success'|'error'), error_message, metadata, created_at
