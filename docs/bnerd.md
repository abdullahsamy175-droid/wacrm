# Bnerd fork

This fork keeps wacrm's product as it is and adds what the Bnerd staff
Portal needs. Work happens on the `bnerd` branch, so `main` stays a clean
copy of upstream for pulling updates.

| Added | Where |
|---|---|
| Framing by the Portal only | `FRAME_ANCESTORS`, `src/lib/security/frame-headers.ts`, `src/middleware.ts` |
| Portal sign-in | `GET /api/sso`, `src/lib/sso/`, migration 060 |
| wacrm's sidebar and header hidden in a frame | `src/app/layout.tsx`, `dashboard-shell.tsx`, `globals.css` |
| Pipelines and deals API | `/api/v1/pipelines`, `/api/v1/deals`, scopes `deals:read`, `deals:write` |
| Archiving contacts | `DELETE /api/v1/contacts/{id}`, scope `contacts:archive`, migration 061 |
| Egyptian pounds by default | `src/lib/currency.ts`, migration 062. Existing deals keep their saved currency. |

## Hostnames

All three staff apps need the same parent domain. The session cookies
depend on it: Payload's is `SameSite=Strict`, and wacrm's must work inside
the Portal's frame.

| App | Example | Used as |
|---|---|---|
| Portal | `portal.example.com` | `CORS_ORIGINS` in Payload, `FRAME_ANCESTORS` here |
| wacrm | `crm.example.com` | `NEXT_PUBLIC_SITE_URL` here, `WACRM_URL` in Payload, `NEXT_PUBLIC_WACRM_URL` in the Portal |
| Payload | `portal-api.example.com` | `SERVER_URL` in Payload, `NEXT_PUBLIC_PAYLOAD_URL` in the Portal |

Payload also needs `COOKIE_DOMAIN=.example.com`. Each `NEXT_PUBLIC_*` value
is built into the image, so changing one means a rebuild.

## First run

1. Create the Supabase project and apply `supabase/migrations/` in order.
   Under Authentication -> URL Configuration, set the Site URL to wacrm's
   address and add `<crm>/auth/callback` to the redirect URLs.
2. Fill in `docs/bnerd.env.example` as `.env.local`, leaving
   `WACRM_SSO_ACCOUNT_ID` empty, and deploy.
3. Open the app directly and sign up once. This user owns the shared
   account. Put its id in `WACRM_SSO_ACCOUNT_ID`:
   `select id from accounts;`
4. Turn off public sign-up in Supabase (Authentication -> Providers ->
   Email), so staff can only arrive through the Portal.
5. As the owner, add the WhatsApp details in Settings and point Meta's
   webhook at `https://<crm>/api/whatsapp/webhook`.
6. In Settings -> API keys, create a key for Payload with `contacts:read`,
   `contacts:write`, `contacts:archive`, `messages:send`, `messages:read`,
   `conversations:read`, `deals:read`, `deals:write` and `webhooks:manage`.
7. Open Pipelines once. wacrm creates the default pipeline on first view.
8. Nothing in the container is scheduled. Call `GET /api/automations/cron`
   and `GET /api/flows/cron` every minute with the header
   `x-cron-secret: <AUTOMATION_CRON_SECRET>`, or Wait steps and flows stall.

## Portal sign-in

The Portal asks Payload for a signed URL and loads it in the frame:

```
GET <wacrm>/api/sso?token=<jwt>&next=/inbox
```

The JWT is HS256, signed with `WACRM_SSO_SECRET`:

| Claim | Value |
|---|---|
| `iss` / `aud` | `bnerd-portal` / `wacrm` |
| `sub` | Payload user id |
| `email`, `name` | The staff member |
| `role` | `admin` or `agent` |
| `jti` | Unique per token. A second use is refused. |
| `exp` | At most 120 seconds ahead. Payload uses 60. |

The first sign-in creates the user in the shared account, and later ones
apply any role change. The account owner keeps `owner`. Identity is the
email address, so changing a staff email creates a new wacrm user.

Removing someone from the Portal stops new sign-ins but leaves their
current wacrm session running until Supabase expires it.

## Framing

Without `FRAME_ANCESTORS` wacrm answers `X-Frame-Options: DENY`, as
upstream does. With it, wacrm sends `frame-ancestors` for those origins
and lets them use the microphone for voice notes. The Portal and wacrm
must share a parent domain, or the session cookie won't work in the frame.

## Archived contacts

Archiving is how a student's deletion request reaches wacrm. Nothing is
removed from the database.

- The contact, its conversations and its deals disappear from every
  dashboard screen through RLS, including live updates.
- `POST /api/v1/messages` answers `409 contact_archived`. Broadcasts count
  the number as rejected, automations stop, active flows are cancelled.
- Inbound messages are stored and stay hidden, and start nothing.
- Finding the phone again returns the contact with `archived_at` still set.
- There is no un-archive.

Known gap: the aggregate numbers on wacrm's own `/dashboard` still count
archived rows. The Portal doesn't link to that screen.

## Keeping up with upstream

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout bnerd && git merge main
```

Migrations 060 to 062 may collide with new upstream numbers. Renumber
ours if so, keeping them last.
