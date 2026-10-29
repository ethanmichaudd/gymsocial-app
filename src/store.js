/**
 * Where your training data lives.
 *
 * Today: this device, via localStorage (Capacitor upgrades this to real
 * app storage automatically — same API, but the OS stops evicting it).
 *
 * Step 2 (Supabase) replaces the two functions below with calls that read
 * and write your account's rows. Nothing else in the app changes, because
 * nothing else in the app knows where the data came from.
 */

export function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Private browsing, blocked storage, corrupt JSON — start fresh in memory
    console.warn("Could not read saved data:", err);
    return null;
  }
}

export function saveState(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn("Could not save:", err);
    return false;
  }
}

/** True once Supabase credentials are present (step 2). */
export function cloudEnabled() {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
