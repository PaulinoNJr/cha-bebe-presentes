import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { upper, formatBRL, esc } from "./shared/formatters.js";
import { parsePriceInput, detectPriceFromUrl } from "./shared/price.js";
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

const formTitle = document.getElementById("formTitle");
const giftId = document.getElementById("giftId");
const classification_id = document.getElementById("classification_id");
const title = document.getElementById("title");
const description = document.getElementById("description");
const image_url = document.getElementById("image_url");
const buy_url = document.getElementById("buy_url");
const price_value = document.getElementById("price_value");
const price_mode = document.getElementById("price_mode");
const priceModeHint = document.getElementById("priceModeHint");
const qty_total = document.getElementById("qty_total");
const openBuyUrlBtn = document.getElementById("openBuyUrlBtn");
const titleCounter = document.getElementById("titleCounter");
const descCounter = document.getElementById("descCounter");
const previewImage = document.getElementById("previewImage");
const previewImageFallback = document.getElementById("previewImageFallback");
const previewClassification = document.getElementById("previewClassification");
const previewTitle = document.getElementById("previewTitle");
const previewPrice = document.getElementById("previewPrice");
const previewQty = document.getElementById("previewQty");
const previewStatus = document.getElementById("previewStatus");
const previewLink = document.getElementById("previewLink");
const saveGiftBtn = document.getElementById("saveGiftBtn");
const clearBtn = document.getElementById("clearBtn");
const adminMsg = document.getElementById("adminMsg");

const DRAFT_KEY_NEW = "admin_item_draft_new";
const OPTIONAL_GIFT_COLS = [
  "price_manual_override",
  "price_status",
  "price_last_error",
  "price_checked_at",
];

let classifications = [];
let pageInitialized = false;

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
  if (msg.toLowerCase().includes("display_order") || msg.toLowerCase().includes("is_active")) {
    return "Banco desatualizado. Execute o supabase-setup.sql mais recente.";
  }
  return msg;
}

