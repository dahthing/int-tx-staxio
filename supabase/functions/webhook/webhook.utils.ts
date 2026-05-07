// supabase/functions/webhook/webhook.utils.ts
// Lógica pura do receptor de notificações Drive — sem I/O, testável isoladamente

// ============================================================
// TIPOS
// ============================================================
export type DriveResourceState =
  | 'sync'
  | 'add'
  | 'update'
  | 'remove'
  | 'trash'
  | 'untrash'
  | 'change';

export interface DriveNotification {
  channelId: string;
  resourceState: DriveResourceState;
  messageNumber: string;
  changed: string[];
  token: string | null;
}

export interface ParseResult {
  valid: boolean;
  notification?: DriveNotification;
  reason?: string;
}

// ============================================================
// PARSING DE HEADERS
// ============================================================
export function parseNotification(headers: Record<string, string | null>): ParseResult {
  const channelId = headers['x-goog-channel-id'];
  const resourceState = headers['x-goog-resource-state'];
  const messageNumber = headers['x-goog-message-number'];

  if (!channelId) {
    return { valid: false, reason: 'Header x-goog-channel-id em falta' };
  }
  if (!resourceState) {
    return { valid: false, reason: 'Header x-goog-resource-state em falta' };
  }
  if (!messageNumber) {
    return { valid: false, reason: 'Header x-goog-message-number em falta' };
  }

  const changedRaw = headers['x-goog-changed'] ?? '';
  const changed = changedRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return {
    valid: true,
    notification: {
      channelId,
      resourceState: resourceState as DriveResourceState,
      messageNumber,
      changed,
      token: headers['x-goog-channel-token'] ?? null,
    },
  };
}

// ============================================================
// VERIFICAÇÃO DO TOKEN
// ============================================================
export function verifyToken(
  notification: DriveNotification,
  expectedToken: string,
): boolean {
  if (!notification.token) return false;
  return notification.token === expectedToken;
}

// ============================================================
// RELEVÂNCIA — decide se deve accionar /classify
// ============================================================
const ACTIONABLE_STATES: DriveResourceState[] = ['add', 'update'];

export function isActionable(notification: DriveNotification): boolean {
  // 'sync' é apenas confirmação de registo — ignorar
  if (!ACTIONABLE_STATES.includes(notification.resourceState)) return false;

  // 'update' só interessa se afectou o conteúdo ou os filhos da pasta
  if (notification.resourceState === 'update') {
    return (
      notification.changed.includes('content') ||
      notification.changed.includes('children')
    );
  }

  return true;
}

// ============================================================
// CHANNEL REGISTRATION BODY
// ============================================================
export interface WatchChannelInput {
  channelId: string;
  webhookUrl: string;
  token: string;
  ttlSeconds?: number;
}

export interface WatchChannelBody {
  id: string;
  type: 'web_hook';
  address: string;
  token: string;
  expiration: number;
}

export const DEFAULT_TTL_SECONDS = 86_400; // 24h (máximo para files resource)

export function buildWatchChannelBody(input: WatchChannelInput): WatchChannelBody {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return {
    id: input.channelId,
    type: 'web_hook',
    address: input.webhookUrl,
    token: input.token,
    expiration: Date.now() + ttl * 1000,
  };
}
