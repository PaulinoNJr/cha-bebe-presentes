export function getSupabaseConfig() {
  const cfg = window.SUPABASE_CONFIG || {};
  return {
    url: cfg.url,
    anonKey: cfg.anonKey,
  };
}

export function isMissingSupabaseConfig(url, anonKey) {
  return (
    !url ||
    !anonKey ||
    String(url).includes("SEU-PROJETO") ||
    String(anonKey).includes("SUA_ANON_KEY")
  );
}
