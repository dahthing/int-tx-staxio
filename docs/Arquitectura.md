# Arquitectura

## Diagrama de Fluxo

```
[Drive App Scan]
      ↓
[Inbox_Contabilidade] ← pasta Drive monitorizada
      ↓
[Angular Dashboard]
  → botão "Processar Inbox"
      ↓
POST /functions/v1/classify
  → lista ficheiros da Inbox (Drive API)
  → para cada PDF:
      → lê conteúdo (Drive API)
      → envia para Claude Vision
      → extrai: data, NIF, fornecedor, valor, país, moeda
      → classifica: nacional | internacional | falha
      → grava em processing_queue (Supabase)
      ↓
POST /functions/v1/move
  → lê fila processing_queue (status=pending)
  → para cada item:
      → calcula path: ANO/Qx/MES/
      → cria pastas se não existem (Drive API)
      → renomeia: YYYY-MM-DD_fornecedor_valor.ext
      → move ficheiro (Drive API)
      → actualiza processing_logs (status=done|error)
      ↓
[Supabase Realtime]
  → INSERT em processing_logs
      ↓
[Angular LogViewer]
  → signal actualiza em tempo real
```

---

## Componentes Angular

| Componente | Estado | Link |
|---|---|---|
| DashboardComponent | planned | [[componentes/Dashboard]] |
| InboxListComponent | planned | [[componentes/InboxList]] |
| LogViewerComponent | planned | [[componentes/LogViewer]] |
| MetadataFormComponent | planned | [[componentes/MetadataForm]] |
| DocPreviewComponent | planned | [[componentes/DocPreview]] |

## Serviços Angular

| Serviço | Estado | Link |
|---|---|---|
| DriveService | planned | [[services/DriveService]] |
| ClassifierService | planned | [[services/ClassifierService]] |
| ProcessingLogService | planned | [[services/ProcessingLogService]] |
| SupabaseService | planned | [[services/SupabaseService]] |

## Edge Functions

| Função | Estado | Link |
|---|---|---|
| /classify | planned | [[edge-functions/classify]] |
| /move | planned | [[edge-functions/move]] |

---

## Schema Supabase

### Tabelas principais

```
processing_queue
  id, file_id, file_name, inbox_folder_id
  status: pending | processing | done | error | manual_review
  metadata: { date, supplier, value, nif, country, currency }
  is_international: boolean
  dest_path: text
  created_at, updated_at

processing_logs
  id, queue_id (FK), file_id, file_name
  action: classify | move | error
  origin_path, dest_path
  status: success | error
  error_message
  created_at

app_config
  id, key, value
  (drive_inbox_folder_id, drive_root_folder_id, etc.)
```

---

## Variáveis de Ambiente

```
# Angular environment.ts
SUPABASE_URL
SUPABASE_ANON_KEY

# Supabase Edge Function secrets
ANTHROPIC_API_KEY
GOOGLE_SERVICE_ACCOUNT_JSON
DRIVE_INBOX_FOLDER_ID
DRIVE_ROOT_FOLDER_ID
```

---

## Novos Componentes (Sessão 2026-05-08)

### Edge Functions Adicionadas

| Função | Descrição |
|---|---|
| `list-folders` | Lista subpastas do Drive para o tree-picker |
| `move-existing` | Move ficheiro já processado para nova pasta |

### Componentes Angular Adicionados

| Componente | Descrição |
|---|---|
| `DriveFolderPicker` | Modal tree-picker para navegar pastas do Drive |
| `DoneList` | Listagem de documentos `status=done` com opção de mover |

### Serviços Adicionados

| Serviço | Método principal |
|---|---|
| `DriveService` | `listFolders(parentId): Observable<DriveFolder[]>` |

### Tabelas Adicionadas

| Tabela | Descrição |
|---|---|
| `training_examples` | Exemplos de treino etiquetados pelo utilizador (few-shot, ver D009) |

### Colunas Adicionadas

| Tabela | Coluna | Tipo | Descrição |
|---|---|---|---|
| `processing_queue` | `is_my_doc` | `boolean` | Marca documentos emitidos pela própria empresa (NIF 514084235) |

### Tipos `doc_type` Adicionados

| Valor | Descrição |
|---|---|
| `invoice_issued` | Factura emitida pela empresa |
| `receipt_issued` | Recibo emitido pela empresa |
| `quote_issued` | Orçamento emitido pela empresa |
