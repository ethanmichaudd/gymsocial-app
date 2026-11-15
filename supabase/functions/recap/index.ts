// GymSocial — "recap" Edge Function
//
// Sends everyone who trained last week one push: "Your week: 4 workouts at
// 2 gyms. Tap for your recap." Tapping it opens the recap inside the app
// (?recap=1), which works the numbers out on the phone.
//
// Nothing calls this on its own. To switch it on:
//
//   1. Deploy it without JWT checking (it has its own shared secret):
//        supabase functions deploy recap --no-verify-jwt
//   2. Edge Functions -> Secrets: add RECAP_SECRET (any long random string).
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are the same
//      ones the "notify" function already uses.
//   3. Database -> Extensions: turn on pg_cron and pg_net, then run this
//      once in the SQL editor, with your secret in place of <secret>:
//
//        select cron.schedule(
//          'gymsocial-weekly-recap',
//          '0 23 * * 0',            -- Sundays 23:00 UTC = 6 PM Eastern (7 PM in summer)
//          $$ select net.http_post(
//               url := 'https://kmhndltnnlhovykfffjg.supabase.co/functions/v1/recap',
//               headers := jsonb_build_object('x-recap-secret', '<secret>')
//             ) $$
//        );
//
//      To stop it later:  select cron.unschedule('gymsocial-weekly-recap');
//
// The week is the last full Sunday-to-Saturday week, measured in UTC because
// the server doesn't know anyone's time zone; a workout logged late on a
// Saturday night can land in the next week's count here. The recap in the
// app uses the phone's own clock and is the accurate one.

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

/** The last full week: [Sunday 00:00 UTC, the following Sunday 00:00 UTC). */
function lastWeek(now: Date): [Date, Date] {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - end.getUTCDay());
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return [start, end];
}

Deno.serve(async (req) => {
  // Only the scheduled job knows the secret. With none set, nobody gets in:
  // an open endpoint would let anyone buzz every phone.
  const secret = Deno.env.get("RECAP_SECRET");
  if (!secret || req.headers.get("x-recap-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const [start, end] = lastWeek(new Date());
    const { data: rows, error } = await db.from("workouts")
      .select("user_id,gym_id")
      .gte("performed_at", start.toISOString())
      .lt("performed_at", end.toISOString())
      .limit(20000);
    if (error) throw error;

    // per person: how many workouts, at how many gyms
    const week = new Map<string, { n: number; gyms: Set<string> }>();
    for (const r of rows ?? []) {
      const w = week.get(r.user_id) ?? { n: 0, gyms: new Set<string>() };
      w.n++;
      if (r.gym_id) w.gyms.add(r.gym_id);
      week.set(r.user_id, w);
    }
    if (!week.size) return Response.json({ sent: 0 });

    const { data: subs, error: subErr } = await db.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth").in("user_id", [...week.keys()]);
    if (subErr) throw subErr;

    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      const w = week.get(s.user_id)!;
      const where = w.gyms.size ? ` at ${w.gyms.size} ${w.gyms.size === 1 ? "gym" : "gyms"}` : "";
      const payload = JSON.stringify({
        title: "GymSocial",
        body: `Your week: ${w.n} ${w.n === 1 ? "workout" : "workouts"}${where}. Tap for your recap.`,
        url: "?recap=1",
        tag: "recap",
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "low" },
        );
        sent++;
      } catch (err) {
        // 404/410: the phone turned notifications off or the app was deleted
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push failed", code, (err as Error).message);
      }
    }));
    return Response.json({ sent });
  } catch (err) {
    console.error(err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
