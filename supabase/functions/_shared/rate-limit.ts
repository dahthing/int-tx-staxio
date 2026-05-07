// supabase/functions/_shared/rate-limit.ts
// In-memory rate limiter — partilhado dentro do mesmo isolate Deno.
// Para uma app interna com tráfego baixo é suficiente.

interface Bucket {
  count: number;
  reset: number; // epoch ms
}

const store = new Map<string, Bucket>();

/**
 * Verifica se a chave (ex: IP ou "global") excedeu o limite.
 * @param key      Identificador único para o contador (IP, user-id, "global", …)
 * @param limit    Nº máximo de requests permitidos na janela
 * @param windowMs Duração da janela em milissegundos
 * @returns true se permitido, false se excedido
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now > bucket.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count++;
  return true;
}

/** Retorna uma Response 429 padronizada */
export function rateLimitExceeded(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'Too Many Requests' }),
    {
      status: 429,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    }
  );
}
