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
    if (parsed !== null && parsed > 0 && parsed < 1000000) {
      return parsed;
    }
  }
  return null;
}

export function extractPriceFromText(text) {
  const source = String(text ?? "");
  const amountPattern =
    "([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{1,2})?)";
  const priorityPatterns = [
    // Mercado Livre markdown: ~~R$ antigo~~ R$ novo
    {
      regex: new RegExp(`~~\\s*R\\$\\s*${amountPattern}\\s*~~\\s*R\\$\\s*${amountPattern}`, "gi"),
      group: 2,
    },
    // Outro formato comum de vitrine: R$ antigo R$ novo 12% OFF
    {
      regex: new RegExp(`R\\$\\s*${amountPattern}\\s+R\\$\\s*${amountPattern}\\s+[0-9]{1,2}%\\s*OFF`, "gi"),
      group: 2,
    },
    // "de X por Y": prioriza o preco apos "por".
    {
      regex: new RegExp(
        `de\\s*(?:r\\$\\s*)?${amountPattern}\\s*(?:por|a)\\s*(?:r\\$\\s*)?${amountPattern}`,
        "gi"
      ),
      group: 2,
    },
    {
      regex: new RegExp(`\\bpor\\s*(?:r\\$\\s*)?${amountPattern}`, "gi"),
      group: 1,
    },
    {
      regex: new RegExp(`\\b(?:pix|a\\s*vista)\\s*(?:por|:|-)?\\s*(?:r\\$\\s*)?${amountPattern}`, "gi"),
      group: 1,
    },
    { regex: /"price"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi, group: 1 },
    { regex: /"lowPrice"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi, group: 1 },
    { regex: /"highPrice"\s*:\s*"([0-9]+(?:[.,][0-9]{1,2})?)"/gi, group: 1 },
    { regex: /price[^0-9]{0,20}([0-9]+(?:[.,][0-9]{1,2}))/gi, group: 1 },
    { regex: /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi, group: 1 },
    { regex: /R\$\s*([0-9]+,[0-9]{2})/gi, group: 1 },
    { regex: /R\$\s*([0-9]+(?:\.[0-9]{2}))\b/gi, group: 1 },
    { regex: /([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/gi, group: 1 },
    { regex: /([0-9]+(?:\.[0-9]{2}))\b/gi, group: 1 },
  ];

  for (const { regex, group } of priorityPatterns) {
    const found = pickPriceFromPattern(source, regex, group);
    regex.lastIndex = 0;
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

async function fetchJsonWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractMercadoLivreItemId(text) {
  const source = String(text ?? "");
  const match = source.match(/\bML[A-Z]\d{7,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractMercadoLivreItemIdFromUrl(urlObj) {
  const source = `${urlObj?.pathname || ""} ${urlObj?.href || ""}`;
  const match = source.match(/\b(ML[A-Z]-?\d{7,})\b/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase().replace("-", "");
}

async function fetchMercadoLivreApiPrice(itemId, timeoutMs = 10000) {
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

  // Prioriza preco de venda atual da API.
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

  const amountPattern =
    "([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{2}))";

  // Em alguns casos "de X por Y" usa Y para pix/cupom. Mantemos X.
  const dePor = new RegExp(
    `de\\s*(?:r\\$\\s*)?${amountPattern}[\\s\\S]{0,40}(?:por|a\\s*partir\\s*de)\\s*(?:r\\$\\s*)?${amountPattern}`,
    "i"
  );
  const matchDePor = block.match(dePor);
  if (matchDePor?.[1]) {
    const parsed = parsePriceInput(matchDePor[1]);
    if (parsed !== null) {
      return parsed;
    }
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
  const isMercadoLivre =
    /mercadolivre|mercadolibre/i.test(parsedUrl.hostname) ||
    /mercadolivre|mercadolibre/i.test(parsedUrl.href);

  if (isMercadoLivre) {
    const itemIdFromUrl = extractMercadoLivreItemIdFromUrl(parsedUrl);
    const apiPriceFromUrl = await fetchMercadoLivreApiPrice(itemIdFromUrl, timeoutMs);
    if (apiPriceFromUrl !== null) {
      return apiPriceFromUrl;
    }
  }

  for (const candidate of candidates) {
    const text = await fetchTextWithTimeout(candidate, timeoutMs);
    if (!text) {
      continue;
    }

    if (isMercadoLivre) {
      const itemId = extractMercadoLivreItemId(text);
      const apiPrice = await fetchMercadoLivreApiPrice(itemId, timeoutMs);
      if (apiPrice !== null) {
        return apiPrice;
      }

      const mlMainPrice = extractMercadoLivreMainPrice(text);
      if (mlMainPrice !== null) {
        return mlMainPrice;
      }
    }

    const price = extractPriceFromText(text);
    if (price !== null) {
      return price;
    }

    // Para links encurtados do Mercado Livre, tenta abrir o item canonical por MLBxxxx.
    if (isMercadoLivre) {
      const itemId = extractMercadoLivreItemId(text);
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
          const mlText = await fetchTextWithTimeout(mlUrl, timeoutMs);
          if (!mlText) {
            continue;
          }
          const mlPrice = extractPriceFromText(mlText);
          if (mlPrice !== null) {
            return mlPrice;
          }
        }
      }
    }
  }

  return null;
}
