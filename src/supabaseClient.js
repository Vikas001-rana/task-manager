import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const clientUrl =
  import.meta.env.DEV && url?.includes("supabase.co")
    ? `${window.location.origin}/supabase`
    : url;

export const hasSupabase = Boolean(
  url &&
    anonKey &&
    !url.includes("your-project") &&
    !anonKey.includes("your-anon-key")
);

export const supabaseUrl = url;
export const supabase = hasSupabase ? createClient(clientUrl, anonKey) : null;
