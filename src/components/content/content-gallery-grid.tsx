"use client";

import { useState } from "react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";
import type { ContentTab } from "./content-gallery";
import { ContentGalleryCard } from "./content-gallery-card";
import { ScheduleUploadModal } from "@/components/channels/schedule-upload-modal";

interface Props {
  items: ContentGenerationRow[];
  activeTab: ContentTab;
  isLoading: boolean;
  searchTerm?: string;
  onView: (item: ContentGenerationRow) => void;
  onEditStatus: (item: ContentGenerationRow) => void;
  onLock: (id: string) => Promise<void>;
  onUnlock: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTTS: (id: string, contentType: ContentTab) => Promise<void>;
  onImages: (id: string) => Promise<void>;
  onLongImages: (id: string) => Promise<void>;
  onVideo: (id: string) => Promise<void>;
  onYoutubeUpload: (id: string) => Promise<void>;
  onRegenerateHooks: (id: string) => Promise<void>;
  onLocalUpdate: (id: string, patch: Partial<ContentGenerationRow>) => void;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 animate-pulse">
      <div className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-slate-700 rounded w-2/3" />
        <div className="h-2.5 bg-slate-800 rounded w-1/3" />
      </div>
      <div className="hidden sm:flex gap-1">
        <div className="h-5 w-14 bg-slate-800 rounded" />
        <div className="h-5 w-14 bg-slate-800 rounded" />
        <div className="h-5 w-16 bg-slate-800 rounded" />
      </div>
      <div className="h-5 w-20 bg-slate-800 rounded-full hidden md:block" />
      <div className="h-3 w-6 bg-slate-800 rounded" />
    </div>
  );
}

