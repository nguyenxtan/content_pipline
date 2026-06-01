export type MusicCategory = {
  id: string;
  label: string;
};

export const MUSIC_CATEGORIES: MusicCategory[] = [
  { id: "phat-phap",    label: "Phật pháp" },
  { id: "truyen-audio", label: "Truyện audio" },
  { id: "thien",        label: "Thiền định" },
  { id: "nhac-nen",     label: "Nhạc nền chung" },
];
