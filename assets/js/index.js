import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { esc, upper, formatBRL } from "./shared/formatters.js";
import { sanitizeHtml } from "./shared/sanitize.js";
import { createSupabaseRestClient } from "./shared/rest.js";

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseConfig();
const missingConfig = isMissingSupabaseConfig(SUPABASE_URL, SUPABASE_ANON_KEY);

const grid = document.getElementById("grid");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
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

const modalEl = document.getElementById("reserveModal");
const reserveModal = new bootstrap.Modal(modalEl);
const modalTitle = document.getElementById("modalTitle");
const modalDesc = document.getElementById("modalDesc");
const nameInput = document.getElementById("nameInput");
const qtySelect = document.getElementById("qtySelect");
const qtyHelp = document.getElementById("qtyHelp");
const confirmBtn = document.getElementById("confirmBtn");
const modalAlert = document.getElementById("modalAlert");

let classifications = [];
let gifts = [];
let reservations = [];
let currentGift = null;

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
    return a.id - b.id;
  });
}

function giftCard(g) {
  const isFull = g.qty_available <= 0;
  const hasPrice = !(g.price_value === null || g.price_value === undefined || g.price_value === "");
  const priceLabel = hasPrice ? `Por ${formatBRL(g.price_value)}` : formatBRL(g.price_value);

  const img = g.image_url
    ? `<img src="${esc(g.image_url)}" class="card-img-top gift-img" alt="${esc(g.title)}">`
    : '<div class="bg-secondary-subtle d-flex align-items-center justify-content-center gift-img"><span class="text-muted small">Sem imagem</span></div>';

  const buyBtn = g.buy_url
    ? `<a class="btn btn-sm btn-outline-secondary" href="${esc(g.buy_url)}" target="_blank" rel="noopener">Comprar</a>`
    : '<span class="text-muted small">Sem link</span>';

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
              <span class="badge text-bg-light">x${x.qty}</span>
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
            ${buyBtn}
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
}

async function loadAll() {
  status.className = "alert alert-secondary py-2 small";
  status.textContent = "Carregando...";

  const siteContent = await sbFetch("/rest/v1/site_content?select=instructions_html&id=eq.1&limit=1");
  classifications = await sbFetch("/rest/v1/gift_classifications?select=id,name&order=name.asc");
  let giftsData = [];
  try {
    giftsData = await sbFetch(
      "/rest/v1/gifts_view?select=id,title,description,image_url,buy_url,price_value,is_active,classification_id,classification_name,qty_total,qty_reserved,qty_available&is_active=eq.true&order=id.asc"
    );
  } catch (e) {
    const maybeMissingColumn = String(e?.message || "").toLowerCase().includes("is_active");
    if (!maybeMissingColumn) {
      throw e;
    }
    giftsData = await sbFetch(
      "/rest/v1/gifts_view?select=id,title,description,image_url,buy_url,price_value,classification_id,classification_name,qty_total,qty_reserved,qty_available&order=id.asc"
    );
  }
  gifts = (giftsData ?? []).filter((g) => g.is_active !== false);
  reservations = await sbFetch(
    "/rest/v1/gift_reservations?select=gift_id,reserved_by,qty,reserved_at&order=reserved_at.desc"
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

async function reserveGift(giftId, name, qty) {
  return sbFetch("/rest/v1/rpc/reserve_gift", {
    method: "POST",
    body: { p_gift_id: giftId, p_name: name, p_qty: qty },
  });
}

confirmBtn.addEventListener("click", async () => {
  clearModalAlert();
  if (!currentGift) {
    return;
  }

  const name = nameInput.value.trim();
  const qty = Number(qtySelect.value);

  if (name.length < 3 || !name.includes(" ")) {
    setModalAlert("warning", "Informe nome e sobrenome (ex: Ana Souza).");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    setModalAlert("warning", "Escolha uma quantidade valida.");
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = "Reservando...";

  try {
    await reserveGift(currentGift.id, name, qty);
    setModalAlert("success", `Reserva confirmada: ${upper(currentGift.title)} (x${qty}) - ${name}`);
    await loadAll();
    setTimeout(() => reserveModal.hide(), 650);
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
setInterval(loadAll, 15000);
loadAll();
