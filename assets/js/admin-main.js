import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { esc, upper, formatBRL } from "./shared/formatters.js";
import { detectPriceFromUrl, parsePriceInput } from "./shared/price.js";
import { createSupabaseBrowserClient } from "./shared/supabase-client.js";

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseConfig();
const missingConfig = isMissingSupabaseConfig(SUPABASE_URL, SUPABASE_ANON_KEY);

if (missingConfig) {
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<div class="container pt-3"><div class="alert alert-danger mb-0">Configure <code>supabase-config.js</code> com <code>url</code> e <code>anonKey</code> do Supabase.</div></div>'
  );
  throw new Error("Supabase nao configurado.");
}

const supabase = createSupabaseBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginCard = document.getElementById("loginCard");
const adminArea = document.getElementById("adminArea");
const logoutBtn = document.getElementById("logoutBtn");

const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");

const className = document.getElementById("className");
const saveClassBtn = document.getElementById("saveClassBtn");
const classMsg = document.getElementById("classMsg");
const classTbody = document.getElementById("classTbody");

const giftsTbody = document.getElementById("giftsTbody");
const giftCategoryFilter = document.getElementById("giftCategoryFilter");
const giftsFilterInfo = document.getElementById("giftsFilterInfo");
const priceScheduleSelect = document.getElementById("priceScheduleSelect");
const savePriceScheduleBtn = document.getElementById("savePriceScheduleBtn");
const enqueueAllPricesBtn = document.getElementById("enqueueAllPricesBtn");
const runDueScheduleBtn = document.getElementById("runDueScheduleBtn");
const processQueueNowBtn = document.getElementById("processQueueNowBtn");
const priceQueueStatusFilter = document.getElementById("priceQueueStatusFilter");
const refreshPriceQueueBtn = document.getElementById("refreshPriceQueueBtn");
const clearDoneFailedQueueBtn = document.getElementById("clearDoneFailedQueueBtn");
const priceQueueMsg = document.getElementById("priceQueueMsg");
const priceQueueTbody = document.getElementById("priceQueueTbody");
const resTbody = document.getElementById("resTbody");
const auditTbody = document.getElementById("auditTbody");
const refreshBtn = document.getElementById("refreshBtn");
const resMsg = document.getElementById("resMsg");
const instructionsEditor = document.getElementById("instructionsEditor");
const saveInstructionsBtn = document.getElementById("saveInstructionsBtn");
const instructionsMsg = document.getElementById("instructionsMsg");
const addLinkBtn = document.getElementById("addLinkBtn");
const foreColorPicker = document.getElementById("foreColorPicker");
const hiliteColorPicker = document.getElementById("hiliteColorPicker");

let classifications = [];
let giftsCache = [];
let priceQueueRowsCache = [];
let hasPriceQueueFeature = true;
const hasPriceQueuePanel = Boolean(priceQueueTbody && priceQueueMsg && priceScheduleSelect);

function formatError(err) {
  const msg = String(err?.message || err || "Erro inesperado");
  if (msg.includes("row-level security")) {
    return "Permissao negada (RLS). Verifique se seu email esta em admin_emails.";
  }
  if (msg.toLowerCase().includes("invalid login credentials")) {
    return "Email ou senha invalidos.";
  }
  if (msg.toLowerCase().includes("email not confirmed")) {
    return "Email nao confirmado no Supabase Auth.";
  }
  if (msg.includes("NOT_ADMIN")) {
    return "Somente usuarios admin podem executar esta acao.";
  }
  if (
    msg.toLowerCase().includes("is_active") ||
    msg.toLowerCase().includes("display_order") ||
    msg.toLowerCase().includes("price_manual_override") ||
    msg.toLowerCase().includes("price_update_")
  ) {
    return "Banco desatualizado. Execute o supabase-setup.sql mais recente.";
  }
  return msg;
}

function applyEditorFormat(cmd, value = null) {
  instructionsEditor.focus();
  if (cmd === "formatBlock") {
    document.execCommand("formatBlock", false, value || "p");
  } else {
    document.execCommand(cmd, false, value);
  }
}

async function saveClassification(classificationId, payload) {
  const { error } = await supabase
    .from("gift_classifications")
    .update(payload)
    .eq("id", classificationId);
  if (error) {
    throw error;
  }
}

