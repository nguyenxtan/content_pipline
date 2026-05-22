"use client";

import { useState, useTransition } from "react";
import type { Niche } from "@/lib/db/schema";
import type { ContentGenerationRow, UpdateContentStatusInput } from "@/lib/validations/content-generator";
import type { PaginatedGenerations, GalleryFiltersInput } from "@/actions/content-generator";
import {
  getContentGenerationsAction,
  lockContentGenerationAction,
  unlockContentGenerationAction,
  updateContentStatusAction,
} from "@/actions/content-generator";
import { ContentGalleryToolbar, type GalleryToolbarFilters } from "./content-gallery-toolbar";
import { ContentGalleryGrid } from "./content-gallery-grid";
import { ContentGalleryPagination } from "./content-gallery-pagination";
import { ViewGenerationModal } from "./view-generation-modal";
import { EditStatusModal } from "./edit-status-modal";

interface Props {
  niches: Niche[];
  initialData: PaginatedGenerations;
}

const DEFAULT_FILTERS: GalleryToolbarFilters = {
  topic: "",
  nicheIds: [],
  ttsStatus: "",
  youtubeUploadStatus: "",
  isLocked: undefined,
  sortBy: "newest",
};

export function ContentGallery({ niches, initialData }: Props) {
  const [data, setData] = useState<PaginatedGenerations>(initialData);
  const [filters, setFilters] = useState<GalleryToolbarFilters>(DEFAULT_FILTERS);
  const [viewItem, setViewItem] = useState<ContentGenerationRow | null>(null);
  const [editItem, setEditItem] = useState<ContentGenerationRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetch = (newFilters: GalleryToolbarFilters, page: number, perPage: number) => {
    startTransition(async () => {
      const params: GalleryFiltersInput = {
        topic: newFilters.topic || undefined,
        nicheId: newFilters.nicheIds.length === 1 ? newFilters.nicheIds[0] : undefined,
        ttsStatus: newFilters.ttsStatus || undefined,
        youtubeUploadStatus: newFilters.youtubeUploadStatus || undefined,
        isLocked: newFilters.isLocked,
        sortBy: newFilters.sortBy,
        page,
        perPage,
      };
      const result = await getContentGenerationsAction(params);
      setData(result);
    });
  };

  const handleFilterChange = (newFilters: GalleryToolbarFilters) => {
    setFilters(newFilters);
    fetch(newFilters, 1, data.perPage);
  };

  const handlePageChange = (page: number) => {
    fetch(filters, page, data.perPage);
  };

  const handlePerPageChange = (perPage: number) => {
    fetch(filters, 1, perPage);
  };

  const updateLocal = (id: string, patch: Partial<ContentGenerationRow>) => {
    setData((prev) => ({
      ...prev,
      items: prev.items.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
    if (viewItem?.id === id) setViewItem((prev) => prev ? { ...prev, ...patch } : prev);
    if (editItem?.id === id) setEditItem((prev) => prev ? { ...prev, ...patch } : prev);
  };

  const handleLock = async (id: string) => {
    await lockContentGenerationAction(id);
    updateLocal(id, { isLocked: true, lockedAt: new Date(), lockedBy: "user" });
  };

  const handleUnlock = async (id: string) => {
    await unlockContentGenerationAction(id);
    updateLocal(id, { isLocked: false, lockedAt: null, lockedBy: null });
  };

  const handleEditSave = async (id: string, updates: UpdateContentStatusInput) => {
    await updateContentStatusAction(id, updates);
    updateLocal(id, {
      ...(updates.ttsStatus !== undefined ? { ttsStatus: updates.ttsStatus } : {}),
      ...(updates.ttsErrorMessage !== undefined ? { ttsErrorMessage: updates.ttsErrorMessage } : {}),
      ...(updates.youtubeUploadStatus !== undefined ? { youtubeUploadStatus: updates.youtubeUploadStatus } : {}),
      ...(updates.youtubeScheduledAt !== undefined ? { youtubeScheduledAt: updates.youtubeScheduledAt } : {}),
      ...(updates.youtubeUploadError !== undefined ? { youtubeUploadError: updates.youtubeUploadError } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <ContentGalleryToolbar
        niches={niches}
        filters={filters}
        total={data.total}
        showing={data.items.length}
        isLoading={isPending}
        onFilterChange={handleFilterChange}
      />

      <ContentGalleryGrid
        items={data.items}
        isLoading={isPending}
        onView={setViewItem}
        onEditStatus={setEditItem}
        onLock={handleLock}
        onUnlock={handleUnlock}
        onLocalUpdate={updateLocal}
      />

      {data.total > data.perPage && (
        <ContentGalleryPagination
          page={data.page}
          perPage={data.perPage}
          total={data.total}
          hasNextPage={data.hasNextPage}
          hasPrevPage={data.hasPrevPage}
          onPageChange={handlePageChange}
          onPerPageChange={handlePerPageChange}
        />
      )}

      {viewItem && (
        <ViewGenerationModal generation={viewItem} onClose={() => setViewItem(null)} />
      )}
      {editItem && (
        <EditStatusModal
          generation={editItem}
          onSave={handleEditSave}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}
