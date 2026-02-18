export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function upper(value) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

export function formatBRL(value, emptyLabel = "Valor nao informado") {
  if (value === null || value === undefined || value === "") {
    return emptyLabel;
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}
