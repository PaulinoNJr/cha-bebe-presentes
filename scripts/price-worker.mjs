#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = Number(process.env.PRICE_WORKER_BATCH_SIZE || 20);
const MAX_BATCHES = Number(process.env.PRICE_WORKER_MAX_BATCHES || 5);
const FORCE_ENQUEUE_ALL = String(process.env.PRICE_WORKER_FORCE_ENQUEUE_ALL || "false") === "true";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

function parseJwtRole(jwt) {
  try {
    const parts = String(jwt || "").split(".");
    if (parts.length < 2) {
      return null;
    }
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    return payload?.role || null;
  } catch {
    return null;
  }
}

function detectKeyFormat(key) {
  const value = String(key || "").trim();
  if (value.startsWith("eyJ")) {
    return "jwt";
  }
  if (value.startsWith("sb_")) {
    return "sb_secret";
  }
  return "unknown";
}

function parsePriceInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const only = raw.replace(/[^\d,.-]/g, "");

  const br = Number(only.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(br) && br > 0) {
    return Math.round(br * 100) / 100;
  }

  const en = Number(only.replace(/,/g, ""));
  if (Number.isFinite(en) && en > 0) {
    return Math.round(en * 100) / 100;
  }

  return null;
}

function pickPriceFromPattern(text, regex, groupIndex = 1) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parsePriceInput(match[groupIndex]);
    if (parsed !== null && parsed < 1000000) {
      return parsed;
    }
  }
  return null;
}

function extractPriceFromText(text) {
  const source = String(text ?? "");
  const amountPattern =
    "([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{1,2})?)";
  const patterns = [
    {
      regex: new RegExp(`~~\\s*R\\$\\s*${amountPattern}\\s*~~\\s*R\\$\\s*${amountPattern}`, "gi"),
      group: 2,
    },
    {
      regex: new RegExp(`de\\s*(?:r\\$\\s*)?${amountPattern}\\s*(?:por|a)\\s*(?:r\\$\\s*)?${amountPattern}`, "gi"),
      group: 2,
    },
    { regex: new RegExp(`\\bpor\\s*(?:r\\$\\s*)?${amountPattern}`, "gi"), group: 1 },
    { regex: /"price"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi, group: 1 },
    { regex: /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi, group: 1 },
    { regex: /([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi, group: 1 },
    { regex: /([0-9]+(?:\.[0-9]{2}))\b/gi, group: 1 },
  ];

  for (const { regex, group } of patterns) {
    const found = pickPriceFromPattern(source, regex, group);
    regex.lastIndex = 0;
    if (found !== null) {
      return found;
    }
  }

  return null;
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectPriceFromUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const noScheme = parsed.href.replace(/^https?:\/\//i, "");
  const candidates = Array.from(
    new Set([
      parsed.href,
      `https://r.jina.ai/http://${noScheme}`,
      `https://r.jina.ai/https://${noScheme}`,
    ])
  );

  for (const candidate of candidates) {
    const text = await fetchTextWithTimeout(candidate);
    if (!text) {
      continue;
    }
    const price = extractPriceFromText(text);
    if (price !== null) {
      return price;
    }
  }

  return null;
}

async function supabaseRpc(fn, body = {}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      (data && (data.message || data.error || data.hint)) || `RPC ${fn} HTTP ${response.status}`
    );
  }

  return data;
}

async function processBatch() {
  const claimed = await supabaseRpc("claim_price_update_jobs", { p_limit: BATCH_SIZE });
  const jobs = Array.isArray(claimed) ? claimed : [];
  if (!jobs.length) {
    return { processed: 0, success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (const job of jobs) {
    const jobId = Number(job.job_id);
    const buyUrl = String(job.buy_url || "").trim();
    try {
      const detected = await detectPriceFromUrl(buyUrl);
      await supabaseRpc("finish_price_update_job", {
        p_job_id: jobId,
        p_price_value: detected,
        p_error_message: detected === null ? "PRECO_NAO_ENCONTRADO" : null,
      });
      if (detected === null) {
        failed += 1;
      } else {
        success += 1;
      }
    } catch (error) {
      failed += 1;
      await supabaseRpc("finish_price_update_job", {
        p_job_id: jobId,
        p_price_value: null,
        p_error_message: String(error?.message || error || "ERRO_DESCONHECIDO").slice(0, 500),
      });
    }
  }

  return { processed: jobs.length, success, failed };
}

async function main() {
  console.log("Iniciando worker de fila de precos...");

  const keyFormat = detectKeyFormat(SUPABASE_SERVICE_ROLE_KEY);
  const role = parseJwtRole(SUPABASE_SERVICE_ROLE_KEY);

  // Bloqueia somente quando fica claro que a chave eh anon.
  // Para chaves "sb_secret_*" o role nao eh legivel localmente.
  if (role === "anon") {
    console.error(
      "A chave informada parece anon. Use a SERVICE ROLE key no secret SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }
  if (keyFormat === "jwt" && role && role !== "service_role") {
    console.error(
      `JWT informado com role inesperada: ${role}. Use a SERVICE ROLE key.`
    );
    process.exit(1);
  }
  if (keyFormat !== "jwt") {
    console.log(
      "Chave em formato nao-JWT detectada; validacao de role local sera feita via RPC no Supabase."
    );
  }

  if (FORCE_ENQUEUE_ALL) {
    const forced = await supabaseRpc("enqueue_price_refresh_all");
    console.log("Enfileiramento forcado:", forced);
  }

  const due = await supabaseRpc("enqueue_due_scheduled_price_updates");
  console.log("Agendamento:", due);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const batch = await processBatch();
    if (batch.processed === 0) {
      break;
    }
    totalProcessed += batch.processed;
    totalSuccess += batch.success;
    totalFailed += batch.failed;
    console.log(`Lote ${i + 1}:`, batch);
  }

  console.log(
    `Concluido. Processados: ${totalProcessed} | Sucesso: ${totalSuccess} | Falhas: ${totalFailed}`
  );
}

main().catch((error) => {
  console.error("Erro no worker:", error?.message || error);
  process.exit(1);
});
