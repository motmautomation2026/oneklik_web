# Auth email templates

The templates moved to `frontend/public/email-templates/`.

They live there because self-hosted GoTrue fetches templates over HTTP rather
than reading them from disk, and `frontend/public/` is already served by the
frontend container's Nginx. Keeping the single copy at the path that is
actually served avoids a second copy drifting out of sync with the one in use.

| Template | Served at | Supabase `.env` key |
| --- | --- | --- |
| `confirmation.html` | `https://app.quickicp.com/email-templates/confirmation.html` | `MAILER_TEMPLATES_CONFIRMATION` |
| `recovery.html` | `https://app.quickicp.com/email-templates/recovery.html` | `MAILER_TEMPLATES_RECOVERY` |

Editing a template is not enough on its own: Nginx serves the copy baked into
the image at build time, so the frontend container has to be rebuilt before
GoTrue can see the change.
