# Vercel deployment and admin subdomain

The public site and admin portal are one Vercel project. The hostname determines which
experience is served:

| Hostname | URL requested | Route rendered |
| --- | --- | --- |
| `alongco.com` | `/` | `app/(public)/page.tsx` |
| `admin.alongco.com` | `/` | `app/(admin)/admin/page.tsx` |

`proxy.ts` makes this happen by internally rewriting requests received on `ADMIN_HOST` from
`/` to `/admin`. The visitor keeps the clean `admin.alongco.com` URL in their browser.

## Configure Vercel

1. Import this repository as one Vercel project and deploy it.
2. In **Project → Settings → Domains**, add `alongco.com` and `admin.alongco.com` to that
   same project. Follow Vercel's DNS instructions for each domain.
3. In **Project → Settings → Environment Variables**, set `ADMIN_HOST` to
   `admin.alongco.com` for Production and Preview. Set `NEXT_PUBLIC_SITE_URL` to
   `https://alongco.com` for Production.
4. Redeploy after adding the variables. Open both `https://alongco.com/` and
   `https://admin.alongco.com/`. The latter must show the **ADMIN** badge and the admin
   placeholder, while retaining the subdomain in the address bar.

For a temporary Vercel preview, set `ADMIN_HOST` to the actual hostname assigned to the
admin domain; preview deployment hostnames cannot act as both public and admin hosts at
the same time.

## Local check

Run `npm run dev`, then use these URLs:

```text
http://localhost:3000/        # public site
http://localhost:3000/admin   # local admin-route equivalent
```

To test host-based routing locally, add `admin.localhost` to your hosts configuration and
start the server with `ADMIN_HOST=admin.localhost:3000` (or use a hostname-mapping tool).
Then opening `http://admin.localhost:3000/` should show the admin placeholder.
