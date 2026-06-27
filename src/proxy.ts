import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "cp_session";
const PUBLIC_PATHS = [
  "/login",
  "/api/cron",
  "/api/admin",
  "/api/telegram",
  // Audio streams — served from protected admin pages; <audio> elements don't reliably
  // forward session cookies in all browsers, causing 307→HTML → silent playback failure.
  // Access is gated by opaque asset UUID (story-audio-assets) or content-UUID (tts/stream),
  // not guessable paths. Admin UI access already requires auth.
  "/api/tts/stream",
  "/api/story-audio-assets",
  // Local-only file-based artifact preview (F4.38.6) — scoped strictly to
  // media/story-audio/ with path-traversal and extension allowlisting in
  // the route itself; not a generic file server. Admin UI access already
  // requires auth, same rationale as the entries above.
  "/api/story-audio-local",
  // Local-only render-preview video (F4.38.6+) — same model, scoped to
  // media/story-renders/ and .mp4 only.
  "/api/story-render-local",
];

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