function renderClassificationTable() {
  classTbody.innerHTML = classifications
    .map(
      (c) => `
        <tr>
          <td style="min-width: 200px;">
            <input
              class="form-control form-control-sm"
              type="text"
              minlength="2"
              value="${esc(c.name)}"
              data-class-name-input="${c.id}"
            />
          </td>
          <td style="min-width: 140px;">
            <div class="d-flex gap-1 align-items-center">
              <input
                class="form-control form-control-sm"
                type="number"
                min="0"
                step="1"
                value="${Number(c.display_order ?? 0)}"
                data-class-order-input="${c.id}"
              />
            </div>
          </td>
          <td class="text-end d-flex gap-1 justify-content-end">
            <button class="btn btn-sm btn-outline-primary" data-save-class="${c.id}">Salvar</button>
            <button class="btn btn-sm btn-outline-danger" data-del-class="${c.id}">Remover</button>
          </td>
        </tr>
      `
    )
    .join("");

  classTbody.querySelectorAll("button[data-save-class]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-save-class"));
      const nameInput = classTbody.querySelector(`input[data-class-name-input=\"${id}\"]`);
      const orderInput = classTbody.querySelector(`input[data-class-order-input=\"${id}\"]`);
      const newName = String(nameInput?.value ?? "").trim();
      const newOrder = Number(orderInput?.value ?? "");

      if (newName.length < 2) {
        classMsg.textContent = "Nome invalido. Use pelo menos 2 caracteres.";
        return;
      }
      if (!Number.isInteger(newOrder) || newOrder < 0) {
        classMsg.textContent = "Ordem invalida. Use numero inteiro maior ou igual a 0.";
        return;
      }

      btn.disabled = true;
      classMsg.textContent = "Salvando classificacao...";
      try {
        await saveClassification(id, { name: newName, display_order: newOrder });
        classMsg.textContent = "Classificacao atualizada.";
        await loadAdminData();
      } catch (e) {
        classMsg.textContent = `Erro ao salvar classificacao: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  classTbody.querySelectorAll("button[data-del-class]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del-class"));
      if (!confirm("Remover esta classificacao?")) {
        return;
      }

      const { error } = await supabase.from("gift_classifications").delete().eq("id", id);
      if (error) {
        classMsg.textContent = `Erro ao remover classificacao: ${formatError(error)}`;
        return;
      }

      classMsg.textContent = "Classificacao removida.";
      await loadAdminData();
    };
  });
}

async function ensureAdminPermission() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    throw error;
  }
  return data === true;
}

function setLoggedIn(logged) {
  loginCard.classList.toggle("d-none", logged);
  adminArea.classList.toggle("d-none", !logged);
  logoutBtn.classList.toggle("d-none", !logged);
}

async function clearGiftReservations(giftIdToClear) {
  const { error } = await supabase
    .from("gift_reservations")
    .delete()
    .eq("gift_id", giftIdToClear);
  if (error) {
    throw error;
  }
}

async function setGiftActiveState(giftIdToUpdate, isActive) {
  const { error } = await supabase
    .from("gifts")
    .update({ is_active: isActive })
    .eq("id", giftIdToUpdate);
  if (error) {
    throw error;
  }
}

async function updateGiftRowWithFallback(giftIdToUpdate, payload) {
  const optionalCols = ["price_manual_override", "price_status", "price_last_error", "price_checked_at"];
  let nextPayload = { ...payload };
  let lastError = null;

  for (let i = 0; i < 5; i += 1) {
    const { error } = await supabase
      .from("gifts")
      .update(nextPayload)
      .eq("id", giftIdToUpdate);

    if (!error) {
      return;
    }
    lastError = error;

    const msg = String(error?.message || "").toLowerCase();
    let removedAny = false;
    optionalCols.forEach((col) => {
      if (Object.prototype.hasOwnProperty.call(nextPayload, col) && msg.includes(col)) {
        delete nextPayload[col];
        removedAny = true;
      }
    });

    if (!removedAny) {
      throw error;
    }
    if (!Object.keys(nextPayload).length) {
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function updateGiftPriceNow(giftIdToUpdate, buyUrl) {
  const normalizedUrl = String(buyUrl || "").trim();
  if (!normalizedUrl) {
    throw new Error("Este item nao possui link de compra.");
  }

  const detectedPrice = await detectPriceFromUrl(normalizedUrl, 12000);
  if (detectedPrice === null) {
    throw new Error("Nao foi possivel detectar o preco nesse link.");
  }

  await updateGiftRowWithFallback(giftIdToUpdate, {
    price_value: detectedPrice,
    price_manual_override: false,
    price_status: "ok",
    price_last_error: null,
    price_checked_at: new Date().toISOString(),
  });

  return detectedPrice;
}

function formatPriceInputValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return "";
  }
  return num.toFixed(2).replace(".", ",");
}

async function clearPendingPriceQueueByGift(giftId) {
  const { error } = await supabase
    .from("price_update_queue")
    .delete()
    .eq("gift_id", giftId)
    .in("status", ["pending", "processing"]);
  if (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("price_update_queue") || msg.includes("does not exist")) {
      return;
    }
    throw error;
  }
}

async function updateGiftPriceManual(giftIdToUpdate, priceInput) {
  const parsedPrice = parsePriceInput(priceInput);
  if (parsedPrice === null || parsedPrice <= 0) {
    throw new Error("Preco invalido. Informe um valor maior que zero.");
  }

  await updateGiftRowWithFallback(giftIdToUpdate, {
    price_value: parsedPrice,
    price_manual_override: true,
    price_status: "manual",
    price_last_error: null,
    price_checked_at: new Date().toISOString(),
  });

  await clearPendingPriceQueueByGift(giftIdToUpdate);
  return parsedPrice;
}

async function setGiftPriceAutoMode(giftIdToUpdate, enabled) {
  await updateGiftRowWithFallback(giftIdToUpdate, {
    price_manual_override: !enabled,
    price_status: enabled ? "pending" : "manual",
    price_last_error: null,
    price_checked_at: enabled ? null : new Date().toISOString(),
  });
}

async function deleteGiftAndClearReservations(giftIdToDelete) {
  await clearGiftReservations(giftIdToDelete);
  const { error } = await supabase.from("gifts").delete().eq("id", giftIdToDelete);
  if (error) {
    throw error;
  }
}

async function hydrateGiftBuyUrls(gifts) {
  const base = Array.isArray(gifts) ? gifts : [];
  const idsWithoutUrl = base
    .filter((g) => g && !String(g.buy_url || "").trim())
    .map((g) => Number(g.id))
    .filter((id) => Number.isFinite(id));

  if (!idsWithoutUrl.length) {
    return base;
  }

  const { data, error } = await supabase
    .from("gifts")
    .select("id,buy_url")
    .in("id", idsWithoutUrl);

  if (error) {
    return base;
  }

  const byId = new Map((data || []).map((row) => [Number(row.id), String(row.buy_url || "")]));
  return base.map((g) => {
    const id = Number(g.id);
    const buyUrl = String(g.buy_url || "").trim();
    if (buyUrl) {
      return g;
    }
    return { ...g, buy_url: byId.get(id) || "" };
  });
}

function setPriceQueueMessage(msg) {
  if (priceQueueMsg) {
    priceQueueMsg.textContent = msg;
  }
}

function isMissingPriceQueueFeatureError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("price_update_") || msg.includes("does not exist");
}

function setPriceQueueControlsEnabled(enabled) {
  [
    priceScheduleSelect,
    savePriceScheduleBtn,
    enqueueAllPricesBtn,
    runDueScheduleBtn,
    processQueueNowBtn,
    priceQueueStatusFilter,
    refreshPriceQueueBtn,
    clearDoneFailedQueueBtn,
  ]
    .filter(Boolean)
    .forEach((el) => {
      el.disabled = !enabled;
    });
}

function formatQueueTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return "-";
  }
}

function normalizeScheduleSelectValue(settingsRow) {
  if (!settingsRow || settingsRow.is_enabled === false) {
    return "off";
  }
  const freq = Number(settingsRow.frequency_minutes || 0);
  return Number.isFinite(freq) && freq >= 60 ? String(freq) : "1440";
}

function setScheduleSelectValue(value) {
  if (!priceScheduleSelect) {
    return;
  }

  const stringValue = String(value ?? "off");
  const hasOption = Array.from(priceScheduleSelect.options).some((opt) => opt.value === stringValue);
  if (!hasOption && stringValue !== "off") {
    const customOption = document.createElement("option");
    customOption.value = stringValue;
    customOption.textContent = `Personalizado (${stringValue} min)`;
    priceScheduleSelect.appendChild(customOption);
  }

  priceScheduleSelect.value = stringValue;
}

function getFilteredPriceQueueRows() {
  const status = String(priceQueueStatusFilter?.value || "");
  if (!status) {
    return priceQueueRowsCache;
  }
  return priceQueueRowsCache.filter((row) => String(row.status || "") === status);
}

async function deleteQueueEventById(queueId) {
  const { error } = await supabase.from("price_update_queue").delete().eq("id", queueId);
  if (error) {
    throw error;
  }
}

async function clearDoneFailedQueueEvents() {
  const { error } = await supabase
    .from("price_update_queue")
    .delete()
    .in("status", ["done", "failed"]);
  if (error) {
    throw error;
  }
}

function renderPriceQueueRows() {
  if (!priceQueueTbody) {
    return;
  }

  const rows = getFilteredPriceQueueRows();
  if (!rows.length) {
    priceQueueTbody.innerHTML =
      '<tr><td colspan="8" class="text-muted small">Nenhum evento para o filtro selecionado.</td></tr>';
    return;
  }

  priceQueueTbody.innerHTML = rows
    .map((r) => {
      const id = Number(r.id);
      const title = esc(r.gifts?.title || `#${r.gift_id}`);
      const status = esc(String(r.status || "-").toUpperCase());
      const attempts = Number(r.attempts || 0);
      const price = r.detected_price === null || r.detected_price === undefined
        ? "-"
        : formatBRL(r.detected_price, "-");
      const scheduledFor = formatQueueTime(r.scheduled_for || r.created_at);
      const updated = formatQueueTime(r.finished_at || r.started_at || r.created_at);

      return `
        <tr>
          <td>${id}</td>
          <td>${title}</td>
          <td>${status}</td>
          <td>${scheduledFor}</td>
          <td>${attempts}</td>
          <td>${price}</td>
          <td title="${esc(r.last_error || "")}">${updated}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" data-del-queue-id="${id}">Excluir</button>
          </td>
        </tr>
      `;
    })
    .join("");

  priceQueueTbody.querySelectorAll("button[data-del-queue-id]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del-queue-id"));
      if (!confirm(`Excluir o evento #${id} da fila?`)) {
        return;
      }
      btn.disabled = true;
      try {
        await deleteQueueEventById(id);
        setPriceQueueMessage(`Evento #${id} excluido.`);
        await loadPriceQueuePanel();
      } catch (e) {
        setPriceQueueMessage(`Erro ao excluir evento: ${formatError(e)}`);
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function savePriceSchedule() {
  if (!hasPriceQueueFeature) {
    return;
  }

  const selected = String(priceScheduleSelect?.value || "off");
  const enabled = selected !== "off";
  const frequency = enabled ? Number(selected) : 1440;

  if (enabled && (!Number.isInteger(frequency) || frequency < 60)) {
    setPriceQueueMessage("Periodicidade invalida.");
    return;
  }

  savePriceScheduleBtn.disabled = true;
  setPriceQueueMessage("Salvando agendamento...");
  try {
    const { error } = await supabase.rpc("set_price_update_schedule", {
      p_enabled: enabled,
      p_frequency_minutes: frequency,
    });
    if (error) {
      throw error;
    }
    setPriceQueueMessage(
      enabled
        ? `Agendamento salvo: a cada ${frequency} minutos.`
        : "Agendamento desativado (modo manual)."
    );
    await loadPriceQueuePanel();
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      return;
    }
    setPriceQueueMessage(`Erro ao salvar agendamento: ${formatError(e)}`);
  } finally {
    if (savePriceScheduleBtn) {
      savePriceScheduleBtn.disabled = false;
    }
  }
}

