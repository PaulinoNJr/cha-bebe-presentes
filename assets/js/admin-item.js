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
const detectPriceBtn = document.getElementById("detectPriceBtn");
const qty_total = document.getElementById("qty_total");
const display_order = document.getElementById("display_order");
const saveGiftBtn = document.getElementById("saveGiftBtn");
const clearBtn = document.getElementById("clearBtn");
const adminMsg = document.getElementById("adminMsg");

let classifications = [];

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

function currentEditId() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id") || "");
  return Number.isInteger(id) && id > 0 ? id : null;
}

function resetUrlToCreateMode() {
  const cleanUrl = `${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);
}

function clearForm(resetUrl = false) {
  giftId.value = "";
  classification_id.value = "";
  title.value = "";
  description.value = "";
  image_url.value = "";
  buy_url.value = "";
  price_value.value = "";
  qty_total.value = 1;
  display_order.value = 0;
  formTitle.textContent = "Cadastrar item";
  adminMsg.textContent = "";
  if (resetUrl) {
    resetUrlToCreateMode();
  }
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
  const { data, error } = await supabase
    .from("gift_classifications")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) {
    throw error;
  }
  classifications = data ?? [];
  renderClassificationOptions(selected);
}

async function loadGiftForEdit(id) {
  const { data, error } = await supabase.from("gifts").select("*").eq("id", id).single();
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
  qty_total.value = data.qty_total ?? 1;
  display_order.value = Number.isInteger(data.display_order) ? data.display_order : 0;
  formTitle.textContent = `Editar item #${data.id}`;
  adminMsg.textContent = "Modo edicao carregado.";
}

async function ensureAdminPermission() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    throw error;
  }
  return data === true;
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
  clearForm(false);
};

clearBtn.onclick = async () => {
  clearForm(true);
  try {
    await loadClassifications("");
  } catch (e) {
    adminMsg.textContent = `Erro ao recarregar classificacoes: ${formatError(e)}`;
  }
};

detectPriceBtn.onclick = async () => {
  detectPriceBtn.disabled = true;
  adminMsg.textContent = "Buscando valor no link...";
  try {
    const detected = await detectPriceFromUrl(buy_url.value);
    if (detected === null) {
      adminMsg.textContent = "Nao foi possivel identificar o valor neste link.";
    } else {
      price_value.value = String(detected.toFixed(2));
      adminMsg.textContent = `Valor detectado: ${formatBRL(detected)}.`;
    }
  } catch (e) {
    adminMsg.textContent = `Erro ao capturar valor: ${formatError(e)}`;
  } finally {
    detectPriceBtn.disabled = false;
  }
};

buy_url.addEventListener("blur", async () => {
  if (!buy_url.value.trim() || price_value.value.trim()) {
    return;
  }
  try {
    const detected = await detectPriceFromUrl(buy_url.value);
    if (detected !== null) {
      price_value.value = String(detected.toFixed(2));
    }
  } catch {
    // Falha silenciosa para nao interromper o formulario.
  }
});

saveGiftBtn.onclick = async () => {
  saveGiftBtn.disabled = true;
  adminMsg.textContent = "Salvando...";

  const isEditing = !!giftId.value;
  const classIdNum = Number(classification_id.value);
  let priceNum = parsePriceInput(price_value.value);

  try {
    if (buy_url.value.trim()) {
      adminMsg.textContent = "Capturando valor pelo link...";
      const detected = await detectPriceFromUrl(buy_url.value);
      if (detected !== null) {
        priceNum = detected;
        price_value.value = String(priceNum.toFixed(2));
      }
    }
  } catch {
    // Falha de rede/proxy; validacao abaixo decide se pode salvar.
  }

  const classificationId = Number.isInteger(classIdNum) && classIdNum > 0 ? classIdNum : null;
  const titleValue = upper(title.value);
  const descriptionValue = description.value.trim() || null;
  const imageUrlValue = image_url.value.trim();
  const buyUrlValue = buy_url.value.trim();
  const qtyTotalValue = Number(qty_total.value || 1);
  const displayOrderValue = Number(display_order.value || 0);

  if (!classificationId) {
    adminMsg.textContent = "Selecione uma classificacao.";
    saveGiftBtn.disabled = false;
    return;
  }
  if (!titleValue) {
    adminMsg.textContent = "Informe o titulo.";
    saveGiftBtn.disabled = false;
    return;
  }
  if (!imageUrlValue || !isValidHttpUrl(imageUrlValue)) {
    adminMsg.textContent = "URL da imagem invalida. Use http(s)://...";
    saveGiftBtn.disabled = false;
    return;
  }
  if (!buyUrlValue || !isValidHttpUrl(buyUrlValue)) {
    adminMsg.textContent = "Link de compra invalido. Use http(s)://...";
    saveGiftBtn.disabled = false;
    return;
  }
  if (priceNum === null) {
    adminMsg.textContent = "Informe o valor do item.";
    saveGiftBtn.disabled = false;
    return;
  }
  if (!Number.isInteger(qtyTotalValue) || qtyTotalValue < 1) {
    adminMsg.textContent = "Quantidade total invalida.";
    saveGiftBtn.disabled = false;
    return;
  }
  if (!Number.isInteger(displayOrderValue) || displayOrderValue < 0) {
    adminMsg.textContent = "Ordem invalida. Use numero inteiro maior ou igual a 0.";
    saveGiftBtn.disabled = false;
    return;
  }

  const payload = {
    classification_id: classificationId,
    title: titleValue,
    description: descriptionValue,
    image_url: imageUrlValue,
    buy_url: buyUrlValue,
    price_value: priceNum,
    qty_total: qtyTotalValue,
    display_order: displayOrderValue,
  };

  try {
    if (isEditing) {
      const { error } = await supabase
        .from("gifts")
        .update(payload)
        .eq("id", Number(giftId.value));
      if (error) {
        throw error;
      }
      await loadClassifications("");
      clearForm(true);
      adminMsg.textContent = "Item atualizado. Formulario limpo.";
    } else {
      const { error } = await supabase.from("gifts").insert(payload);
      if (error) {
        throw error;
      }
      await loadClassifications("");
      clearForm(false);
      adminMsg.textContent = "Item criado. Formulario limpo para o proximo cadastro.";
    }
  } catch (e) {
    adminMsg.textContent = `Erro ao salvar: ${formatError(e)}`;
  } finally {
    saveGiftBtn.disabled = false;
  }
};

async function loadPageForSession() {
  const editId = currentEditId();
  if (editId) {
    await loadGiftForEdit(editId);
  } else {
    await loadClassifications("");
    clearForm(false);
  }
}

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
    await loadPageForSession();
  } catch (e) {
    setLoggedIn(false);
    adminMsg.textContent = `Erro ao carregar dados: ${formatError(e)}`;
    loginMsg.textContent = `Erro ao validar admin: ${formatError(e)}`;
  }
}

const {
  data: { session },
} = await supabase.auth.getSession();
setLoggedIn(!!session);

supabase.auth.onAuthStateChange((_event, session2) => {
  setTimeout(() => {
    handleSessionChange(session2);
  }, 0);
});

if (session) {
  await handleSessionChange(session);
}
