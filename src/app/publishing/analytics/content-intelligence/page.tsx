import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ContentIntelligenceClient } from "@/components/channels/content-intelligence-client";
import { getContentIntelligenceAction } from "@/actions/content-intelligence";
import type { ChannelProfile, PlatformFilter } from "@/actions/content-intelligence";

export const dynamic = "force-dynamic";

export default async function ContentIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const profile: ChannelProfile =
    params.profile === "tang_sau" ? "tang_sau" : "phat_phap";
  const validPlatforms: PlatformFilter[] = ["all", "youtube", "facebook", "tiktok"];
  const platformFilter: PlatformFilter =
    validPlatforms.includes(params.platform as PlatformFilter)
      ? (params.platform as PlatformFilter)
      : "all";
  const data = await getContentIntelligenceAction(profile, platformFilter);
  return (
    <AppShell>
      <Suspense>
        <ContentIntelligenceClient initialData={data} />
      </Suspense>
    </AppShell>
  );
}
