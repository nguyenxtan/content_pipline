"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/niches": "Ngách",
  "/content": "Nội dung",
  "/content/gallery": "Gallery",
  "/agent": "Agent",
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
      part
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push(label);
  }
  return crumbs;
}

export function Topbar({
  monthlyCost,
}: {
  monthlyCost?: number;
}) {
  const pathname = usePathname();
  const crumbs = getBreadcrumb(pathname);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const dark = stored ? stored === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-[hsl(var(--muted-foreground))]">/</span>
            )}
            <span
              className={cn(
                i === crumbs.length - 1
                  ? "font-medium text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))]"
              )}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {monthlyCost !== undefined && (
          <span className="rounded-full bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))]">
            Tháng này: ${monthlyCost.toFixed(4)}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
