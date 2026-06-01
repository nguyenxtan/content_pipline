export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  BarChart3,
  Clock3,
  DollarSign,
  Eye,
  Globe2,
  Layers3,
  PlaySquare,
  Upload,
  Wallet,
} from "lucide-react";
import { gte, sql } from "drizzle-orm";
import { getUsdRateAction } from "@/actions/exchange-rate";
import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/lib/db";
import {
  apiUsageLogs,
  niches,
} from "@/lib/db/schema";
import { getPurposeLabel } from "@/lib/purpose-labels";

type CountRow = { count?: string | number | null };
type CostRow = { total?: string | number | null; calls?: string | number | null };
type VideoCostRow = {
  count?: string | number | null;
  avg_cost?: string | number | null;
  sum_cost?: string | number | null;
};
type PlatformChannelRow = {
  platform: string;
  real_channels?: string | number | null;
  credentials?: string | number | null;
};
type PlatformQueueRow = {
  platform: string;
  queued?: string | number | null;
  uploading?: string | number | null;
  errors?: string | number | null;
  next_slot?: Date | string | null;
};
type PlatformPublishRow = {
  platform: string;
  videos?: string | number | null;
  month_videos?: string | number | null;
  views?: string | number | null;
  likes?: string | number | null;
  comments?: string | number | null;
  stale_videos?: string | number | null;
  last_synced_at?: Date | string | null;
  last_published_at?: Date | string | null;
};
type PurposeRow = {
  purpose: string;
  calls?: string | number | null;
  cost_usd?: string | number | null;
};
type QueuePreviewRow = {
  id: string;
  platform: string;
  channel_name: string;
  video_type: string;
  scheduled_at: Date | string;
  status: string;
  title: string;
  topic: string | null;
};
type TopVideoRow = {
  id: string;
  platform: string;
  channel_name: string | null;
  title: string;
  platform_video_url: string | null;
  video_type: string;
  published_at: Date | string | null;
  latest_view_count?: string | number | null;
  latest_like_count?: string | number | null;
  latest_comment_count?: string | number | null;
  niche_name: string | null;
};
type RecentContentRow = {
  id: string;
  topic: string;
  niche_name: string;
  content_mode: string;
  video_status: string | null;
  youtube_upload_status: string | null;
  facebook_upload_status: string | null;
  long_video_status: string | null;
  long_youtube_upload_status: string | null;
  total_cost?: string | number | null;
  images_cost_usd?: string | number | null;
  created_at: Date | string;
};