async function enqueueAllPricesNow() {
  if (!hasPriceQueueFeature) {
    return;
  }

  enqueueAllPricesBtn.disabled = true;
  setPriceQueueMessage("Enfileirando todos os itens ativos...");
  try {
    const { data, error } = await supabase.rpc("enqueue_price_refresh_all");
    if (error) {
      throw error;
    }
    const enqueued = Number(data?.enqueued ?? 0);
    setPriceQueueMessage(`Itens enfileirados: ${enqueued}.`);
    await loadPriceQueuePanel();
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      return;
    }
    setPriceQueueMessage(`Erro ao enfileirar: ${formatError(e)}`);
  } finally {
    enqueueAllPricesBtn.disabled = false;
  }
}

async function runDueScheduledNow() {
  if (!hasPriceQueueFeature) {
    return;
  }

  runDueScheduleBtn.disabled = true;
  setPriceQueueMessage("Executando verificador de agendamento...");
  try {
    const { data, error } = await supabase.rpc("enqueue_due_scheduled_price_updates");
    if (error) {
      throw error;
    }
    const enqueued = Number(data?.enqueued ?? 0);
    if (data?.ran === false) {
      const reason = String(data?.reason || "nao_due");
      if (reason === "disabled") {
        setPriceQueueMessage("Agendamento esta desativado.");
      } else if (reason === "not_due") {
        setPriceQueueMessage("Ainda nao chegou o horario da proxima execucao.");
      } else {
        setPriceQueueMessage("Sem execucao pendente no momento.");
      }
    } else {
      setPriceQueueMessage(`Agendamento executado. Novos itens na fila: ${enqueued}.`);
    }
    await loadPriceQueuePanel();
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      return;
    }
    setPriceQueueMessage(`Erro ao rodar agendamento: ${formatError(e)}`);
  } finally {
    runDueScheduleBtn.disabled = false;
  }
}

