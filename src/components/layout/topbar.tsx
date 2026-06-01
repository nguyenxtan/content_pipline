"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/contexts/app-settings";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/niches": "Lĩnh vực",
  "/content": "Nội dung",
  "/content/gallery": "Gallery",
  "/agent": "Lĩnh vực",
  "/settings": "Cài đặt",
};

function getBreadcrumb(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return ["Dashboard"];

  const crumbs: string[] = [];
  let path = "";
  for (const part of parts) {
    path += `/${part}`;
    const label =
      ROUTE_LABELS[path] ??
      part.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push(label);
  }
  return crumbs;
}

export function Topbar({ monthlyCost }: { monthlyCost?: number }) {
  const pathname = usePathname();
  const crumbs = getBreadcrumb(pathname);
  const { theme, toggleTheme, currency, toggleCurrency, fmt } = useAppSettings();

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-700 bg-slate-900 px-6">
      <nav className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-500">/</span>}
            <span
              className={cn(
                i === crumbs.length - 1
                  ? "font-medium text-slate-100"
                  : "text-slate-400"
              )}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {/* Currency toggle */}
        <button
          onClick={toggleCurrency}
          title={currency === "usd" ? "Chuyển sang VND" : "Chuyển sang USD"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          {currency === "usd" ? "$" : "₫"}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Chuyển sang sáng" : "Chuyển sang tối"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>

        {/* Monthly cost */}
        {monthlyCost !== undefined && (
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">
            Tháng này: {fmt(monthlyCost, 4)}
          </span>
        )}
      </div>
    </header>
  );
}
