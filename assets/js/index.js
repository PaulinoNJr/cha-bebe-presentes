import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { esc, upper, formatBRL } from "./shared/formatters.js";
import { sanitizeHtml } from "./shared/sanitize.js";
import { detectPriceFromUrl } from "./shared/price.js";
import { createSupabaseRestClient } from "./shared/rest.js";
import { createSupabaseBrowserClient } from "./shared/supabase-client.js";

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseConfig();
const missingConfig = isMissingSupabaseConfig(SUPABASE_URL, SUPABASE_ANON_KEY);

const grid = document.getElementById("grid");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const adminRefreshPricesBtn = document.getElementById("adminRefreshPricesBtn");
const adminRefreshMsg = document.getElementById("adminRefreshMsg");
const classFilter = document.getElementById("classFilter");
const instructionsBox = document.getElementById("instructionsBox");

if (missingConfig) {
  status.className = "alert alert-danger py-2 small";
  status.innerHTML =
    'Configure <code>supabase-config.js</code> com <code>url</code> e <code>anonKey</code> do Supabase.';
  throw new Error("Supabase nao configurado.");
}

const sbFetch = createSupabaseRestClient({
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
});
const supabase = createSupabaseBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const modalEl = document.getElementById("reserveModal");
const reserveModal = new bootstrap.Modal(modalEl);
const modalTitle = document.getElementById("modalTitle");
const modalDesc = document.getElementById("modalDesc");
const nameInput = document.getElementById("nameInput");
const cpfInput = document.getElementById("cpfInput");
const qtySelect = document.getElementById("qtySelect");
const qtyHelp = document.getElementById("qtyHelp");
const confirmBtn = document.getElementById("confirmBtn");
const modalAlert = document.getElementById("modalAlert");

let classifications = [];
let gifts = [];
let reservations = [];
let currentGift = null;
let canRefreshPrices = false;

function setAdminRefreshVisibility(show) {
  if (adminRefreshPricesBtn) {
    adminRefreshPricesBtn.classList.toggle("d-none", !show);
  }
  if (adminRefreshMsg) {
    adminRefreshMsg.classList.toggle("d-none", !show);
    if (!show) {
      adminRefreshMsg.textContent = "";
    }
  }
}

function setAdminRefreshMessage(msg) {
  if (adminRefreshMsg) {
    adminRefreshMsg.textContent = msg;
  }
}

function formatAdminError(err) {
  const msg = String(err?.message || err || "Erro inesperado");
  if (msg.includes("NOT_ADMIN")) {
    return "Somente admin pode atualizar precos.";
  }
  if (msg.toLowerCase().includes("row-level security")) {
    return "Permissao negada para atualizar precos.";
  }
  if (msg.toLowerCase().includes("price_update_")) {
    return "Banco desatualizado para fila de precos.";
  }
  return msg;
}

function normalizeCpf(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function formatCpf(raw) {
  const digits = normalizeCpf(raw).slice(0, 11);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  }
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isValidCpf(rawCpf) {
  const cpf = normalizeCpf(rawCpf);
  if (!/^\d{11}$/.test(cpf)) {
    return false;
  }
  if (/^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let d1 = (sum * 10) % 11;
  if (d1 === 10) {
    d1 = 0;
  }
  if (d1 !== Number(cpf[9])) {
    return false;
  }

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(cpf[i]) * (11 - i);
  }
  let d2 = (sum * 10) % 11;
  if (d2 === 10) {
    d2 = 0;
  }
  return d2 === Number(cpf[10]);
}

async function checkIndexAdminAccess() {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      canRefreshPrices = false;
      setAdminRefreshVisibility(false);
      return;
    }

    const { data, error } = await supabase.rpc("is_admin");
    if (error || data !== true) {
      canRefreshPrices = false;
      setAdminRefreshVisibility(false);
      return;
    }

    canRefreshPrices = true;
    setAdminRefreshVisibility(true);
  } catch {
    canRefreshPrices = false;
    setAdminRefreshVisibility(false);
  }
}

