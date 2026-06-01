import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { db } from "@/lib/db";
import { apiUsageLogs } from "@/lib/db/schema";
import { sql, gte } from "drizzle-orm";

async function getMonthlyCost(): Promise<number> {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const result = await db
      .select({ total: sql<string>`COALESCE(SUM(cost_usd), 0)` })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, firstDay));
    return parseFloat(result[0]?.total ?? "0");
  } catch {
    return 0;
  }
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  const monthlyCost = await getMonthlyCost();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar monthlyCost={monthlyCost} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
