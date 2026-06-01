import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "cp_session";
const PUBLIC_PATHS = ["/login", "/api/cron"];

// Use Web Crypto API (Edge Runtime compatible)
async function verifyToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.AUTH_SECRET ?? "fallback-secret";
    const lastDot = token.lastIndexOf(".");
    if (lastDot === -1) return false;

    const value = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Re-sign to compare
    const signedBuf = await crypto.subtle.sign(
      "HMAC",
      keyMaterial,
      encoder.encode(value)
    );
    const computed = Array.from(new Uint8Array(signedBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computed === sig;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
