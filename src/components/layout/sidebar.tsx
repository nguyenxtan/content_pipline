"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  FileText,
  Sparkles,
  Settings,
  LogOut,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/actions/auth";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/niches", label: "Ngách", icon: Layers },
  { href: "/agent", label: "Agent", icon: Sparkles },
  { href: "/settings", label: "Cài đặt", icon: Settings },
];

const contentSubItems = [
  { href: "/content", label: "Generate" },
  { href: "/content/gallery", label: "Gallery" },
];

export function Sidebar() {
  const pathname = usePathname();
  const isContentActive = pathname.startsWith("/content");

  return (
    <aside className="flex h-screen w-[var(--sidebar-width)] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-[hsl(var(--border))] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
          <Zap className="h-4 w-4" />
        </div>
        <span className="font-semibold text-[hsl(var(--foreground))]">
          {process.env.NEXT_PUBLIC_APP_NAME ?? "Content Pipeline"}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {/* Dashboard */}
        <Link
          href="/"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/"
              ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Link>

        {/* Niches */}
        <Link
          href="/niches"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/niches")
              ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
          )}
        >
          <Layers className="h-4 w-4" />
          Ngách
        </Link>

        {/* Content with sub-items */}
        <div>
          <Link
            href="/content"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isContentActive
                ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
            )}
          >
            <FileText className="h-4 w-4" />
            Nội dung
          </Link>
          {isContentActive && (
            <div className="ml-7 mt-0.5 space-y-0.5 border-l border-[hsl(var(--border))] pl-3">
              {contentSubItems.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "block rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    pathname === href
                      ? "text-[hsl(var(--accent-foreground))] bg-[hsl(var(--accent))]/60"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent-foreground))]"
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Remaining items */}
        {navItems.slice(2).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-[hsl(var(--border))] p-2">
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))] transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </button>
        </form>
      </div>
    </aside>
  );
}
