# facebook-page-token-manager

Standalone TypeScript service for managing Facebook OAuth login, Long-Lived User Tokens, and Long-Lived Facebook Page Access Tokens.

Important note:

This service does **not** describe Page tokens as permanently valid. It treats them as:

> Long-lived Facebook Page Access Tokens which may still expire, be revoked, or become invalid due to Meta security policies, permission changes, password resets, admin removal, or app restrictions.

## Features

- Facebook OAuth Login
- Short-lived User Token -> Long-lived User Token exchange
- User token validation via `/me`
- Guard against Page token misuse:
  - returns `Expected Facebook User Token but received Facebook Page Token.`
- Managed Pages fetch via `/me/accounts`
- Page token inspection via `/debug_token`
- PostgreSQL persistence
- AES-256-GCM token encryption at rest
- Token masking in API responses and logs
- Daily expiry monitor
- Reconnect and refresh workflow

## Folder Structure

```text
facebook-page-token-manager/
  src/
    config.ts
    db.ts
    routes.ts
    server.ts
    types.ts
    repositories/
      token-repository.ts
    services/
      crypto-service.ts
      facebook-api.ts
      scheduler.ts
      token-manager.ts
    utils/
      dates.ts
      state.ts
      token-mask.ts
  sql/
    schema.sql
  .env.example
  Dockerfile
  docker-compose.yml
  package.json
  tsconfig.json
```

## Required Facebook Permissions

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `pages_manage_metadata`
- `business_management`
- `public_profile`

## Environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:

- `DATABASE_URL`
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `FACEBOOK_REDIRECT_URI`
- `TOKEN_ENCRYPTION_KEY_BASE64`
- `STATE_SIGNING_SECRET`

### Generate a 32-byte encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database Setup

Run the SQL schema:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

## Local Development

Install dependencies:

```bash
npm install
```

Start in watch mode:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run production build:

```bash
npm run start
```

## Docker

Build and run:

```bash
docker compose up --build
```

The service listens on:

- `http://localhost:4001`

## API

### `POST /auth/facebook`

Returns a Facebook Login URL and signed OAuth state.

Response example:

```json
{
  "state": "signed-state",
  "loginUrl": "https://www.facebook.com/v25.0/dialog/oauth?...",
  "requiredPermissions": [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_metadata",
    "business_management",
    "public_profile"
  ]
}
```

### `GET /auth/facebook/callback`

Facebook OAuth callback endpoint. Exchanges code -> short-lived user token -> long-lived user token, fetches managed pages, debugs page tokens, stores everything in PostgreSQL, and returns a masked summary.

### `POST /refresh`

Manual reconnect endpoint. Requires a fresh short-lived user token:

```json
{
  "shortLivedUserToken": "EAAB..."
}
```

This endpoint:

1. Exchanges the short-lived user token for a long-lived user token.
2. Validates that the token belongs to a Facebook User.
3. Fetches all managed pages.
4. Refreshes stored page tokens and metadata.

### `GET /pages`

Lists stored pages with masked page tokens.

### `GET /tokens`

Lists stored tokens with:

- masked token
- expiry
- validity
- scopes
- debug type
- warning state

### `GET /health`

Basic service and database health check.

## Expiry Monitoring

The service runs a daily monitor.

If a token expires in fewer than `TOKEN_WARNING_DAYS` days:

- it prints a warning
- marks the token as expiring in the database
- exposes that state through `GET /tokens`

For refresh planning, use the reconnect flow before expiry. Meta can still revoke tokens earlier than the reported expiry time.

## Security Notes

- App Secret is never printed in logs.
- Tokens are masked in console output and API responses.
- Full tokens are encrypted before storage.
- Full tokens are only sent to Meta APIs and stored encrypted in PostgreSQL.

## Production Notes

- Page tokens should be treated as long-lived, not permanent.
- Meta can still invalidate tokens due to:
  - security checks
  - password resets
  - admin removal
  - permission changes
  - app restrictions
  - inactivity or policy enforcement

## n8n / External Automation Compatibility

This service is standalone. It does not depend on n8n, Zapier, Make, or any workflow automation platform.

It can still be used *by* those tools through standard HTTP endpoints if you choose to integrate later.