export function ContentGalleryGrid({
  items,
  activeTab,
  isLoading,
  searchTerm,
  onView,
  onEditStatus,
  onLock,
  onUnlock,
  onDelete,
  onTTS,
  onImages,
  onLongImages,
  onVideo,
  onYoutubeUpload,
  onRegenerateHooks,
  onLocalUpdate,
}: Props) {
  const [lockLoadingId, setLockLoadingId]               = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId]                 = useState<string | null>(null);
  const [imagesLoadingId, setImagesLoadingId]           = useState<string | null>(null);
  const [longImagesLoadingId, setLongImagesLoadingId]   = useState<string | null>(null);
  const [videoLoadingId, setVideoLoadingId]             = useState<string | null>(null);
  const [youtubeLoadingId, setYoutubeLoadingId]         = useState<string | null>(null);
  const [hookLoadingId, setHookLoadingId]               = useState<string | null>(null);
  const [scheduleModal, setScheduleModal]               = useState<{ item: ContentGenerationRow; videoType: "short" | "long" | "quote" } | null>(null);

  const handleTTS = async (id: string) => {
    setTtsLoadingId(id);
    if (activeTab === "long") {
      onLocalUpdate(id, { longTtsStatus: "processing" });
    } else {
      onLocalUpdate(id, { ttsStatus: "processing" });
    }
    try {
      await onTTS(id, activeTab);
    } finally {
      setTtsLoadingId(null);
    }
  };

  const handleImages = async (id: string) => {
    setImagesLoadingId(id);
    onLocalUpdate(id, { imagesStatus: "processing", imagePaths: [], imagesDurationMs: null, imagesCostUsd: null });
    try {
      await onImages(id);
    } finally {
      setImagesLoadingId(null);
    }
  };

  const handleLongImages = async (id: string) => {
    setLongImagesLoadingId(id);
    onLocalUpdate(id, { longImagesStatus: "processing", longImagePaths: [], longImagesDurationMs: null, longImagesCostUsd: null, longThumbnailPath: null });
    try {
      await onLongImages(id);
    } finally {
      setLongImagesLoadingId(null);
    }
  };

  const handleVideo = async (id: string) => {
    setVideoLoadingId(id);
    if (activeTab === "long") {
      onLocalUpdate(id, { longVideoStatus: "processing", longVideoErrorMessage: null });
    } else {
      onLocalUpdate(id, { videoStatus: "processing", videoErrorMessage: null });
    }
    try {
      await onVideo(id);
    } finally {
      setVideoLoadingId(null);
    }
  };

  const handleYoutubeUpload = async (id: string) => {
    setYoutubeLoadingId(id);
    try {
      await onYoutubeUpload(id);
    } finally {
      setYoutubeLoadingId(null);
    }
  };

  const handleRegenerateHooks = async (id: string) => {
    setHookLoadingId(id);
    try {
      await onRegenerateHooks(id);
    } finally {
      setHookLoadingId(null);
    }
  };

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
      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-800/50">
          <div className="w-2 shrink-0" />
          <span className="flex-1 text-[11px] font-medium text-slate-500 uppercase tracking-wider">Chủ đề</span>
          <span className="hidden sm:block text-[11px] font-medium text-slate-500 uppercase tracking-wider w-32 text-center">Pipeline</span>
          <span className="hidden md:block text-[11px] font-medium text-slate-500 uppercase tracking-wider w-24 text-center">Trạng thái</span>
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider w-8 text-right">Thời gian</span>
        </div>
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  if (items.length === 0) {
    const isIdSearch = !!searchTerm && searchTerm.length >= 7 && /^[0-9a-f-]+$/i.test(searchTerm);
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 py-16 text-center space-y-2">
        <p className="text-slate-400 text-sm">Không có kết quả phù hợp.</p>
        {searchTerm && (
          <p className="text-slate-600 text-xs">
            {isIdSearch ? "ID" : "Chủ đề"}: <span className="font-mono text-slate-500">&ldquo;{searchTerm}&rdquo;</span>
          </p>
        )}
        <p className="text-slate-700 text-xs">
          {isIdSearch
            ? "Thử đầy đủ UUID hoặc xóa bộ lọc."
            : "Thử tên chủ đề khác, hoặc nhập 8 ký tự đầu của ID."}
        </p>
      </div>
    );
  }

  return (
    <>
    {scheduleModal && (
      <ScheduleUploadModal
        content={scheduleModal.item}
        videoType={scheduleModal.videoType}
        onClose={() => setScheduleModal(null)}
      />
    )}
    <div className="rounded-xl border border-slate-700 bg-slate-900">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800/60 rounded-t-xl overflow-hidden">
        <div className="w-2 shrink-0" />
        <span className="flex-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Chủ đề</span>
        <span className="hidden sm:block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Pipeline</span>
        <span className="hidden md:block text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-24 text-center">Trạng thái</span>
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-6 text-right">Thời gian</span>
        <div className="w-24 shrink-0" />
      </div>

      {items.map((item) => (
        <ContentGalleryCard
          key={item.id}
          generation={item}
          activeTab={activeTab}
          onView={() => onView(item)}
          onEditStatus={() => onEditStatus(item)}
          onLock={() => handleLock(item.id)}
          onUnlock={() => handleUnlock(item.id)}
          onDelete={() => onDelete(item.id)}
          onTTS={async () => handleTTS(item.id)}
          onImages={async () => handleImages(item.id)}
          onLongImages={async () => handleLongImages(item.id)}
          onVideo={async () => handleVideo(item.id)}
          onYoutubeUpload={async () => handleYoutubeUpload(item.id)}
          onRegenerateHooks={async () => handleRegenerateHooks(item.id)}
          onScheduleShort={() => setScheduleModal({ item, videoType: "short" })}
          onScheduleQuote={() => setScheduleModal({ item, videoType: "quote" })}
          onScheduleLong={() => setScheduleModal({ item, videoType: "long" })}
          isLockLoading={lockLoadingId === item.id}
          isTTSLoading={ttsLoadingId === item.id}
          isImagesLoading={imagesLoadingId === item.id}
          isLongImagesLoading={longImagesLoadingId === item.id}
          isVideoLoading={videoLoadingId === item.id}
          isYoutubeLoading={youtubeLoadingId === item.id}
          isHookLoading={hookLoadingId === item.id}
        />
      ))}
    </div>
    </>
  );
}
