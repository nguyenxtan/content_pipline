import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}`);
  }
  return parsed;
}

export const config = {
  port: parsePositiveInt("PORT", 4001),
  databaseUrl: getEnv("DATABASE_URL"),
  facebookAppId: getEnv("FACEBOOK_APP_ID"),
  facebookAppSecret: getEnv("FACEBOOK_APP_SECRET"),
  facebookRedirectUri: getEnv("FACEBOOK_REDIRECT_URI"),
  facebookApiVersion: getEnv("FACEBOOK_API_VERSION", "v25.0"),
  tokenEncryptionKeyBase64: getEnv("TOKEN_ENCRYPTION_KEY_BASE64"),
  tokenWarningDays: parsePositiveInt("TOKEN_WARNING_DAYS", 14),
  tokenMonitorIntervalMs: parsePositiveInt("TOKEN_MONITOR_INTERVAL_MS", 24 * 60 * 60 * 1000),
  stateSigningSecret: getEnv("STATE_SIGNING_SECRET")
};
