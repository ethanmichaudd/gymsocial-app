/**
 * A stand-in Supabase for the browser tests.
 *
 * The tests never touch the real database. Every request the app makes to
 * Supabase is answered here from a small in-memory copy: two friends (Maya
 * and Dev), a stranger, someone asking to be your friend, a few gyms and
 * workouts. `makeDb({ legacy })` builds a database that has NOT run the
 * later migrations (008 / 009), so every test can prove the app still works
 * before a migration is run. Everything the app writes is recorded in
 * `db.log`, which is how tests check what was (and wasn't) sent.
 *
 * installMaps() does the same for the map tiles and the address lookup, so
 * the tests never call OpenStreetMap's servers either.
 */
export const ME = "11111111-1111-4111-8111-111111111111";
export const MAYA = "22222222-2222-4222-8222-222222222222";
export const DEV = "33333333-3333-4333-8333-333333333333";
export const STRANGER = "44444444-4444-4444-8444-444444444444";
export const ASKER = "55555555-5555-4555-8555-555555555555";
export const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", W2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const EX1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", EX2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
export const G1 = "99999999-0000-4000-8000-000000000001", G2 = "99999999-0000-4000-8000-000000000002", G3 = "99999999-0000-4000-8000-000000000003", G4 = "99999999-0000-4000-8000-000000000004";
const ago = (min) => new Date(Date.now() - min * 60000).toISOString().replace("Z", "+00:00");

