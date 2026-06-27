"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Niche } from "@/lib/db/schema";
import type { ContentGenerationRow, UpdateContentStatusInput } from "@/lib/validations/content-generator";
import type { PaginatedGenerations, GalleryFiltersInput } from "@/actions/content-generator";
import {
  getContentGenerationsAction,
  lockContentGenerationAction,
  unlockContentGenerationAction,
  updateContentStatusAction,
  deleteContentGenerationAction,
  regenerateShortHooksAction,
} from "@/actions/content-generator";
import { ContentGalleryToolbar, type GalleryToolbarFilters } from "./content-gallery-toolbar";
import { ContentGalleryGrid } from "./content-gallery-grid";
import { ContentGalleryPagination } from "./content-gallery-pagination";
import { ViewGenerationModal } from "./view-generation-modal";
import { EditStatusModal } from "./edit-status-modal";

export type ContentTab = "short" | "long";

interface Props {
  niches: Niche[];
  initialData: PaginatedGenerations;
  initialTab?: ContentTab;
  initialSearch?: string;
}

function makeDefaultFilters(initialSearch?: string): GalleryToolbarFilters {
  const isId = !!initialSearch && initialSearch.length >= 7 && /^[0-9a-f-]+$/i.test(initialSearch);
  return {
    topic: isId ? "" : (initialSearch ?? ""),
    idSearch: isId ? initialSearch : "",
    nicheIds: [],
    ttsStatus: "",
    youtubeUploadStatus: "",
    isLocked: undefined,
    sortBy: "newest",
  };
}

