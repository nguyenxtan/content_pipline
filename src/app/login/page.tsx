"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/actions/auth";
import { Lock, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [state, action, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    null
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">
            {process.env.NEXT_PUBLIC_APP_NAME ?? "Content Pipeline"}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Nhập mật khẩu để tiếp tục
          </p>
        </div>

        <form action={action} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="text-sm font-medium text-[hsl(var(--foreground))]"
            >
              Mật khẩu
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              placeholder="••••••••"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Đăng nhập
          </button>
        </form>
      </div>
    </div>
  );
}
