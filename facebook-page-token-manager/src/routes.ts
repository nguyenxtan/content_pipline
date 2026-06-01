import { Router } from "express";
import { TokenManagerService } from "./services/token-manager";
import { verifyAuthState } from "./utils/state";
import { pool } from "./db";

const service = new TokenManagerService();
export const router = Router();

router.post("/auth/facebook", async (_req, res, next) => {
  try {
    res.json(service.createLoginUrl());
  } catch (error) {
    next(error);
  }
});

router.get("/auth/facebook/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "Missing code or state." });
      return;
    }
    verifyAuthState(state);
    const summary = await service.handleOAuthCallback(code);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get("/pages", async (_req, res, next) => {
  try {
    res.json({
      note:
        "Long-lived Facebook Page Access Tokens which may still expire, be revoked, or become invalid due to Meta security policies, permission changes, password resets, admin removal, or app restrictions.",
      pages: await service.getPages()
    });
  } catch (error) {
    next(error);
  }
});

router.get("/tokens", async (_req, res, next) => {
  try {
    res.json({
      tokens: await service.getTokens()
    });
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const code = req.body?.code;
    const shortLivedUserToken = req.body?.shortLivedUserToken;
    if (typeof code === "string" && code.trim() !== "") {
      const summary = await service.refreshFromCode(code);
      res.json({
        ...summary,
        refreshInstructions:
          "If the long-lived user token is within 14 days of expiry, reconnect Facebook Login and POST /refresh with a new code or short-lived user token."
      });
      return;
    }
    if (typeof shortLivedUserToken !== "string" || shortLivedUserToken.trim() === "") {
      res.status(400).json({ error: "code or shortLivedUserToken is required." });
      return;
    }
    const summary = await service.refreshFromShortLivedToken(shortLivedUserToken);
    res.json({
      ...summary,
      refreshInstructions:
        "If the long-lived user token is within 14 days of expiry, reconnect Facebook Login and POST /refresh with a new short-lived user token."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/health", async (_req, res, next) => {
  try {
    const dbResult = await pool.query("SELECT 1");
    res.json({
      ok: true,
      db: dbResult.rowCount === 1 ? "up" : "unknown",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});
