# Email OTP — Supabase configuration

Sign-in sends a 6-digit code. Supabase decides between a code and a magic link
**purely from what the email template contains**:

> If `{{ .ConfirmationURL }}` is in the template, a magic link is sent.
> If `{{ .Token }}` is in the template, an OTP is sent.

The default templates contain only `{{ .ConfirmationURL }}`, so out of the box a
link arrives and the code entry screen has nothing to accept. That is a
dashboard change, not a code change — nothing in this repo can override it.

---

## 1. Turn off "Confirm email"

**Authentication → Sign In / Providers → Email → Confirm email: OFF**

With it on, a first-time address gets the *Confirm signup* template and a
`signup` token; a returning address gets *Magic Link* and an `email` token. Two
paths, two token types, and a first booking behaves differently from a tenth.

It is also redundant here. Entering a code that only arrives at that address
*is* the proof the address works — a separate confirmation step proves the same
thing twice.

(The sign-in action tries both token types regardless, so leaving this on will
still work. Off is simply one fewer thing to be wrong.)

## 2. Replace the Magic Link template

**Authentication → Emails → Magic Link**

Subject:

```
{{ .Token }} is your AlongCo sign-in code
```

Body:

```html
<h2>Your sign-in code</h2>
<p>Enter this code to finish signing in:</p>
<p style="font-size:28px;letter-spacing:.18em;font-weight:600">{{ .Token }}</p>
<p>It expires in a few minutes. If you did not ask for it, ignore this email —
nothing has been booked and nothing has been charged.</p>
```

## 3. Replace the Confirm signup template

**Authentication → Emails → Confirm signup** — same content as above.

Only fires if you left step 1 on, but leaving it as a link means a first-time
customer gets a different email from everyone else, and the code screen she is
looking at cannot accept what she was sent.

---

## Why there is no link in these templates

Deliberate, and it fixes two real failures:

**Link prefetching consumes the token.** Corporate scanners and some mail
providers (Microsoft Defender Safe Links, for one) fetch every URL in an
incoming email. That single-use token is spent before she ever sees the message,
and she gets "token has expired or is invalid" on a code she never used.
Supabase documents this as a known limitation, and a code-only template is their
first recommended fix.

**She is rarely reading email on the device she is booking on.** A link opens a
session in her phone's mail browser; the laptop with the held slot stays signed
out and the ten-minute hold runs down while she works out why.

A code moves between devices. A link does not.

---

## Checking it worked

Request a code, then look at **Logs → Auth**. The line to find is:

```
"event":"mail.send", "mail_type":"magiclink"
```

`"mail_type":"confirmation"` means step 1 is still on. Either mail type is fine
**provided** that template contains `{{ .Token }}` — but if a link arrives
instead of a code, the template is still the default one.
