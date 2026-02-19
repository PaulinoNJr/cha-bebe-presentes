import { getSupabaseConfig, isMissingSupabaseConfig } from "./shared/config.js";
import { esc, upper, formatBRL } from "./shared/formatters.js";
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
const resTbody = document.getElementById("resTbody");
const refreshBtn = document.getElementById("refreshBtn");
const resMsg = document.getElementById("resMsg");
const instructionsEditor = document.getElementById("instructionsEditor");
const saveInstructionsBtn = document.getElementById("saveInstructionsBtn");
const instructionsMsg = document.getElementById("instructionsMsg");
const addLinkBtn = document.getElementById("addLinkBtn");
const foreColorPicker = document.getElementById("foreColorPicker");
const hiliteColorPicker = document.getElementById("hiliteColorPicker");

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
  if (msg.toLowerCase().includes("is_active") || msg.toLowerCase().includes("display_order")) {
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

function renderClassificationTable() {
  classTbody.innerHTML = classifications
    .map(
      (c) => `
        <tr>
          <td>${esc(c.name)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-danger" data-del-class="${c.id}">Remover</button>
          </td>
        </tr>
      `
    )
    .join("");

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

async function deleteGiftAndClearReservations(giftIdToDelete) {
  await clearGiftReservations(giftIdToDelete);
  const { error } = await supabase.from("gifts").delete().eq("id", giftIdToDelete);
  if (error) {
    throw error;
  }
}

async function saveDisplayOrder(giftIdToUpdate, displayOrder) {
  const { error } = await supabase
    .from("gifts")
    .update({ display_order: displayOrder })
    .eq("id", giftIdToUpdate);
  if (error) {
    throw error;
  }
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

  const { data: cls, error: ec } = await supabase
    .from("gift_classifications")
    .select("id,name")
    .order("name", { ascending: true });

  if (ec) {
    throw ec;
  }
  classifications = cls ?? [];
  renderClassificationTable();

  let gifts = [];
  let eg = null;
  const { data: giftsWithOrder, error: egWithOrder } = await supabase
    .from("gifts_view")
    .select(
      "id,title,price_value,is_active,display_order,classification_id,classification_name,qty_total,qty_reserved,qty_available"
    )
    .order("classification_name", { ascending: true })
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });

  if (egWithOrder) {
    const maybeMissingColumn =
      String(egWithOrder?.code || "") === "42703" ||
      String(egWithOrder?.message || "").toLowerCase().includes("display_order") ||
      String(egWithOrder?.message || "").toLowerCase().includes("is_active");

    if (maybeMissingColumn) {
      const fallback = await supabase
        .from("gifts_view")
        .select("id,title,price_value,classification_id,classification_name,qty_total,qty_reserved,qty_available")
        .order("classification_name", { ascending: true })
        .order("id", { ascending: true });

      gifts = (fallback.data ?? []).map((g) => ({ ...g, is_active: true, display_order: 0 }));
      eg = fallback.error;
    } else {
      eg = egWithOrder;
    }
  } else {
    gifts = (giftsWithOrder ?? []).map((g) => ({ ...g, display_order: g.display_order ?? 0 }));
  }

  if (eg) {
    throw eg;
  }

  giftsTbody.innerHTML = gifts
    .map(
      (g) => `
        <tr>
          <td>${g.id}</td>
          <td>${upper(g.title)}</td>
          <td>${g.classification_name ?? "-"}</td>
          <td style="min-width: 140px;">
            <div class="d-flex gap-1 align-items-center">
              <input
                class="form-control form-control-sm"
                type="number"
                min="0"
                step="1"
                value="${Number(g.display_order ?? 0)}"
                data-order-input="${g.id}"
              />
              <button class="btn btn-sm btn-outline-primary" data-save-order="${g.id}">OK</button>
            </div>
          </td>
          <td>${formatBRL(g.price_value, "-")}</td>
          <td>${
            g.is_active === false
              ? '<span class="badge text-bg-secondary">INATIVO</span>'
              : '<span class="badge text-bg-success">ATIVO</span>'
          }</td>
          <td>${g.qty_total}</td>
          <td>${g.qty_reserved}</td>
          <td>${g.qty_available}</td>
          <td class="text-end">
            <div class="d-flex gap-1 justify-content-end flex-wrap">
              <a class="btn btn-sm btn-outline-secondary" href="./admin-item.html?id=${g.id}">Editar</a>
              <button
                class="btn btn-sm ${g.is_active === false ? "btn-outline-success" : "btn-outline-warning"}"
                data-toggle-active="${g.id}"
                data-next-active="${g.is_active === false ? "true" : "false"}"
              >${g.is_active === false ? "Ativar" : "Desativar"}</button>
              <button class="btn btn-sm btn-outline-danger" data-delete-gift="${g.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  giftsTbody.querySelectorAll("button[data-save-order]").forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-save-order"));
      const input = giftsTbody.querySelector(`input[data-order-input=\"${id}\"]`);
      const newOrder = Number(input?.value ?? "");

      if (!Number.isInteger(newOrder) || newOrder < 0) {
        resMsg.textContent = "Ordem invalida. Use numero inteiro maior ou igual a 0.";
        return;
      }

      btn.disabled = true;
      resMsg.textContent = "Salvando ordem...";
      try {
        await saveDisplayOrder(id, newOrder);
        resMsg.textContent = "Ordem salva.";
        await loadAdminData();
      } catch (e) {
        resMsg.textContent = `Erro ao salvar ordem: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-toggle-active]").forEach((btn) => {
    btn.onclick = async () => {
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
      } catch (e) {
        resMsg.textContent = `Erro ao alterar status: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

  giftsTbody.querySelectorAll("button[data-delete-gift]").forEach((btn) => {
    btn.onclick = async () => {
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
      } catch (e) {
        resMsg.textContent = `Erro ao excluir: ${formatError(e)}`;
      } finally {
        btn.disabled = false;
      }
    };
  });

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
