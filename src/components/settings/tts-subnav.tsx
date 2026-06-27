"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart2, Mic2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  {
    href: "/settings/tts/aimax",
    label: "AiMax",
    description: "API, balance, voices, defaults",
    icon: Sparkles,
    exact: true,
  },
  {
    href: "/settings/tts/aimax/usage",
    label: "AiMax Usage",
    description: "Per-request credits, cache hits, pipeline breakdown",
    icon: BarChart2,
    exact: false,
  },
  {
    href: "/settings/tts/general",
    label: "Legacy VieNeu",
    description: "Deprecated — not used for new generation",
    icon: Mic2,
    exact: false,
  },
];

export function TtsSubnav() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {ITEMS.map(({ href, label, description, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-w-[220px] items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
              active
                ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
                : "border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900/70",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