async function processQueueNowInBrowser() {
  if (!hasPriceQueueFeature) {
    return;
  }

  processQueueNowBtn.disabled = true;
  setPriceQueueMessage("Processando fila no navegador...");

  try {
    const { data: jobs, error: claimError } = await supabase.rpc("claim_price_update_jobs", {
      p_limit: 20,
    });
    if (claimError) {
      throw claimError;
    }

    const queueItems = Array.isArray(jobs) ? jobs : [];
    if (!queueItems.length) {
      setPriceQueueMessage("Fila vazia no momento.");
      await loadPriceQueuePanel();
      return;
    }

    let okCount = 0;
    let failCount = 0;

    for (const job of queueItems) {
      const jobId = Number(job.job_id);
      const buyUrl = String(job.buy_url || "").trim();

      try {
        const detected = await detectPriceFromUrl(buyUrl, 12000);
        const { error: finishError } = await supabase.rpc("finish_price_update_job", {
          p_job_id: jobId,
          p_price_value: detected,
          p_error_message: detected === null ? "PRECO_NAO_ENCONTRADO" : null,
        });
        if (finishError) {
          throw finishError;
        }
        if (detected === null) {
          failCount += 1;
        } else {
          okCount += 1;
        }
      } catch (e) {
        failCount += 1;
        await supabase.rpc("finish_price_update_job", {
          p_job_id: jobId,
          p_price_value: null,
          p_error_message: String(e?.message || e || "ERRO_DESCONHECIDO").slice(0, 500),
        });
      }
    }

    const summaryMessage = `Processamento concluido. Sucesso: ${okCount} | Falhas: ${failCount} | Total: ${queueItems.length}.`;
    await loadAdminData();
    setPriceQueueMessage(summaryMessage);
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      return;
    }
    setPriceQueueMessage(`Erro ao processar fila: ${formatError(e)}`);
  } finally {
    processQueueNowBtn.disabled = false;
  }
}

