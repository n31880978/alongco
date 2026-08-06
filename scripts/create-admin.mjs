#!/usr/bin/env node
/**
 * Creates (or promotes) an admin.
 *
 *   node scripts/create-admin.mjs you@example.com 'a-long-password' owner
 *
 * Solves the bootstrap problem: `admin_users` starts empty, and the admin
 * sign-in refuses anyone without a row in it, so the first admin cannot be made
 * through the product. This uses the service-role key to do both halves —
 * create the Supabase auth user and insert the admin_users row — in one step.
 *
 * Safe to re-run. An existing auth user is reused rather than duplicated, and
 * an existing admin_users row is updated in place.
 *
 * Roles, narrowest first: support < ops < owner. Only `owner` may read a
 * companion's legal name, phone or vetting notes (CLAUDE.md §3.6), so give it
 * out sparingly.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Load .env without adding a dependency. Real values only; inline comments and
// surrounding quotes are stripped the way a dotenv parser would.
function loadEnv(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.split(' #')[0].trim()
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv('.env')
loadEnv('.env.local')

const [email, password, role = 'owner'] = process.argv.slice(2)

if (!email || !password) {
  console.error(
    'Usage: node scripts/create-admin.mjs <email> <password> [owner|ops|support]',
  )
  process.exit(1)
}

if (!['owner', 'ops', 'support'].includes(role)) {
  console.error(`Unknown role "${role}". Use owner, ops or support.`)
  process.exit(1)
}

if (password.length < 12) {
  console.error('Use a password of at least 12 characters for an admin account.')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.',
  )
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const host = new URL(url).host
console.log(`→ ${host}`)

// 1. The auth user.
let userId
const created = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // no inbox round-trip for a staff account
})

if (created.error) {
  const alreadyExists =
    created.error.status === 422 || /already/i.test(created.error.message)
  if (!alreadyExists) {
    console.error(`✗ could not create the auth user: ${created.error.message}`)
    process.exit(1)
  }

  // Reuse the existing user and reset the password to what was just given.
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  })
  if (listError) {
    console.error(`✗ could not look up the existing user: ${listError.message}`)
    process.exit(1)
  }
  const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!found) {
    console.error('✗ the user exists but could not be found to update.')
    process.exit(1)
  }
  userId = found.id
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password,
  })
  if (updateError) {
    console.error(`✗ could not set the password: ${updateError.message}`)
    process.exit(1)
  }
  console.log('· auth user already existed — password reset')
} else {
  userId = created.data.user.id
  console.log('· auth user created')
}

// 2. The admin_users row. This is what the sign-in actually checks.
const { error: upsertError } = await supabase
  .from('admin_users')
  .upsert({ id: userId, email, role, is_active: true }, { onConflict: 'id' })

if (upsertError) {
  console.error(`✗ could not write admin_users: ${upsertError.message}`)
  process.exit(1)
}

console.log(`✓ ${email} is now an active ${role}`)
console.log('  Sign in at /admin/sign-in (admin host: /sign-in)')
