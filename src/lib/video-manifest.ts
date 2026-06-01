import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VideoManifest = {
  // Identity
  id: string;
  platform: "youtube" | "facebook" | "both";
  videoType: "short" | "long";
  createdAt: string; // ISO-8601

  // Content
  topic: string;
  nicheName: string;
  hook: string;
  script: string;
  title: string;
  thumbnailText: string;

  // Paths
  imagePaths: string[];
  audioPath: string;
  videoPath: string;
  thumbnailPath: string;

  // Timing & model
  durationSec: number;
  renderTimeTotalMs: number;
  mainModelUsed: string;

  // Status
  status: string;

  // Analytics (populated later when platform data is available)
  analytics: {
    views: number | null;
    ctr: number | null;
    avgViewDurationSec: number | null;
    retentionPct: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    fetchedAt: string | null;
  };
};

// ─── Manifest directory ───────────────────────────────────────────────────────

const MANIFEST_DIR = path.join(process.cwd(), "output", "manifests");

function manifestPath(id: string): string {
  return path.join(MANIFEST_DIR, `${id}.json`);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function writeVideoManifest(manifest: VideoManifest): string {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const filePath = manifestPath(manifest.id);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
  return filePath;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function readVideoManifest(id: string): VideoManifest | null {
  const filePath = manifestPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as VideoManifest;
  } catch {
    return null;
  }
}

// ─── Update analytics ─────────────────────────────────────────────────────────

export function updateManifestAnalytics(
  id: string,
  analytics: Partial<VideoManifest["analytics"]>,
): VideoManifest | null {
  const manifest = readVideoManifest(id);
  if (!manifest) return null;
  manifest.analytics = { ...manifest.analytics, ...analytics };
  writeVideoManifest(manifest);
  return manifest;
}

// ─── List all ────────────────────────────────────────────────────────────────

export function listManifests(): VideoManifest[] {
  if (!fs.existsSync(MANIFEST_DIR)) return [];
  return fs
    .readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), "utf-8")) as VideoManifest;
      } catch {
        return null;
      }
    })
    .filter((m): m is VideoManifest => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Build from contentGeneration DB row ──────────────────────────────────────

export function buildManifestFromGeneration(params: {
  id: string;
  topic: string;
  nicheName: string;
  hook: string;
  script: string;
  title: string;
  thumbnailText: string;
  imagePaths: string[];
  audioPath: string;
  videoPath: string;
  thumbnailPath: string;
  durationSec: number;
  renderTimeTotalMs: number;
  mainModelUsed: string;
  platform: "youtube" | "facebook" | "both";
  videoType: "short" | "long";
  status: string;
  createdAt: Date;
}): VideoManifest {
  return {
    id: params.id,
    platform: params.platform,
    videoType: params.videoType,
    createdAt: params.createdAt.toISOString(),
    topic: params.topic,
    nicheName: params.nicheName,
    hook: params.hook,
    script: params.script,
    title: params.title,
    thumbnailText: params.thumbnailText,
    imagePaths: params.imagePaths,
    audioPath: params.audioPath,
    videoPath: params.videoPath,
    thumbnailPath: params.thumbnailPath,
    durationSec: params.durationSec,
    renderTimeTotalMs: params.renderTimeTotalMs,
    mainModelUsed: params.mainModelUsed,
    status: params.status,
    analytics: {
      views: null,
      ctr: null,
      avgViewDurationSec: null,
      retentionPct: null,
      likes: null,
      comments: null,
      shares: null,
      fetchedAt: null,
    },
  };
}