function setLoggedIn(logged) {
  loginCard.classList.toggle("d-none", logged);
  adminArea.classList.toggle("d-none", !logged);
  logoutBtn.classList.toggle("d-none", !logged);
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function clearFieldInvalid(field) {
  if (!field) {
    return;
  }
  field.classList.remove("is-invalid");
}

function setFieldInvalid(field, message) {
  if (!field) {
    return;
  }
  field.classList.add("is-invalid");
  adminMsg.textContent = message;
}

function clearAllFieldErrors() {
  [classification_id, title, image_url, buy_url, price_value, qty_total].forEach(clearFieldInvalid);
}

function toPriceDisplay(num) {
  if (!Number.isFinite(num) || num <= 0) {
    return "";
  }
  return num.toFixed(2).replace(".", ",");
}

function updateCounters() {
  if (titleCounter) {
    titleCounter.textContent = String((title.value || "").trim().length);
  }
  if (descCounter) {
    descCounter.textContent = String((description.value || "").trim().length);
  }
}

function refreshOpenBuyButton() {
  const url = String(buy_url.value || "").trim();
  const valid = isValidHttpUrl(url);
  if (!openBuyUrlBtn) {
    return;
  }
  if (valid) {
    openBuyUrlBtn.href = url;
    openBuyUrlBtn.classList.remove("disabled");
    openBuyUrlBtn.setAttribute("aria-disabled", "false");
  } else {
    openBuyUrlBtn.href = "#";
    openBuyUrlBtn.classList.add("disabled");
    openBuyUrlBtn.setAttribute("aria-disabled", "true");
  }
}

function updateModeUI() {
  const isManual = String(price_mode.value || "").toLowerCase() === "manual";
  if (priceModeHint) {
    priceModeHint.textContent = isManual
      ? "No modo manual, o valor e obrigatorio e a fila automatica fica desativada."
      : "No modo automatico, o sistema tenta capturar o preco pelo link ao salvar.";
  }
  price_value.placeholder = isManual ? "Ex: 149,90 (obrigatorio)" : "Opcional (captura automatica)";
}

function refreshImagePreview() {
  const src = String(image_url.value || "").trim();
  const valid = isValidHttpUrl(src);
  if (!previewImage || !previewImageFallback) {
    return;
  }
  if (!valid) {
    previewImage.removeAttribute("src");
    previewImage.classList.remove("show");
    previewImageFallback.classList.remove("d-none");
    return;
  }
  previewImage.src = src;
  previewImage.classList.add("show");
  previewImageFallback.classList.add("d-none");
}

function updatePreview() {
  const classText = classification_id.options[classification_id.selectedIndex]?.text || "Sem classificacao";
  const titleText = upper((title.value || "").trim()) || "TITULO DO PRODUTO";
  const priceNum = parsePriceInput(price_value.value);
  const qty = Number(qty_total.value || 1);
  const mode = String(price_mode.value || "auto").toLowerCase() === "manual" ? "Manual" : "Automatico";
  const link = String(buy_url.value || "").trim();
  const hasValidLink = isValidHttpUrl(link);

  if (previewClassification) {
    previewClassification.textContent = classText === "Selecione a classificacao" ? "Sem classificacao" : classText;
  }
  if (previewTitle) {
    previewTitle.textContent = titleText;
  }
  if (previewPrice) {
    previewPrice.textContent =
      Number.isFinite(priceNum) && priceNum > 0 ? `Preco: ${formatBRL(priceNum)}` : "Preco: -";
  }
  if (previewQty) {
    previewQty.textContent = `Quantidade: ${Number.isInteger(qty) && qty > 0 ? qty : 1}`;
  }
  if (previewStatus) {
    previewStatus.textContent = `Modo preco: ${mode}`;
  }
  if (previewLink) {
    previewLink.textContent = hasValidLink ? `Link: ${link}` : "Link: -";
    previewLink.title = hasValidLink ? link : "";
  }

  refreshImagePreview();
  refreshOpenBuyButton();
  updateCounters();
}

function currentEditId() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id") || "");
  return Number.isInteger(id) && id > 0 ? id : null;
}

function draftKeyFor(editId = currentEditId()) {
  return editId ? `admin_item_draft_edit_${editId}` : DRAFT_KEY_NEW;
}

function readDraftByKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    return typeof data === "object" && data ? data : null;
  } catch {
    return null;
  }
}

function writeDraftByKey(key, draft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Ignora falhas de storage para nao quebrar o formulario.
  }
}

function removeDraftByKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignora falhas de storage.
  }
}