async function refreshPricesAsAdmin() {
  if (!canRefreshPrices || !adminRefreshPricesBtn) {
    return;
  }

  adminRefreshPricesBtn.disabled = true;
  const originalText = adminRefreshPricesBtn.textContent;
  adminRefreshPricesBtn.textContent = "Atualizando...";
  setAdminRefreshMessage("Enfileirando e processando precos...");

  let okCount = 0;
  let failCount = 0;
  let totalJobs = 0;

  try {
    const { error: enqueueError } = await supabase.rpc("enqueue_price_refresh_all");
    if (enqueueError) {
      throw enqueueError;
    }

    const maxBatches = 8;
    const batchLimit = 20;

    for (let i = 0; i < maxBatches; i += 1) {
      const { data: jobs, error: claimError } = await supabase.rpc("claim_price_update_jobs", {
        p_limit: batchLimit,
      });
      if (claimError) {
        throw claimError;
      }

      const queueItems = Array.isArray(jobs) ? jobs : [];
      if (!queueItems.length) {
        break;
      }
      totalJobs += queueItems.length;

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
        } catch (jobError) {
          failCount += 1;
          await supabase.rpc("finish_price_update_job", {
            p_job_id: jobId,
            p_price_value: null,
            p_error_message: String(jobError?.message || jobError || "ERRO_DESCONHECIDO").slice(0, 500),
          });
        }
      }
    }

    await loadAll();
    setAdminRefreshMessage(
      `Atualizacao concluida. Sucesso: ${okCount} | Falhas: ${failCount} | Itens: ${totalJobs}.`
    );
  } catch (e) {
    setAdminRefreshMessage(`Erro ao atualizar precos: ${formatAdminError(e)}`);
  } finally {
    adminRefreshPricesBtn.disabled = false;
    adminRefreshPricesBtn.textContent = originalText || "Atualizar precos";
  }
}

function setModalAlert(kind, msg) {
  modalAlert.classList.remove(
    "d-none",
    "alert-danger",
    "alert-success",
    "alert-warning",
    "alert-info"
  );
  modalAlert.classList.add(`alert-${kind}`);
  modalAlert.textContent = msg;
}

function clearModalAlert() {
  modalAlert.className = "alert d-none mb-0";
  modalAlert.textContent = "";
}

function reservationsForGift(giftId) {
  return reservations
    .filter((r) => r.gift_id === giftId)
    .sort((a, b) => new Date(b.reserved_at) - new Date(a.reserved_at));
}

function renderFilterOptions() {
  const selected = classFilter.value;
  classFilter.innerHTML =
    '<option value="">Todas as classificacoes</option>' +
    classifications.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  if (selected && classifications.some((c) => String(c.id) === selected)) {
    classFilter.value = selected;
  } else {
    classFilter.value = "";
  }
}

function renderInstructions(siteContent) {
  const html = siteContent?.instructions_html?.trim() || "";
  if (!html) {
    instructionsBox.classList.add("d-none");
    instructionsBox.innerHTML = "";
    return;
  }
  instructionsBox.innerHTML = sanitizeHtml(html);
  instructionsBox.classList.remove("d-none");
}

function getFilteredGifts() {
  const selected = classFilter.value;
  const base = !selected
    ? gifts
    : gifts.filter((g) => String(g.classification_id ?? "") === selected);

  // Disponiveis primeiro; esgotados vao para o final da lista.
  return [...base].sort((a, b) => {
    const aFull = a.qty_available <= 0 ? 1 : 0;
    const bFull = b.qty_available <= 0 ? 1 : 0;
    if (aFull !== bFull) {
      return aFull - bFull;
    }
    const aClassOrder = Number.isFinite(Number(a.classification_display_order))
      ? Number(a.classification_display_order)
      : 0;
    const bClassOrder = Number.isFinite(Number(b.classification_display_order))
      ? Number(b.classification_display_order)
      : 0;
    if (aClassOrder !== bClassOrder) {
      return aClassOrder - bClassOrder;
    }

    const aClass = String(a.classification_name ?? "");
    const bClass = String(b.classification_name ?? "");
    if (aClass !== bClass) {
      return aClass.localeCompare(bClass, "pt-BR");
    }
    return Number(a.id) - Number(b.id);
  });
}

