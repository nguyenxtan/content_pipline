import { db } from "@/lib/db";
import { generatedContents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    generatedContentId,
    output,
    outputTokens,
    totalCost,
    generationTime,
    status,
    errorMessage,
    executionId,
  } = body as {
    generatedContentId: string;
    output?: string;
    outputTokens?: number;
    totalCost?: number;
    generationTime?: number;
    status: "done" | "error";
    errorMessage?: string;
    executionId?: string;
  };

  if (!generatedContentId || !status) {
    return Response.json(
      { error: "generatedContentId and status are required" },
      { status: 400 }
    );
  }

  await db
    .update(generatedContents)
    .set({
      output: output ?? null,
      outputTokens: outputTokens ?? null,
      totalCost: totalCost != null ? String(totalCost) : null,
      generationTime: generationTime ?? null,
      status,
      errorMessage: errorMessage ?? null,
      n8nExecutionId: executionId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(generatedContents.id, generatedContentId));

  return Response.json({ success: true });
}
