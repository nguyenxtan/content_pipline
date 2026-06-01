import { PoolClient } from "pg";
import { FacebookApi } from "./facebook-api";
import { withTransaction, pool } from "../db";
import { FacebookPage, TokenDebugSummary } from "../types";
import { daysUntil, fromUnixSeconds, isoOrNull } from "../utils/dates";
import { maskToken } from "../utils/token-mask";
import { createAuthState } from "../utils/state";
import {
  listPages,
  listTokens,
  listTokensForMonitoring,
  markTokenMonitoringState,
  upsertPage,
  upsertToken,
  upsertUser
} from "../repositories/token-repository";
import { config } from "../config";

type SyncInput =
  | { code: string; shortLivedUserToken?: never }
  | { code?: never; shortLivedUserToken: string };

export class TokenManagerService {
  private readonly facebook = new FacebookApi();

  createLoginUrl() {
    const state = createAuthState();
    return {
      state,
      loginUrl: this.facebook.createLoginUrl(state),
      requiredPermissions: [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "pages_manage_metadata",
        "business_management",
        "public_profile"
      ]
    };
  }

  async handleOAuthCallback(code: string) {
    return this.syncTokens({ code });
  }

  async refreshFromShortLivedToken(shortLivedUserToken: string) {
    return this.syncTokens({ shortLivedUserToken });
  }

  async refreshFromCode(code: string) {
    return this.syncTokens({ code });
  }

  async syncTokens(input: SyncInput) {
    const shortLived = input.code
      ? await this.facebook.exchangeCodeForShortLivedUserToken(input.code)
      : { access_token: input.shortLivedUserToken };
    if (!shortLived.access_token) {
      throw new Error("Facebook did not return a short-lived user token.");
    }

    const longLived = await this.facebook.exchangeShortLivedForLongLivedUserToken(shortLived.access_token);
    if (!longLived.access_token) {
      throw new Error("Facebook did not return a long-lived user token.");
    }
    const validated = await this.facebook.validateUserToken(longLived.access_token);
    const pages = await this.facebook.getManagedPages(longLived.access_token);
    const pageDebugInfo = await Promise.all(
      pages.map(async (page) => ({
        page,
        debug: await this.facebook.debugToken(page.access_token)
      }))
    );

    const summary = await withTransaction(async (client) => {
      const user = await upsertUser(client, {
        facebookUserId: validated.user.id,
        name: validated.user.name
      });

      await this.persistLongLivedUserToken(client, user.id, longLived.access_token, validated.debug, validated.expiresAt);

      for (const item of pageDebugInfo) {
        await this.persistPage(client, user.id, item.page, item.debug);
      }

      return {
        generatedAt: new Date().toISOString(),
        user: {
          id: validated.user.id,
          name: validated.user.name
        },
        longLivedUserToken: {
          masked: maskToken(longLived.access_token),
          expiresAt: isoOrNull(validated.expiresAt),
          expiresInDays: validated.expiresAt ? daysUntil(validated.expiresAt) : null
        },
        pages: pageDebugInfo.map(({ page, debug }) => ({
          id: page.id,
          name: page.name,
          category: page.category ?? null,
          tasks: page.tasks ?? [],
          accessTokenMasked: maskToken(page.access_token),
          debug: {
            is_valid: Boolean(debug.is_valid),
            expires_at: debug.expires_at ?? null,
            scopes: debug.scopes ?? [],
            type: debug.type ?? null
          }
        })),
        note:
          "Long-lived Facebook Page Access Tokens which may still expire, be revoked, or become invalid due to Meta security policies, permission changes, password resets, admin removal, or app restrictions."
      };
    });

    return summary;
  }

  async getPages() {
    const client = await pool.connect();
    try {
      return await listPages(client);
    } finally {
      client.release();
    }
  }

  async getTokens() {
    const client = await pool.connect();
    try {
      return await listTokens(client);
    } finally {
      client.release();
    }
  }

  async runExpiryMonitor() {
    return withTransaction(async (client) => {
      const tokens = await listTokensForMonitoring(client);
      const warnings: Array<{ tokenId: string; tokenType: string; message: string }> = [];

      for (const token of tokens) {
        if (!token.expiresAt) {
          await markTokenMonitoringState(client, token.id, {
            isExpiring: false,
            warningMessage: null
          });
          continue;
        }

        const remainingDays = daysUntil(token.expiresAt);
        if (remainingDays < config.tokenWarningDays) {
          const message =
            `Token ${token.tokenType} will expire in ${remainingDays} day(s). ` +
            `Reconnect Facebook and refresh all page tokens before expiry.`;
          warnings.push({
            tokenId: token.id,
            tokenType: token.tokenType,
            message
          });
          await markTokenMonitoringState(client, token.id, {
            isExpiring: true,
            warningMessage: message
          });
        } else {
          await markTokenMonitoringState(client, token.id, {
            isExpiring: false,
            warningMessage: null
          });
        }
      }

      return warnings;
    });
  }

  private async persistLongLivedUserToken(
    client: PoolClient,
    userId: string,
    token: string,
    debug: TokenDebugSummary,
    expiresAt: Date | null
  ) {
    await upsertToken(client, {
      userId,
      tokenType: "long_lived_user_token",
      token,
      expiresAt,
      isValid: debug.is_valid,
      debugType: debug.type,
      appId: debug.app_id,
      externalUserId: debug.user_id,
      scopes: debug.scopes,
      isExpiring: Boolean(expiresAt && daysUntil(expiresAt) < config.tokenWarningDays),
      warningMessage:
        expiresAt && daysUntil(expiresAt) < config.tokenWarningDays
          ? `Long-lived user token expires soon. Reconnect Facebook and refresh tokens.`
          : null
    });
  }

  private async persistPage(
    client: PoolClient,
    userId: string,
    page: FacebookPage,
    debug: Record<string, unknown>
  ) {
    await upsertPage(client, {
      userId,
      pageId: page.id,
      pageName: page.name,
      category: page.category,
      tasks: page.tasks ?? [],
      pageAccessToken: page.access_token
    });

    const expiresAt = fromUnixSeconds(typeof debug.expires_at === "number" ? debug.expires_at : null);
    const scopes = Array.isArray(debug.scopes) ? debug.scopes.filter((value): value is string => typeof value === "string") : [];

    await upsertToken(client, {
      userId,
      pageId: page.id,
      tokenType: "page_access_token",
      token: page.access_token,
      expiresAt,
      isValid: Boolean(debug.is_valid),
      debugType: typeof debug.type === "string" ? debug.type : null,
      appId: typeof debug.app_id === "string" ? debug.app_id : null,
      externalUserId: typeof debug.user_id === "string" ? debug.user_id : null,
      scopes,
      isExpiring: Boolean(expiresAt && daysUntil(expiresAt) < config.tokenWarningDays),
      warningMessage:
        expiresAt && daysUntil(expiresAt) < config.tokenWarningDays
          ? "Long-lived Facebook Page Access Token is approaching expiry or refresh threshold. Reconnect Facebook and refresh page tokens."
          : null
    });
  }
}
