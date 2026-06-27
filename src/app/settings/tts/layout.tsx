import { TtsSubnav } from "@/components/settings/tts-subnav";

export default function TtsSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <TtsSubnav />
      {children}
    </div>
  );
}
