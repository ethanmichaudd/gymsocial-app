// GymSocial — "notify" Edge Function
//
// Called by three Database Webhooks (INSERT on workouts, reactions,
// connection_requests). Works out who should hear about it and sends a Web
// Push to each of their phones.
//
//   workout logged    -> everyone connected to the author: "@maya logged Push Day 💪"
//   reaction added    -> the workout's owner:              "@maya reacted 🔥 to Push Day"
//   friend request    -> the person asked:                 "@maya sent you a friend request"
//
// Secrets it needs (Edge Functions -> Secrets): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

// Workouts uploaded long after they happened (a first sign-in backfilling a
// phone's history) shouldn't buzz everyone. Only recent sessions notify.
const RECENT_MS = 24 * 60 * 60 * 1000;

type Note = { title: string; body: string; url: string; tag: string };

async function handleOf(userId: string): Promise<string> {
  const { data } = await db.from("profiles").select("username").eq("id", userId).maybeSingle();
  return data ? "@" + data.username : "Someone";
}

async function friendsOf(userId: string): Promise<string[]> {
  const { data, error } = await db.from("connections").select("user_a,user_b")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (error) throw error;
  return data.map((c) => (c.user_a === userId ? c.user_b : c.user_a));
}

/** Sends one notification to every phone of every recipient. */
async function send(userIds: string[], note: Note) {
  if (!userIds.length) return 0;
  const { data: subs, error } = await db.from("push_subscriptions")
    .select("id,endpoint,p256dh,auth").in("user_id", userIds);
  if (error) throw error;

  const payload = JSON.stringify(note);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: "normal" },
      );
      sent++;
    } catch (err) {
      // 404/410: the phone turned notifications off or the app was deleted
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", code, (err as Error).message);
    }
  }));
  return sent;
}

async function onWorkout(w: Record<string, string>) {
  if (Date.now() - new Date(w.performed_at).getTime() > RECENT_MS) return 0;
  const [who, friends] = await Promise.all([handleOf(w.user_id), friendsOf(w.user_id)]);
  return send(friends, {
    title: "GymSocial",
    body: `${who} logged ${w.title || "a workout"} 💪`,
    url: `?workout=${w.id}`,
    tag: `workout-${w.id}`,
  });
}

async function onReaction(r: Record<string, string>) {
  const { data: w } = await db.from("workouts").select("id,user_id,title")
    .eq("id", r.workout_id).maybeSingle();
  if (!w || w.user_id === r.user_id) return 0;      // no buzz for reacting to yourself
  const who = await handleOf(r.user_id);
  return send([w.user_id], {
    title: "GymSocial",
    body: `${who} reacted ${r.emoji} to ${w.title || "your workout"}`,
    url: `?workout=${w.id}`,
    tag: `react-${w.id}`,                              // several reactions stack into one
  });
}

async function onRequest(q: Record<string, string>) {
  const who = await handleOf(q.from_id);
  return send([q.to_id], {
    title: "GymSocial",
    body: `${who} sent you a friend request`,
    url: `?friends=1`,
    tag: `request-${q.from_id}`,
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    if (body.type !== "INSERT" || !body.record) return Response.json({ skipped: true });
    let sent = 0;
    if (body.table === "workouts") sent = await onWorkout(body.record);
    else if (body.table === "reactions") sent = await onReaction(body.record);
    else if (body.table === "connection_requests") sent = await onRequest(body.record);
    return Response.json({ sent });
  } catch (err) {
    console.error(err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