function resetUrlToCreateMode() {
  const cleanUrl = `${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);
}

function clearFieldsOnly() {
  giftId.value = "";
  classification_id.value = "";
  title.value = "";
  description.value = "";
  image_url.value = "";
  buy_url.value = "";
  price_value.value = "";
  price_mode.value = "auto";
  qty_total.value = 1;
  formTitle.textContent = "Cadastrar item";
  adminMsg.textContent = "";
  clearAllFieldErrors();
  updateModeUI();
  updatePreview();
}

function snapshotFormDraft() {
  return {
    classification_id: classification_id.value || "",
    title: title.value || "",
    description: description.value || "",
    image_url: image_url.value || "",
    buy_url: buy_url.value || "",
    price_value: price_value.value || "",
    price_mode: price_mode.value || "auto",
    qty_total: qty_total.value || "1",
  };
}

function saveCurrentDraft() {
  writeDraftByKey(draftKeyFor(), snapshotFormDraft());
}

function applyDraftToForm(draft) {
  if (!draft) {
    return false;
  }

  title.value = String(draft.title ?? "");
  description.value = String(draft.description ?? "");
  image_url.value = String(draft.image_url ?? "");
  buy_url.value = String(draft.buy_url ?? "");
  price_value.value = String(draft.price_value ?? "");
  const mode = String(draft.price_mode ?? "auto").toLowerCase();
  price_mode.value = mode === "manual" ? "manual" : "auto";

  const qty = Number(draft.qty_total);
  qty_total.value = Number.isInteger(qty) && qty > 0 ? String(qty) : "1";

  const draftClassificationId = String(draft.classification_id ?? "");
  if (draftClassificationId) {
    classification_id.value = draftClassificationId;
  }

  return true;
}

function clearDraftForCurrentContext() {
  removeDraftByKey(draftKeyFor());
}

function clearAllItemDraftsForCurrentGift() {
  const editId = currentEditId();
  if (editId) {
    removeDraftByKey(draftKeyFor(editId));
  }
  removeDraftByKey(DRAFT_KEY_NEW);
}

function renderClassificationOptions(selected = "") {
  classification_id.innerHTML =
    '<option value="">Selecione a classificacao</option>' +
    classifications.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  if (selected !== "" && selected !== null && selected !== undefined) {
    classification_id.value = String(selected);
  }
}

async function loadClassifications(selected = "") {
  const withOrder = await supabase
    .from("gift_classifications")
    .select("id,name,display_order")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (withOrder.error) {
    const maybeMissingColumn = String(withOrder.error?.message || "")
      .toLowerCase()
      .includes("display_order");
    if (!maybeMissingColumn) {
      throw withOrder.error;
    }

    const fallback = await supabase
      .from("gift_classifications")
      .select("id,name")
      .order("name", { ascending: true });
    if (fallback.error) {
      throw fallback.error;
    }
    classifications = fallback.data ?? [];
    renderClassificationOptions(selected);
    return;
  }

  classifications = withOrder.data ?? [];
  renderClassificationOptions(selected);
}

async function loadGiftForEdit(id) {
  let data = null;
  let error = null;
  const withMode = await supabase
    .from("gifts")
    .select("id,classification_id,title,description,image_url,buy_url,price_value,price_manual_override,qty_total")
    .eq("id", id)
    .single();

  if (withMode.error) {
    const missingModeCol = String(withMode.error?.message || "")
      .toLowerCase()
      .includes("price_manual_override");
    if (!missingModeCol) {
      throw withMode.error;
    }

    const fallback = await supabase
      .from("gifts")
      .select("id,classification_id,title,description,image_url,buy_url,price_value,qty_total")
      .eq("id", id)
      .single();
    data = fallback.data ? { ...fallback.data, price_manual_override: false } : null;
    error = fallback.error;
  } else {
    data = withMode.data;
    error = null;
  }

  if (error) {
    throw error;
  }

  giftId.value = String(data.id);
  await loadClassifications(data.classification_id ?? "");

  title.value = upper(data.title);
  description.value = data.description ?? "";
  image_url.value = data.image_url ?? "";
  buy_url.value = data.buy_url ?? "";
  price_value.value =
    data.price_value === null || data.price_value === undefined ? "" : String(data.price_value);
  price_mode.value = data.price_manual_override === true ? "manual" : "auto";
  qty_total.value = data.qty_total ?? 1;
  formTitle.textContent = `Editar item #${data.id}`;
  adminMsg.textContent = "Modo edicao carregado.";
  updateModeUI();
  updatePreview();

  const restored = applyDraftToForm(readDraftByKey(draftKeyFor(id)));
  if (restored) {
    adminMsg.textContent = "Rascunho restaurado para este item.";
    updateModeUI();
    updatePreview();
  }
}

async function ensureAdminPermission() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    throw error;
  }
  return data === true;
}

