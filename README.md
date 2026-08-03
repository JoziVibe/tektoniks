# tektoniks

## Resend contact form

The contact form posts to `/api/contact` and sends inquiries through Resend.
Configure these environment variables before deploying:

```bash
RESEND_API_KEY=
RESEND_FROM_EMAIL=no-reply@updates.tektonics.africa
RESEND_TO_EMAIL=info@tektonics.africa
RESEND_FROM_NAME="Tektonics Website"
RESEND_SUBJECT_PREFIX="Tektonics Website Inquiry"
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

`RESEND_FROM_EMAIL` must use a sender on a domain that has been verified in
Resend. The current verified sender domain is `updates.tektonics.africa`.

The contact form includes server-side spam controls for direct bot posts,
including a honeypot field, submit pacing, and short-window rate limits. To add
Cloudflare Turnstile verification as another layer, create a Turnstile widget
for the site and set both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` in the deployment environment.
