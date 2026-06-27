"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, Mic2, Music, ImageIcon, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/tokens",   label: "Quản lý Token", icon: KeyRound,  desc: "API keys, chi phí sử dụng"    },
  { href: "/settings/tts/general", label: "TTS · Legacy", icon: Mic2,   desc: "VieNeu (deprecated)"          },
  { href: "/settings/tts/aimax",   label: "TTS · AiMax",   icon: Mic2,   desc: "API, balance, voices"         },
  { href: "/settings/images",   label: "Tạo ảnh",       icon: ImageIcon, desc: "Model prompt, chi phí fal.ai" },
  { href: "/settings/music",    label: "Nhạc nền",      icon: Music,     desc: "Tải nhạc từ YouTube"          },
  { href: "/settings/channels", label: "Kênh & Đăng",   icon: Radio,     desc: "YouTube, Facebook, lên lịch"  },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <aside className="w-52 shrink-0">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-2 mb-2">Cài đặt</p>
      <nav className="space-y-0.5">
        {ITEMS.map(({ href, label, icon: Icon, desc }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                active
                  ? "bg-rose-600/10 text-rose-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              )}
            >
              <Icon className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-tight">{label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{desc}</p>
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
