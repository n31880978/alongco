/**
 * Supabase Auth "Send SMS" hook — MSG91 delivery.
 *
 * Supabase Auth has no native MSG91 provider, so this hook is what makes MSG91
 * possible: Supabase generates and verifies the one-time code itself and calls
 * this function purely to deliver it. The code is never stored here, never
 * logged, and never reaches the AlongCo application.
 *
 * Deploy:
 *   supabase functions deploy send-sms-otp --no-verify-jwt
 *
 * Then in the Supabase dashboard, Authentication → Hooks → Send SMS hook:
 *   URI     https://<project-ref>.supabase.co/functions/v1/send-sms-otp
 *   Secret  the generated v1,whsec_… value, set below as SEND_SMS_HOOK_SECRET
 *
 * Function secrets (supabase secrets set …):
 *   MSG91_AUTH_KEY        from the MSG91 console
 *   MSG91_TEMPLATE_ID     the DLT-approved OTP template id
 *   MSG91_SENDER_ID       the 6-character DLT-registered header, e.g. ALNGCO
 *   SEND_SMS_HOOK_SECRET  the hook secret Supabase generated
 *
 * BEFORE THIS WORKS IN PRODUCTION: Indian SMS requires DLT registration. The
 * entity, the sender header and the template must all be approved on the DLT
 * portal and linked in MSG91. An unregistered template is accepted by the API
 * and then silently dropped by the carrier, which looks exactly like a working
 * integration with no messages arriving.
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

type SendSmsPayload = {
  user: { id: string; phone: string }
  sms: { otp: string }
}

const MSG91_URL = 'https://control.msg91.com/api/v5/flow'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET')
  const authKey = Deno.env.get('MSG91_AUTH_KEY')
  const templateId = Deno.env.get('MSG91_TEMPLATE_ID')
  const senderId = Deno.env.get('MSG91_SENDER_ID')

  if (!hookSecret || !authKey || !templateId || !senderId) {
    console.error('send-sms-otp: missing configuration')
    return json({ error: { message: 'SMS delivery is not configured.' } }, 500)
  }

  // Verify the payload really came from Supabase Auth before doing anything with
  // it. Without this, anyone who found the URL could make us send SMS traffic.
  const raw = await req.text()
  let payload: SendSmsPayload
  try {
    const wh = new Webhook(hookSecret.replace('v1,whsec_', ''))
    payload = wh.verify(raw, Object.fromEntries(req.headers)) as SendSmsPayload
  } catch {
    console.error('send-sms-otp: signature verification failed')
    return json({ error: { message: 'invalid signature' } }, 401)
  }

  const phone = payload.user?.phone
  const otp = payload.sms?.otp
  if (!phone || !otp) {
    return json({ error: { message: 'malformed hook payload' } }, 400)
  }

  try {
    const res = await fetch(MSG91_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
      },
      body: JSON.stringify({
        template_id: templateId,
        sender: senderId,
        short_url: '0',
        recipients: [
          {
            // MSG91 wants the country code with no '+'. Supabase stores exactly
            // that shape (see lib/auth/phone.ts).
            mobiles: phone.replace(/\D/g, ''),
            // Must match the variable name in the approved DLT template.
            OTP: otp,
          },
        ],
      }),
    })

    const body = await res.json().catch(() => ({}))

    // MSG91 answers 200 with {type:'error'} for template and DLT problems, so
    // the status code alone is not enough to call this a success.
    if (!res.ok || body?.type === 'error') {
      // Never log the number or the code (CLAUDE.md §9) — only why it failed.
      console.error('send-sms-otp: MSG91 rejected the request', {
        status: res.status,
        message: body?.message ?? null,
      })
      return json({ error: { message: 'Could not deliver the code.' } }, 502)
    }
  } catch (err) {
    console.error('send-sms-otp: MSG91 request failed', {
      message: err instanceof Error ? err.message : 'unknown',
    })
    return json({ error: { message: 'Could not deliver the code.' } }, 502)
  }

  // An empty 200 tells Supabase Auth the message was handed off successfully.
  return json({}, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