type PlatformOverview = {
  platform: string;
  label: string;
  realChannels: number;
  credentials: number;
  queued: number;
  uploading: number;
  errors: number;
  nextSlot: Date | null;
  videos: number;
  monthVideos: number;
  views: number;
  likes: number;
  comments: number;
  staleVideos: number;
  lastSyncedAt: Date | null;
  lastPublishedAt: Date | null;
};

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function fmtUsd(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function fmtVnd(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtCostPair(usd: number, usdToVnd: number): string {
  return `${fmtUsd(usd)} · ${fmtVnd(usd * usdToVnd)}`;
}

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const VN_TIME_SUFFIX = "VN (GMT+7)";

function formatDateTime(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + ` · ${VN_TIME_SUFFIX}`;
}

function formatShortDateTime(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + ` · ${VN_TIME_SUFFIX}`;
}

function formatAgo(value: Date | null): string {
  if (!value) return "chưa có";
  const diffMinutes = Math.round((Date.now() - value.getTime()) / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}p trước`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h trước`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} ngày trước`;
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}

function thirtyDaysAgo(): Date {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "facebook":
      return "Facebook";
    case "tiktok":
      return "TikTok";
    default:
      return platform;
  }
}

async function executeRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

async function getDashboardData() {
  const since = monthStart();
  const recentSince = thirtyDaysAgo();
  const usdToVnd = await getUsdRateAction();

  const [
    activeNichesRows,
    monthlyCostRows,
    shortCostRows,
    longCostRows,
    purposeRows,
    channelRows,
    queueRows,
    publishRows,
    queuePreviewRows,
    topVideoRows,
    recentContentRows,
  ] = await Promise.all([
    db.select({ count: sql<string>`count(*)` }).from(niches).where(sql`is_active = true`),
    db
      .select({
        total: sql<string>`coalesce(sum(cost_usd), 0)`,
        calls: sql<string>`count(*)`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, since)),
    executeRows<VideoCostRow>(sql`
      select
        count(*)::text as count,
        coalesce(avg(cast(total_cost as numeric) + coalesce(cast(images_cost_usd as numeric), 0)), 0)::text as avg_cost,
        coalesce(sum(cast(total_cost as numeric) + coalesce(cast(images_cost_usd as numeric), 0)), 0)::text as sum_cost
      from content_generations
      where created_at >= ${since}
        and content_mode in ('short', 'both')
        and video_status = 'done'
    `),
    executeRows<VideoCostRow>(sql`
      select
        count(*)::text as count,
        coalesce(avg(cast(total_cost as numeric)), 0)::text as avg_cost,
        coalesce(sum(cast(total_cost as numeric)), 0)::text as sum_cost
      from content_generations
      where created_at >= ${since}
        and content_mode in ('long', 'both')
        and long_video_status = 'done'
    `),
    executeRows<PurposeRow>(sql`
      select
        purpose,
        count(*)::text as calls,
        coalesce(sum(cost_usd), 0)::text as cost_usd
      from api_usage_logs
      where created_at >= ${since}
      group by purpose
      order by sum(cost_usd) desc
      limit 6
    `),
    executeRows<PlatformChannelRow>(sql`
      select
        platform,
        count(distinct platform_channel_id)::text as real_channels,
        count(*)::text as credentials
      from social_channels
      where is_active = true
      group by platform
      order by platform
    `),
    executeRows<PlatformQueueRow>(sql`
      select
        sc.platform,
        count(*) filter (where q.status = 'queued')::text as queued,
        count(*) filter (where q.status = 'uploading')::text as uploading,
        count(*) filter (where q.status = 'error')::text as errors,
        min(q.scheduled_at) filter (where q.status = 'queued') as next_slot
      from social_channels sc
      left join upload_queue q on q.channel_id = sc.id
      where sc.is_active = true
      group by sc.platform
      order by sc.platform
    `),
    executeRows<PlatformPublishRow>(sql`
      select
        platform,
        count(*)::text as videos,
        count(*) filter (where published_at >= ${recentSince})::text as month_videos,
        coalesce(sum(coalesce(latest_view_count, 0)), 0)::text as views,
        coalesce(sum(coalesce(latest_like_count, 0)), 0)::text as likes,
        coalesce(sum(coalesce(latest_comment_count, 0)), 0)::text as comments,
        count(*) filter (
          where latest_fetched_at is null
             or latest_fetched_at < now() - interval '24 hours'
        )::text as stale_videos,
        max(latest_fetched_at) as last_synced_at,
        max(published_at) as last_published_at
      from published_videos
      group by platform
      order by platform
    `),
    executeRows<QueuePreviewRow>(sql`
      select
        q.id,
        sc.platform,
        sc.name as channel_name,
        q.video_type,
        q.scheduled_at,
        q.status,
        q.title,
        cg.topic
      from upload_queue q
      join social_channels sc on sc.id = q.channel_id
      left join content_generations cg on cg.id = q.content_id
      where q.status = 'queued'
      order by q.scheduled_at asc
      limit 8
    `),
    executeRows<TopVideoRow>(sql`
      select
        pv.id,
        pv.platform,
        pa.display_name as channel_name,
        pv.title,
        pv.platform_video_url,
        pv.video_type,
        pv.published_at,
        pv.latest_view_count,
        pv.latest_like_count,
        pv.latest_comment_count,
        cg.niche_name
      from published_videos pv
      left join platform_accounts pa on pa.id = pv.platform_account_id
      left join content_generations cg on cg.id = pv.content_id
      order by coalesce(pv.latest_view_count, 0) desc, pv.published_at desc nulls last
      limit 8
    `),
    executeRows<RecentContentRow>(sql`
      select
        id,
        topic,
        niche_name,
        content_mode,
        video_status,
        youtube_upload_status,
        facebook_upload_status,
        long_video_status,
        long_youtube_upload_status,
        total_cost,
        images_cost_usd,
        created_at
      from content_generations
      order by created_at desc
      limit 8
    `),
  ]);

  const activeNiches = toNumber((activeNichesRows[0] as CountRow | undefined)?.count);
  const monthlyCost = toNumber((monthlyCostRows[0] as CostRow | undefined)?.total);
  const monthlyCalls = toNumber((monthlyCostRows[0] as CostRow | undefined)?.calls);
  const shortCount = toNumber(shortCostRows[0]?.count);
  const shortAvgCost = toNumber(shortCostRows[0]?.avg_cost);
  const shortSumCost = toNumber(shortCostRows[0]?.sum_cost);
  const longCount = toNumber(longCostRows[0]?.count);
  const longAvgCost = toNumber(longCostRows[0]?.avg_cost);
  const longSumCost = toNumber(longCostRows[0]?.sum_cost);

  const channelMap = new Map(channelRows.map((row) => [row.platform, row]));
  const queueMap = new Map(queueRows.map((row) => [row.platform, row]));
  const publishMap = new Map(publishRows.map((row) => [row.platform, row]));

  const platforms = ["youtube", "facebook", "tiktok"].map<PlatformOverview>((platform) => {
    const channel = channelMap.get(platform);
    const queue = queueMap.get(platform);
    const publish = publishMap.get(platform);

    return {
      platform,
      label: platformLabel(platform),
      realChannels: toNumber(channel?.real_channels),
      credentials: toNumber(channel?.credentials),
      queued: toNumber(queue?.queued),
      uploading: toNumber(queue?.uploading),
      errors: toNumber(queue?.errors),
      nextSlot: toDate(queue?.next_slot),
      videos: toNumber(publish?.videos),
      monthVideos: toNumber(publish?.month_videos),
      views: toNumber(publish?.views),
      likes: toNumber(publish?.likes),
      comments: toNumber(publish?.comments),
      staleVideos: toNumber(publish?.stale_videos),
      lastSyncedAt: toDate(publish?.last_synced_at),
      lastPublishedAt: toDate(publish?.last_published_at),
    };
  });

  const totals = platforms.reduce(
    (acc, platform) => {
      acc.realChannels += platform.realChannels;
      acc.credentials += platform.credentials;
      acc.queued += platform.queued;
      acc.uploading += platform.uploading;
      acc.errors += platform.errors;
      acc.videos += platform.videos;
      acc.monthVideos += platform.monthVideos;
      acc.views += platform.views;
      acc.likes += platform.likes;
      acc.comments += platform.comments;
      acc.staleVideos += platform.staleVideos;
      if (!acc.nextSlot || (platform.nextSlot && platform.nextSlot < acc.nextSlot)) {
        acc.nextSlot = platform.nextSlot;
      }
      if (!acc.lastSyncedAt || (platform.lastSyncedAt && platform.lastSyncedAt > acc.lastSyncedAt)) {
        acc.lastSyncedAt = platform.lastSyncedAt;
      }
      return acc;
    },
    {
      realChannels: 0,
      credentials: 0,
      queued: 0,
      uploading: 0,
      errors: 0,
      videos: 0,
      monthVideos: 0,
      views: 0,
      likes: 0,
      comments: 0,
      staleVideos: 0,
      nextSlot: null as Date | null,
      lastSyncedAt: null as Date | null,
    }
  );

  return {
    usdToVnd,
    activeNiches,
    monthlyCost,
    monthlyCalls,
    shortCount,
    shortAvgCost,
    shortSumCost,
    longCount,
    longAvgCost,
    longSumCost,
    purposeBreakdown: purposeRows.map((row) => ({
      purpose: row.purpose,
      calls: toNumber(row.calls),
      costUsd: toNumber(row.cost_usd),
    })),
    platforms,
    totals,
    queuePreview: queuePreviewRows.map((row) => ({
      ...row,
      scheduledAt: toDate(row.scheduled_at)!,
    })),
    topVideos: topVideoRows.map((row) => ({
      ...row,
      publishedAt: toDate(row.published_at),
      viewCount: toNumber(row.latest_view_count),
      likeCount: toNumber(row.latest_like_count),
      commentCount: toNumber(row.latest_comment_count),
    })),
    recentContents: recentContentRows.map((row) => ({
      ...row,
      createdAt: toDate(row.created_at)!,
      totalCostUsd: toNumber(row.total_cost) + toNumber(row.images_cost_usd),
    })),
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const monthName = new Date().toLocaleDateString("vi-VN", {
    month: "long",
    year: "numeric",
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
            <p className="max-w-4xl text-sm text-slate-400">
              Overview vận hành cho pipeline nội dung, lịch đăng và hiệu suất đa nền tảng.
              Chi phí là chi phí pipeline dùng chung cho content, không tách theo từng nền tảng.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/publishing"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
            >
              <Upload className="h-4 w-4" />
              Lịch đăng
            </Link>
            <Link
              href="/publishing/analytics"
              className="inline-flex items-center gap-2 rounded-lg border border-rose-700/60 bg-rose-600/10 px-3 py-2 text-sm text-rose-300 transition-colors hover:border-rose-500 hover:text-rose-200"
            >
              <BarChart3 className="h-4 w-4" />
              Phân tích
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label={`Chi phí ${monthName}`}
            value={fmtUsd(data.monthlyCost)}
            meta={fmtVnd(data.monthlyCost * data.usdToVnd)}
            note={`${fmtNumber(data.monthlyCalls)} lần gọi API`}
            icon={Wallet}
            accent="text-emerald-300"
          />
          <StatCard
            label="Video đã đăng 30 ngày"
            value={fmtNumber(data.totals.monthVideos)}
            meta={
              <>
                <div>{fmtNumber(data.platforms.find((item) => item.platform === "youtube")?.monthVideos ?? 0)} YouTube</div>
                <div>{fmtNumber(data.platforms.find((item) => item.platform === "facebook")?.monthVideos ?? 0)} Facebook</div>
              </>
            }
            note={`${fmtNumber(data.totals.videos)} video lưu trong analytics`}
            icon={Upload}
            accent="text-amber-300"
          />
          <StatCard
            label="Queue chờ đăng"
            value={fmtNumber(data.totals.queued)}
            meta={data.totals.nextSlot ? formatShortDateTime(data.totals.nextSlot) : "Không có lịch chờ"}
            note={`${fmtNumber(data.totals.uploading)} đang upload · ${fmtNumber(data.totals.errors)} lỗi`}
            icon={Clock3}
            accent="text-sky-300"
          />
          <StatCard
            label="Views hiện có"
            value={fmtNumber(data.totals.views)}
            meta={`${fmtNumber(data.totals.likes)} thích · ${fmtNumber(data.totals.comments)} bình luận`}
            note={`${fmtNumber(data.totals.staleVideos)} video cần sync lại`}
            icon={Eye}
            accent="text-violet-300"
          />
          <StatCard
            label="Kênh đang kết nối"
            value={fmtNumber(data.totals.realChannels)}
            meta={`${fmtNumber(data.totals.credentials)} credentials hoạt động`}
            note={`${fmtNumber(data.activeNiches)} lĩnh vực active`}
            icon={Globe2}
            accent="text-rose-300"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {data.platforms.map((platform) => (
            <PlatformCard key={platform.platform} platform={platform} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-4">
            <SectionHeader
              title="Chi phí pipeline"
              subtitle="Hiển thị song song USD và VND để nhìn ngân sách nhanh hơn."
              icon={DollarSign}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <MetricPanel
                title="Short tháng này"
                rows={[
                  { label: "Số lượng", value: `${fmtNumber(data.shortCount)} video` },
                  { label: "Tổng chi phí", value: fmtCostPair(data.shortSumCost, data.usdToVnd), highlight: true },
                  { label: "Trung bình / video", value: data.shortCount > 0 ? fmtCostPair(data.shortAvgCost, data.usdToVnd) : "—" },
                ]}
              />
              <MetricPanel
                title="Long tháng này"
                rows={[
                  { label: "Số lượng", value: `${fmtNumber(data.longCount)} video` },
                  { label: "Tổng chi phí", value: fmtCostPair(data.longSumCost, data.usdToVnd), highlight: true },
                  { label: "Trung bình / video", value: data.longCount > 0 ? fmtCostPair(data.longAvgCost, data.usdToVnd) : "—" },
                ]}
              />
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-100">Chi phí theo mục đích</h3>
                  <p className="text-xs text-slate-500">Top call-site tốn tiền nhất trong tháng hiện tại.</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  Tổng tháng này
                  <div className="text-sm font-medium text-slate-300">{fmtCostPair(data.monthlyCost, data.usdToVnd)}</div>
                </div>
              </div>

              <div className="space-y-3">
                {data.purposeBreakdown.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                    Chưa có usage log trong tháng này.
                  </div>
                ) : (
                  data.purposeBreakdown.map((item) => {
                    const percent = data.monthlyCost > 0 ? (item.costUsd / data.monthlyCost) * 100 : 0;
                    return (
                      <div key={item.purpose} className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-slate-200">{getPurposeLabel(item.purpose)}</p>
                            <p className="text-xs text-slate-500">{fmtNumber(item.calls)} calls</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-slate-100">{fmtUsd(item.costUsd, 4)}</p>
                            <p className="text-xs text-slate-500">{fmtVnd(item.costUsd * data.usdToVnd)}</p>
                          </div>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-rose-500/70"
                            style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              title="Lịch sắp đăng"
              subtitle="Các item queued gần nhất trên mọi nền tảng."
              icon={Clock3}
            />
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-800 bg-slate-950/60">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nền tảng</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kênh</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Video</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lên lịch</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queuePreview.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                        Không có item queued.
                      </td>
                    </tr>
                  ) : (
                    data.queuePreview.map((item) => (
                      <tr key={item.id} className="border-b border-slate-800/70 last:border-0">
                        <td className="px-4 py-3 align-top">
                          <PlatformBadge platform={item.platform} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-slate-200">{item.channel_name}</div>
                          <div className="text-xs text-slate-500">{item.video_type}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="line-clamp-2 text-sm text-slate-200">{item.topic || item.title}</div>
                        </td>
                        <td className="px-4 py-3 text-right align-top text-xs text-slate-400">
                          {formatDateTime(item.scheduledAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="space-y-4">
          <SectionHeader
            title="Top video hiện có"
            subtitle="Sắp theo latest view count đang lưu trong analytics."
            icon={PlaySquare}
          />
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/60">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Video</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kênh</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Views</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Likes</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Comments</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đăng lúc</th>
                </tr>
              </thead>
              <tbody>
                {data.topVideos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      Chưa có video nào trong analytics.
                    </td>
                  </tr>
                ) : (
                  data.topVideos.map((video) => (
                    <tr key={video.id} className="border-b border-slate-800/70 last:border-0">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-3">
                          <PlatformBadge platform={video.platform} />
                          <div className="min-w-0">
                            {video.platform_video_url ? (
                              <a
                                href={video.platform_video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="line-clamp-2 text-sm text-slate-100 transition-colors hover:text-rose-300"
                              >
                                {video.title}
                              </a>
                            ) : (
                              <div className="line-clamp-2 text-sm text-slate-100">{video.title}</div>
                            )}
                            <div className="mt-1 text-xs text-slate-500">
                              {video.niche_name || "—"} · {video.video_type}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-slate-300">{video.channel_name || "—"}</td>
                      <td className="px-4 py-3 text-right align-top font-medium text-slate-100">{fmtNumber(video.viewCount)}</td>
                      <td className="px-4 py-3 text-right align-top text-slate-300">{fmtNumber(video.likeCount)}</td>
                      <td className="px-4 py-3 text-right align-top text-slate-300">{fmtNumber(video.commentCount)}</td>
                      <td className="px-4 py-3 text-right align-top text-xs text-slate-500">{formatShortDateTime(video.publishedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader
            title="Nội dung gần đây"
            subtitle="Theo dõi pipeline generate và trạng thái upload ở một hàng."
            icon={Layers3}
          />
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/60">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Chủ đề</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pipeline</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Upload</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Chi phí</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {data.recentContents.map((item) => (
                  <tr key={item.id} className="border-b border-slate-800/70 last:border-0">
                    <td className="px-4 py-3 align-top">
                      <div className="line-clamp-2 text-sm text-slate-100">{item.topic}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.niche_name} · {item.content_mode}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill label={`Short ${item.video_status ?? "—"}`} tone={statusTone(item.video_status)} />
                        {["long", "both"].includes(item.content_mode) && (
                          <StatusPill
                            label={`Long ${item.long_video_status ?? "—"}`}
                            tone={statusTone(item.long_video_status)}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill label={`YT ${item.youtube_upload_status ?? "—"}`} tone={statusTone(item.youtube_upload_status)} />
                        <StatusPill label={`FB ${item.facebook_upload_status ?? "—"}`} tone={statusTone(item.facebook_upload_status)} />
                        {["long", "both"].includes(item.content_mode) && (
                          <StatusPill
                            label={`Long YT ${item.long_youtube_upload_status ?? "—"}`}
                            tone={statusTone(item.long_youtube_upload_status)}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="text-sm font-medium text-slate-100">{fmtUsd(item.totalCostUsd)}</div>
                      <div className="text-xs text-slate-500">{fmtVnd(item.totalCostUsd * data.usdToVnd)}</div>
                    </td>
                    <td className="px-4 py-3 text-right align-top text-xs text-slate-500">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  meta,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  meta: React.ReactNode;
  note: string;
  icon: typeof Wallet;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`text-2xl font-semibold ${accent}`}>{value}</p>
          <div className="text-sm text-slate-300">{meta}</div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/70 p-2 text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: typeof Layers3;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md border border-slate-800 bg-slate-950/70 p-2 text-slate-400">
        <Icon className="h-4 w-4" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-medium text-slate-100">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function MetricPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; highlight?: boolean }>;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="mb-4 text-sm font-medium text-slate-100">{title}</h3>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-400">{row.label}</span>
            <span className={`text-sm font-medium ${row.highlight ? "text-emerald-300" : "text-slate-200"}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformCard({ platform }: { platform: PlatformOverview }) {
  const hasConnection = platform.realChannels > 0 || platform.credentials > 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={platform.platform} />
            <h3 className="text-sm font-medium text-slate-100">{platform.label}</h3>
          </div>
          <p className="text-xs text-slate-500">
            {hasConnection
              ? `${fmtNumber(platform.realChannels)} kênh thật · ${fmtNumber(platform.credentials)} credential`
              : "Chưa có kết nối"}
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          Sync
          <div className="text-sm text-slate-300">{formatAgo(platform.lastSyncedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <MiniStat label="Đã đăng" value={fmtNumber(platform.videos)} />
        <MiniStat label="30 ngày" value={fmtNumber(platform.monthVideos)} />
        <MiniStat label="Queued" value={fmtNumber(platform.queued)} />
        <MiniStat label="Lỗi queue" value={fmtNumber(platform.errors)} />
        <MiniStat label="Views" value={fmtNumber(platform.views)} />
        <MiniStat label="Likes / Cmt" value={`${fmtNumber(platform.likes)} / ${fmtNumber(platform.comments)}`} />
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-xs text-slate-500">
        <div className="flex items-center justify-between gap-4">
          <span>Slot kế tiếp</span>
          <span className="text-slate-300">{formatShortDateTime(platform.nextSlot)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Video stale</span>
          <span className="text-slate-300">{fmtNumber(platform.staleVideos)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Đăng gần nhất</span>
          <span className="text-slate-300">{formatShortDateTime(platform.lastPublishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const tone =
    platform === "youtube"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : platform === "facebook"
        ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
        : "border-slate-700 bg-slate-800/60 text-slate-300";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium ${tone}`}>
      {platformLabel(platform)}
    </span>
  );
}

function statusTone(status: string | null | undefined): "success" | "warning" | "error" | "neutral" {
  switch (status) {
    case "done":
      return "success";
    case "queued":
    case "scheduled":
    case "uploading":
    case "processing":
      return "warning";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "error" | "neutral";
}) {
  const className =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : "border-slate-700 bg-slate-800/60 text-slate-400";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] ${className}`}>
      {label}
    </span>
  );
}
