import { AppShell } from "@/components/layout/app-shell";

export default function AgentPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Agent
        </h1>
        <p className="text-[hsl(var(--muted-foreground))]">
          Phase 4 — coming soon
        </p>
      </div>
    </AppShell>
  );
}