function watchDraftPersistence() {
  const fields = [classification_id, title, description, image_url, buy_url, price_value, price_mode, qty_total];
  fields.forEach((field) => {
    field.addEventListener("input", saveCurrentDraft);
    field.addEventListener("change", saveCurrentDraft);
    field.addEventListener("input", () => clearFieldInvalid(field));
    field.addEventListener("change", () => clearFieldInvalid(field));
    field.addEventListener("input", updatePreview);
    field.addEventListener("change", updatePreview);
  });
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

clearBtn.onclick = async () => {
  clearAllItemDraftsForCurrentGift();
  clearFieldsOnly();
  resetUrlToCreateMode();
  try {
    await loadClassifications("");
  } catch (e) {
    adminMsg.textContent = `Erro ao recarregar classificacoes: ${formatError(e)}`;
  }
};

if (openBuyUrlBtn) {
  openBuyUrlBtn.addEventListener("click", (event) => {
    if (openBuyUrlBtn.classList.contains("disabled")) {
      event.preventDefault();
    }
  });
}

if (previewImage) {
  previewImage.addEventListener("error", () => {
    previewImage.classList.remove("show");
    previewImage.removeAttribute("src");
    previewImageFallback?.classList.remove("d-none");
  });
}

title.addEventListener("input", () => {
  title.value = upper(title.value);
});

price_mode.addEventListener("change", () => {
  clearFieldInvalid(price_value);
  updateModeUI();
  updatePreview();
});

price_value.addEventListener("blur", () => {
  const parsed = parsePriceInput(price_value.value);
  if (parsed !== null && parsed > 0) {
    price_value.value = toPriceDisplay(parsed);
  }
  updatePreview();
});

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

async function saveGiftWithFallback(isEditing, editingId, payload) {
  let nextPayload = { ...payload };
  let lastError = null;

  for (let i = 0; i < 5; i += 1) {
    const req = isEditing
      ? supabase.from("gifts").update(nextPayload).eq("id", editingId)
      : supabase.from("gifts").insert(nextPayload);
    const { error } = await req;
    if (!error) {
      return;
    }

    lastError = error;
    const msg = String(error?.message || "").toLowerCase();
    let removedAny = false;
    OPTIONAL_GIFT_COLS.forEach((col) => {
      if (Object.prototype.hasOwnProperty.call(nextPayload, col) && msg.includes(col)) {
        delete nextPayload[col];
        removedAny = true;
      }
    });

    if (!removedAny || !Object.keys(nextPayload).length) {
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

saveGiftBtn.onclick = async () => {
  clearAllFieldErrors();
  saveGiftBtn.disabled = true;
  const originalSaveText = saveGiftBtn.textContent;
  saveGiftBtn.textContent = "Salvando...";
  adminMsg.textContent = "Salvando...";

  const isEditing = !!giftId.value;
  const editingId = isEditing ? Number(giftId.value) : null;
  const classIdNum = Number(classification_id.value);
  const mode = String(price_mode.value || "auto").toLowerCase() === "manual" ? "manual" : "auto";
  let priceNum = parsePriceInput(price_value.value);
  let detectedPrice = null;

  const classificationId = Number.isInteger(classIdNum) && classIdNum > 0 ? classIdNum : null;
  const titleValue = upper(title.value);
  const descriptionValue = description.value.trim() || null;
  const imageUrlValue = image_url.value.trim();
  const buyUrlValue = buy_url.value.trim();
  const qtyTotalValue = Number(qty_total.value || 1);
  const nowIso = new Date().toISOString();

  if (!classificationId) {
    setFieldInvalid(classification_id, "Selecione uma classificacao.");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }
  if (!titleValue || titleValue.length < 2) {
    setFieldInvalid(title, "Informe o titulo com pelo menos 2 caracteres.");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }
  if (!imageUrlValue || !isValidHttpUrl(imageUrlValue)) {
    setFieldInvalid(image_url, "URL da imagem invalida. Use http(s)://...");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }
  if (!buyUrlValue || !isValidHttpUrl(buyUrlValue)) {
    setFieldInvalid(buy_url, "Link de compra invalido. Use http(s)://...");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }
  if (!Number.isInteger(qtyTotalValue) || qtyTotalValue < 1) {
    setFieldInvalid(qty_total, "Quantidade total invalida.");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }

  if (mode === "auto") {
    try {
      adminMsg.textContent = "Capturando valor automaticamente pelo link...";
      detectedPrice = await detectPriceFromUrl(buyUrlValue);
      if (detectedPrice !== null) {
        priceNum = detectedPrice;
        price_value.value = String(priceNum.toFixed(2));
      }
    } catch {
      // Se falhar a captura automatica, salva como pendente.
    }
  } else if (priceNum === null || priceNum <= 0) {
    setFieldInvalid(price_value, "No modo manual, informe um valor maior que zero.");
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    return;
  }

  const payload = {
    classification_id: classificationId,
    title: titleValue,
    description: descriptionValue,
    image_url: imageUrlValue,
    buy_url: buyUrlValue,
    qty_total: qtyTotalValue,
    price_manual_override: mode === "manual",
    price_status: mode === "manual" ? "manual" : priceNum !== null && priceNum > 0 ? "ok" : "pending",
    price_last_error: null,
    price_checked_at: mode === "manual" ? nowIso : priceNum !== null && priceNum > 0 ? nowIso : null,
    price_value: priceNum === null ? null : priceNum,
  };

  try {
    if (isEditing && editingId) {
      await saveGiftWithFallback(true, editingId, payload);
      if (mode === "manual") {
        await clearPendingPriceQueueByGift(editingId);
      }

      removeDraftByKey(draftKeyFor(editingId));
      removeDraftByKey(DRAFT_KEY_NEW);
      clearFieldsOnly();
      resetUrlToCreateMode();
      await loadClassifications("");
      adminMsg.textContent =
        mode === "manual"
          ? `Item atualizado com preco manual (${formatBRL(priceNum)}).`
          : detectedPrice !== null
          ? `Item atualizado com captura automatica (${formatBRL(detectedPrice)}).`
          : "Item atualizado em modo automatico (preco pendente de captura).";
    } else {
      await saveGiftWithFallback(false, null, payload);

      clearDraftForCurrentContext();
      clearFieldsOnly();
      await loadClassifications("");
      adminMsg.textContent =
        mode === "manual"
          ? `Item criado com preco manual (${formatBRL(priceNum)}).`
          : detectedPrice !== null
          ? `Item criado com captura automatica (${formatBRL(detectedPrice)}).`
          : "Item criado em modo automatico (preco pendente de captura).";
    }
  } catch (e) {
    adminMsg.textContent = `Erro ao salvar: ${formatError(e)}`;
  } finally {
    saveGiftBtn.disabled = false;
    saveGiftBtn.textContent = originalSaveText || "Salvar item";
    updatePreview();
  }
};

async function loadPageForSession() {
  const editId = currentEditId();
  if (editId) {
    await loadGiftForEdit(editId);
    return;
  }

  await loadClassifications("");
  clearFieldsOnly();
  const restored = applyDraftToForm(readDraftByKey(DRAFT_KEY_NEW));
  if (restored) {
    adminMsg.textContent = "Rascunho restaurado.";
    updateModeUI();
    updatePreview();
  }
}

async function handleSessionChange(session2, { reloadForm = false } = {}) {
  if (!session2) {
    setLoggedIn(false);
    pageInitialized = false;
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
    if (!pageInitialized || reloadForm) {
      await loadPageForSession();
      pageInitialized = true;
    }
  } catch (e) {
    setLoggedIn(false);
    adminMsg.textContent = `Erro ao carregar dados: ${formatError(e)}`;
    loginMsg.textContent = `Erro ao validar admin: ${formatError(e)}`;
  }
}

watchDraftPersistence();

const {
  data: { session },
} = await supabase.auth.getSession();
setLoggedIn(!!session);

supabase.auth.onAuthStateChange((event, session2) => {
  setTimeout(() => {
    if (event === "SIGNED_OUT") {
      handleSessionChange(null);
      return;
    }
    // Evita limpar formulario em eventos como TOKEN_REFRESHED.
    const mustReloadForm = event === "SIGNED_IN";
    handleSessionChange(session2, { reloadForm: mustReloadForm });
  }, 0);
});

if (session) {
  await handleSessionChange(session, { reloadForm: true });
}
