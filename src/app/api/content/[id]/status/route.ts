import { db } from "@/lib/db";
import { generatedContents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.generatedContents.findFirst({
    where: (c, { eq: eqFn }) => eqFn(c.id, id),
  });

  if (!row) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({
    id: row.id,
    status: row.status,
    output: row.output,
    outputTokens: row.outputTokens,
    totalCost: row.totalCost ? Number(row.totalCost) : null,
    generationTime: row.generationTime,
    errorMessage: row.errorMessage,
  });
}
