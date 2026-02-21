import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { esc, formatBRL } from "./shared/formatters.js";
import { detectPriceFromUrl } from "./shared/price.js";
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

const priceScheduleSelect = document.getElementById("priceScheduleSelect");
const savePriceScheduleBtn = document.getElementById("savePriceScheduleBtn");
const enqueueAllPricesBtn = document.getElementById("enqueueAllPricesBtn");
const runDueScheduleBtn = document.getElementById("runDueScheduleBtn");
const processQueueNowBtn = document.getElementById("processQueueNowBtn");
const disableScheduleAndClearBtn = document.getElementById("disableScheduleAndClearBtn");
const priceQueueStatusFilter = document.getElementById("priceQueueStatusFilter");
const refreshPriceQueueBtn = document.getElementById("refreshPriceQueueBtn");
const clearDoneFailedQueueBtn = document.getElementById("clearDoneFailedQueueBtn");
const clearScheduledRunsBtn = document.getElementById("clearScheduledRunsBtn");
const priceQueueMsg = document.getElementById("priceQueueMsg");
const priceQueueTbody = document.getElementById("priceQueueTbody");
const activeScheduleMsg = document.getElementById("activeScheduleMsg");
const scheduledRunsTbody = document.getElementById("scheduledRunsTbody");
const queueStatTotal = document.getElementById("queueStatTotal");
const queueStatPending = document.getElementById("queueStatPending");
const queueStatProcessing = document.getElementById("queueStatProcessing");
const queueStatDone = document.getElementById("queueStatDone");
const queueStatFailed = document.getElementById("queueStatFailed");
const queueStatUpdatedAt = document.getElementById("queueStatUpdatedAt");

let hasPriceQueueFeature = true;
let priceQueueRowsCache = [];
let currentScheduleSettings = null;

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
  if (msg.toLowerCase().includes("price_update_")) {
    return "Banco desatualizado. Execute o supabase-setup.sql mais recente.";
  }
  return msg;
}

function setLoggedIn(logged) {
  loginCard.classList.toggle("d-none", logged);
  adminArea.classList.toggle("d-none", !logged);
  logoutBtn.classList.toggle("d-none", !logged);
}

async function ensureAdminPermission() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    throw error;
  }
  return data === true;
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
    disableScheduleAndClearBtn,
    priceQueueStatusFilter,
    refreshPriceQueueBtn,
    clearDoneFailedQueueBtn,
    clearScheduledRunsBtn,
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

function setText(el, value) {
  if (el) {
    el.textContent = String(value);
  }
}

function renderQueueStats() {
  const rows = Array.isArray(priceQueueRowsCache) ? priceQueueRowsCache : [];
  const counts = {
    total: rows.length,
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
  };

  let latestMs = 0;

  rows.forEach((row) => {
    const status = String(row?.status || "").toLowerCase();
    if (status in counts) {
      counts[status] += 1;
    }

    const sourceTime = row?.finished_at || row?.started_at || row?.created_at || null;
    const parsed = sourceTime ? Date.parse(sourceTime) : NaN;
    if (Number.isFinite(parsed) && parsed > latestMs) {
      latestMs = parsed;
    }
  });

  setText(queueStatTotal, counts.total);
  setText(queueStatPending, counts.pending);
  setText(queueStatProcessing, counts.processing);
  setText(queueStatDone, counts.done);
  setText(queueStatFailed, counts.failed);
  setText(queueStatUpdatedAt, latestMs > 0 ? formatQueueTime(new Date(latestMs).toISOString()) : "-");
}

function normalizeScheduleSelectValue(settingsRow) {
  if (!settingsRow || settingsRow.is_enabled === false) {
    return "off";
  }
  const freq = Number(settingsRow.frequency_minutes || 0);
  return Number.isFinite(freq) && freq >= 60 ? String(freq) : "1440";
}

function setScheduleSelectValue(value) {
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

function getScheduledRows() {
  const rows = Array.isArray(priceQueueRowsCache) ? priceQueueRowsCache : [];
  return rows
    .filter((row) => {
      return Boolean(row?.scheduled_for || row?.created_at);
    })
    .sort((a, b) => {
      const aTime = Date.parse(a?.scheduled_for || a?.created_at || 0) || 0;
      const bTime = Date.parse(b?.scheduled_for || b?.created_at || 0) || 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
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

async function clearScheduledQueueEvents() {
  const { error } = await supabase
    .from("price_update_queue")
    .delete()
    .in("status", ["pending", "processing"]);
  if (error) {
    throw error;
  }
}

function renderScheduledRuns() {
  if (!scheduledRunsTbody) {
    return;
  }

  const scheduledRows = getScheduledRows();
  const pendingCount = scheduledRows.filter((row) => String(row?.status || "").toLowerCase() === "pending").length;
  const processingCount = scheduledRows.filter((row) => String(row?.status || "").toLowerCase() === "processing").length;
  const enabled = currentScheduleSettings?.is_enabled === true;
  const frequency = Number(currentScheduleSettings?.frequency_minutes || 0);
  const nextRun = formatQueueTime(currentScheduleSettings?.next_run_at || null);

  if (activeScheduleMsg) {
    activeScheduleMsg.textContent = enabled
      ? `Agendamento ativo (${frequency} min). Proxima execucao: ${nextRun}. Pendentes: ${pendingCount} | Processando: ${processingCount}.`
      : `Agendamento automatico desativado. Pendentes: ${pendingCount} | Processando: ${processingCount}.`;
  }

  if (!scheduledRows.length) {
    scheduledRunsTbody.innerHTML =
      '<tr><td colspan="5" class="text-muted small">Nenhum agendamento registrado.</td></tr>';
    return;
  }

  scheduledRunsTbody.innerHTML = scheduledRows
    .map((r) => {
      const id = Number(r.id);
      const title = esc(r.gifts?.title || `#${r.gift_id}`);
      const status = esc(String(r.status || "-").toUpperCase());
      const scheduledFor = formatQueueTime(r.scheduled_for || r.created_at);
      return `
        <tr>
          <td>${id}</td>
          <td>${title}</td>
          <td>${status}</td>
          <td>${scheduledFor}</td>
          <td>
            <button class="btn btn-sm btn-outline-danger" data-del-scheduled-id="${id}">Excluir</button>
          </td>
        </tr>
      `;
    })
    .join("");

  scheduledRunsTbody.querySelectorAll("button[data-del-scheduled-id]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del-scheduled-id"));
      if (!confirm(`Excluir o agendamento #${id}?`)) {
        return;
      }
      btn.disabled = true;
      try {
        await deleteQueueEventById(id);
        setPriceQueueMessage(`Agendamento #${id} excluido.`);
        await loadPriceQueuePanel();
      } catch (e) {
        setPriceQueueMessage(`Erro ao excluir agendamento: ${formatError(e)}`);
      } finally {
        btn.disabled = false;
      }
    };
  });
}

