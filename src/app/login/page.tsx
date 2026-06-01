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
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-xl border border-slate-700 bg-slate-900 shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-100">
            {process.env.NEXT_PUBLIC_APP_NAME ?? "Content Pipeline"}
          </h1>
          <p className="text-sm text-slate-400">
            Nhập mật khẩu để tiếp tục
          </p>
        </div>

        <form action={action} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-100"
            >
              Mật khẩu
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="••••••••"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Đăng nhập
          </button>
        </form>
      </div>
    </div>
  );
}
