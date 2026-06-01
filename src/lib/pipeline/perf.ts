import os from "os";

export function isAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

export function isAppleM4With16GbOrMore(): boolean {
  const model = os.cpus()[0]?.model ?? "";
  const totalMemGb = os.totalmem() / 1024 / 1024 / 1024;
  return isAppleSilicon() && /Apple M4/i.test(model) && totalMemGb >= 15.5;
}

export function getRecommendedShortBatchSize(): number {
  return isAppleM4With16GbOrMore() ? 4 : 3;
}

export function getRecommendedLongBatchSize(): number {
  return isAppleM4With16GbOrMore() ? 2 : 1;
}

export function getRecommendedShortConcurrency(): number {
  return isAppleM4With16GbOrMore() ? 2 : 1;
}

export function getRecommendedLongConcurrency(): number {
  return isAppleM4With16GbOrMore() ? 2 : 1;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) return;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runOne()));
  return results;
}

export function getVideoToolboxArgs(kind: "short" | "long"): string[] {
  if (!isAppleSilicon()) return [];

  const bitrate = kind === "short" ? "8M" : "10M";
  const maxrate = kind === "short" ? "10M" : "12M";
  const bufsize = kind === "short" ? "16M" : "20M";

  return [
    "-c:v", "h264_videotoolbox",
    "-allow_sw", "1",
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
  ];
}

export function getLibx264Args(kind: "short" | "long"): string[] {
  return [
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", kind === "short" ? "23" : "22",
    "-pix_fmt", "yuv420p",
  ];
}
