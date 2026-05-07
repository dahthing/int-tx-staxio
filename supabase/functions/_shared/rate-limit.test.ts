// supabase/functions/_shared/rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import { checkRateLimit, rateLimitExceeded } from './rate-limit.ts';

// Cada test usa uma chave única para evitar interferência entre testes
// (o store em memória é partilhado no mesmo isolate)
let keySeq = 0;
const k = () => `test-key-${++keySeq}-${Math.random()}`;

describe('checkRateLimit', () => {
  it('allows first request', () => {
    expect(checkRateLimit(k(), 5, 60_000)).toBe(true);
  });

  it('allows up to the limit', () => {
    const key = k();
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60_000)).toBe(true);
    }
  });

  it('blocks request that exceeds the limit', () => {
    const key = k();
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    expect(checkRateLimit(key, 3, 60_000)).toBe(false);
  });

  it('resets counter after window expires', async () => {
    const key = k();
    // Fill to limit with a 1ms window
    for (let i = 0; i < 2; i++) checkRateLimit(key, 2, 1);
    // Wait for window to expire
    await new Promise(r => setTimeout(r, 20));
    expect(checkRateLimit(key, 2, 1)).toBe(true);
  });

  it('different keys have independent counters', () => {
    const keyA = k();
    const keyB = k();
    // Fill keyA
    for (let i = 0; i < 2; i++) checkRateLimit(keyA, 2, 60_000);
    expect(checkRateLimit(keyA, 2, 60_000)).toBe(false);
    // keyB unaffected
    expect(checkRateLimit(keyB, 2, 60_000)).toBe(true);
  });
});

describe('rateLimitExceeded', () => {
  it('returns a 429 Response', () => {
    const res = rateLimitExceeded({});
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header', () => {
    const res = rateLimitExceeded({});
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('body contains error field', async () => {
    const res = rateLimitExceeded({});
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('merges CORS headers', () => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    const res = rateLimitExceeded(cors);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
