import "dotenv/config";

import {
  findNextAvailablePublishSlot,
  getSlotOffsetMinutes,
  isUploadQueueStatusSlotBlocking,
} from "@/lib/publishing/slot-occupancy";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type MockQueueRow = {
  id: string;
  scheduledAt: Date;
  status: string;
  videoType: "short" | "quote";
  platform: "youtube" | "facebook";
  channelKey: "phat_phap" | "tang_sau";
  formatType: "tts_short" | "legacy_quote_short" | "facebook_quote_photo";
};

function makeUtcDateAtMinuteOffset(baseUtcHour: Date, minuteOffset: number): Date {
  return new Date(baseUtcHour.getTime() + minuteOffset * 60_000);
}

function nextHourUtc(): Date {
  const now = new Date();
  return new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
}

function simulateCooldownDeferral(input: {
  rows: MockQueueRow[];
  takenRows: MockQueueRow[];
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  nextAllowedAt: Date;
  slotOffsetMinutesResolver?: (row: MockQueueRow) => number;
}): Date[] {
  const taken = input.takenRows
    .filter((row) => isUploadQueueStatusSlotBlocking(row.status))
    .map((row) => row.scheduledAt.getTime());

  const planned: Date[] = [];
  for (const row of input.rows) {
    const slotOffsetMinutes = input.slotOffsetMinutesResolver
      ? input.slotOffsetMinutesResolver(row)
      : getSlotOffsetMinutes(row.scheduledAt, input.intervalMin);
    const slot = findNextAvailablePublishSlot({
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      intervalMin: input.intervalMin,
      taken: [...taken, ...planned.map((item) => item.getTime())],
      notBefore: input.nextAllowedAt,
      slotOffsetMinutes,
    });
    if (!slot) throw new Error(`no slot found for ${row.id}`);
    planned.push(slot);
  }

  return planned;
}