async function loadPriceQueuePanel() {
  if (!hasPriceQueuePanel) {
    return;
  }

  if (!hasPriceQueueFeature) {
    setPriceQueueControlsEnabled(false);
    setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
    return;
  }

  try {
    const { data: settings, error: settingsError } = await supabase
      .from("price_update_settings")
      .select("is_enabled,frequency_minutes,next_run_at,last_run_at")
      .eq("id", 1)
      .maybeSingle();
    if (settingsError) {
      throw settingsError;
    }

    setScheduleSelectValue(normalizeScheduleSelectValue(settings));

    const { data: queueRows, error: queueError } = await supabase
      .from("price_update_queue")
      .select(
        "id,gift_id,status,attempts,scheduled_for,detected_price,last_error,created_at,started_at,finished_at,gifts(title)"
      )
      .order("id", { ascending: false })
      .limit(100);
    if (queueError) {
      throw queueError;
    }

    priceQueueRowsCache = Array.isArray(queueRows) ? queueRows : [];
    renderPriceQueueRows();

    const scheduleText =
      settings?.is_enabled === true
        ? `Agendado a cada ${settings.frequency_minutes} min. Proxima execucao: ${formatQueueTime(
            settings?.next_run_at
          )}.`
        : "Agendamento desativado (somente manual).";
    setPriceQueueMessage(scheduleText);
    setPriceQueueControlsEnabled(true);
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      if (priceQueueTbody) {
        priceQueueTbody.innerHTML =
          '<tr><td colspan="8" class="text-muted small">Recurso indisponivel ate atualizar o banco.</td></tr>';
      }
      return;
    }
    setPriceQueueMessage(`Erro ao carregar fila: ${formatError(e)}`);
  }
}

function renderGiftFilterOptions() {
  const previousValue = giftCategoryFilter?.value ?? "";
  if (!giftCategoryFilter) {
    return;
  }

  giftCategoryFilter.innerHTML =
    '<option value="">Todas</option>' +
    classifications.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  if (previousValue && classifications.some((c) => String(c.id) === previousValue)) {
    giftCategoryFilter.value = previousValue;
  } else {
    giftCategoryFilter.value = "";
  }
}

function getFilteredGifts() {
  const selectedClass = giftCategoryFilter?.value ?? "";
  if (!selectedClass) {
    return giftsCache;
  }
  return giftsCache.filter((g) => String(g.classification_id ?? "") === selectedClass);
}