export function makeDb({ legacy = false, legacy9 = false } = {}) {
  if (legacy) legacy9 = true;
  const strip = (row, keys) => { if (legacy) keys.forEach((k) => delete row[k]); return row; };
  const set = (weId, n, reps, weight) => ({ id: crypto.randomUUID(), workout_exercise_id: weId, set_number: n, reps, seconds: null, weight, weight_unit: "lb", distance: null, distance_unit: "mi", intensity: null, heart_rate: null, steps: null });
  const wk = (id, user, title, minsAgo, ex) => {
    const weId = crypto.randomUUID();
    return { id, user_id: user, gym_id: user === ME ? G2 : G1, title, performed_at: ago(minsAgo), ended_at: ago(minsAgo - 55), calories: 400, photo_path: null,
      workout_exercises: [{ id: weId, workout_id: id, exercise_id: ex, order_index: 0, metric: "reps", equipment: "Barbell", note: null, superset_group: null,
        workout_sets: [set(weId, 1, 5, 225), set(weId, 2, 5, 245)] }] };
  };
  return {
    log: [],
    profiles: [
      { id: ME, username: "ethan", display_name: "Ethan", avatar: null, is_private: false, weekly_goal: 3, streak_mode: "weekly", custom_count: 4, custom_days: 10, settings: { theme: "light" } },
      { id: MAYA, username: "mayaj", display_name: "Maya Jensen", avatar: null, is_private: false },
      { id: DEV, username: "devp", display_name: "Dev Patel", avatar: null, is_private: false },
      { id: STRANGER, username: "sam.k", display_name: "Sam Kim", avatar: null, is_private: false },
      { id: ASKER, username: "priya_r", display_name: "Priya Rao", avatar: null, is_private: false },
    ],
    exercises: [
      { id: EX1, owner_id: ME, name: "Back Squat", category: "legs", metric: "reps" },
      { id: EX2, owner_id: MAYA, name: "Bench Press", category: "push", metric: "reps" },
    ],
    workouts: [wk(W1, ME, "Leg Day", 60 * 26, EX1), wk(W2, MAYA, "Push Day", 180, EX2)],
    connections: [
      strip({ user_a: ME, user_b: MAYA, created_at: ago(60 * 24), requested_by: ME }, ["requested_by"]),
      strip({ user_a: ME, user_b: DEV, created_at: ago(60 * 24 * 30), requested_by: null }, ["requested_by"]),
    ],
    connection_requests: [{ from_id: ASKER, to_id: ME, created_at: ago(45) }],
    reactions: [
      strip({ workout_id: W1, user_id: MAYA, emoji: "\u{1F525}", created_at: ago(120) }, ["created_at"]),
      strip({ workout_id: W1, user_id: STRANGER, emoji: "\u{1F389}", created_at: ago(10) }, ["created_at"]),
      strip({ workout_id: W2, user_id: DEV, emoji: "\u{1F4AA}", created_at: ago(100) }, ["created_at"]),
    ],
    gyms: [
      strip({ id: G1, name: "Planet Fitness", street: "100 Cambridge St", city: "Boston", state: "MA", created_by: MAYA, lat: 42.3601, lng: -71.0625, is_private: false }, ["lat", "lng", "is_private"]),
      strip({ id: G2, name: "BU FitRec", street: "915 Commonwealth Ave", city: "Boston", state: "MA", created_by: ME, lat: null, lng: null, is_private: false }, ["lat", "lng", "is_private"]),
      strip({ id: G3, name: "Crunch Fitness", street: "1 Main St", city: "Cambridge", state: "MA", created_by: STRANGER, lat: 42.3736, lng: -71.1097, is_private: false }, ["lat", "lng", "is_private"]),
      strip({ id: G4, name: "Empty Gym", street: "", city: "Boston", state: "MA", created_by: STRANGER, lat: 42.34, lng: -71.09, is_private: false }, ["lat", "lng", "is_private"]),
    ],
    counts: { [G1]: [2, 5, 9], [G2]: [1, 1, 1], [G3]: [3, 7, 12], [G4]: [0, 0, 0] },
    stats: { people_30d: 14, sessions_30d: 40, top_exercises: [{ name: "Bench Press", sets: 214 }, { name: "Lat Pulldown", sets: 160 }, { name: "Back Squat", sets: 1 }],
             by_hour: [0,0,0,0,0,1,3,6,4,2,1,1,2,1,1,2,5,8,12,7,3,1,0,0] },
    geo: [], tiles: [], legacy9,
    comments: [
      { id: "cccccccc-0000-4000-8000-000000000001", workout_id: W1, user_id: MAYA, body: "245 for 5?? strong", created_at: ago(30) },
      { id: "cccccccc-0000-4000-8000-000000000002", workout_id: W2, user_id: DEV, body: "nice session", created_at: ago(90) },
    ],
    workout_tags: [{ workout_id: W2, user_id: ME, created_at: ago(20) }],
    presence: [{ user_id: MAYA, gym_id: G1, started_at: ago(25), expires_at: ago(-155) }],
    legacy,
  };
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const inList = (v) => v.replace(/^in\.\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, ""));

