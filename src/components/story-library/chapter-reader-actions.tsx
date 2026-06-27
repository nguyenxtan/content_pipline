"use client";

import { useState, useTransition } from "react";
import { markStoryLibraryChapterReviewedAction } from "@/actions/story-library";

export function ChapterReaderActions(props: {
  chapterId: string;
  contentText: string;
  reviewedAt: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [reviewedAt, setReviewedAt] = useState<string | null>(props.reviewedAt);
  const [isPending, startTransition] = useTransition();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.contentText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleMarkReviewed = () => {
    startTransition(async () => {
      const updated = await markStoryLibraryChapterReviewedAction(props.chapterId);
      setReviewedAt(updated?.reviewedAt ? new Date(updated.reviewedAt).toISOString() : new Date().toISOString());
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500"
      >
        {copied ? "Da copy" : "Copy text"}
      </button>
      <button
        type="button"
        onClick={handleMarkReviewed}
        disabled={isPending || Boolean(reviewedAt)}
        className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        {reviewedAt ? "Da kiem tra" : isPending ? "Dang luu..." : "Mark checked"}
      </button>
      {reviewedAt && (
        <span className="text-xs text-slate-400">
          Checked {new Date(reviewedAt).toLocaleString("vi-VN")}
        </span>
      )}
    </div>
  );
}
