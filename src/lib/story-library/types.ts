export type StoryLibrarySite = "truyenfull.today";

export type StoryLibraryFallbackInspectionVerdict =
  | "valid_fallback"
  | "gated_or_unreadable"
  | "wrong_story_or_chapter"
  | "empty_or_placeholder"
  | "parser_needed"
  | "inconclusive";

export type StoryLibraryCrawlStatus = "queued" | "crawling" | "done" | "partial" | "failed";
export type StoryLibraryChapterCrawlStatus = "queued" | "crawling" | "done" | "failed";
export type StoryCrawlerRunMode = "catalog" | "story" | "chapters" | "resume" | "retry_failed";
export type StoryCrawlerRunStatus = "running" | "completed" | "failed" | "skipped_overlap";
export type StoryCrawlerEventLevel = "info" | "warn" | "error";

export type ParsedCatalogStory = {
  title: string;
  sourceUrl: string;
  slug: string;
  author?: string | null;
  chapterLabel?: string | null;
};

export type ParsedStoryChapterRef = {
  chapterNumber: number;
  chapterTitle: string;
  chapterUrl: string;
};

export type ParsedStoryDetail = {
  sourceUrl: string;
  slug: string;
  title: string;
  author?: string | null;
  genres: string[];
  status?: string | null;
  intro?: string | null;
  chapterCount: number;
  chapterPageCount: number;
  chapters: ParsedStoryChapterRef[];
};

export type ParsedChapterContent = {
  storyTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  contentText: string;
  wordCount: number;
};

export type CrawlRunOptions = {
  dryRun?: boolean;
  maxConcurrency?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  requestTimeoutSecs?: number;
  maxRequestRetries?: number;
};

export type CrawlStoriesOptions = CrawlRunOptions & {
  site: StoryLibrarySite;
  limitStories?: number;
};

export type CrawlStoryOptions = CrawlRunOptions & {
  site: StoryLibrarySite;
  storyUrl: string;
};

export type CrawlStoryChaptersOptions = CrawlRunOptions & {
  storyId: string;
  limitChapters?: number;
};

export type ResumeStoryCrawlOptions = CrawlRunOptions & {
  site: StoryLibrarySite;
  sourceSite?: StoryLibrarySite;
  maxStories?: number;
  maxChapters?: number;
  failedOnly?: boolean;
};
