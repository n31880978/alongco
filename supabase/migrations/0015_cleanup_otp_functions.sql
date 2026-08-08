-- AlongCo — 0015_cleanup_otp_functions.sql
--
-- Customer sign-in moved from Supabase phone OTP (0006, 0011) to Clerk email/OAuth.
-- The OTP functions are no longer called by any customer path, so they can be dropped.
-- The otp_requests table is kept for now — removing a table is a one-way door on
-- a live database, and the empty table does no harm.

-- Drop the OTP rate limit function that is no longer called anywhere.
drop function if exists ac_consume_otp_rate_limit(text, text);

-- Also clean up the legacy identifier-hash version (0011 renamed phone_hash to identifier_hash).
-- This may not exist if migrations were applied in full sequence, but the conditional drop is harmless.
drop function if exists ac_consume_otp_rate_limit_old(text, text);

-- Note: otp_requests table is deliberately kept. It has RLS enabled with no policies,
-- so only service_role can access it. The table can be manually dropped later if desired,
-- but this migration takes the conservative approach.