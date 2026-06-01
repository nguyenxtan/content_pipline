function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "");
}

function extractTopicWords(rawTitle: string): string[] {
  return rawTitle
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .map((w) => w.replace(/[^a-zA-Z0-9À-ỹ]/g, ""));
}

function buildShortDescription(rawTitle: string, nicheSlug: string, topicWords: string[]): string {
  const summary = `Goc nhin ngan ve ${rawTitle.trim()}.`.slice(0, 140);
  const cta = "Theo doi kenh de xem them video cung chu de.";
  const hashtags = ["#Shorts", `#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return [summary, cta, hashtags].join("\n");
}

export function buildFacebookReelDescription(input: {
  topic: string;
  nicheName: string;
  shortContent?: string | null;
}): string {
  const rawTitle = input.topic || "Video";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const summary = input.shortContent?.trim()
    ? input.shortContent.trim().slice(0, 260)
    : `Goc nhin ngan ve ${rawTitle.trim()}.`.slice(0, 260);
  const hashtags = [`#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return [summary, hashtags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export function buildFacebookQuoteText(input: {
  topic: string;
  shortContent?: string | null;
}): string {
  const normalized = (input.shortContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const sentence = normalized
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 40);

  const base = sentence && sentence.length > 0
    ? sentence
    : `Mỗi ngày là một cơ hội để quán chiếu sâu hơn về ${input.topic.trim()}.`;

  if (base.length <= 170) return base;

  const clipped = base.slice(0, 167);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 60 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

export function buildFacebookQuotePostDescription(input: {
  topic: string;
  nicheName: string;
  shortContent?: string | null;
}): string {
  const rawTitle = input.topic || "Bai viet";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const quote = buildFacebookQuoteText({
    topic: input.topic,
    shortContent: input.shortContent,
  });
  const hashtags = [`#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return [`“${quote}”`, hashtags].filter(Boolean).join("\n\n").slice(0, 2200);
}

export function buildYouTubeVideoMetadata(input: {
  contentType: "short" | "long";
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  longContent?: string | null;
  longYoutubeDescription?: string | null;
}): {
  title: string;
  description: string;
  tags: string[];
} {
  const rawTitle = input.topic || "Video";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const hashtagWords = [nicheSlug, ...topicWords.map(slugify)].filter(Boolean);

  if (input.contentType === "long") {
    const hashtags = ["#viral", ...hashtagWords.map((w) => `#${w}`)].join(" ");
    const seoBase = input.longYoutubeDescription?.trim()
      ? input.longYoutubeDescription.trim()
      : input.longContent?.slice(0, 4800) ?? "";
    return {
      title: rawTitle.slice(0, 100),
      description: [seoBase, "", hashtags].join("\n").slice(0, 5000),
      tags: ["viral", nicheSlug, ...topicWords].filter(Boolean),
    };
  }

  return {
    title: (rawTitle.length <= 93 ? `${rawTitle} #Shorts` : rawTitle).slice(0, 100),
    description: buildShortDescription(rawTitle, nicheSlug, topicWords).slice(0, 5000),
    tags: ["shorts", nicheSlug, ...topicWords].filter(Boolean),
  };
}

export function buildDefaultVideoTitle(input: {
  platform: "youtube" | "facebook";
  contentType: "short" | "long" | "quote";
  topic: string;
}): string {
  const rawTitle = input.topic || "Video";
  if (input.platform === "youtube" && input.contentType === "short") {
    return (rawTitle.length <= 93 ? `${rawTitle} #Shorts` : rawTitle).slice(0, 100);
  }
  if (input.platform === "facebook" && input.contentType === "quote") {
    return buildFacebookQuoteText({ topic: input.topic }).slice(0, 100);
  }
  return rawTitle.slice(0, 100);
}

export function buildDefaultVideoDescription(input: {
  platform: "youtube" | "facebook";
  contentType: "short" | "long" | "quote";
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  longContent?: string | null;
  longYoutubeDescription?: string | null;
}): string {
  if (input.platform === "facebook") {
    if (input.contentType === "quote") {
      return buildFacebookQuotePostDescription({
        topic: input.topic,
        nicheName: input.nicheName,
        shortContent: input.shortContent,
      });
    }
    return buildFacebookReelDescription({
      topic: input.topic,
      nicheName: input.nicheName,
      shortContent: input.shortContent,
    });
  }

  if (input.contentType === "quote") {
    return "";
  }

  return buildYouTubeVideoMetadata({
    contentType: input.contentType as "short" | "long",
    topic: input.topic,
    nicheName: input.nicheName,
    shortContent: input.shortContent,
    longContent: input.longContent,
    longYoutubeDescription: input.longYoutubeDescription,
  }).description;
}
