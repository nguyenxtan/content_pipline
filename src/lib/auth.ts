import { cookies } from "next/headers";

const COOKIE_NAME = "cp_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Server-side HMAC using Node.js crypto (runs in Node.js runtime, not Edge)
async function signValue(value: string): Promise<string> {
  const { createHmac } = await import("crypto");
  const secret = process.env.AUTH_SECRET ?? "fallback-secret";
  const hmac = createHmac("sha256", secret);
  hmac.update(value);
  return `${value}.${hmac.digest("hex")}`;
}

export async function createSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = await signValue(`authenticated.${Date.now()}`);
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;

  // Recompute the HMAC to verify
  const { createHmac } = await import("crypto");
  const secret = process.env.AUTH_SECRET ?? "fallback-secret";
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;
  const value = token.slice(0, lastDot);
  const hmac = createHmac("sha256", secret);
  hmac.update(value);
  const expected = `${value}.${hmac.digest("hex")}`;
  return token === expected;
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return password === expected;
}
