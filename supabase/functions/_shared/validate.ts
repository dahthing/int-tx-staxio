// supabase/functions/_shared/validate.ts
// Thin wrapper sobre Zod para validação de input nas Edge Functions.

import { z } from 'npm:zod@3';

export { z };

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Valida `body` contra `schema`.
 * Devolve { ok: true, data } ou { ok: false, error } com mensagem legível.
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { ok: false, error: msg };
  }
  return { ok: true, data: result.data };
}

/** Resposta 400 padronizada para erros de validação */
export function validationError(
  message: string,
  cors: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }
  );
}
