import crypto from "node:crypto";
import { config } from "../config";

type AuthStatePayload = {
  issuedAt: number;
  nonce: string;
};

function sign(payloadBase64: string): string {
  return crypto.createHmac("sha256", config.stateSigningSecret).update(payloadBase64).digest("base64url");
}

export function createAuthState(): string {
  const payload: AuthStatePayload = {
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex")
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAuthState(state: string): AuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid OAuth state format.");
  }
  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid OAuth state signature.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AuthStatePayload;
  if (Date.now() - payload.issuedAt > 15 * 60 * 1000) {
    throw new Error("OAuth state expired.");
  }
  return payload;
}
