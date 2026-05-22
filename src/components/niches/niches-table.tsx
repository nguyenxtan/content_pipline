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
        currentValue ? "Đã tắt ngách" : "Đã kích hoạt ngách"
      );
    });
  }

  function handleDelete(id: number) {
    startTransition(async () => {
      await deleteNicheAction(id);
      toast.success("Đã xóa ngách");
    });
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      {/* Filters */}
      <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter(searchValue, filter ?? "all");
            }}
            placeholder="Tìm theo tên hoặc slug..."
            className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent pl-9 pr-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => applyFilter(searchValue, f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                (filter ?? "all") === f
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
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
          <p className="text-[hsl(var(--muted-foreground))]">
            Chưa có ngách nào.
          </p>
          <Link
            href="/niches/new"
            className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            Tạo ngách đầu tiên
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                  Tên
                </th>
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                  Slug
                </th>
                <th className="hidden px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))] md:table-cell">
                  Mô tả
                </th>
                <th className="px-4 py-3 text-center font-medium text-[hsl(var(--muted-foreground))]">
                  Trạng thái
                </th>
                <th className="hidden px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))] lg:table-cell">
                  Cập nhật
                </th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--muted-foreground))]">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {niches.map((niche) => (
                <tr
                  key={niche.id}
                  className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--accent))]/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/niches/${niche.id}`}
                      className="flex items-center gap-2 font-medium text-[hsl(var(--foreground))] hover:underline"
                    >
                      {niche.icon && (
                        <span className="text-base leading-none">{niche.icon}</span>
                      )}
                      {niche.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                    {niche.slug}
                  </td>
                  <td className="hidden px-4 py-3 text-[hsl(var(--muted-foreground))] md:table-cell max-w-xs truncate">
                    {niche.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        niche.isActive
                          ? "bg-green-500/15 text-green-400"
                          : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      {niche.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-[hsl(var(--muted-foreground))] lg:table-cell whitespace-nowrap">
                    {formatDate(niche.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Toggle active */}
                      <button
                        onClick={() =>
                          handleToggle(niche.id, niche.isActive)
                        }
                        disabled={isPending}
                        title={niche.isActive ? "Tắt ngách" : "Kích hoạt"}
                        className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors disabled:opacity-50"
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
                        className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
                        title="Chỉnh sửa"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>

                      {/* Delete */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            disabled={isPending}
                            title="Xóa ngách"
                            className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[hsl(var(--card))] border-[hsl(var(--border))]">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-[hsl(var(--foreground))]">
                              Xóa ngách?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-[hsl(var(--muted-foreground))]">
                              Thao tác này sẽ xóa vĩnh viễn ngách{" "}
                              <strong className="text-[hsl(var(--foreground))]">
                                {niche.name}
                              </strong>{" "}
                              và toàn bộ prompt templates liên quan. Không thể
                              hoàn tác.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-[hsl(var(--border))] text-[hsl(var(--foreground))]">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
