import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { FacebookDebugTokenData, FacebookPage, FacebookUserIdentity, TokenDebugSummary } from "../types";
import { fromUnixSeconds } from "../utils/dates";

type OAuthAccessTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MeAccountsResponse = {
  data: FacebookPage[];
};

export class FacebookApiError extends Error {
  constructor(message: string, readonly status?: number, readonly payload?: unknown) {
    super(message);
  }
}

export class FacebookApi {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${config.facebookApiVersion}`,
      timeout: 15_000
    });
  }

  createLoginUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.facebookAppId,
      redirect_uri: config.facebookRedirectUri,
      response_type: "code",
      scope: [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "pages_manage_metadata",
        "business_management",
        "public_profile"
      ].join(","),
      state
    });
    return `https://www.facebook.com/${config.facebookApiVersion}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForShortLivedUserToken(code: string): Promise<OAuthAccessTokenResponse> {
    return this.fetchOAuthToken({
      client_id: config.facebookAppId,
      client_secret: config.facebookAppSecret,
      redirect_uri: config.facebookRedirectUri,
      code
    });
  }

  async exchangeShortLivedForLongLivedUserToken(shortLivedUserToken: string): Promise<OAuthAccessTokenResponse> {
    return this.fetchOAuthToken({
      grant_type: "fb_exchange_token",
      client_id: config.facebookAppId,
      client_secret: config.facebookAppSecret,
      fb_exchange_token: shortLivedUserToken
    });
  }

  async getMe(accessToken: string): Promise<FacebookUserIdentity> {
    try {
      const response = await this.client.get<FacebookUserIdentity>("/me", {
        params: {
          fields: "id,name",
          access_token: accessToken
        }
      });
      return response.data;
    } catch (error) {
      throw this.wrapError("Failed to validate Facebook token via /me", error);
    }
  }

  async debugToken(inputToken: string): Promise<FacebookDebugTokenData> {
    const appAccessToken = `${config.facebookAppId}|${config.facebookAppSecret}`;
    try {
      const response = await this.client.get<{ data: FacebookDebugTokenData }>("/debug_token", {
        params: {
          input_token: inputToken,
          access_token: appAccessToken
        }
      });
      return response.data.data;
    } catch (error) {
      throw this.wrapError("Failed to debug Facebook token", error);
    }
  }

  async validateUserToken(accessToken: string): Promise<{
    user: FacebookUserIdentity;
    debug: TokenDebugSummary;
    expiresAt: Date | null;
  }> {
    const [user, debugRaw] = await Promise.all([
      this.getMe(accessToken),
      this.debugToken(accessToken)
    ]);

    const type = debugRaw.type ?? null;
    if (type === "PAGE") {
      throw new Error("Expected Facebook User Token but received Facebook Page Token.");
    }

    return {
      user,
      debug: {
        is_valid: Boolean(debugRaw.is_valid),
        expires_at: debugRaw.expires_at ?? null,
        scopes: debugRaw.scopes ?? [],
        type,
        app_id: debugRaw.app_id ?? null,
        user_id: debugRaw.user_id ?? null
      },
      expiresAt: fromUnixSeconds(debugRaw.expires_at ?? null)
    };
  }

  async getManagedPages(longLivedUserToken: string): Promise<FacebookPage[]> {
    try {
      const response = await this.client.get<MeAccountsResponse>("/me/accounts", {
        params: {
          access_token: longLivedUserToken
        }
      });
      return response.data.data ?? [];
    } catch (error) {
      throw this.wrapError("Failed to fetch managed Facebook pages", error);
    }
  }

  private async fetchOAuthToken(params: Record<string, string>): Promise<OAuthAccessTokenResponse> {
    try {
      const response = await this.client.get<OAuthAccessTokenResponse>("/oauth/access_token", {
        params
      });
      return response.data;
    } catch (error) {
      throw this.wrapError("Failed to exchange Facebook OAuth token", error);
    }
  }

  private wrapError(message: string, error: unknown): FacebookApiError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const payload = error.response?.data;
      return new FacebookApiError(message, status, payload);
    }
    return new FacebookApiError(message, undefined, error);
  }
}
