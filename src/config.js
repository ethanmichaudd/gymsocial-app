/**
 * Which Supabase project the app talks to. Shared by the app (store.js) and
 * the developer page (admin.js).
 *
 * The anon key is public by design: Row Level Security in supabase/*.sql is
 * what keeps one account out of another's data. .env can override both.
 */
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://kmhndltnnlhovykfffjg.supabase.co";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttaG5kbHRubmxob3Z5a2ZmZmpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwMjAxMzEsImV4cCI6MjEwOTU5NjEzMX0.lP0VZq6ZHBpFsnvu_iDNWB-62hYPDuK_osl5D9pTuoQ";

/* Accounts are a username + password. Supabase still wants an email under
   the hood, so a username becomes a placeholder address on this domain,
   which nobody receives mail for. */
export const LOGIN_DOMAIN = "users.gymsocial.app";
