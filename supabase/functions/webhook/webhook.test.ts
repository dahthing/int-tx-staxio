// supabase/functions/webhook/webhook.test.ts
// Vitest — testes unitários para lógica do receptor de webhooks Drive
// Correr: pnpm vitest run --config vitest.config.edge.ts

import { describe, it, expect } from 'vitest';
import {
  parseNotification,
  verifyToken,
  isActionable,
  buildWatchChannelBody,
  DEFAULT_TTL_SECONDS,
  type DriveNotification,
} from './webhook.utils.ts';

// ============================================================
// FIXTURE
// ============================================================
const validHeaders: Record<string, string | null> = {
  'x-goog-channel-id':    'channel-abc-123',
  'x-goog-resource-state':'add',
  'x-goog-message-number':'42',
  'x-goog-changed':       'content,children',
  'x-goog-channel-token': 'secret-token',
};

const validNotification: DriveNotification = {
  channelId:     'channel-abc-123',
  resourceState: 'add',
  messageNumber: '42',
  changed:       ['content', 'children'],
  token:         'secret-token',
};

// ============================================================
// parseNotification
// ============================================================
describe('parseNotification', () => {
  it('parseia headers válidos correctamente', () => {
    const result = parseNotification(validHeaders);
    expect(result.valid).toBe(true);
    expect(result.notification).toEqual(validNotification);
  });

  it('falha sem x-goog-channel-id', () => {
    const result = parseNotification({ ...validHeaders, 'x-goog-channel-id': null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('x-goog-channel-id');
  });

  it('falha sem x-goog-resource-state', () => {
    const result = parseNotification({ ...validHeaders, 'x-goog-resource-state': null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('x-goog-resource-state');
  });

  it('falha sem x-goog-message-number', () => {
    const result = parseNotification({ ...validHeaders, 'x-goog-message-number': null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('x-goog-message-number');
  });

  it('token é null quando header ausente', () => {
    const { notification } = parseNotification({
      ...validHeaders,
      'x-goog-channel-token': null,
    });
    expect(notification?.token).toBeNull();
  });

  it('changed é array vazio quando header ausente', () => {
    const { notification } = parseNotification({
      ...validHeaders,
      'x-goog-changed': null,
    });
    expect(notification?.changed).toEqual([]);
  });

  it('split de changed por vírgula com espaços', () => {
    const { notification } = parseNotification({
      ...validHeaders,
      'x-goog-changed': 'content, parents, permissions',
    });
    expect(notification?.changed).toEqual(['content', 'parents', 'permissions']);
  });

  it('parseia resource state "sync"', () => {
    const { notification } = parseNotification({
      ...validHeaders,
      'x-goog-resource-state': 'sync',
    });
    expect(notification?.resourceState).toBe('sync');
  });
});

// ============================================================
// verifyToken
// ============================================================
describe('verifyToken', () => {
  it('válido quando token coincide', () => {
    expect(verifyToken(validNotification, 'secret-token')).toBe(true);
  });

  it('inválido quando token não coincide', () => {
    expect(verifyToken(validNotification, 'outro-token')).toBe(false);
  });

  it('inválido quando token é null', () => {
    const n: DriveNotification = { ...validNotification, token: null };
    expect(verifyToken(n, 'secret-token')).toBe(false);
  });

  it('inválido com string vazia', () => {
    const n: DriveNotification = { ...validNotification, token: '' };
    expect(verifyToken(n, 'secret-token')).toBe(false);
  });
});

// ============================================================
// isActionable
// ============================================================
describe('isActionable', () => {
  it('"sync" nunca é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'sync' };
    expect(isActionable(n)).toBe(false);
  });

  it('"add" é sempre accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'add', changed: [] };
    expect(isActionable(n)).toBe(true);
  });

  it('"remove" não é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'remove', changed: [] };
    expect(isActionable(n)).toBe(false);
  });

  it('"trash" não é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'trash', changed: [] };
    expect(isActionable(n)).toBe(false);
  });

  it('"update" com "content" é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'update', changed: ['content'] };
    expect(isActionable(n)).toBe(true);
  });

  it('"update" com "children" é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'update', changed: ['children'] };
    expect(isActionable(n)).toBe(true);
  });

  it('"update" apenas com "permissions" não é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'update', changed: ['permissions'] };
    expect(isActionable(n)).toBe(false);
  });

  it('"update" sem changed não é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'update', changed: [] };
    expect(isActionable(n)).toBe(false);
  });

  it('"untrash" não é accionável', () => {
    const n: DriveNotification = { ...validNotification, resourceState: 'untrash', changed: [] };
    expect(isActionable(n)).toBe(false);
  });
});

// ============================================================
// buildWatchChannelBody
// ============================================================
describe('buildWatchChannelBody', () => {
  it('constrói body com valores correctos', () => {
    const before = Date.now();
    const body = buildWatchChannelBody({
      channelId:  'ch-1',
      webhookUrl: 'https://example.com/webhook',
      token:      'tok',
    });
    const after = Date.now();

    expect(body.id).toBe('ch-1');
    expect(body.type).toBe('web_hook');
    expect(body.address).toBe('https://example.com/webhook');
    expect(body.token).toBe('tok');
    expect(body.expiration).toBeGreaterThanOrEqual(before + DEFAULT_TTL_SECONDS * 1000);
    expect(body.expiration).toBeLessThanOrEqual(after + DEFAULT_TTL_SECONDS * 1000);
  });

  it('TTL customizado altera expiration', () => {
    const before = Date.now();
    const body = buildWatchChannelBody({
      channelId: 'ch-2', webhookUrl: 'https://x.com', token: 't', ttlSeconds: 3600,
    });
    expect(body.expiration).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it(`DEFAULT_TTL_SECONDS é ${DEFAULT_TTL_SECONDS}`, () => {
    expect(DEFAULT_TTL_SECONDS).toBe(86_400);
  });
});
