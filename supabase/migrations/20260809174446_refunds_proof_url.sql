-- Add proof_url to refunds for manual refund screenshot tracking.
-- Also add the refund-proofs storage bucket if it doesn't exist.

alter table public.refunds
  add column if not exists proof_url text;

-- Storage bucket for refund screenshots. Private — only service_role can read.
insert into storage.buckets (id, name, public)
  values ('refund-proofs', 'refund-proofs', false)
  on conflict (id) do nothing;

-- Only service_role may read/write the refund-proofs bucket.
-- No RLS policies for anon or authenticated — operator-only access via service client.
