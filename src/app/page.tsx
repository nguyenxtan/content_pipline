export const dynamic = "force-dynamic";

import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/lib/db";
import { niches, contentPieces, contentOutputs } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Layers, FileText, DollarSign, Clock } from "lucide-react";

async function getDashboardData() {
  try {
  const [
    activeNiches,
    monthlyPieces,
    monthlyCost,
    pendingReview,
    recentOutputs,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(niches)
      .where(sql`is_active = true`),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(contentPieces)
      .where(sql`created_at >= DATE_TRUNC('month', CURRENT_DATE)`),
    db
      .select({ total: sql<string>`COALESCE(SUM(cost_usd), 0)` })
      .from(contentOutputs)
      .where(sql`created_at >= DATE_TRUNC('month', CURRENT_DATE)`),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(contentPieces)
      .where(sql`status = 'idea_generated'`),
    db
      .select({
        id: contentOutputs.id,
        stage: contentOutputs.stage,
        model: contentOutputs.model,
        costUsd: contentOutputs.costUsd,
        createdAt: contentOutputs.createdAt,
        pieceId: contentOutputs.pieceId,
        title: contentPieces.title,
      })
      .from(contentOutputs)
      .leftJoin(
        contentPieces,
        sql`${contentOutputs.pieceId} = ${contentPieces.id}`
      )
      .orderBy(desc(contentOutputs.createdAt))
      .limit(10),
  ]);

  return {
    activeNiches: Number(activeNiches[0]?.count ?? 0),
    monthlyPieces: Number(monthlyPieces[0]?.count ?? 0),
    monthlyCost: parseFloat(monthlyCost[0]?.total ?? "0"),
    pendingReview: Number(pendingReview[0]?.count ?? 0),
    recentOutputs,
  };
  } catch {
    return {
      activeNiches: 0,
      monthlyPieces: 0,
      monthlyCost: 0,
      pendingReview: 0,
      recentOutputs: [],
    };
  }
}

const STAGE_LABELS: Record<string, string> = {
  ideation: "Ideation",
  script: "Script",
  short: "Short 60s",
  long: "Long Meta",
};

export default async function DashboardPage() {
  const data = await getDashboardData();

  const stats = [
    {
      label: "Ngách active",
      value: data.activeNiches,
      icon: Layers,
      color: "text-blue-400",
    },
    {
      label: "Nội dung tháng này",
      value: data.monthlyPieces,
      icon: FileText,
      color: "text-violet-400",
    },
    {
      label: "Cost tháng này",
      value: `$${data.monthlyCost.toFixed(4)}`,
      icon: DollarSign,
      color: "text-green-400",
    },
    {
      label: "Chờ review",
      value: data.pendingReview,
      icon: Clock,
      color: "text-amber-400",
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Dashboard
        </h1>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                  {label}
                </p>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="mt-2 text-3xl font-bold text-[hsl(var(--foreground))]">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="border-b border-[hsl(var(--border))] px-6 py-4">
            <h2 className="font-semibold text-[hsl(var(--foreground))]">
              Hoạt động gần đây
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="px-6 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                    Tiêu đề
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                    Stage
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                    Model
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-[hsl(var(--muted-foreground))]">
                    Cost
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-[hsl(var(--muted-foreground))]">
                    Thời gian
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentOutputs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-[hsl(var(--muted-foreground))]"
                    >
                      Chưa có hoạt động nào. Hãy tạo ngách và chạy pipeline!
                    </td>
                  </tr>
                ) : (
                  data.recentOutputs.map((output) => (
                    <tr
                      key={output.id}
                      className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--accent))]/50 transition-colors"
                    >
                      <td className="px-6 py-3 text-[hsl(var(--foreground))]">
                        {output.title ?? `Piece #${output.pieceId}`}
                      </td>
                      <td className="px-6 py-3">
                        <span className="rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--secondary-foreground))]">
                          {STAGE_LABELS[output.stage] ?? output.stage}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                        {output.model ?? "-"}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-xs text-green-400">
                        {output.costUsd
                          ? formatCurrency(Number(output.costUsd))
                          : "-"}
                      </td>
                      <td className="px-6 py-3 text-right text-[hsl(var(--muted-foreground))]">
                        {output.createdAt ? formatDate(output.createdAt) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