function renderGiftsTable() {
  const gifts = getFilteredGifts();
  const selectedClass = giftCategoryFilter?.value ?? "";
  const selectedClassName = selectedClass
    ? classifications.find((c) => String(c.id) === selectedClass)?.name || "Categoria"
    : "Todas";

  if (giftsFilterInfo) {
    giftsFilterInfo.textContent = `Filtro: ${selectedClassName} | Exibindo ${gifts.length} de ${giftsCache.length} itens.`;
  }

  if (!gifts.length) {
    giftsTbody.innerHTML =
      '<tr><td colspan="9" class="text-muted small">Nenhum item para esta categoria.</td></tr>';
    return;
  }

  giftsTbody.innerHTML = gifts
    .map(
      (g) => `
        <tr data-gift-row-id="${g.id}">
          <td>${g.id}</td>
          <td class="gift-title-cell">${esc(upper(g.title || ""))}</td>
          <td class="gift-class-cell">${esc(g.classification_name || "-")}</td>
          <td data-gift-price-cell="${g.id}">
            <div class="gift-price-editor">
              <input
                class="form-control form-control-sm"
                type="text"
                inputmode="decimal"
                data-manual-price-input="${g.id}"
                value="${esc(formatPriceInputValue(g.price_value))}"
                placeholder="0,00"
              />
              <button class="btn btn-sm btn-outline-primary" data-save-manual-price="${g.id}">Salvar</button>
            </div>
            <div class="small text-muted mt-1">
              ${
                g.price_manual_override === true
                  ? '<span class="badge text-bg-warning">MANUAL</span> Auto desativado'
                  : g.price_status === "ok"
                  ? '<span class="badge text-bg-success">AUTO OK</span>'
                  : g.price_status === "failed"
                  ? `<span class="badge text-bg-danger" title="${esc(g.price_last_error || "Falha na captura")}">AUTO FALHOU</span>`
                  : '<span class="badge text-bg-secondary">AUTO PENDENTE</span>'
              }
              ${
                g.price_checked_at
                  ? ` <span class="text-muted">(${new Date(g.price_checked_at).toLocaleString("pt-BR")})</span>`
                  : ""
              }
            </div>
          </td>
          <td>${
            g.is_active === false
              ? '<span class="badge text-bg-secondary">INATIVO</span>'
              : '<span class="badge text-bg-success">ATIVO</span>'
          }</td>
          <td>${g.qty_total}</td>
          <td>${g.qty_reserved}</td>
          <td>${g.qty_available}</td>
          <td class="text-end gift-actions-cell">
            <details class="gift-actions-menu">
              <summary class="btn btn-sm btn-outline-secondary">Ações</summary>
              <div class="gift-actions-list">
                <a class="btn btn-sm btn-outline-secondary w-100" href="./admin-item.html?id=${g.id}">Editar</a>
                <button
                  class="btn btn-sm btn-outline-info w-100"
                  data-refresh-price="${g.id}"
                  data-refresh-buy-url="${esc(g.buy_url || "")}"
                >Atualizar preco</button>
                <button
                  class="btn btn-sm ${g.price_manual_override === true ? "btn-outline-success" : "btn-outline-secondary"} w-100"
                  data-enable-auto-price="${g.id}"
                  ${g.price_manual_override === true ? "" : "disabled"}
                >Reativar auto preco</button>
                <button
                  class="btn btn-sm ${g.is_active === false ? "btn-outline-success" : "btn-outline-warning"} w-100"
                  data-toggle-active="${g.id}"
                  data-next-active="${g.is_active === false ? "true" : "false"}"
                >${g.is_active === false ? "Ativar" : "Desativar"}</button>
                <button class="btn btn-sm btn-outline-danger w-100" data-delete-gift="${g.id}">Excluir</button>
              </div>
            </details>
          </td>
        </tr>
      `
    )
    .join("");

  giftsTbody.querySelectorAll("button[data-save-manual-price]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-save-manual-price"));
      const input = giftsTbody.querySelector(`input[data-manual-price-input="${id}"]`);
      const inputValue = String(input?.value || "").trim();

      btn.disabled = true;
      resMsg.textContent = "Salvando preco manual...";
      try {
        const savedPrice = await updateGiftPriceManual(id, inputValue);
        resMsg.textContent = `Preco manual salvo: ${formatBRL(savedPrice, "-")}. Atualizacao automatica desativada para este item.`;
        await loadAdminData();
      } catch (e) {
        resMsg.textContent = `Erro ao salvar preco manual: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-enable-auto-price]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-enable-auto-price"));
      if (!confirm("Reativar atualizacao automatica de preco para este item?")) {
        return;
      }

      btn.disabled = true;
      resMsg.textContent = "Reativando atualizacao automatica...";
      try {
        await setGiftPriceAutoMode(id, true);
        resMsg.textContent = "Atualizacao automatica reativada para este item.";
        await loadAdminData();
      } catch (e) {
        resMsg.textContent = `Erro ao reativar auto preco: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-toggle-active]").forEach((btn) => {
    btn.onclick = async () => {
      const details = btn.closest("details");
      const id = Number(btn.getAttribute("data-toggle-active"));
      const nextActive = btn.getAttribute("data-next-active") === "true";
      const confirmMsg = nextActive
        ? "Ativar este presente?"
        : "Desativar este presente e limpar todas as reservas dele?";

      if (!confirm(confirmMsg)) {
        return;
      }

      btn.disabled = true;
      resMsg.textContent = nextActive ? "Ativando presente..." : "Desativando presente e limpando reservas...";

      try {
        if (nextActive) {
          await setGiftActiveState(id, true);
          resMsg.textContent = "Presente ativado.";
        } else {
          await setGiftActiveState(id, false);
          await clearGiftReservations(id);
          resMsg.textContent = "Presente desativado e reservas removidas.";
        }
        await loadAdminData();
        if (details) {
          details.open = false;
        }
      } catch (e) {
        resMsg.textContent = `Erro ao alterar status: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-refresh-price]").forEach((btn) => {
    btn.onclick = async () => {
      const details = btn.closest("details");
      const id = Number(btn.getAttribute("data-refresh-price"));
      const buyUrl = String(btn.getAttribute("data-refresh-buy-url") || "").trim();
      const row = giftsTbody.querySelector(`tr[data-gift-row-id="${id}"]`);
      const originalText = btn.textContent;

      btn.disabled = true;
      btn.textContent = "Atualizando...";
      row?.classList.add("gift-row-updating");
      resMsg.textContent = "Atualizando preco do item...";
      try {
        const detectedPrice = await updateGiftPriceNow(id, buyUrl);
        resMsg.textContent = `Preco atualizado: ${formatBRL(detectedPrice, "-")}.`;
        await loadAdminData();
        if (details) {
          details.open = false;
        }
      } catch (e) {
        resMsg.textContent = `Erro ao atualizar preco: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
        btn.textContent = originalText || "Atualizar preco";
        row?.classList.remove("gift-row-updating");
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-delete-gift]").forEach((btn) => {
    btn.onclick = async () => {
      const details = btn.closest("details");
      const id = Number(btn.getAttribute("data-delete-gift"));
      if (!confirm("Excluir este presente? As reservas dele tambem serao removidas.")) {
        return;
      }

      btn.disabled = true;
      resMsg.textContent = "Excluindo presente...";
      try {
        await deleteGiftAndClearReservations(id);
        resMsg.textContent = "Presente excluido e reservas removidas.";
        await loadAdminData();
        if (details) {
          details.open = false;
        }
      } catch (e) {
        resMsg.textContent = `Erro ao excluir: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });
}

function summarizeAuditPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "-";
  }

  const row = payload.new ?? payload.old ?? payload;
  if (row && typeof row === "object") {
    if (row.title) {
      return String(row.title).slice(0, 80);
    }
    if (row.name) {
      return String(row.name).slice(0, 80);
    }
    if (row.reserved_by) {
      return `${String(row.reserved_by).slice(0, 60)} x${row.qty ?? "?"}`;
    }
  }

  const keys = Object.keys(payload);
  return keys.length ? keys.slice(0, 3).join(", ") : "-";
}

function renderAuditTable(rows) {
  if (!auditTbody) {
    return;
  }

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    auditTbody.innerHTML = '<tr><td colspan="5" class="text-muted small">Sem eventos recentes.</td></tr>';
    return;
  }

  auditTbody.innerHTML = list
    .map((r) => {
      const when = r.created_at ? new Date(r.created_at).toLocaleString("pt-BR") : "-";
      const actor = r.actor_email || r.actor_role || "desconhecido";
      const action = String(r.action || "-").toUpperCase();
      const entity = `${r.entity_type || "-"} #${r.entity_id ?? "-"}`;
      const details = summarizeAuditPayload(r.payload);
      return `
        <tr>
          <td>${esc(when)}</td>
          <td>${esc(actor)}</td>
          <td>${esc(action)}</td>
          <td>${esc(entity)}</td>
          <td>${esc(details)}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadAdminData() {
  const { data: site, error: es } = await supabase
    .from("site_content")
    .select("id,instructions_html")
    .eq("id", 1)
    .maybeSingle();

  if (es) {
    throw es;
  }
  instructionsEditor.innerHTML = site?.instructions_html || "";

  let cls = [];
  let ec = null;
  const withOrder = await supabase
    .from("gift_classifications")
    .select("id,name,display_order")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (withOrder.error) {
    const maybeMissingColumn = String(withOrder.error?.message || "").toLowerCase().includes("display_order");
    if (maybeMissingColumn) {
      const fallback = await supabase
        .from("gift_classifications")
        .select("id,name")
        .order("name", { ascending: true });
      cls = (fallback.data ?? []).map((c) => ({ ...c, display_order: 0 }));
      ec = fallback.error;
    } else {
      ec = withOrder.error;
    }
  } else {
    cls = (withOrder.data ?? []).map((c) => ({ ...c, display_order: c.display_order ?? 0 }));
  }

  if (ec) {
    throw ec;
  }

  classifications = cls;
  renderClassificationTable();

  let gifts = [];
  let eg = null;
  const withClassOrder = await supabase
    .from("gifts_view")
    .select(
      "id,title,buy_url,price_value,price_manual_override,price_status,price_last_error,price_checked_at,is_active,classification_display_order,classification_id,classification_name,qty_total,qty_reserved,qty_available"
    )
    .order("classification_display_order", { ascending: true })
    .order("classification_name", { ascending: true })
    .order("id", { ascending: true });

  if (withClassOrder.error) {
    const emsg = String(withClassOrder.error?.message || "").toLowerCase();
    const maybeMissing =
      emsg.includes("classification_display_order") ||
      emsg.includes("is_active") ||
      emsg.includes("buy_url") ||
      emsg.includes("price_manual_override") ||
      emsg.includes("price_status") ||
      emsg.includes("price_last_error") ||
      emsg.includes("price_checked_at");

    if (maybeMissing) {
      const fallback = await supabase
        .from("gifts_view")
        .select("id,title,price_value,classification_id,classification_name,qty_total,qty_reserved,qty_available")
        .order("classification_name", { ascending: true })
        .order("id", { ascending: true });

      gifts = (fallback.data ?? []).map((g) => ({
        ...g,
        is_active: true,
        classification_display_order: 0,
        buy_url: "",
        price_manual_override: false,
        price_status: "pending",
        price_last_error: null,
        price_checked_at: null,
      }));
      eg = fallback.error;
    } else {
      eg = withClassOrder.error;
    }
  } else {
    gifts = (withClassOrder.data ?? []).map((g) => ({
      ...g,
      classification_display_order: g.classification_display_order ?? 0,
      price_manual_override: g.price_manual_override === true,
      price_status: String(g.price_status || "").toLowerCase(),
      price_last_error: g.price_last_error || null,
      price_checked_at: g.price_checked_at || null,
    }));
  }

  if (eg) {
    throw eg;
  }

  giftsCache = await hydrateGiftBuyUrls(gifts);
  renderGiftFilterOptions();
  renderGiftsTable();
  if (hasPriceQueuePanel) {
    await loadPriceQueuePanel();
  }

  const { data: res, error: er } = await supabase
    .from("gift_reservations")
    .select("id,gift_id,reserved_by,qty,reserved_at,gifts(title)")
    .order("reserved_at", { ascending: false })
    .limit(200);

  if (er) {
    throw er;
  }

  resTbody.innerHTML = res
    .map(
      (r) => `
        <tr>
          <td>${r.gifts?.title ?? `#${r.gift_id}`}</td>
          <td>${r.reserved_by}</td>
          <td>${r.qty}</td>
          <td>${new Date(r.reserved_at).toLocaleString("pt-BR")}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-danger" data-del="${r.id}">Remover</button>
          </td>
        </tr>
      `
    )
    .join("");

  resTbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del"));
      if (!confirm("Remover esta reserva?")) {
        return;
      }

      const { error } = await supabase.from("gift_reservations").delete().eq("id", id);
      if (error) {
        resMsg.textContent = `Erro ao remover: ${error.message}`;
      } else {
        resMsg.textContent = "Reserva removida.";
        await loadAdminData();
      }
    };
  });

  if (auditTbody) {
    const { data: auditRows, error: auditError } = await supabase
      .from("admin_audit_log")
      .select("created_at,actor_email,actor_role,action,entity_type,entity_id,payload")
      .order("created_at", { ascending: false })
      .limit(120);

    if (auditError) {
      const msg = String(auditError?.message || "").toLowerCase();
      if (msg.includes("admin_audit_log") || msg.includes("does not exist")) {
        renderAuditTable([]);
      } else {
        throw auditError;
      }
    } else {
      renderAuditTable(auditRows ?? []);
    }
  }

  if (!resMsg.textContent) {
    resMsg.textContent = "Mostrando ate 200 reservas recentes.";
  }
}

document.querySelectorAll("[data-format]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cmd = btn.getAttribute("data-format");
    const value = btn.getAttribute("data-value");
    if (cmd) {
      applyEditorFormat(cmd, value);
    }
  });
});

addLinkBtn.addEventListener("click", () => {
  const url = prompt("Informe a URL do link:");
  if (!url) {
    return;
  }
  instructionsEditor.focus();
  document.execCommand("createLink", false, url.trim());
});

foreColorPicker.addEventListener("change", () => {
  applyEditorFormat("foreColor", foreColorPicker.value);
});

hiliteColorPicker.addEventListener("change", () => {
  applyEditorFormat("hiliteColor", hiliteColorPicker.value);
});

loginBtn.onclick = async () => {
  loginBtn.disabled = true;
  loginMsg.textContent = "Entrando...";
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    });
    if (error) {
      loginMsg.textContent = `Erro: ${formatError(error)}`;
      return;
    }
    loginMsg.textContent = "Login realizado. Validando acesso...";
  } catch (e) {
    loginMsg.textContent = `Erro: ${formatError(e)}`;
  } finally {
    loginBtn.disabled = false;
  }
};

logoutBtn.onclick = async () => {
  await supabase.auth.signOut();
  setLoggedIn(false);
};

saveClassBtn.onclick = async () => {
  saveClassBtn.disabled = true;
  classMsg.textContent = "Salvando classificacao...";

  const name = className.value.trim();
  if (name.length < 2) {
    classMsg.textContent = "Informe um nome de classificacao com pelo menos 2 caracteres.";
    saveClassBtn.disabled = false;
    return;
  }

  try {
    const { error } = await supabase.from("gift_classifications").insert({ name });
    if (error) {
      throw error;
    }
    className.value = "";
    classMsg.textContent = "Classificacao criada.";
    await loadAdminData();
  } catch (e) {
    classMsg.textContent = `Erro ao criar classificacao: ${formatError(e)}`;
  } finally {
    saveClassBtn.disabled = false;
  }
};

saveInstructionsBtn.onclick = async () => {
  saveInstructionsBtn.disabled = true;
  instructionsMsg.textContent = "Salvando mensagem...";
  try {
    const payload = {
      id: 1,
      instructions_html: instructionsEditor.innerHTML || "",
    };
    const { error } = await supabase.from("site_content").upsert(payload, { onConflict: "id" });
    if (error) {
      throw error;
    }
    instructionsMsg.textContent = "Mensagem salva.";
  } catch (e) {
    instructionsMsg.textContent = `Erro ao salvar mensagem: ${formatError(e)}`;
  } finally {
    saveInstructionsBtn.disabled = false;
  }
};

refreshBtn.onclick = async () => {
  try {
    await loadAdminData();
  } catch (e) {
    resMsg.textContent = `Erro ao atualizar: ${formatError(e)}`;
  }
};

if (savePriceScheduleBtn) {
  savePriceScheduleBtn.onclick = savePriceSchedule;
}

if (enqueueAllPricesBtn) {
  enqueueAllPricesBtn.onclick = enqueueAllPricesNow;
}

if (runDueScheduleBtn) {
  runDueScheduleBtn.onclick = runDueScheduledNow;
}

if (processQueueNowBtn) {
  processQueueNowBtn.onclick = processQueueNowInBrowser;
}

if (refreshPriceQueueBtn) {
  refreshPriceQueueBtn.onclick = loadPriceQueuePanel;
}

if (priceQueueStatusFilter) {
  priceQueueStatusFilter.onchange = renderPriceQueueRows;
}

if (clearDoneFailedQueueBtn) {
  clearDoneFailedQueueBtn.onclick = async () => {
    if (!confirm("Excluir todos os eventos concluidos e falhos da fila?")) {
      return;
    }
    clearDoneFailedQueueBtn.disabled = true;
    try {
      await clearDoneFailedQueueEvents();
      setPriceQueueMessage("Eventos concluidos/falhos removidos.");
      await loadPriceQueuePanel();
    } catch (e) {
      setPriceQueueMessage(`Erro ao limpar eventos: ${formatError(e)}`);
    } finally {
      clearDoneFailedQueueBtn.disabled = false;
    }
  };
}

if (giftCategoryFilter) {
  giftCategoryFilter.onchange = () => {
    renderGiftsTable();
  };
}

const {
  data: { session },
} = await supabase.auth.getSession();
setLoggedIn(!!session);

async function handleSessionChange(session2) {
  if (!session2) {
    setLoggedIn(false);
    return;
  }

  try {
    const isAdmin = await ensureAdminPermission();
    setLoggedIn(isAdmin);
    if (!isAdmin) {
      loginMsg.textContent = "Login OK, mas este usuario nao esta autorizado no admin.";
      await supabase.auth.signOut();
      return;
    }

    loginMsg.textContent = "";
    await loadAdminData();
  } catch (e) {
    setLoggedIn(false);
    resMsg.textContent = `Erro ao carregar dados: ${formatError(e)}`;
    loginMsg.textContent = `Erro ao validar admin: ${formatError(e)}`;
  }
}

supabase.auth.onAuthStateChange((_event, session2) => {
  setTimeout(() => {
    handleSessionChange(session2);
  }, 0);
});

if (session) {
  await handleSessionChange(session);
}
