export type TTSProviderVoice = {
  id: string;
  name: string;
  locale?: string;
  gender?: string;
  accent?: string;
  age?: string;
  category?: string;
  useCase?: string;
  rawJson?: unknown;
};

export type TTSProviderVoiceFilter = {
  language?: string;
  gender?: string;
  forceRefresh?: boolean;
};

export type TTSUsageContext = {
  pipelineRoute?: string | null;
  contentProfileKey?: string | null;
  nicheName?: string | null;
  formatType?: string | null;
  voiceLabel?: string | null;
  voiceFamily?: string | null;
  textHash?: string | null;
  textCharCount?: number | null;
  cacheIdentity?: string | null;
};

export type TTSProviderSynthesisRequest = {
  text: string;
  voiceId: string;
  outputPath: string;
  contentId?: string;
  chapterId?: string | null;
  providerName?: string | null;
  model?: string | null;
  language?: string | null;
  normalize?: boolean | null;
  enableSrt?: boolean | null;
  speed?: number | null;
  pitch?: number | null;
  volume?: number | null;
  usageContext?: TTSUsageContext;
};

export type TTSProviderSynthesisResult = {
  audioPath: string;
  providerId: string;
  voiceId: string;
  engine: string;
  model?: string | null;
  externalJobId?: string | null;
  audioUrl?: string | null;
  srtUrl?: string | null;
  srtPath?: string | null;
  durationSec?: number | null;
  creditUsed?: number | null;
  rawResponse?: unknown;
};

export type TTSProviderAvailability = {
  available: boolean;
  reason?: string;
};

export type TTSProviderBalance = {
  balance: number | null;
  raw?: unknown;
};

export interface TTSProvider {
  providerId: string;
  displayName: string;
  engine: string;
  model?: string | null;
  defaultVoiceId?: string;
  supportsLongform: boolean;
  supportsSpeedControl: boolean;
  supportsProsodyControl: boolean;
  supportsSrt?: boolean;
  checkAvailability(): Promise<TTSProviderAvailability>;
  checkBalance?(): Promise<TTSProviderBalance>;
  listVoices(filters?: TTSProviderVoiceFilter): Promise<TTSProviderVoice[]>;
  synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult>;
}
