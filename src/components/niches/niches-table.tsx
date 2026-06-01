"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, ToggleLeft, ToggleRight, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { toggleNicheActiveAction, deleteNicheAction } from "@/actions/niches";
import type { Niche } from "@/lib/db/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface NichesTableProps {
  niches: Niche[];
  search?: string;
  filter?: string;
}

export function NichesTable({ niches, search, filter }: NichesTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(search ?? "");

  function applyFilter(newSearch: string, newFilter: string) {
    const params = new URLSearchParams();
    if (newSearch) params.set("search", newSearch);
    if (newFilter && newFilter !== "all") params.set("filter", newFilter);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleToggle(id: number, currentValue: boolean) {
    startTransition(async () => {
      await toggleNicheActiveAction(id, currentValue);
      toast.success(
        currentValue ? "Đã tắt phân mục" : "Đã kích hoạt phân mục"
      );
    });
  }

  function handleDelete(id: number) {
    startTransition(async () => {
      await deleteNicheAction(id);
      toast.success("Đã xóa phân mục");
    });
  }

  // Group niches by category
  const grouped = niches.reduce<Record<string, Niche[]>>((acc, n) => {
    const key = n.category || "Chưa phân loại";
    if (!acc[key]) acc[key] = [];
    acc[key].push(n);
    return acc;
  }, {});

  // Sort: named categories first, "Chưa phân loại" last
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "Chưa phân loại") return 1;
    if (b === "Chưa phân loại") return -1;
    return a.localeCompare(b, "vi");
  });

  const NicheRow = ({ niche }: { niche: Niche }) => (
    <tr className="border-b border-slate-700 last:border-0 hover:bg-slate-800/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/niches/${niche.id}`}
          className="flex items-center gap-2 font-medium text-slate-100 hover:underline"
        >
          {niche.icon && (
            <span className="text-base leading-none">{niche.icon}</span>
          )}
          {niche.name}
        </Link>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-400">
        {niche.slug}
      </td>
      <td className="hidden px-4 py-3 text-slate-400 md:table-cell max-w-xs truncate">
        {niche.description ?? "—"}
      </td>
      <td className="px-4 py-3 text-center">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            niche.isActive
              ? "bg-green-500/15 text-green-400"
              : "bg-slate-800/50 text-slate-400"
          }`}
        >
          {niche.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="hidden px-4 py-3 text-slate-400 lg:table-cell whitespace-nowrap">
        {formatDate(niche.updatedAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {/* Toggle active */}
          <button
            onClick={() => handleToggle(niche.id, niche.isActive)}
            disabled={isPending}
            title={niche.isActive ? "Tắt phân mục" : "Kích hoạt"}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors disabled:opacity-50"
          >
            {niche.isActive ? (
              <ToggleRight className="h-4 w-4 text-green-400" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>

          {/* Edit */}
          <Link
            href={`/niches/${niche.id}`}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            title="Chỉnh sửa"
          >
            <Pencil className="h-4 w-4" />
          </Link>

          {/* Delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={isPending}
                title="Xóa phân mục"
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-slate-900 border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">
                  Xóa phân mục?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  Thao tác này sẽ xóa vĩnh viễn phân mục{" "}
                  <strong className="text-slate-100">
                    {niche.name}
                  </strong>{" "}
                  và toàn bộ prompt templates liên quan. Không thể hoàn tác.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-700 text-slate-100">
                  Hủy
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleDelete(niche.id)}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  Xóa
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900">
      {/* Filters */}
      <div className="flex flex-col gap-3 border-b border-slate-700 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter(searchValue, filter ?? "all");
            }}
            placeholder="Tìm theo tên hoặc slug..."
            className="w-full rounded-md border border-slate-600 bg-transparent pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => applyFilter(searchValue, f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                (filter ?? "all") === f
                  ? "bg-rose-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              {f === "all" ? "Tất cả" : f === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {niches.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <p className="text-slate-400">Chưa có phân mục nào.</p>
          <Link
            href="/niches/new"
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Tạo phân mục đầu tiên
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {groupKeys.map((groupKey) => (
            <div key={groupKey}>
              {/* Group header */}
              <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-800/40 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {groupKey}
                </span>
                <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                  {grouped[groupKey].length}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Tên</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Slug</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-slate-500 md:table-cell">Mô tả</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">Trạng thái</th>
                    <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-slate-500 lg:table-cell">Cập nhật</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[groupKey].map((niche) => (
                    <NicheRow key={niche.id} niche={niche} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
