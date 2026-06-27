export type TTSChunk = {
  index: number;
  text: string;
  wordCount: number;
  charCount: number;
};

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_TARGET_WORDS = 180;
const DEFAULT_MIN_WORDS = 120;
const HARD_MAX_WORDS = 260;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitIntoSentences(paragraph: string): string[] {
  return (paragraph.match(/[^.!?…]+(?:[.!?…]+(?:["')\]]+)?)?|.+$/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function chunkTextForTTS(
  text: string,
  options?: { maxCharsPerChunk?: number; targetWords?: number; minWords?: number },
): TTSChunk[] {
  const maxCharsPerChunk = options?.maxCharsPerChunk ?? Number(process.env.TTS_MAX_CHARS_PER_CHUNK ?? DEFAULT_MAX_CHARS);
  const targetWords = options?.targetWords ?? DEFAULT_TARGET_WORDS;
  const minWords = options?.minWords ?? DEFAULT_MIN_WORDS;
  const paragraphs = normalizeParagraphs(text);
  const chunks: TTSChunk[] = [];
  let currentParts: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (currentParts.length === 0) return;
    const chunkText = currentParts.join("\n\n").trim();
    chunks.push({
      index: chunks.length,
      text: chunkText,
      wordCount: countWords(chunkText),
      charCount: chunkText.length,
    });
    currentParts = [];
    currentWords = 0;
  };

  const pushSentence = (sentence: string) => {
    const sentenceWords = countWords(sentence);
    if (sentenceWords > HARD_MAX_WORDS) {
      throw new Error(`Single sentence too large for TTS chunking (${sentenceWords} words).`);
    }

    const nextText = currentParts.length === 0 ? sentence : `${currentParts.join("\n\n")} ${sentence}`;
    const nextWords = currentWords + sentenceWords;
    const nextChars = nextText.length;
    const shouldFlush =
      currentParts.length > 0 &&
      (
        (currentWords >= minWords && nextWords > targetWords) ||
        nextChars > maxCharsPerChunk ||
        nextWords > HARD_MAX_WORDS
      );

    if (shouldFlush) {
      flush();
    }

    currentParts.push(sentence);
    currentWords += sentenceWords;
  };

  for (const paragraph of paragraphs) {
    const paragraphWords = countWords(paragraph);
    if (paragraph.length <= maxCharsPerChunk && paragraphWords <= HARD_MAX_WORDS) {
      const nextText = currentParts.length === 0 ? paragraph : `${currentParts.join("\n\n")}\n\n${paragraph}`;
      if (
        currentParts.length > 0 &&
        (
          (currentWords >= minWords && currentWords + paragraphWords > targetWords) ||
          nextText.length > maxCharsPerChunk ||
          currentWords + paragraphWords > HARD_MAX_WORDS
        )
      ) {
        flush();
      }
      currentParts.push(paragraph);
      currentWords += paragraphWords;
      continue;
    }

    for (const sentence of splitIntoSentences(paragraph)) {
      pushSentence(sentence);
    }
  }

  flush();
  return chunks;
}