export async function install(context, db) {
  await context.route("https://kmhndltnnlhovykfffjg.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = url.pathname;
    const q = url.searchParams;
    let body = null;
    try { body = req.postDataJSON(); } catch (e) {}
    if (method !== "GET") db.log.push({ method, path, query: url.search, body });

    if (path.startsWith("/auth/v1/")) {
      if (path.endsWith("/user")) return json(route, { id: ME, email: "ethan@users.gymsocial.app" });
      return json(route, {});
    }
    if (path.startsWith("/storage/")) return json(route, []);
    if (path === "/rest/v1/rpc/accept_friend_request") {
      const from = body.requester;
      db.connection_requests = db.connection_requests.filter((r) => r.from_id !== from);
      const row = { user_a: [ME, from].sort()[0], user_b: [ME, from].sort()[1], created_at: new Date().toISOString() };
      if (!db.legacy) row.requested_by = from;
      db.connections.push(row);
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (path.startsWith("/rest/v1/rpc/gym_") || path.endsWith("/rpc/set_gym_location")) {
      if (db.legacy) return json(route, { code: "PGRST202", message: "Could not find the function public." + path.split("/").pop() + " in the schema cache" }, 404);
      if (path.endsWith("gym_directory")) return json(route, db.gyms.map((g) => ({ ...g, people_30d: (db.counts[g.id] || [0, 0, 0])[0], sessions_30d: (db.counts[g.id] || [0, 0, 0])[1], sessions_all: (db.counts[g.id] || [0, 0, 0])[2] })));
      if (path.endsWith("gym_stats")) return json(route, db.stats);
      const g = db.gyms.find((x) => x.id === body.p_gym);
      if (g && g.lat != null && g.created_by !== ME && g.id !== G2 && !db.workouts.some((w) => w.user_id === ME && w.gym_id === g.id)) {
        return json(route, { code: "P0001", message: "Only people who train here can move the pin." }, 400);
      }
      if (g) { g.lat = body.p_lat; g.lng = body.p_lng; }
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (path.startsWith("/rest/v1/rpc/")) return route.fulfill({ status: 204, headers: CORS });
    if (path === "/rest/v1/app_config") {
      if (db.legacy) return json(route, { code: "PGRST205", message: "Could not find the table 'public.app_config' in the schema cache" }, 404);
      return json(route, [{ value: { geocoding: db.geocodingOff ? false : true, geocoder_url: "https://nominatim.openstreetmap.org/search", tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" } }]);
    }

    const table = path.replace("/rest/v1/", "");
    if (["comments", "workout_tags", "presence"].includes(table)) {
      if (db.legacy9) return json(route, { code: "PGRST205", message: "Could not find the table 'public." + table + "' in the schema cache" }, 404);
      const eq = (k) => (q.get(k) || "").startsWith("eq.") ? q.get(k).slice(3) : null;
      const ins = (k) => (q.get(k) || "").startsWith("in.") ? inList(q.get(k)) : null;
      const match = (r) => ["id", "workout_id", "user_id"].every((k) => (eq(k) === null || r[k] === eq(k)) && (ins(k) === null || ins(k).includes(r[k])));
      if (method === "GET") {
        let rows = db[table].filter(match);
        if (table === "presence" && q.get("expires_at")) rows = rows.filter((r) => new Date(r.expires_at) > new Date());
        return json(route, rows);
      }
      if (method === "DELETE") { db[table] = db[table].filter((r) => !match(r)); return route.fulfill({ status: 204, headers: CORS }); }
      if (table === "comments") {
        if (db.failComment) return json(route, { code: "42501", message: "new row violates row-level security policy" }, 403);
        const row = { id: crypto.randomUUID(), ...body, created_at: new Date().toISOString() };
        db.comments.push(row);
        return json(route, row, 201);
      }
      if (table === "workout_tags") { (Array.isArray(body) ? body : [body]).forEach((b) => db.workout_tags.push({ ...b, created_at: new Date().toISOString() })); return json(route, [], 201); }
      if (table === "presence") {
        db.presence = db.presence.filter((r) => r.user_id !== body.user_id);
        db.presence.push({ ...body, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3 * 3600e3).toISOString() });
        return json(route, [], 201);
      }
    }
    if (method === "GET") {
      let rows = db[table] || [];
      if (table === "profiles") {
        if (q.get("id") && q.get("id").startsWith("eq.")) rows = rows.filter((r) => r.id === q.get("id").slice(3));
        else if (q.get("id") && q.get("id").startsWith("in.")) rows = rows.filter((r) => inList(q.get("id")).includes(r.id));
        else rows = [];
      } else if (table === "exercises") {
        if (q.get("owner_id")) rows = rows.filter((r) => r.owner_id === q.get("owner_id").slice(3));
        else if (q.get("id")) rows = rows.filter((r) => inList(q.get("id")).includes(r.id));
      } else if (table === "workouts") {
        const u = q.get("user_id") || "";
        rows = u.startsWith("eq.") ? rows.filter((r) => r.user_id === u.slice(3)) : rows.filter((r) => inList(u).includes(r.user_id));
      } else if (table === "reactions") {
        rows = rows.filter((r) => inList(q.get("workout_id")).includes(r.workout_id));
      } else if (table === "gyms") {
        const eq = (k) => (q.get(k) || "").startsWith("eq.") ? q.get(k).slice(3) : null;
        if (eq("name") !== null) rows = rows.filter((g) => g.name === eq("name") && g.street === eq("street") && g.city === eq("city") && g.state === eq("state"));
        else if (q.get("or")) { const m = q.get("or"); rows = rows.filter((g) => m.includes(g.id) || (g.created_by === ME && m.includes("created_by.eq." + ME))); }
        else if (eq("created_by") !== null) rows = rows.filter((g) => g.created_by === eq("created_by"));
        else if (q.get("id")) rows = rows.filter((g) => inList(q.get("id")).includes(g.id));
      }
      return json(route, rows);
    }
    if (table === "reactions" && method === "POST") {
      db.reactions = db.reactions.filter((r) => !(r.workout_id === body.workout_id && r.user_id === body.user_id));
      const row = { ...body, created_at: new Date().toISOString() };
      if (db.legacy) delete row.created_at;
      db.reactions.push(row);
    }
    if (table === "reactions" && method === "DELETE") {
      const w = q.get("workout_id").slice(3), u = q.get("user_id").slice(3);
      db.reactions = db.reactions.filter((r) => !(r.workout_id === w && r.user_id === u));
    }
    if (table === "connection_requests" && method === "DELETE") {
      db.connection_requests = db.connection_requests.filter((r) => r.from_id !== q.get("from_id").slice(3));
    }
    if (table === "gyms" && (method === "POST" || method === "PATCH")) {
      if (db.legacy && body && ("lat" in body || "is_private" in body)) return json(route, { code: "PGRST204", message: "Could not find the 'is_private' column of 'gyms' in the schema cache" }, 400);
      if (method === "POST") db.gyms.push({ ...body });
      else { const g = db.gyms.find((x) => x.id === (q.get("id") || "").slice(3)); if (g && g.created_by === ME) Object.assign(g, body); }
    }
    if (table === "profiles" && method === "PATCH") {
      Object.assign(db.profiles[0], body);
      return json(route, [{ id: ME }]);
    }
    return json(route, [], method === "POST" ? 201 : 200);
  });
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8e/fufwAIoQNiMxzc5AAAAABJRU5ErkJggg==", "base64");
/** Stand-ins for the map tiles and the address lookup; both record what was asked. */
export async function installMaps(context, db) {
  await context.route("https://tile.openstreetmap.org/**", (route) => {
    db.tiles.push({ url: route.request().url(), referer: route.request().headers()["referer"] || "" });
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await context.route("https://nominatim.openstreetmap.org/**", (route) => {
    const u = new URL(route.request().url());
    const qq = (u.searchParams.get("q") || "").toLowerCase();
    db.geo.push({ t: Date.now(), q: qq, referer: route.request().headers()["referer"] || "", format: u.searchParams.get("format"), limit: u.searchParams.get("limit") });
    let out = [{ lat: "42.3550", lon: "-71.0700" }];
    if (qq.includes("915 commonwealth")) out = [{ lat: "42.3519", lon: "-71.1168" }];
    if (qq.includes("nowhere")) out = [];
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(out) });
  });
}

export function sessionScript() {
  const payload = Buffer.from(JSON.stringify({ sub: ME, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 * 40 })).toString("base64url");
  const session = {
    access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + payload + ".sig",
    refresh_token: "r", token_type: "bearer", expires_in: 86400 * 40, expires_at: Math.floor(Date.now() / 1000) + 86400 * 40,
    user: { id: ME, email: "ethan@users.gymsocial.app", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  return `if (!localStorage.getItem("sb-kmhndltnnlhovykfffjg-auth-token")) localStorage.setItem("sb-kmhndltnnlhovykfffjg-auth-token", ${JSON.stringify(JSON.stringify(session))});`;
}
