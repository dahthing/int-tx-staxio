// supabase/functions/extract-transactions/index.ts
// Edge Function: POST /functions/v1/extract-transactions
// Extrai transacções de um extrato bancário PDF e reconcilia com faturas

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

// ============================================================
// CORS
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// GOOGLE DRIVE AUTH
// ============================================================
async function getDriveToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64Url = (str: string) =>
    btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;

  const keyData = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigBase64Url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = `${unsigned}.${sigBase64Url}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const { access_token } = await res.json();
  return access_token;
}

// ============================================================
// DRIVE: download PDF como base64
// ============================================================
async function downloadFileBase64(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============================================================
// Tipos
// ============================================================
interface BankTransaction {
  txn_date: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  counterparty: string | null;
}

interface ReconcileResult {
  matched: number;
  unmatched: number;
}

// ============================================================
// CLAUDE: extrai transacções do PDF
// ============================================================
async function extractTransactions(
  client: Anthropic,
  pdfBase64: string,
): Promise<BankTransaction[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        {
          type: 'text',
          text: `Analisa este extrato bancário e extrai TODAS as transacções em JSON.
Responde APENAS com um array JSON válido, sem texto adicional.
Cada transacção:
{
  "txn_date": "YYYY-MM-DD",
  "description": "descrição completa da linha",
  "amount": número (NEGATIVO para débitos/saídas, POSITIVO para créditos/entradas),
  "balance": saldo após a transacção ou null,
  "reference": número de referência ou null,
  "counterparty": nome da entidade se visível na descrição ou null
}`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed as BankTransaction[];
  } catch {
    return [];
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
    });

    // Valida body
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const queue_id = body.queue_id;

    if (!queue_id || typeof queue_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'queue_id é obrigatório e deve ser uma string UUID' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Busca entry da queue
    const { data: entry, error: entryError } = await supabase
      .from('processing_queue')
      .select('id, file_id, file_name, doc_type, status')
      .eq('id', queue_id)
      .single();

    if (entryError || !entry) {
      return new Response(
        JSON.stringify({ error: 'Queue entry não encontrada', detail: entryError?.message }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    if (entry.doc_type !== 'bank_statement') {
      return new Response(
        JSON.stringify({ error: `doc_type deve ser bank_statement, recebido: ${entry.doc_type}` }),
        { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Download PDF do Drive
    const driveToken = await getDriveToken();
    const pdfBase64 = await downloadFileBase64(driveToken, entry.file_id);

    // Extrai transacções via Claude
    const transactions = await extractTransactions(anthropic, pdfBase64);

    if (transactions.length === 0) {
      return new Response(
        JSON.stringify({ extracted: 0, reconciled: { matched: 0, unmatched: 0 } }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Insere transacções na DB
    const rows = transactions.map((txn) => ({
      queue_id: entry.id,
      txn_date: txn.txn_date,
      description: txn.description,
      amount: txn.amount,
      balance: txn.balance ?? null,
      reference: txn.reference ?? null,
      counterparty: txn.counterparty ?? null,
    }));

    const { error: insertError } = await supabase
      .from('bank_transactions')
      .insert(rows);

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'Erro ao inserir transacções', detail: insertError.message }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Chama função de reconciliação
    const { data: reconcileData, error: reconcileError } = await supabase
      .rpc('reconcile_transactions');

    let reconciled: ReconcileResult = { matched: 0, unmatched: 0 };
    if (!reconcileError && reconcileData && Array.isArray(reconcileData) && reconcileData.length > 0) {
      reconciled = {
        matched: reconcileData[0].matched ?? 0,
        unmatched: reconcileData[0].unmatched ?? 0,
      };
    }

    return new Response(
      JSON.stringify({ extracted: transactions.length, reconciled }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
