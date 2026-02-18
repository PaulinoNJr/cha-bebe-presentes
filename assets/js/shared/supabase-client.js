import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function createSupabaseBrowserClient(url, anonKey) {
  const noOpLock = async (_name, _timeout, fn) => await fn();
  return createClient(url, anonKey, {
    auth: {
      lock: noOpLock,
    },
  });
}
