export function parsePriceInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const only = raw.replace(/[^\d,.-]/g, "");
  const br = Number(only.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(br) && br >= 0) {
    return Math.round(br * 100) / 100;
  }

  const en = Number(only.replace(/,/g, ""));
  if (Number.isFinite(en) && en >= 0) {
    return Math.round(en * 100) / 100;
  }

  return null;
}

function pickPriceFromPattern(text, regex) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parsePriceInput(match[1]);
    if (parsed !== null && parsed > 0 && parsed < 1000000) {
      return parsed;
    }
  }
  return null;
}

export function extractPriceFromText(text) {
  const source = String(text ?? "");
  const priorityPatterns = [
    /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi,
    /R\$\s*([0-9]+,[0-9]{2})/gi,
    /R\$\s*([0-9]+(?:\.[0-9]{2}))\b/gi,
    /"price"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi,
    /"lowPrice"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi,
    /"highPrice"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi,
    /price[^0-9]{0,20}([0-9]+(?:[.,][0-9]{1,2}))/gi,
  ];

  for (const re of priorityPatterns) {
    const found = pickPriceFromPattern(source, re);
    re.lastIndex = 0;
    if (found !== null) {
      return found;
    }
  }

  return null;
}

async function fetchTextWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function detectPriceFromUrl(url, timeoutMs = 10000) {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch {
    return null;
  }

  const noScheme = parsedUrl.href.replace(/^https?:\/\//i, "");
  const candidates = Array.from(
    new Set([
      parsedUrl.href,
      `https://r.jina.ai/http://${noScheme}`,
      `https://r.jina.ai/https://${noScheme}`,
    ])
  );

  for (const candidate of candidates) {
    const text = await fetchTextWithTimeout(candidate, timeoutMs);
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
