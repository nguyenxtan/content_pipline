import fsPromises from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getLegacyQuoteSampleAssets } from "@/lib/quote-shorts-assets";

function contentTypeForPath(filePath: string): string {
  if (filePath.endsWith(".mp4")) return "video/mp4";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> },
) {
  const { contentId } = await context.params;
  const kind = request.nextUrl.searchParams.get("kind") === "contact" ? "contact" : "video";
  const assetList = getLegacyQuoteSampleAssets();
  const sample = assetList.samples.find((row) => row.contentId === contentId);

  if (!sample) {
    return NextResponse.json({ error: "Quote short sample not found." }, { status: 404 });
  }

  const filePath = kind === "contact" ? sample.contactSheet : sample.outputVideoPath;
  if (!filePath) {
    return NextResponse.json({ error: "Asset not available for this sample." }, { status: 404 });
  }

  try {
    const data = await fsPromises.readFile(filePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentTypeForPath(filePath),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset file missing on disk." }, { status: 404 });
  }
}
