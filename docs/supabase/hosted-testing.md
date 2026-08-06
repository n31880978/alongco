# Hosted Supabase verification

T2, T3, and the database portion of T4 run only against a dedicated hosted
Supabase test project (or an isolated database branch). They never fall back to
localhost. The suite truncates mutable application tables between tests, so do
not point `TEST_DATABASE_URL` at production or a shared staging database.

## Apply the schema

Link the CLI to the test project, then apply the checked-in migrations:

```bash
npx supabase link --project-ref <test-project-ref>
npx supabase db push
```

The migrations create `btree_gist`, seed `settings` and `areas`, enable RLS on
every public table, and add the OTP rate-limit RPC. Neither command needs a
Supabase service-role key.

## Run the real database checks

Copy the transaction-pooler connection string from the project’s **Connect**
panel into a shell variable. Keep it private:

```bash
export TEST_DATABASE_URL='<Supabase transaction-pooler connection string>'
npm run db:test
```

This includes the required RLS and overlap tests, plus the sixth-OTP-request
test. The test runner fails immediately if `TEST_DATABASE_URL` is not set,
which prevents accidental local execution.

## Auth provider check

For the browser OTP flow, configure Supabase Auth’s phone provider and a
WhatsApp-capable delivery provider, then set `NEXT_PUBLIC_OTP_CHANNEL=whatsapp`
and the server-only `OTP_HASH_SALT` in your deployment environment. The
application’s public anon key is sufficient for sign-in; the service-role key
is not used by this flow.
