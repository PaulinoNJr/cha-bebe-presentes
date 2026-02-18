export function createSupabaseRestClient({ url, anonKey }) {
  const baseUrl = String(url ?? "").replace(/\/+$/, "");

  return async function sbFetch(path, { method = "GET", body = null } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : null,
    });

    const txt = await res.text();
    let data;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = txt;
    }

    if (!res.ok) {
      const msg =
        data && (data.message || data.error || data.hint)
          ? data.message || data.error || data.hint
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  };
}
