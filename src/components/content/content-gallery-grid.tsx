"use client";

import { useState } from "react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";
import { ContentGalleryCard } from "./content-gallery-card";

interface Props {
  items: ContentGenerationRow[];
  isLoading: boolean;
  onView: (item: ContentGenerationRow) => void;
  onEditStatus: (item: ContentGenerationRow) => void;
  onLock: (id: string) => Promise<void>;
  onUnlock: (id: string) => Promise<void>;
  onLocalUpdate: (id: string, patch: Partial<ContentGenerationRow>) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3 animate-pulse">
      <div className="h-4 bg-slate-700 rounded w-3/4" />
      <div className="h-3 bg-slate-700 rounded w-1/2" />
      <div className="h-5 bg-slate-700 rounded w-24" />
      <div className="h-5 bg-slate-700 rounded w-20" />
      <div className="h-px bg-slate-700" />
      <div className="flex gap-2">
        <div className="flex-1 h-7 bg-slate-700 rounded" />
        <div className="flex-1 h-7 bg-slate-700 rounded" />
        <div className="w-10 h-7 bg-slate-700 rounded" />
      </div>
    </div>
  );
}

export function ContentGalleryGrid({
  items,
  isLoading,
  onView,
  onEditStatus,
  onLock,
  onUnlock,
  onLocalUpdate,
}: Props) {
  const [lockLoadingId, setLockLoadingId] = useState<string | null>(null);

  const handleLock = async (id: string) => {
    setLockLoadingId(id);
    await onLock(id);
    onLocalUpdate(id, { isLocked: true, lockedAt: new Date(), lockedBy: "user" });
    setLockLoadingId(null);
  };

  const handleUnlock = async (id: string) => {
    setLockLoadingId(id);
    await onUnlock(id);
    onLocalUpdate(id, { isLocked: false, lockedAt: null, lockedBy: null });
    setLockLoadingId(null);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-400 text-sm">Không có kết quả nào phù hợp.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((item) => (
        <ContentGalleryCard
          key={item.id}
          generation={item}
          onView={() => onView(item)}
          onEditStatus={() => onEditStatus(item)}
          onLock={() => handleLock(item.id)}
          onUnlock={() => handleUnlock(item.id)}
          isLockLoading={lockLoadingId === item.id}
        />
      ))}
    </div>
  );
}
