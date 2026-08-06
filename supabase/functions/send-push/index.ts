import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const BodySchema = z.object({
  user_id: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  data: z.record(z.string()).optional(),
});

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Mints a short-lived OAuth token for FCM HTTP v1 from the service account JSON. */
async function getAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${b64(header)}.${b64(claim)}`;

  const pem = sa.private_key.replace(/\\n/g, '\n');
  const der = Uint8Array.from(
    atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  );
  const sigB64 = btoa(String.fromCharCode(...sig))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sigB64}`,
    }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error('Failed to obtain FCM access token');
  return tok.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // --- AuthN: caller must be a signed-in user or hold the service role key ---
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace('Bearer ', '').trim();
    if (!bearer) return json({ error: 'Unauthorized' }, 401);

    let callerId: string | null = null;
    let isService = bearer === serviceKey;
    if (!isService) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data?.user) return json({ error: 'Unauthorized' }, 401);
      callerId = data.user.id;
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }

    // --- AuthZ: non-service callers may only notify themselves ---
    const targetUser = isService ? parsed.data.user_id ?? callerId : callerId;
    if (!targetUser) return json({ error: 'user_id is required' }, 400);
    if (!isService && targetUser !== callerId) return json({ error: 'Forbidden' }, 403);

    const rawSa = Deno.env.get('FCM_SERVICE_ACCOUNT');
    if (!rawSa) return json({ error: 'Push notifications are not configured' }, 503);
    const sa = JSON.parse(rawSa);

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', targetUser);

    if (!tokens?.length) return json({ sent: 0, message: 'No registered devices' });

    const accessToken = await getAccessToken(sa);
    let sent = 0;
    const failures: string[] = [];

    for (const { token } of tokens) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: parsed.data.title, body: parsed.data.body },
              data: parsed.data.data ?? {},
              android: { priority: 'HIGH' },
            },
          }),
        },
      );
      if (res.ok) {
        sent += 1;
      } else {
        const err = await res.text();
        failures.push(err.slice(0, 200));
        // Prune tokens FCM rejects as permanently invalid.
        if (res.status === 404 || res.status === 400) {
          await admin.from('push_tokens').delete().eq('token', token);
        }
      }
    }

    await admin.from('notification_log').insert({
      user_id: targetUser,
      title: parsed.data.title,
      body: parsed.data.body,
      data: parsed.data.data ?? {},
      status: sent > 0 ? 'sent' : 'failed',
      error_message: failures.length ? failures.join(' | ') : null,
    });

    return json({ sent, failed: failures.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
