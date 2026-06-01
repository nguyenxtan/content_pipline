import { PoolClient } from "pg";
import { decryptToken, encryptToken } from "../services/crypto-service";
import { StoredPageView, StoredTokenView, TokenDebugSummary } from "../types";
import { maskToken } from "../utils/token-mask";

type PersistUserInput = {
  facebookUserId: string;
  name: string;
};

type PersistPageInput = {
  userId: string;
  pageId: string;
  pageName: string;
  category?: string;
  tasks: string[];
  pageAccessToken: string;
};

type PersistTokenInput = {
  userId?: string;
  pageId?: string;
  tokenType: string;
  token: string;
  expiresAt: Date | null;
  isValid: boolean;
  debugType: string | null;
  appId: string | null;
  externalUserId: string | null;
  scopes: string[];
  warningMessage?: string | null;
  isExpiring?: boolean;
};

export async function upsertUser(client: PoolClient, input: PersistUserInput): Promise<{ id: string; facebookUserId: string; name: string }> {
  const result = await client.query(
    `
      INSERT INTO users (facebook_user_id, name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (facebook_user_id)
      DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id, facebook_user_id, name
    `,
    [input.facebookUserId, input.name]
  );
  return {
    id: result.rows[0].id,
    facebookUserId: result.rows[0].facebook_user_id,
    name: result.rows[0].name
  };
}

export async function upsertPage(client: PoolClient, input: PersistPageInput): Promise<void> {
  await client.query(
    `
      INSERT INTO pages (page_id, user_id, page_name, category, page_access_token, tasks, last_refresh_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
      ON CONFLICT (page_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        page_name = EXCLUDED.page_name,
        category = EXCLUDED.category,
        page_access_token = EXCLUDED.page_access_token,
        tasks = EXCLUDED.tasks,
        last_refresh_at = NOW(),
        updated_at = NOW()
    `,
    [
      input.pageId,
      input.userId,
      input.pageName,
      input.category ?? null,
      encryptToken(input.pageAccessToken),
      JSON.stringify(input.tasks ?? [])
    ]
  );
}

export async function upsertToken(client: PoolClient, input: PersistTokenInput): Promise<void> {
  const ownerKey = input.pageId
    ? `${input.tokenType}:page:${input.pageId}`
    : `${input.tokenType}:user:${input.userId ?? "global"}`;
  await client.query(
    `
      INSERT INTO tokens (
        user_id, page_id, owner_key, token_type, token, expires_at, is_valid, is_expiring,
        last_checked_at, warning_message, debug_type, app_id, external_user_id, scopes, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12, $13::jsonb, NOW())
      ON CONFLICT (owner_key)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        page_id = EXCLUDED.page_id,
        token = EXCLUDED.token,
        token_type = EXCLUDED.token_type,
        expires_at = EXCLUDED.expires_at,
        is_valid = EXCLUDED.is_valid,
        is_expiring = EXCLUDED.is_expiring,
        last_checked_at = NOW(),
        warning_message = EXCLUDED.warning_message,
        debug_type = EXCLUDED.debug_type,
        app_id = EXCLUDED.app_id,
        external_user_id = EXCLUDED.external_user_id,
        scopes = EXCLUDED.scopes,
        updated_at = NOW()
    `,
    [
      input.userId ?? null,
      input.pageId ?? null,
      ownerKey,
      input.tokenType,
      encryptToken(input.token),
      input.expiresAt ? input.expiresAt.toISOString() : null,
      input.isValid,
      input.isExpiring ?? false,
      input.warningMessage ?? null,
      input.debugType,
      input.appId,
      input.externalUserId,
      JSON.stringify(input.scopes ?? [])
    ]
  );
}

export async function listPages(client: PoolClient): Promise<StoredPageView[]> {
  const result = await client.query(
    `
      SELECT page_id, page_name, category, page_access_token, tasks, last_refresh_at
      FROM pages
      ORDER BY page_name ASC
    `
  );
      return result.rows.map((row) => ({
    pageId: row.page_id,
    pageName: row.page_name,
    category: row.category,
    tasks: row.tasks ?? [],
    lastRefreshAt: row.last_refresh_at.toISOString(),
    maskedPageAccessToken: maskToken(decryptToken(row.page_access_token))
  }));
}

export async function listTokens(client: PoolClient): Promise<StoredTokenView[]> {
  const result = await client.query(
    `
      SELECT id, token_type, user_id, page_id, token, expires_at, is_valid, is_expiring,
             warning_message, debug_type, app_id, external_user_id, scopes, last_checked_at
      FROM tokens
      ORDER BY updated_at DESC
    `
  );
      return result.rows.map((row) => ({
    id: row.id,
    tokenType: row.token_type,
    pageId: row.page_id,
    userId: row.user_id,
    maskedToken: maskToken(decryptToken(row.token)),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    isValid: row.is_valid,
    isExpiring: row.is_expiring,
    warningMessage: row.warning_message,
    debugType: row.debug_type,
    appId: row.app_id,
    externalUserId: row.external_user_id,
    scopes: row.scopes ?? [],
    lastCheckedAt: row.last_checked_at ? row.last_checked_at.toISOString() : null
  }));
}

export async function listTokensForMonitoring(client: PoolClient): Promise<Array<{
  id: string;
  tokenType: string;
  expiresAt: Date | null;
  pageId: string | null;
  userId: string | null;
}>> {
  const result = await client.query(
    `
      SELECT id, token_type, expires_at, page_id, user_id
      FROM tokens
      WHERE is_valid = TRUE
    `
  );
  return result.rows.map((row) => ({
    id: row.id,
    tokenType: row.token_type,
    expiresAt: row.expires_at,
    pageId: row.page_id,
    userId: row.user_id
  }));
}

export async function markTokenMonitoringState(
  client: PoolClient,
  tokenId: string,
  args: { isExpiring: boolean; warningMessage: string | null }
): Promise<void> {
  await client.query(
    `
      UPDATE tokens
      SET is_expiring = $2,
          warning_message = $3,
          last_checked_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [tokenId, args.isExpiring, args.warningMessage]
  );
}
