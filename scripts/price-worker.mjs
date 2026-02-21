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

function roundPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.round(num * 100) / 100;
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

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractMercadoLivreItemId(text) {
  const source = String(text ?? "");
  const match = source.match(/\bML[A-Z]\d{7,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractMercadoLivreListingIdsFromUrl(urlObj) {
  const ids = new Set();
  const source = `${urlObj?.href || ""} ${urlObj?.pathname || ""} ${urlObj?.search || ""}`;
  const widRegex = /[?&]wid=(MLB\d{7,})\b/gi;
  let match;
  while ((match = widRegex.exec(source)) !== null) {
    ids.add(match[1].toUpperCase());
  }

  const listingPathRegex = /\/MLB-(\d{7,})\b/gi;
  while ((match = listingPathRegex.exec(source)) !== null) {
    ids.add(`MLB${match[1]}`);
  }

  return [...ids];
}

function extractMercadoLivreListingIdsFromText(text) {
  const source = String(text ?? "");
  const ids = new Set();

  const widRegex = /[?&]wid=(MLB\d{7,})\b/gi;
  let match;
  while ((match = widRegex.exec(source)) !== null) {
    ids.add(match[1].toUpperCase());
  }

  const listingPathRegex = /produto\.mercadolivre\.com\.br\/MLB-(\d{7,})\b/gi;
  while ((match = listingPathRegex.exec(source)) !== null) {
    ids.add(`MLB${match[1]}`);
  }

  return [...ids];
}

function extractMercadoLivreDePorPrice(text) {
  const source = String(text ?? "");
  if (!source) {
    return null;
  }

  const amountPattern =
    "([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{2}))";

  const dePor = new RegExp(
    `de\\s*(?:r\\$\\s*)?${amountPattern}[\\s\\S]{0,80}(?:por|a\\s*partir\\s*de)\\s*(?:r\\$\\s*)?${amountPattern}`,
    "i"
  );
  const matchDePor = source.match(dePor);
  if (!matchDePor?.[1]) {
    return null;
  }

  return parsePriceInput(matchDePor[1]);
}

function pickEmbeddedPriceFromSegment(segment) {
  const source = String(segment ?? "");
  if (!source) {
    return null;
  }

  const originalPricePatterns = [
    /"original_price"\s*:\s*\{[^{}]{0,140}"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
    /"old_price"\s*:\s*\{[^{}]{0,140}"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
    /"previous_price"\s*:\s*\{[^{}]{0,140}"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
  ];
  for (const pattern of originalPricePatterns) {
    const parsed = pickPriceFromPattern(source, pattern);
    if (parsed !== null) {
      return parsed;
    }
  }

  const currentPricePatterns = [
    /"current_price"\s*:\s*\{[^{}]{0,140}"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
    /"price"\s*:\s*\{[^{}]{0,140}"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
    /"localItemPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/gi,
  ];
  for (const pattern of currentPricePatterns) {
    const parsed = pickPriceFromPattern(source, pattern);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractMercadoLivreSocialFeaturedPrice(text) {
  const source = String(text ?? "");
  if (!source) {
    return null;
  }

  const start = source.indexOf('"id":"card-featured"');
  if (start < 0) {
    return null;
  }
  const end = source.indexOf('"id":"tabs"', start + 1);
  const segment = source.slice(start, end > start ? end : start + 24000);
  return pickEmbeddedPriceFromSegment(segment);
}

function extractMercadoLivreEmbeddedPriceByListingId(text, listingId) {
  const source = String(text ?? "");
  const normalized = String(listingId ?? "").toUpperCase().replace("-", "");
  const match = normalized.match(/^MLB(\d{7,})$/);
  if (!source || !match) {
    return null;
  }
  const canonicalId = `MLB${match[1]}`;

  let cursor = 0;
  while (cursor < source.length) {
    const idx = source.indexOf(canonicalId, cursor);
    if (idx < 0) {
      break;
    }

    const startUnique = source.lastIndexOf('{"unique_id"', idx);
    const start = startUnique >= 0 ? startUnique : Math.max(0, idx - 1400);
    const nextUnique = source.indexOf('{"unique_id"', idx + canonicalId.length);
    const end = nextUnique > idx ? nextUnique : Math.min(source.length, idx + 9000);
    const segment = source.slice(start, end);

    const parsed = pickEmbeddedPriceFromSegment(segment);
    if (parsed !== null) {
      return parsed;
    }
    cursor = idx + canonicalId.length;
  }

  return null;
}

function extractMercadoLivreListingMainPrice(text) {
  const source = String(text ?? "");
  if (!source) {
    return null;
  }

  const startMarkers = ["Vender um igual", "Mercado Livre Brasil"];
  let start = 0;
  for (const marker of startMarkers) {
    const idx = source.indexOf(marker);
    if (idx >= 0) {
      start = Math.max(0, idx - 1200);
      break;
    }
  }

  let segment = source.slice(start, start + 12000);
  const endMarkers = [
    "Quem viu este produto tambem comprou",
    "Quem viu este produto tambÃ©m comprou",
    "Mais anuncios do vendedor",
    "Mais anÃºncios do vendedor",
    "Perguntas e respostas",
    "Produtos relacionados",
    "Compare com itens similares",
  ];

  let end = segment.length;
  for (const marker of endMarkers) {
    const idx = segment.indexOf(marker);
    if (idx > 0 && idx < end) {
      end = idx;
    }
  }
  segment = segment.slice(0, end);

  const dePorPrice = extractMercadoLivreDePorPrice(segment);
  if (dePorPrice !== null) {
    return dePorPrice;
  }

  const firstPrice = segment.match(
    /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2}))/i
  );
  if (firstPrice?.[1]) {
    const parsed = parsePriceInput(firstPrice[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractMercadoLivreItemIdFromUrl(urlObj) {
  const source = `${urlObj?.pathname || ""} ${urlObj?.href || ""}`;
  const match = source.match(/\b(ML[A-Z]-?\d{7,})\b/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase().replace("-", "");
}

async function fetchMercadoLivreApiPrice(itemId, timeoutMs = 12000) {
  const normalized = String(itemId || "").toUpperCase().replace("-", "");
  if (!/^ML[A-Z]\d{7,}$/.test(normalized)) {
    return null;
  }

  const payload = await fetchJsonWithTimeout(
    `https://api.mercadolibre.com/items/${normalized}`,
    timeoutMs
  );
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const salePrice = roundPrice(payload?.sale_price?.amount);
  if (salePrice !== null) {
    return salePrice;
  }

  const directPrice = roundPrice(payload?.price);
  if (directPrice !== null) {
    return directPrice;
  }

  const basePrice = roundPrice(payload?.base_price);
  if (basePrice !== null) {
    return basePrice;
  }

  return null;
}

async function fetchMercadoLivreListingPrice(listingId, timeoutMs = 12000) {
  const normalized = String(listingId || "").toUpperCase().replace("-", "");
  const match = normalized.match(/^MLB(\d{7,})$/);
  if (!match) {
    return null;
  }

  const listingUrl = `https://produto.mercadolivre.com.br/MLB-${match[1]}?ts=${Date.now()}`;
  const directText = await fetchTextWithTimeout(listingUrl, timeoutMs);
  if (directText) {
    const embeddedPrice = extractMercadoLivreEmbeddedPriceByListingId(directText, normalized);
    if (embeddedPrice !== null) {
      return embeddedPrice;
    }

    const dePorPrice = extractMercadoLivreDePorPrice(directText);
    if (dePorPrice !== null) {
      return dePorPrice;
    }
  }

  const noScheme = listingUrl.replace(/^https?:\/\//i, "");
  const candidates = [
    `https://r.jina.ai/http://${noScheme}`,
    `https://r.jina.ai/https://${noScheme}`,
  ];

  for (const candidate of candidates) {
    const text = await fetchTextWithTimeout(candidate, timeoutMs);
    if (!text) {
      continue;
    }
    const embeddedPrice = extractMercadoLivreEmbeddedPriceByListingId(text, normalized);
    if (embeddedPrice !== null) {
      return embeddedPrice;
    }
    const mainPrice = extractMercadoLivreListingMainPrice(text);
    if (mainPrice !== null) {
      return mainPrice;
    }
  }

  return null;
}

function extractMercadoLivreMainBlock(text) {
  const source = String(text ?? "");
  if (!source) {
    return "";
  }
  const markers = [
    "Quem viu este produto também comprou",
    "Quem viu este produto tambem comprou",
    "Perguntas e respostas",
    "Mais anúncios do vendedor",
    "Mais anuncios do vendedor",
  ];
  let end = source.length;
  for (const marker of markers) {
    const idx = source.indexOf(marker);
    if (idx > 0 && idx < end) {
      end = idx;
    }
  }
  return source.slice(0, Math.min(end, 8000));
}

function extractMercadoLivreMainPrice(text) {
  const block = extractMercadoLivreMainBlock(text);
  if (!block) {
    return null;
  }

  const dePorPrice = extractMercadoLivreDePorPrice(block);
  if (dePorPrice !== null) {
    return dePorPrice;
  }

  const firstR$ = block.match(
    /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2}))/i
  );
  if (firstR$?.[1]) {
    const parsed = parsePriceInput(firstR$[1]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
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
  const isMercadoLivre =
    /mercadolivre|mercadolibre/i.test(parsed.hostname) ||
    /mercadolivre|mercadolibre/i.test(parsed.href);
  const listingIdsFromUrl = isMercadoLivre ? extractMercadoLivreListingIdsFromUrl(parsed) : [];

  if (isMercadoLivre) {
    const itemIdFromUrl = extractMercadoLivreItemIdFromUrl(parsed);
    const apiPriceFromUrl = await fetchMercadoLivreApiPrice(itemIdFromUrl);
    if (apiPriceFromUrl !== null) {
      return apiPriceFromUrl;
    }

    for (const listingId of listingIdsFromUrl) {
      const listingPrice = await fetchMercadoLivreListingPrice(listingId);
      if (listingPrice !== null) {
        return listingPrice;
      }
    }
  }

  for (const candidate of candidates) {
    const text = await fetchTextWithTimeout(candidate);
    if (!text) {
      continue;
    }

    if (isMercadoLivre) {
      const featuredPrice = extractMercadoLivreSocialFeaturedPrice(text);
      if (featuredPrice !== null) {
        return featuredPrice;
      }

      const listingIds = Array.from(
        new Set([...listingIdsFromUrl, ...extractMercadoLivreListingIdsFromText(text)])
      ).slice(0, 12);
      for (const listingId of listingIds) {
        const embeddedPrice = extractMercadoLivreEmbeddedPriceByListingId(text, listingId);
        if (embeddedPrice !== null) {
          return embeddedPrice;
        }
      }

      const itemId = extractMercadoLivreItemId(text);
      const apiPrice = await fetchMercadoLivreApiPrice(itemId);
      if (apiPrice !== null) {
        return apiPrice;
      }

      for (const listingId of listingIds) {
        const listingPrice = await fetchMercadoLivreListingPrice(listingId);
        if (listingPrice !== null) {
          return listingPrice;
        }
      }

      const mlMainPrice = extractMercadoLivreMainPrice(text);
      if (mlMainPrice !== null) {
        return mlMainPrice;
      }

      const dePorPrice = extractMercadoLivreDePorPrice(text);
      if (dePorPrice !== null) {
        return dePorPrice;
      }

      if (itemId && itemId.startsWith("MLB")) {
        const itemSlug = `${itemId.slice(0, 3)}-${itemId.slice(3)}`;
        const mlCandidates = Array.from(
          new Set([
            `https://produto.mercadolivre.com.br/${itemSlug}`,
            `https://r.jina.ai/http://produto.mercadolivre.com.br/${itemSlug}`,
            `https://r.jina.ai/https://produto.mercadolivre.com.br/${itemSlug}`,
          ])
        );
        for (const mlUrl of mlCandidates) {
          const mlText = await fetchTextWithTimeout(mlUrl);
          if (!mlText) {
            continue;
          }

          const mlFeaturedPrice = extractMercadoLivreSocialFeaturedPrice(mlText);
          if (mlFeaturedPrice !== null) {
            return mlFeaturedPrice;
          }

          const mlListingIds = extractMercadoLivreListingIdsFromText(mlText).slice(0, 8);
          for (const mlListingId of mlListingIds) {
            const embeddedPrice = extractMercadoLivreEmbeddedPriceByListingId(
              mlText,
              mlListingId
            );
            if (embeddedPrice !== null) {
              return embeddedPrice;
            }

            const listingPrice = await fetchMercadoLivreListingPrice(mlListingId);
            if (listingPrice !== null) {
              return listingPrice;
            }
          }

          const mlMainPrice = extractMercadoLivreMainPrice(mlText);
          if (mlMainPrice !== null) {
            return mlMainPrice;
          }
        }
      }

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
