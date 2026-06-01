"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  FileText,
  Settings,
  LogOut,
  Zap,
  KeyRound,
  Mic2,
  Music,
  AlignLeft,
  BookOpen,
  ImageIcon,
  CalendarClock,
  Radio,
  Upload,
  CalendarDays,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/actions/auth";

const contentSubItems = [
  { href: "/content",               label: "Tạo content", icon: null           },
  { href: "/content/gallery",       label: "Short",       icon: AlignLeft      },
  { href: "/content/gallery/long",  label: "Long",        icon: BookOpen       },
  { href: "/content/scheduler",     label: "Lập lịch",    icon: CalendarClock  },
];

const publishingSubItems = [
  { href: "/publishing",           label: "Lịch đăng",  icon: CalendarDays },
  { href: "/publishing/analytics", label: "Phân tích",  icon: BarChart3    },
];

const settingsSubItems = [
  { href: "/settings/tokens",   label: "Token & Chi phí", icon: KeyRound },
  { href: "/settings/tts",      label: "TTS",             icon: Mic2 },
  { href: "/settings/images",   label: "Tạo ảnh",         icon: ImageIcon },
  { href: "/settings/music",    label: "Nhạc nền",        icon: Music },
  { href: "/settings/channels", label: "Kênh & Đăng",     icon: Radio },
];

export function Sidebar() {
  const pathname = usePathname();
  const isContentActive = pathname.startsWith("/content");
  const isSettingsActive = pathname.startsWith("/settings");
  const isPublishingActive = pathname.startsWith("/publishing");

  return (
    <aside className="flex h-screen w-[var(--sidebar-width)] flex-col border-r border-slate-700 bg-slate-900">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-slate-700 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-rose-600 text-white">
          <Zap className="h-4 w-4" />
        </div>
        <span className="font-semibold text-slate-100">
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
              ? "bg-rose-600/10 text-rose-400"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Link>

        {/* Niches / Lĩnh vực */}
        <Link
          href="/niches"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/niches")
              ? "bg-rose-600/10 text-rose-400"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          )}
        >
          <Layers className="h-4 w-4" />
          Lĩnh vực
        </Link>

        {/* Content with sub-items */}
        <div>
          <Link
            href="/content"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isContentActive
                ? "bg-rose-600/10 text-rose-400"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <FileText className="h-4 w-4" />
            Nội dung
          </Link>
          {isContentActive && (
            <div className="ml-7 mt-0.5 space-y-0.5 border-l border-slate-700 pl-3">
              {contentSubItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    pathname === href
                      ? "text-rose-400 bg-rose-600/10"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  {Icon && <Icon className="h-3 w-3 shrink-0" />}
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Publishing with sub-items */}
        <div>
          <Link
            href="/publishing"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isPublishingActive
                ? "bg-rose-600/10 text-rose-400"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <Upload className="h-4 w-4" />
            Đăng bài
          </Link>
          {isPublishingActive && (
            <div className="ml-7 mt-0.5 space-y-0.5 border-l border-slate-700 pl-3">
              {publishingSubItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    pathname === href
                      ? "text-rose-400 bg-rose-600/10"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>


        {/* Settings with sub-items */}
        <div>
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isSettingsActive
                ? "bg-rose-600/10 text-rose-400"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <Settings className="h-4 w-4" />
            Cài đặt
          </Link>
          {isSettingsActive && (
            <div className="ml-7 mt-0.5 space-y-0.5 border-l border-slate-700 pl-3">
              {settingsSubItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    pathname === href
                      ? "text-rose-400 bg-rose-600/10"
                      : "text-slate-400 hover:text-slate-100"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Logout */}
      <div className="border-t border-slate-700 p-2">
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Đăng xuất
          </button>
        </form>
      </div>
    </aside>
  );
}
