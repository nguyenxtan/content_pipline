import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FactoryHealthDashboard } from "@/components/admin/factory-health-dashboard";
import { getFactoryHealthAction } from "@/actions/factory-health";

export const dynamic = "force-dynamic";

export default async function PublishingHealthPage() {
  const data = await getFactoryHealthAction();

  return (
    <AppShell>
      <Suspense>
        <FactoryHealthDashboard data={data} />
      </Suspense>
    </AppShell>
  );
}