function formatVn(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function verifyBlockingSemantics() {
  const nextAllowedAt = nextHourUtc();
  const baseCampaignSlot = nextAllowedAt;

  const shortRows: MockQueueRow[] = Array.from({ length: 5 }, (_, index) => ({
    id: `short-${index + 1}`,
    scheduledAt: baseCampaignSlot,
    status: "queued",
    videoType: "short",
    platform: "youtube",
    channelKey: "tang_sau",
    formatType: "tts_short",
  }));
  const shortTaken: MockQueueRow[] = [
    {
      id: "done-blocker",
      scheduledAt: baseCampaignSlot,
      status: "done",
      videoType: "short",
      platform: "youtube",
      channelKey: "tang_sau",
      formatType: "tts_short",
    },
    {
      id: "cancelled-non-blocker",
      scheduledAt: makeUtcDateAtMinuteOffset(baseCampaignSlot, 60),
      status: "cancelled",
      videoType: "short",
      platform: "youtube",
      channelKey: "tang_sau",
      formatType: "tts_short",
    },
  ];
  const shortPlan = simulateCooldownDeferral({
    rows: shortRows,
    takenRows: shortTaken,
    windowStart: "06:00",
    windowEnd: "22:00",
    intervalMin: 60,
    nextAllowedAt,
  });
  const shortIso = shortPlan.map((slot) => slot.toISOString());

  assert(new Set(shortIso).size === shortPlan.length, "short rows should spread across distinct slots");
  assert(!shortIso.includes(baseCampaignSlot.toISOString()), "done row should block its slot");
  assert(shortIso.includes(makeUtcDateAtMinuteOffset(baseCampaignSlot, 60).toISOString()), "cancelled row should not block its slot");

  return shortPlan;
}

function verifyPhatPhapFacebookQuotePhotoDeferral() {
  const nextAllowedAt = nextHourUtc();
  const originalQuoteSlot = makeUtcDateAtMinuteOffset(nextAllowedAt, 5);
  const quoteRows: MockQueueRow[] = Array.from({ length: 4 }, (_, index) => ({
    id: `phat-phap-fb-quote-${index + 1}`,
    scheduledAt: originalQuoteSlot,
    status: "queued",
    videoType: "quote",
    platform: "facebook",
    channelKey: "phat_phap",
    formatType: "facebook_quote_photo",
  }));

  const quotePlan = simulateCooldownDeferral({
    rows: quoteRows,
    takenRows: [],
    windowStart: "06:00",
    windowEnd: "22:00",
    intervalMin: 60,
    nextAllowedAt,
    slotOffsetMinutesResolver: (row) => {
      assert(row.platform === "facebook" && row.videoType === "quote", "HH:05 test must be explicit FB quote/photo");
      return 5;
    },
  });

  assert(
    quotePlan.every((slot) => slot.getUTCMinutes() === 5),
    "phat_phap Facebook quote/photo rows should remain on HH:05 slots",
  );
  assert(
    quotePlan[0]?.toISOString() === originalQuoteSlot.toISOString(),
    "first phat_phap FB quote row should land on the same next HH:05 slot",
  );
  assert(new Set(quotePlan.map((slot) => slot.toISOString())).size === quotePlan.length, "FB quote/photo rows should not pile up");

  return quotePlan;
}

function verifyPhatPhapCampaignPairCoupling() {
  const nextAllowedAt = nextHourUtc();
  const baseCampaignSlot = nextAllowedAt;
  const deferredShortPlan = simulateCooldownDeferral({
    rows: [{
      id: "phat-phap-fb-short-campaign",
      scheduledAt: baseCampaignSlot,
      status: "queued",
      videoType: "short",
      platform: "facebook",
      channelKey: "phat_phap",
      formatType: "tts_short",
    }],
    takenRows: [{
      id: "phat-phap-fb-short-done",
      scheduledAt: baseCampaignSlot,
      status: "done",
      videoType: "short",
      platform: "facebook",
      channelKey: "phat_phap",
      formatType: "tts_short",
    }],
    windowStart: "06:00",
    windowEnd: "22:00",
    intervalMin: 60,
    nextAllowedAt: new Date(baseCampaignSlot.getTime() + 15_000),
  })[0];

  if (!deferredShortPlan) throw new Error("missing deferred short plan");
  const pairedQuoteSlot = makeUtcDateAtMinuteOffset(deferredShortPlan, 5);

  assert(
    deferredShortPlan.getTime() === makeUtcDateAtMinuteOffset(baseCampaignSlot, 60).getTime(),
    "phat_phap primary short should defer to the next HH:00 slot when cooldown blocks the current one",
  );
  assert(
    pairedQuoteSlot.getTime() - deferredShortPlan.getTime() === 5 * 60_000,
    "paired phat_phap quote should follow the deferred primary short by +5 minutes",
  );

  return { deferredShortPlan, pairedQuoteSlot };
}

function verifyTangSauYoutubeLegacyQuoteShortDeferral() {
  const nextAllowedAt = nextHourUtc();
  const originalYoutubeQuoteShortSlot = nextAllowedAt;
  const youtubeQuoteRows: MockQueueRow[] = Array.from({ length: 3 }, (_, index) => ({
    id: `tang-sau-yt-quote-${index + 1}`,
    scheduledAt: originalYoutubeQuoteShortSlot,
    status: "queued",
    videoType: "short",
    platform: "youtube",
    channelKey: "tang_sau",
    formatType: "legacy_quote_short",
  }));

  const quoteShortPlan = simulateCooldownDeferral({
    rows: youtubeQuoteRows,
    takenRows: [],
    windowStart: "07:00",
    windowEnd: "22:00",
    intervalMin: 60,
    nextAllowedAt,
    slotOffsetMinutesResolver: (row) => {
      assert(
        row.platform === "youtube" &&
        row.channelKey === "tang_sau" &&
        row.formatType === "legacy_quote_short" &&
        row.videoType === "short",
        "HH:00 test must be explicit tang_sau YouTube legacy_quote_short",
      );
      return 0;
    },
  });

  assert(
    quoteShortPlan.every((slot) => slot.getUTCMinutes() === 0),
    "tang_sau YouTube legacy_quote_short rows should remain on HH:00 slots",
  );
  assert(
    quoteShortPlan[0]?.toISOString() === originalYoutubeQuoteShortSlot.toISOString(),
    "first tang_sau YouTube legacy_quote_short row should land on the same next HH:00 slot",
  );
  assert(new Set(quoteShortPlan.map((slot) => slot.toISOString())).size === quoteShortPlan.length, "YouTube quote-short rows should not pile up");

  return quoteShortPlan;
}

async function main() {
  const shortPlan = verifyBlockingSemantics();
  const phatPhapQuotePlan = verifyPhatPhapFacebookQuotePhotoDeferral();
  const phatPhapCampaignPair = verifyPhatPhapCampaignPairCoupling();
  const tangSauQuoteShortPlan = verifyTangSauYoutubeLegacyQuoteShortDeferral();

  console.log("verify-upload-queue-cooldown-deferral: ok");
  console.log("  blocking semantics / short plan:");
  for (const slot of shortPlan) {
    console.log(`    ${formatVn(slot)} VN  ${slot.toISOString()}`);
  }
  console.log("  phat_phap Facebook quote/photo plan:");
  for (const slot of phatPhapQuotePlan) {
    console.log(`    ${formatVn(slot)} VN  ${slot.toISOString()}`);
  }
  console.log("  phat_phap campaign pair coupling:");
  console.log(`    primary short → ${formatVn(phatPhapCampaignPair.deferredShortPlan)} VN  ${phatPhapCampaignPair.deferredShortPlan.toISOString()}`);
  console.log(`    paired quote  → ${formatVn(phatPhapCampaignPair.pairedQuoteSlot)} VN  ${phatPhapCampaignPair.pairedQuoteSlot.toISOString()}`);
  console.log("  tang_sau YouTube legacy_quote_short plan:");
  for (const slot of tangSauQuoteShortPlan) {
    console.log(`    ${formatVn(slot)} VN  ${slot.toISOString()}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