function giftCard(g) {
  const isFull = g.qty_available <= 0;
  const hasPrice = !(g.price_value === null || g.price_value === undefined || g.price_value === "");
  const priceLabel = hasPrice ? `Por ${formatBRL(g.price_value)}` : formatBRL(g.price_value);

  const img = g.image_url
    ? `<img src="${esc(g.image_url)}" class="card-img-top gift-img" alt="${esc(g.title)}">`
    : '<div class="bg-secondary-subtle d-flex align-items-center justify-content-center gift-img"><span class="text-muted small">Sem imagem</span></div>';

  const reserveBtn = isFull
    ? '<button class="btn btn-sm btn-secondary" disabled>Esgotado</button>'
    : `<button class="btn btn-sm btn-primary" data-id="${g.id}">Reservar</button>`;

  const badge = isFull
    ? '<span class="badge text-bg-danger">Esgotado</span>'
    : `<span class="badge text-bg-success">Disponivel: ${g.qty_available} / ${g.qty_total}</span>`;

  const res = reservationsForGift(g.id);
  const resHtml = res.length
    ? res
        .map(
          (x) => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <span>${esc(x.reserved_by)}</span>
              <span class="d-flex align-items-center gap-2">
                <span class="badge text-bg-light">x${x.qty}</span>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger py-0 px-2"
                  data-cancel-reservation-id="${x.id}"
                  title="Cancelar reserva"
                  aria-label="Cancelar reserva"
                ><span aria-hidden="true">&#128465;</span></button>
              </span>
            </li>`
        )
        .join("")
    : '<li class="list-group-item text-muted small">Nenhuma reserva ainda.</li>';

  return `
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card shadow-sm h-100">
        ${img}
        <div class="card-body d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <h5 class="card-title mb-0">${esc(upper(g.title))}</h5>
            ${badge}
          </div>
          <div class="small text-muted mt-1">${esc(g.classification_name || "Sem classificacao")}</div>
          <div class="small fw-semibold mt-1">${esc(priceLabel)}</div>
          <p class="card-text text-muted small mt-2">${esc(g.description || "")}</p>

          <div class="d-flex flex-wrap gap-2 mt-auto pt-2">
            ${reserveBtn}
          </div>

          <div class="mt-3">
            <div class="fw-semibold small mb-2">Reservado por</div>
            <ul class="list-group res-list">${resHtml}</ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGrid() {
  const filtered = getFilteredGifts();
  const full = filtered.filter((g) => g.qty_available <= 0).length;
  const selectedText =
    classFilter.options[classFilter.selectedIndex]?.text || "Todas as classificacoes";

  status.className = "alert alert-light border py-2 small";
  status.textContent = `Filtro: ${selectedText} | Exibindo: ${filtered.length} de ${gifts.length} | Disponiveis: ${filtered.length - full} | Esgotados: ${full}`;

  if (!filtered.length) {
    grid.innerHTML =
      '<div class="col-12"><div class="alert alert-warning py-2 small mb-0">Nenhum item nesta classificacao.</div></div>';
    return;
  }

  grid.innerHTML = filtered.map(giftCard).join("");

  grid.querySelectorAll("button.btn-primary[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id"));
      const gift = gifts.find((x) => x.id === id);
      openReserveModal(gift);
    });
  });

  grid.querySelectorAll("button[data-cancel-reservation-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reservationId = Number(btn.getAttribute("data-cancel-reservation-id"));
      if (!Number.isFinite(reservationId)) {
        return;
      }

      const providedCpf = prompt("Informe o CPF usado na reserva para cancelar:");
      if (providedCpf === null) {
        return;
      }

      if (!isValidCpf(providedCpf)) {
        alert("cpf invalido para essa reserva");
        return;
      }

      btn.disabled = true;
      try {
        await cancelReservationByCpf(reservationId, providedCpf);
        await loadAll();
        alert("Reserva cancelada com sucesso.");
      } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("INVALID_CPF_RESERVATION") || msg.includes("INVALID_CPF")) {
          alert("cpf invalido para essa reserva");
        } else if (msg.includes("RESERVATION_NOT_FOUND")) {
          alert("Reserva nao encontrada.");
          await loadAll();
        } else {
          alert(`Erro ao cancelar reserva: ${msg}`);
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadAll() {
  status.className = "alert alert-secondary py-2 small";
  status.textContent = "Carregando...";

  const siteContent = await sbFetch("/rest/v1/site_content?select=instructions_html&id=eq.1&limit=1");

  try {
    const orderedClassifications = await sbFetch(
      "/rest/v1/gift_classifications?select=id,name,display_order&order=display_order.asc,name.asc"
    );
    classifications = (orderedClassifications ?? []).map((c) => ({
      ...c,
      display_order: c.display_order ?? 0,
    }));
  } catch (e) {
    const emsg = String(e?.message || "").toLowerCase();
    if (!emsg.includes("display_order")) {
      throw e;
    }
    classifications = await sbFetch("/rest/v1/gift_classifications?select=id,name&order=name.asc");
  }

  let giftsData = [];
  try {
    giftsData = await sbFetch(
      "/rest/v1/gifts_view?select=id,title,description,image_url,buy_url,price_value,is_active,classification_display_order,classification_id,classification_name,qty_total,qty_reserved,qty_available&is_active=eq.true&order=classification_display_order.asc,classification_name.asc,id.asc"
    );
  } catch (e) {
    const emsg = String(e?.message || "").toLowerCase();
    const maybeMissingColumn =
      emsg.includes("is_active") || emsg.includes("classification_display_order");
    if (!maybeMissingColumn) {
      throw e;
    }
    giftsData = await sbFetch(
      "/rest/v1/gifts_view?select=id,title,description,image_url,buy_url,price_value,classification_id,classification_name,qty_total,qty_reserved,qty_available&order=classification_name.asc,id.asc"
    );
  }
  gifts = (giftsData ?? [])
    .map((g) => ({
      ...g,
      classification_display_order: g.classification_display_order ?? 0,
    }))
    .filter((g) => g.is_active !== false);
  reservations = await sbFetch(
    "/rest/v1/gift_reservations?select=id,gift_id,reserved_by,qty,reserved_at&order=reserved_at.desc"
  );

  renderInstructions(siteContent?.[0] || null);
  renderFilterOptions();
  renderGrid();
}

function openReserveModal(gift) {
  currentGift = gift;
  clearModalAlert();
  modalTitle.textContent = `Reservar: ${upper(gift.title)}`;
  modalDesc.textContent = gift.description || "";
  nameInput.value = "";
  cpfInput.value = "";

  qtySelect.innerHTML = "";
  const max = Math.max(0, gift.qty_available);
  for (let i = 1; i <= max; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    qtySelect.appendChild(opt);
  }
  qtyHelp.textContent = `Disponivel agora: ${gift.qty_available} de ${gift.qty_total}.`;

  confirmBtn.disabled = max <= 0;
  reserveModal.show();
  setTimeout(() => nameInput.focus(), 150);
}

async function reserveGift(giftId, name, qty, cpf) {
  return sbFetch("/rest/v1/rpc/reserve_gift", {
    method: "POST",
    body: { p_gift_id: giftId, p_name: name, p_qty: qty, p_cpf: normalizeCpf(cpf) },
  });
}

async function cancelReservationByCpf(reservationId, cpf) {
  return sbFetch("/rest/v1/rpc/cancel_reservation", {
    method: "POST",
    body: {
      p_reservation_id: reservationId,
      p_cpf: normalizeCpf(cpf),
    },
  });
}

confirmBtn.addEventListener("click", async () => {
  clearModalAlert();
  if (!currentGift) {
    return;
  }

  const name = nameInput.value.trim();
  const cpf = cpfInput.value.trim();
  const qty = Number(qtySelect.value);

  if (name.length < 3 || !name.includes(" ")) {
    setModalAlert("warning", "Informe nome e sobrenome (ex: Ana Souza).");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    setModalAlert("warning", "Escolha uma quantidade valida.");
    return;
  }
  if (!isValidCpf(cpf)) {
    setModalAlert("warning", "Informe um CPF valido.");
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = "Reservando...";

  try {
    await reserveGift(currentGift.id, name, qty, cpf);
    const redirectUrl = String(currentGift?.buy_url || "").trim();
    setModalAlert("success", `Reserva confirmada: ${upper(currentGift.title)} (x${qty}) - ${name}`);
    await loadAll();
    if (redirectUrl) {
      setModalAlert("success", "Reserva confirmada. Redirecionando para a compra...");
      setTimeout(() => {
        window.location.href = redirectUrl;
      }, 650);
    } else {
      setTimeout(() => reserveModal.hide(), 650);
    }
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("NOT_ENOUGH_QTY")) {
      setModalAlert("danger", "Quantidade insuficiente (alguem reservou antes). Atualize e tente novamente.");
    } else if (msg.includes("GIFT_INACTIVE")) {
      setModalAlert("danger", "Este item foi desativado pela administracao.");
    } else if (msg.includes("INVALID_NAME")) {
      setModalAlert("danger", "Nome invalido.");
    } else if (msg.includes("INVALID_QTY")) {
      setModalAlert("danger", "Quantidade invalida.");
    } else if (msg.includes("INVALID_CPF")) {
      setModalAlert("danger", "CPF invalido.");
    } else {
      setModalAlert("danger", `Erro: ${msg}`);
    }
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirmar reserva";
  }
});

refreshBtn.addEventListener("click", loadAll);
classFilter.addEventListener("change", renderGrid);
if (cpfInput) {
  cpfInput.addEventListener("input", () => {
    cpfInput.value = formatCpf(cpfInput.value);
  });
}
if (adminRefreshPricesBtn) {
  adminRefreshPricesBtn.addEventListener("click", refreshPricesAsAdmin);
}
supabase.auth.onAuthStateChange(() => {
  setTimeout(() => {
    checkIndexAdminAccess();
  }, 0);
});
checkIndexAdminAccess();
setInterval(loadAll, 15000);
loadAll();