function renderPriceQueueRows() {
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
      const price =
        r.detected_price === null || r.detected_price === undefined
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
    savePriceScheduleBtn.disabled = false;
  }
}

async function disableScheduleAndClearPending() {
  if (!hasPriceQueueFeature) {
    return;
  }

  disableScheduleAndClearBtn.disabled = true;
  setPriceQueueMessage("Desativando agendamento e limpando pendentes...");
  try {
    const { error: scheduleError } = await supabase.rpc("set_price_update_schedule", {
      p_enabled: false,
      p_frequency_minutes: 1440,
    });
    if (scheduleError) {
      throw scheduleError;
    }

    await clearScheduledQueueEvents();
    setPriceQueueMessage("Agendamento desativado e pendentes removidos.");
    await loadPriceQueuePanel();
  } catch (e) {
    if (isMissingPriceQueueFeatureError(e)) {
      hasPriceQueueFeature = false;
      setPriceQueueControlsEnabled(false);
      setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
      return;
    }
    setPriceQueueMessage(`Erro ao desativar agendamento: ${formatError(e)}`);
  } finally {
    disableScheduleAndClearBtn.disabled = false;
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

    setPriceQueueMessage(
      `Processamento concluido. Sucesso: ${okCount} | Falhas: ${failCount} | Total: ${queueItems.length}.`
    );
    await loadPriceQueuePanel();
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
  if (!hasPriceQueueFeature) {
    setPriceQueueControlsEnabled(false);
    setPriceQueueMessage("Fila de precos indisponivel. Execute o supabase-setup.sql atualizado.");
    priceQueueRowsCache = [];
    currentScheduleSettings = null;
    renderScheduledRuns();
    renderQueueStats();
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
    currentScheduleSettings = settings || null;

    setScheduleSelectValue(normalizeScheduleSelectValue(settings));

    const { data: queueRows, error: queueError } = await supabase
      .from("price_update_queue")
      .select(
        "id,gift_id,status,attempts,scheduled_for,detected_price,last_error,created_at,started_at,finished_at,gifts(title)"
      )
      .order("id", { ascending: false })
      .limit(300);
    if (queueError) {
      throw queueError;
    }

    priceQueueRowsCache = Array.isArray(queueRows) ? queueRows : [];
    renderPriceQueueRows();
    renderScheduledRuns();
    renderQueueStats();

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
      priceQueueTbody.innerHTML =
        '<tr><td colspan="8" class="text-muted small">Recurso indisponivel ate atualizar o banco.</td></tr>';
      priceQueueRowsCache = [];
      currentScheduleSettings = null;
      renderScheduledRuns();
      renderQueueStats();
      return;
    }
    setPriceQueueMessage(`Erro ao carregar fila: ${formatError(e)}`);
    priceQueueRowsCache = [];
    currentScheduleSettings = null;
    renderScheduledRuns();
    renderQueueStats();
  }
}

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

savePriceScheduleBtn.onclick = savePriceSchedule;
enqueueAllPricesBtn.onclick = enqueueAllPricesNow;
runDueScheduleBtn.onclick = runDueScheduledNow;
processQueueNowBtn.onclick = processQueueNowInBrowser;
refreshPriceQueueBtn.onclick = loadPriceQueuePanel;
priceQueueStatusFilter.onchange = renderPriceQueueRows;
disableScheduleAndClearBtn.onclick = async () => {
  if (!confirm("Desativar o agendamento automatico e excluir todos os pendentes?")) {
    return;
  }
  await disableScheduleAndClearPending();
};

clearScheduledRunsBtn.onclick = async () => {
  if (!confirm("Excluir todos os agendamentos pendentes/processando?")) {
    return;
  }
  clearScheduledRunsBtn.disabled = true;
  try {
    await clearScheduledQueueEvents();
    setPriceQueueMessage("Agendamentos pendentes removidos.");
    await loadPriceQueuePanel();
  } catch (e) {
    setPriceQueueMessage(`Erro ao limpar agendamentos: ${formatError(e)}`);
  } finally {
    clearScheduledRunsBtn.disabled = false;
  }
};

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
    await loadPriceQueuePanel();
  } catch (e) {
    setLoggedIn(false);
    loginMsg.textContent = `Erro ao validar admin: ${formatError(e)}`;
    setPriceQueueMessage(`Erro ao carregar fila: ${formatError(e)}`);
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