export function ContentGallery({ niches, initialData, initialTab = "short", initialSearch }: Props) {
  const router = useRouter();
  const [activeTab] = useState<ContentTab>(initialTab);
  const [data, setData] = useState<PaginatedGenerations>(initialData);
  const [filters, setFilters] = useState<GalleryToolbarFilters>(() => makeDefaultFilters(initialSearch));
  const [viewItem, setViewItem] = useState<ContentGenerationRow | null>(null);
  const [editItem, setEditItem] = useState<ContentGenerationRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchData = (newFilters: GalleryToolbarFilters, page: number, perPage: number) => {
    startTransition(async () => {
      const isId = !!newFilters.idSearch;
      const params: GalleryFiltersInput = {
        topic: isId ? undefined : (newFilters.topic || undefined),
        idSearch: isId ? newFilters.idSearch : undefined,
        nicheId: newFilters.nicheIds.length === 1 ? newFilters.nicheIds[0] : undefined,
        // Status filters are bypassed when searching by ID so all statuses are visible
        ttsStatus: isId ? undefined : (newFilters.ttsStatus || undefined),
        youtubeUploadStatus: isId ? undefined : (newFilters.youtubeUploadStatus || undefined),
        isLocked: newFilters.isLocked,
        sortBy: newFilters.sortBy,
        contentType: activeTab,
        page,
        perPage,
      };
      const result = await getContentGenerationsAction(params);
      setData(result);
    });
  };

  const handleFilterChange = (newFilters: GalleryToolbarFilters) => {
    setFilters(newFilters);
    fetchData(newFilters, 1, data.perPage);
    // Sync ?q= URL param so the search is bookmarkable
    const q = newFilters.idSearch || newFilters.topic || "";
    const url = new URL(window.location.href);
    if (q) {
      url.searchParams.set("q", q);
    } else {
      url.searchParams.delete("q");
    }
    router.replace(url.pathname + (url.search || ""), { scroll: false });
  };

  const updateLocal = (id: string, patch: Partial<ContentGenerationRow>) => {
    setData((prev) => ({
      ...prev,
      items: prev.items.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
    if (viewItem?.id === id) setViewItem((prev) => prev ? { ...prev, ...patch } : prev);
    if (editItem?.id === id) setEditItem((prev) => prev ? { ...prev, ...patch } : prev);
  };

  const handleLock   = async (id: string) => { await lockContentGenerationAction(id); updateLocal(id, { isLocked: true, lockedAt: new Date(), lockedBy: "user" }); };
  const handleUnlock = async (id: string) => { await unlockContentGenerationAction(id); updateLocal(id, { isLocked: false, lockedAt: null, lockedBy: null }); };

  const handleTTS = async (id: string, contentType: ContentTab) => {
    const res = await fetch("/api/tts/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: id, contentType }),
    });
    const json = await res.json() as { success?: boolean; audioPath?: string; ttsDurationMs?: number; error?: string };
    if (json.success) {
      updateLocal(id, contentType === "long"
        ? { longTtsStatus: "done", longAudioPath: json.audioPath ?? null, longTtsDurationMs: json.ttsDurationMs ?? null }
        : { ttsStatus: "done", audioPath: json.audioPath ?? null, ttsDurationMs: json.ttsDurationMs ?? null }
      );
    } else {
      updateLocal(id, contentType === "long"
        ? { longTtsStatus: "error", longTtsErrorMessage: json.error ?? "Lỗi" }
        : { ttsStatus: "error", ttsErrorMessage: json.error ?? "Lỗi" }
      );
    }
  };

  const handleImages = async (id: string) => {
    const res = await fetch("/api/images/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: id }),
    });
    const json = await res.json() as { success?: boolean; imagePaths?: string[]; durationMs?: number; costUsd?: number; error?: string };
    if (json.success) {
      updateLocal(id, {
        imagesStatus: "done",
        imagePaths: json.imagePaths ?? [],
        imagesDurationMs: json.durationMs ?? null,
        imagesCostUsd: json.costUsd != null ? json.costUsd.toFixed(6) : null,
      });
    } else {
      updateLocal(id, { imagesStatus: "error", imagesErrorMessage: json.error ?? "Lỗi tạo ảnh" });
    }
  };

  const handleLongImages = async (id: string) => {
    const res = await fetch("/api/images/long/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: id }),
    });
    const json = await res.json() as { success?: boolean; imagePaths?: string[]; thumbnailPath?: string; seoDescription?: string; durationMs?: number; costUsd?: number; error?: string };
    if (json.success) {
      updateLocal(id, {
        longImagesStatus: "done",
        longImagePaths: json.imagePaths ?? [],
        longThumbnailPath: json.thumbnailPath ?? null,
        longYoutubeDescription: json.seoDescription ?? null,
        longImagesDurationMs: json.durationMs ?? null,
        longImagesCostUsd: json.costUsd != null ? json.costUsd.toFixed(6) : null,
      });
    } else {
      updateLocal(id, { longImagesStatus: "error", longImagesErrorMessage: json.error ?? "Lỗi tạo ảnh dài" });
    }
  };

  const handleVideo = async (id: string, contentType: ContentTab) => {
    const url = contentType === "long" ? "/api/video/long/run" : "/api/video/short/run";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: id }),
    });
    const json = await res.json() as { success?: boolean; videoPath?: string; durationMs?: number; error?: string };
    if (json.success) {
      updateLocal(id, contentType === "long"
        ? { longVideoStatus: "done", longVideoPath: json.videoPath ?? null, longVideoErrorMessage: null }
        : { videoStatus: "done", videoPath: json.videoPath ?? null, videoErrorMessage: null }
      );
    } else {
      updateLocal(id, contentType === "long"
        ? { longVideoStatus: "error", longVideoErrorMessage: json.error ?? "Lỗi dựng video" }
        : { videoStatus: "error", videoErrorMessage: json.error ?? "Lỗi dựng video" }
      );
    }
  };

  const handleYoutubeUpload = async (id: string) => {
    if (activeTab === "long") {
      updateLocal(id, { longYoutubeUploadStatus: "processing", longYoutubeUploadError: null });
    } else {
      updateLocal(id, { youtubeUploadStatus: "processing", youtubeUploadError: null });
    }
    const res = await fetch("/api/youtube/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: id, contentType: activeTab }),
    });
    const json = await res.json() as { success?: boolean; videoUrl?: string; error?: string };
    if (json.success) {
      updateLocal(id, activeTab === "long"
        ? { longYoutubeUploadStatus: "done", longYoutubeVideoUrl: json.videoUrl ?? null, longYoutubeUploadError: null }
        : { youtubeUploadStatus: "done", youtubeVideoUrl: json.videoUrl ?? null, youtubeUploadError: null }
      );
    } else {
      updateLocal(id, activeTab === "long"
        ? { longYoutubeUploadStatus: "error", longYoutubeUploadError: json.error ?? "Lỗi upload" }
        : { youtubeUploadStatus: "error", youtubeUploadError: json.error ?? "Lỗi upload" }
      );
    }
  };

  const handleRegenerateHooks = async (id: string) => {
    const result = await regenerateShortHooksAction(id);
    if (!result.success) {
      alert(result.error);
      return;
    }
    updateLocal(id, {
      shortContent: result.shortContent,
      shortHookCandidates: result.shortHookCandidates,
      shortSelectedHook: result.shortSelectedHook,
      ttsStatus: "pending",
      ttsErrorMessage: null,
      ttsOutputUrl: null,
      audioPath: null,
      ttsDurationMs: null,
      imagesStatus: "pending",
      imagesErrorMessage: null,
      imagePaths: [],
      imagesDurationMs: null,
      imagesCostUsd: null,
      videoStatus: "pending",
      videoErrorMessage: null,
      videoPath: null,
      youtubeUploadStatus: "pending",
      youtubeUploadError: null,
      youtubeVideoUrl: null,
      youtubeScheduledAt: null,
      facebookUploadStatus: "pending",
      facebookUploadError: null,
      facebookVideoUrl: null,
      completedAt: null,
      mediaCleanedAt: null,
    });
  };

  const handleDelete = async (id: string) => {
    const item = data.items.find((g) => g.id === id);
    const hasTts    = !!(item?.audioPath || item?.longAudioPath);
    const hasImages = !!(item?.imagePaths?.length);
    const hasVideo  = !!(item?.videoPath || item?.longVideoPath);

    const parts: string[] = ["nội dung"];
    if (hasTts)    parts.push("audio TTS");
    if (hasImages) parts.push("ảnh đã tạo");
    if (hasVideo)  parts.push("video");

    const msg =
      `Xóa ${parts.join(", ")}?\n\n` +
      `Tất cả file media liên quan sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`;

    if (!confirm(msg)) return;
    await deleteContentGenerationAction(id);
    setData((prev) => ({ ...prev, items: prev.items.filter((g) => g.id !== id), total: prev.total - 1 }));
  };

  const handleEditSave = async (id: string, updates: UpdateContentStatusInput) => {
    await updateContentStatusAction(id, updates);
    updateLocal(id, {
      ...(updates.ttsStatus !== undefined        ? { ttsStatus: updates.ttsStatus }               : {}),
      ...(updates.ttsErrorMessage !== undefined  ? { ttsErrorMessage: updates.ttsErrorMessage }   : {}),
      ...(updates.youtubeUploadStatus !== undefined ? { youtubeUploadStatus: updates.youtubeUploadStatus } : {}),
      ...(updates.youtubeScheduledAt !== undefined  ? { youtubeScheduledAt: updates.youtubeScheduledAt }   : {}),
      ...(updates.youtubeUploadError !== undefined  ? { youtubeUploadError: updates.youtubeUploadError }   : {}),
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Filters ───────────────────────────────────────────── */}
      <ContentGalleryToolbar
        niches={niches}
        filters={filters}
        total={data.total}
        showing={data.items.length}
        isLoading={isPending}
        onFilterChange={handleFilterChange}
      />

      {/* ── Grid ──────────────────────────────────────────────── */}
      <ContentGalleryGrid
        items={data.items}
        activeTab={activeTab}
        isLoading={isPending}
        searchTerm={filters.idSearch || filters.topic || undefined}
        onView={setViewItem}
        onEditStatus={setEditItem}
        onLock={handleLock}
        onUnlock={handleUnlock}
        onDelete={handleDelete}
        onTTS={handleTTS}
        onImages={handleImages}
        onLongImages={handleLongImages}
        onVideo={(id) => handleVideo(id, activeTab)}
        onYoutubeUpload={handleYoutubeUpload}
        onRegenerateHooks={handleRegenerateHooks}
        onLocalUpdate={updateLocal}
      />

      {data.total > data.perPage && (
        <ContentGalleryPagination
          page={data.page}
          perPage={data.perPage}
          total={data.total}
          hasNextPage={data.hasNextPage}
          hasPrevPage={data.hasPrevPage}
          onPageChange={(page) => fetchData(filters, page, data.perPage)}
          onPerPageChange={(perPage) => fetchData(filters, 1, perPage)}
        />
      )}

      {viewItem && <ViewGenerationModal generation={viewItem} onClose={() => setViewItem(null)} />}
      {editItem && (
        <EditStatusModal generation={editItem} onSave={handleEditSave} onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}
