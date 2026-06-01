export type FacebookDebugTokenData = {
  app_id?: string;
  type?: string;
  application?: string;
  data_access_expires_at?: number;
  expires_at?: number;
  is_valid?: boolean;
  issued_at?: number;
  profile_id?: string;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  user_id?: string;
  error?: { code?: number; message?: string };
};

export type FacebookUserIdentity = {
  id: string;
  name: string;
};

export type FacebookPage = {
  id: string;
  name: string;
  category?: string;
  tasks?: string[];
  access_token: string;
};

export type TokenDebugSummary = {
  is_valid: boolean;
  expires_at: number | null;
  scopes: string[];
  type: string | null;
  app_id: string | null;
  user_id: string | null;
};

export type StoredPageView = {
  pageId: string;
  pageName: string;
  category: string | null;
  tasks: string[];
  lastRefreshAt: string;
  maskedPageAccessToken: string;
};

export type StoredTokenView = {
  id: string;
  tokenType: string;
  pageId: string | null;
  userId: string | null;
  maskedToken: string;
  expiresAt: string | null;
  isValid: boolean;
  isExpiring: boolean;
  warningMessage: string | null;
  debugType: string | null;
  appId: string | null;
  externalUserId: string | null;
  scopes: string[];
  lastCheckedAt: string | null;
};
