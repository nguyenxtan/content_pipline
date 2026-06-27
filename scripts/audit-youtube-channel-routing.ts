import "dotenv/config";

import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";

type Args = {
  failOnViolation: boolean;
};

type DestinationRow = {
  id: number;
  channel_key: string;
  name: string;
  platform_channel_id: string | null;
  oauth_client_config_id: number | null;
  is_active: boolean;
  access_token: string | null;
  refresh_token: string | null;
};

type QueueRow = {
  queue_id: string;
  content_id: string;
  content_channel_key: string | null;
  format_type: string | null;
  platform: string;
  video_type: string;
  status: string;
  scheduled_at: string;
  social_channel_id: number | null;
  social_channel_key: string | null;
  social_channel_name: string | null;
  platform_channel_id: string | null;
  oauth_client_config_id: number | null;
  access_token: string | null;
  refresh_token: string | null;
};

type Verdict =
  | "ok"
  | "channel_key_mismatch"
  | "missing_social_channel_id"
  | "missing_external_channel_id"
  | "missing_credential"
  | "ambiguous_shared_credential";

function parseArgs(argv: string[]): Args {
  let failOnViolation = false;
  for (const arg of argv) {
    if (arg === "--fail-on-violation") {
      failOnViolation = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { failOnViolation };
}

function formatVn(value: string | Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildCredentialFingerprint(row: {
  oauth_client_config_id: number | null;
  refresh_token: string | null;
  access_token: string | null;
}): string | null {
  const tokenSource = row.refresh_token ?? row.access_token ?? null;
  if (!tokenSource) return null;
  const tokenHash = crypto.createHash("sha256").update(tokenSource).digest("hex").slice(0, 8);
  const clientLabel = row.oauth_client_config_id == null
    ? "env-default"
    : `oauth-client-${row.oauth_client_config_id}`;
  return `${clientLabel}/token:${tokenHash}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const [destinationsResult, queueRowsResult] = await Promise.all([
      pool.query<DestinationRow>(`
        select
          sc.id,
          sc.channel_key,
          sc.name,
          sc.platform_channel_id,
          sc.oauth_client_config_id,
          sc.is_active,
          sc.access_token,
          sc.refresh_token
        from social_channels sc
        where sc.platform = 'youtube'
        order by sc.channel_key asc, sc.id asc
      `),
      pool.query<QueueRow>(`
        select
          q.id as queue_id,
          q.content_id,
          c.channel_key as content_channel_key,
          c.format_type,
          q.platform,
          q.video_type,
          q.status,
          q.scheduled_at,
          sc.id as social_channel_id,
          sc.channel_key as social_channel_key,
          sc.name as social_channel_name,
          sc.platform_channel_id,
          sc.oauth_client_config_id,
          sc.access_token,
          sc.refresh_token
        from upload_queue q
        join content_generations c on c.id = q.content_id
        left join social_channels sc on sc.id = q.channel_id
        where q.platform = 'youtube'
          and q.status in ('queued', 'uploading', 'pending')
          and q.scheduled_at >= now()
        order by q.scheduled_at asc, q.id asc
      `),
    ]);

    const destinations = destinationsResult.rows;
    const queueRows = queueRowsResult.rows;

    const sharedCredentialGroups = new Map<string, DestinationRow[]>();
    for (const destination of destinations.filter((row) => row.is_active)) {
      const fingerprint = buildCredentialFingerprint(destination);
      if (!fingerprint) continue;
      const group = sharedCredentialGroups.get(fingerprint) ?? [];
      group.push(destination);
      sharedCredentialGroups.set(fingerprint, group);
    }

    const sharedGroups = Array.from(sharedCredentialGroups.entries())
      .map(([credentialFingerprint, rows]) => ({
        credentialFingerprint,
        destinationIds: rows.map((row) => row.id),
        destinationNames: rows.map((row) => row.name),
        channelKeys: Array.from(new Set(rows.map((row) => row.channel_key))),
        platformChannelIds: Array.from(new Set(rows.map((row) => row.platform_channel_id).filter(Boolean))),
      }))
      .filter((group) => group.platformChannelIds.length > 1);

    const verdictRows = queueRows.map((row) => {
      const credentialFingerprint = buildCredentialFingerprint(row);
      const ambiguousSharedCredential = credentialFingerprint
        ? sharedGroups.some((group) => group.credentialFingerprint === credentialFingerprint)
        : false;

      let verdict: Verdict = "ok";
      if (!row.social_channel_id) {
        verdict = "missing_social_channel_id";
      } else if (!row.platform_channel_id) {
        verdict = "missing_external_channel_id";
      } else if (!row.access_token && !row.refresh_token) {
        verdict = "missing_credential";
      } else if ((row.social_channel_key ?? null) !== (row.content_channel_key ?? null)) {
        verdict = "channel_key_mismatch";
      } else if (ambiguousSharedCredential) {
        verdict = "ambiguous_shared_credential";
      }

      return {
        queueId: row.queue_id,
        contentId: row.content_id,
        contentChannelKey: row.content_channel_key,
        destinationSocialChannelId: row.social_channel_id,
        destinationChannelKey: row.social_channel_key,
        destinationName: row.social_channel_name,
        externalYouTubeChannelId: row.platform_channel_id,
        credentialId: credentialFingerprint ?? (row.oauth_client_config_id == null ? "env-default/no-token" : `oauth-client-${row.oauth_client_config_id}/no-token`),
        scheduledAtUtc: new Date(row.scheduled_at).toISOString(),
        scheduledAtVn: formatVn(row.scheduled_at),
        status: row.status,
        formatType: row.format_type,
        verdict,
      };
    });

    const summary = {
      activeYouTubeDestinations: destinations.filter((row) => row.is_active).length,
      queueRowsScanned: verdictRows.length,
      ok: verdictRows.filter((row) => row.verdict === "ok").length,
      violations: verdictRows.filter((row) => row.verdict !== "ok").length,
      sharedCredentialGroups: sharedGroups.length,
    };

    console.log(JSON.stringify({
      summary,
      activeDestinations: destinations
        .filter((row) => row.is_active)
        .map((row) => ({
          id: row.id,
          channelKey: row.channel_key,
          name: row.name,
          externalYouTubeChannelId: row.platform_channel_id,
          oauthClientConfigId: row.oauth_client_config_id,
          credentialId: buildCredentialFingerprint(row) ?? (row.oauth_client_config_id == null ? "env-default/no-token" : `oauth-client-${row.oauth_client_config_id}/no-token`),
        })),
      sharedCredentialGroups: sharedGroups,
      queueRows: verdictRows,
    }, null, 2));

    if (args.failOnViolation && summary.violations > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
