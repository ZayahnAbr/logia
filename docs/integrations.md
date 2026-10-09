# Integrations setup: Google Docs sync, Word and OneDrive

Run `supabase/migration-45-doc-sync.sql` first (safe to re-run). It creates `oauth_tokens` (no direct access from the browser), the SECURITY DEFINER functions `set_oauth_token`, `get_oauth_token`, `oauth_token_status`, `delete_oauth_token`, and `note_doc_links` (owner-only RLS).

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `TOKEN_ENCRYPTION_KEY` | server | 32 random bytes, base64. Encrypts stored refresh tokens (AES-256-GCM). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it disconnects everyone. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | server | The same OAuth client Supabase uses for Google sign-in. Needed to turn a stored refresh token into an access token. Without them Google Docs shows "isn't set up". |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | browser | API key for the Google Picker. Without it, "Link to a Google Doc" shows a setup message; "Create a Google Doc from this note" still works. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | browser | Optional fallback for the Picker's project number if `GOOGLE_CLIENT_ID` is not set on the server. Same value. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | server | Azure app registration for OneDrive. |
| `MICROSOFT_TENANT` | server | `common` (work, school and personal accounts). |
| `MICROSOFT_REDIRECT_URI` | server | Optional. Overrides `<site address>/api/microsoft/callback`. |

Missing variables never break anything: the cards in Settings and the menus in a note say plainly that the integration isn't set up.

## Google Cloud (Google Docs sync)

Use the same Google Cloud project as Supabase Google sign-in.

1. APIs and Services, Library: enable **Google Docs API**, **Google Drive API** and **Google Picker API**.
2. OAuth consent screen, Data access (scopes): add `https://www.googleapis.com/auth/drive.file`. This scope only reaches files the person picks with the Picker or that Logia creates. It is a non-sensitive scope, so it does not need the heavier restricted-scope review.
3. Credentials, Create credentials, **API key**. Restrict it: Application restrictions, Websites (add `http://localhost:3000/*` and the production address); API restrictions, **Google Picker API** only. Put it in `NEXT_PUBLIC_GOOGLE_API_KEY`. It is public by design.
4. Use the existing OAuth 2.0 Client ID (Web application) that Supabase uses. Put its id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Its authorised redirect URI stays the Supabase callback (`https://<project>.supabase.co/auth/v1/callback`).
5. In Supabase, Authentication, Providers, Google must be enabled, and Authentication, Sign In / Providers, **Manual linking** must be on if people link Google to an existing account (same as Classroom). Add `http://localhost:3000/auth/callback` and the production `/auth/callback` to the Supabase redirect allow-list.
6. Until the app is verified, Google shows an "unverified app" warning and limits it to 100 test users. Add test users on the consent screen while testing.

How it works: Settings, Connected apps, Connect Google Docs runs Google OAuth through Supabase with `access_type=offline` and `prompt=consent`. `app/auth/callback/route.ts` (with `gdocs=1`) takes `provider_refresh_token`, encrypts it and stores it through `set_oauth_token`. The refresh token never goes to the browser. The Picker gets a short-lived access token from the server action `gdocsPickerToken`.

## Azure (OneDrive, Word import and export)

1. Azure portal, Microsoft Entra ID, App registrations, **New registration**. Name: Logia. Supported account types: accounts in any organizational directory and personal Microsoft accounts.
2. Redirect URI, platform **Web**: `http://localhost:3000/api/microsoft/callback`. After creating, Authentication, add the production address (`https://<your domain>/api/microsoft/callback`).
3. Certificates and secrets, **New client secret**. Copy the **Value** (not the id) into `MICROSOFT_CLIENT_SECRET`. It expires; note the date.
4. Overview: copy the Application (client) ID into `MICROSOFT_CLIENT_ID`.
5. API permissions, Add a permission, Microsoft Graph, **Delegated**: `Files.ReadWrite`, `offline_access`, `User.Read`. None need admin consent for personal accounts; some work or school tenants may require an administrator to approve `Files.ReadWrite`.
6. Set `MICROSOFT_TENANT=common`.

The flow is the authorization-code flow with PKCE, implemented in `app/api/microsoft/connect` and `app/api/microsoft/callback`. The state and verifier wait in a short-lived httpOnly cookie. Only the refresh token is stored, encrypted.

## What syncs and what does not

Google Docs (two way, live while a note is open): paragraphs, headings 1 to 3, bulleted and numbered list items (nesting is flattened to one level), bold, italic, underline, strikethrough and links. Pictures, tables, headers, footers, comments, suggestions, fonts, sizes, colours, highlights and page setup are never read or written. A Docs paragraph that contains a picture or other embedded object is left alone whole.

Word (one way each, no sync): import converts a `.docx` with the existing mammoth converter; export builds a `.docx` with the `docx` package (title, headings, paragraphs, lists, inline marks). Pictures and tables are not included. Edits made in Word are never brought back.
