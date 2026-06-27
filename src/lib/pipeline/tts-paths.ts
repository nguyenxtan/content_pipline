import fs from "fs";
import path from "path";

const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const DEFAULT_TTS_CONTAINER_AUDIO_DIR = "/media/audio";

export function toContainerAudioPath(hostPath: string): string {
  const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? DEFAULT_TTS_CONTAINER_AUDIO_DIR;
  const rel = path.relative(AUDIO_DIR, hostPath);
  if (rel.startsWith("..")) return hostPath;
  return path.posix.join(containerAudioDir, rel.replace(/\\/g, "/"));
}

export function resolveAudioPathForHost(filePath: string): string {
  if (!filePath) return filePath;

  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }

  const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? DEFAULT_TTS_CONTAINER_AUDIO_DIR;
  if (containerAudioDir && path.posix.isAbsolute(filePath) && filePath.startsWith(containerAudioDir)) {
    const rel = path.posix.relative(containerAudioDir, filePath);
    return path.join(AUDIO_DIR, rel);
  }

  return path.join(process.cwd(), filePath.replace(/^\/+/, ""));
}
