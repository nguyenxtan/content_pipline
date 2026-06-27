# PROMPT MAP — Content Pipeline

Tài liệu này liệt kê **toàn bộ prompt** được sử dụng trong pipeline, bao gồm model đang chạy, mục đích sử dụng, và toàn văn prompt.

> **API chung:** Mọi LLM call dùng OpenAI SDK trỏ tới OpenRouter (`https://openrouter.ai/api/v1`).  
> **Image generation:** Fal.ai (`fal-ai/flux/*`).

---

## Cách model được chọn

Pipeline có **3 tầng** model khác nhau, tuỳ giai đoạn:

```
Tầng 1 — Content (hook + script)
  └─ shortModel / longModel
       ├─ promptTemplates.model  (lưu trong DB, per-niche — ưu tiên cao nhất)
       └─ CONTENT_GEN_MODEL (env)
            └─ NEXT_PUBLIC_LLM_TEST_MODEL (env, fallback)
                 └─ "openai/gpt-4o-mini"  (hardcode fallback cuối)

Tầng 2 — Longform metadata (tiêu đề, description, tags...)
  └─ LONGFORM_MODEL (env)
       └─ "google/gemini-2.0-flash"  (hardcode fallback)

Tầng 3 — Image (LLM sinh prompt + Fal.ai render)
  ├─ Short images:  image_prompt_model (DB) → "openai/gpt-4o-mini"
  │                 fal_image_model    (DB) → "fal-ai/flux/schnell"
  ├─ Long images:   long_image_prompt_model (DB) → "openai/gpt-4o-mini"
  │                 long_fal_image_model    (DB) → "fal-ai/flux/dev"
  └─ Long thumbnail: long_thumbnail_llm_model (DB) → "openai/gpt-4o-mini"
                     long_thumbnail_fal_model (DB) → "fal-ai/flux-pro/v1.1-ultra"
```

---

## Luồng tổng quan

```
[Cron / Thủ công]
       │
       ▼
① suggestTopicsAction()          gpt-4o-mini
       │
       ▼
② runHookEngine() — sinh hook     CONTENT_GEN_MODEL
③ runHookEngine() — chấm điểm    CONTENT_GEN_MODEL
       │
       ▼ (short)
④ buildShortDraftPrompt           CONTENT_GEN_MODEL (shortModel)
⑤ buildShortRepairPrompt          CONTENT_GEN_MODEL (shortModel) [nếu fail]
       │
       ▼ (long)
⑥  buildLongOutlinePrompt         CONTENT_GEN_MODEL (longModel)
⑦  buildLongOpeningPrompt         CONTENT_GEN_MODEL (longModel)
⑧  buildLongSectionPrompt ×4      CONTENT_GEN_MODEL (longModel)
⑨  buildLongClosingPrompt         CONTENT_GEN_MODEL (longModel)
⑩  buildLongRepairPrompt          CONTENT_GEN_MODEL (longModel)  [nếu fail]
       │
       ▼
⑪ generateImagePrompts (short)   gpt-4o-mini → fal-ai/flux/schnell
⑫ generateLandscapePrompts (long) gpt-4o-mini → fal-ai/flux/dev
⑬ generateThumbnailPrompt (long)  gpt-4o-mini → fal-ai/flux-pro/v1.1-ultra
       │
       ▼ (long only)
⑭ generateTitles()               LONGFORM_MODEL (gemini-2.0-flash)
⑮ generateTitles() — scoring     LONGFORM_MODEL (gemini-2.0-flash)
⑯ generateDescription()          LONGFORM_MODEL (gemini-2.0-flash)
⑰ generateTags()                 LONGFORM_MODEL (gemini-2.0-flash)
⑱ generatePinnedComment()        LONGFORM_MODEL (gemini-2.0-flash)
⑲ generateThumbnailIntent()      LONGFORM_MODEL (gemini-2.0-flash)
```

---

## Mục lục

1. [Gợi ý chủ đề](#1-gợi-ý-chủ-đề)
2. [Hook — Sinh 20 hooks](#2-hook--sinh-20-hooks)
3. [Hook — Chấm điểm](#3-hook--chấm-điểm)
4. [Short Script — Draft đầu](#4-short-script--draft-đầu)
5. [Short Script — Sửa lỗi Repair](#5-short-script--sửa-lỗi-repair)
6. [Long Script — Tạo Outline](#6-long-script--tạo-outline)
7. [Long Script — Mở đầu](#7-long-script--mở-đầu)
8. [Long Script — Từng Section](#8-long-script--từng-section)
9. [Long Script — Kết bài](#9-long-script--kết-bài)
10. [Long Script — Sửa lỗi Repair](#10-long-script--sửa-lỗi-repair)
11. [Image Prompts — Short video](#11-image-prompts--short-video)
12. [Image Prompts — Long video Landscape](#12-image-prompts--long-video-landscape)
13. [Thumbnail Prompt — Long video](#13-thumbnail-prompt--long-video)
14. [Longform — Sinh tiêu đề YouTube](#14-longform--sinh-tiêu-đề-youtube)
15. [Longform — Chấm điểm tiêu đề](#15-longform--chấm-điểm-tiêu-đề)
16. [Longform — Description](#16-longform--description)
17. [Longform — Tags](#17-longform--tags)
18. [Longform — Pinned Comment](#18-longform--pinned-comment)
19. [Longform — Thumbnail Intent](#19-longform--thumbnail-intent)
20. [Template mặc định — Short](#20-template-mặc-định--short)
21. [Template mặc định — Long](#21-template-mặc-định--long)

---

## 1. Gợi ý chủ đề

| | |
|---|---|
| **File** | [`src/actions/content-generator.ts`](../src/actions/content-generator.ts) · `suggestTopicsAction()` |
| **Model** | `openai/gpt-4o-mini` (tham số `model`, default hardcode) |
| **Cấu hình model** | Truyền qua param khi gọi, không đọc env |
| **Temperature** | `0.9` |
| **Max tokens** | `150` (count=1) / `800` (count>1) |
| **Mục đích** | Sinh danh sách chủ đề ngắn 1–5 từ để user hoặc cron chọn làm đầu vào cho pipeline. Tránh trùng với chủ đề đã làm 14 ngày qua (dedup block). |
| **Output** | Danh sách chủ đề tiếng Việt dạng cảm xúc/nỗi đau/trạng thái ("Tha thứ", "Buông bỏ", "Cô đơn"...) |

### Prompt (count = 1)

```
{nicheContext}
{dedupBlock}

Gợi ý 1 chủ đề ngắn gọn cho video short về lĩnh vực trên.

Yêu cầu:
- Chủ đề phải là một cảm xúc, nỗi đau, trạng thái, hoặc tình huống mà con người hay trải qua
- Viết như một nhãn chủ đề ngắn, KHÔNG phải tiêu đề YouTube
- Độ dài: 1-5 từ tiếng Việt
- Ưu tiên: "Tha thứ", "Buông bỏ", "Cô đơn", "Tự ti", "Sợ bị bỏ rơi", "Mất lòng tin"...
- KHÔNG dùng: "Khám phá...", "Hành trình...", "Bí quyết...", "Nghệ thuật...", "Lời dạy..."
- Không dùng dấu hai chấm, không câu hoàn chỉnh, không giật tít
- Chỉ trả về chủ đề duy nhất, không giải thích
```

### Prompt (count > 1)

```
{nicheContext}
{dedupBlock}

Gợi ý {count} chủ đề ngắn gọn cho video short về lĩnh vực trên.

Yêu cầu:
[... tương tự count=1, nhưng yêu cầu đánh số 1. 2. 3. ...]
- Mỗi chủ đề phải KHÁC BIỆT hoàn toàn
- Liệt kê đánh số (mỗi dòng 1 chủ đề, không giải thích thêm)
```

### Biến inject

| Biến | Nguồn |
|------|-------|
| `{nicheContext}` | `"Phân mục YouTube: {name} — {description}\nĐối tượng: {targetAudience}"` từ DB |
| `{dedupBlock}` | 30 chủ đề đã làm trong 14 ngày qua, lấy từ `contentGenerations` |

### Hậu xử lý

Lọc qua `isValidShortTopic()` — từ chối nếu: >5 từ, >40 ký tự, chứa dấu `,` hay `:`, khớp bất kỳ pattern nào trong `DISALLOWED_TOPIC_PATTERNS`:

```
/^khám phá/, /^hành trình/, /^bí quyết/, /^nghệ thuật/, /^lời dạy/,
/^những/, /^sức mạnh/, /^bí mật/, /^điều gì/, /^tại sao/, /^vì sao/,
/^làm sao/, /^đừng/, /^người/, /^càng/, /^có những/, /^trong cuộc sống/
```

---

## 2. Hook — Sinh 20 hooks

| | |
|---|---|
| **File** | [`src/lib/hook-engine.ts`](../src/lib/hook-engine.ts) · `buildHookGenerationPrompt()` |
| **Model** | `shortModel` = `promptTemplates.model` (DB, per-niche) → `CONTENT_GEN_MODEL` (env) → `NEXT_PUBLIC_LLM_TEST_MODEL` (env) → `"openai/gpt-4o-mini"` |
| **Temperature** | `0.95` (cao để đa dạng) |
| **Max tokens** | `420` |
| **Mục đích** | Sinh 20 câu mở đầu (hook) tiếng Việt đa dạng về phong cách, đủ pool để chấm điểm và chọn top 3. Hook phải là câu đời thường, không giảng đạo. |
| **Output** | 20 dòng text thuần, mỗi dòng 1 hook (12–180 ký tự sau lọc) |

### Prompt

```
Bạn là người từng trải, hiểu Phật pháp nhưng không giảng đạo. Bạn nói bằng ngôn ngữ của người đời thường.

Lĩnh vực: {nicheName}
Mô tả ngách: {nicheDescription}
Giọng điệu: {tone}
Chủ đề: {topic}
{dedupBlock}

Hãy tạo đúng {count} câu mở đầu bằng tiếng Việt cho video short về chủ đề trên.

KHÔNG ĐƯỢC mở đầu bằng:
- Khái niệm trừu tượng hoặc định nghĩa ("Tha thứ là...", "Nỗi sợ hãi là...")
- Đạo lý hoặc lời Phật dạy
- "Trong cuộc sống...", "Có những...", "Chúng ta thường...", "Bạn có biết..."
- Bất kỳ câu nào nghe như bài giảng hoặc sách self-help
- Từ ngữ marketing: "hook", "viral", "engagement"

BẮT BUỘC mỗi câu phải thuộc một trong các dạng:
- Một sự thật khiến người nghe giật mình
- Một điều tiếc nuối mà nhiều người từng trải qua
- Một tình huống rất đời thường
- Một nghịch lý trong cuộc sống
- Một câu khiến người nghe thấy bản thân trong đó

YÊU CẦU THÊM:
- Mỗi câu chỉ 1 câu, không quá 20 từ
- Giọng trầm tĩnh, chân thật, như người lớn tuổi kể lại điều mình đã nghiệm ra
- Phân bổ đều các dạng, không tập trung vào 1 dạng
- Ưu tiên các kiểu câu như:
  - "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu."
  - "Có những thứ người ta mang theo cả đời mà không nhận ra."
  - "Điều khiến nhiều người khổ nhất lại không nằm ở hoàn cảnh."
  - "Càng lớn tuổi, quý vị càng hiểu giá trị của sự im lặng."

ĐỊNH DẠNG OUTPUT:
- Chỉ xuất đúng {count} dòng
- Mỗi dòng là một câu mở đầu
- Không thêm giải thích, không tiêu đề, không markdown
```

### Hậu xử lý — `extractHookCandidates()`

- Split by `\n`, strip số thứ tự (`1.`, `1)`, `-`)
- Strip dấu ngoặc kép đầu/cuối
- Lọc 12–180 ký tự
- Reject dòng bắt đầu bằng `hook`, `mở đầu`, `câu \d+`
- Dedup case-insensitive

---

## 3. Hook — Chấm điểm

| | |
|---|---|
| **File** | [`src/lib/hook-engine.ts`](../src/lib/hook-engine.ts) · `buildHookScoringPrompt()` |
| **Model** | Cùng `shortModel` với bước #2 |
| **Temperature** | `0.2` (deterministic để điểm nhất quán) |
| **Max tokens** | `900` |
| **Mục đích** | Chấm điểm 20 hooks theo 4 tiêu chí cảm xúc để chọn top 3. Hook được chọn là hook đạt `total` cao nhất trong `top3`. |
| **Output** | JSON: `{scores: [{index, curiosity, emotion, relatability, retention}], top3: [1, 4, 2]}` |

### Prompt

```
Bạn là biên tập viên chuyên tối ưu hook cho video short tiếng Việt về Phật pháp và chữa lành.

Chủ đề: {topic}
Lĩnh vực: {nicheName}

Đây là {n} hook ứng viên:
1. {hook1}
2. {hook2}
...{hookN}

Hãy chấm điểm TỪNG hook theo 4 tiêu chí, thang điểm 0-10:
- curiosity: mức độ khiến người nghe muốn biết tiếp
- emotion: mức độ chạm cảm xúc thật
- relatability: mức độ khiến người nghe thấy bản thân trong đó
- retention: mức độ đủ mạnh để giữ người xem ở lại

YÊU CẦU:
- Điểm phải là số nguyên
- Chấm công bằng, không cho tất cả điểm cao
- Không chấm theo kiểu giật gân rẻ tiền
- Ưu tiên hook đúng cảm xúc, gần đời, có chiều sâu

Trả về JSON đúng format:
{
  "scores": [
    {"index": 1, "curiosity": 8, "emotion": 7, "relatability": 9, "retention": 8}
  ],
  "top3": [1, 4, 2]
}

Chỉ xuất JSON, không giải thích thêm.
```

### Fallback khi JSON parse fail

Không gọi LLM lại. `fallbackScoreHooks()` tính điểm bằng keyword matching:

| Tiêu chí | Keywords đếm |
|----------|-------------|
| curiosity | `?`, `đừng`, `quên`, `muộn`, `giữ`, `vì sao`, `điều gì`, `càng` |
| emotion | `đau`, `khổ`, `sợ`, `hận`, `buồn`, `nhẹ`, `mất`, `cô đơn`, `tổn thương`, `day dứt` |
| relatability | `người ta`, `quý vị`, `có những`, `càng lớn`, `nhiều người`, `chúng ta` |
| retention | `nhưng`, `lại`, `đôi khi`, `có thể`, `thường`, `chỉ vì`, `không phải` |

---

## 4. Short Script — Draft đầu

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildShortDraftPrompt()` |
| **Model** | `shortModel` (xem tầng 1 phía trên) |
| **Temperature** | `0.75` |
| **Max tokens** | `500` |
| **Mục đích** | Viết script video ngắn hoàn chỉnh (~45–60 giây). Hook thắng từ bước #3 phải là câu đầu tiên. Script kết thúc bằng CTA cố định. |
| **Output** | Văn bản thuần tiếng Việt, 130–150 từ, không markdown |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}

Hook thắng:
{selectedHook}

Viết short script theo đúng flow này:
1. Hook
2. Một tình huống đời thường
3. Một đoạn chiêm nghiệm
4. Một ý tinh thần Phật pháp rất nhẹ
5. CTA

RÀNG BUỘC CỨNG:
- 130-150 từ
- 45-60 giây
- Câu đầu tiên phải chính là hook thắng, giữ nguyên wording
- Không giảng đạo
- Không dạy đời
- Không dùng văn AI chung chung
- Không mở đầu lại bằng: "Trong cuộc sống", "Chúng ta thường", "Hôm nay chúng ta"
- CTA cuối phải đúng nguyên văn:
"Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống."

{basePrompt}   ← DEFAULT_SHORT_PROMPT hoặc template custom từ DB

Chỉ xuất script cuối cùng, không giải thích thêm.
```

### Validation sau nhận output

| Tiêu chí | Điều kiện pass |
|----------|---------------|
| Số từ | 120–170 từ |
| Thời lượng | 45–60 giây (tính ở 2.8 từ/giây) |
| Opening | Không khớp `BANNED_OPENINGS` |
| Generic phrases | Không chứa `GENERIC_AI_PHRASES` |
| CTA | Phải chứa chuỗi CTA cố định |

Nếu fail → Prompt #5. Tối đa **3 lần rewrite**.

---

## 5. Short Script — Sửa lỗi Repair

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildShortRepairPrompt()` |
| **Model** | Cùng `shortModel` với #4 |
| **Temperature** | `0.45` (bảo thủ hơn để sửa đúng lỗi) |
| **Max tokens** | `500` |
| **Mục đích** | Rewrite script bị reject bởi validation, truyền danh sách lỗi cụ thể để model sửa đúng điểm. |
| **Output** | Script mới đã sửa, cùng định dạng #4 |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}
Hook thắng: {selectedHook}

Script hiện tại:
---
{currentScript}
---

Script trên chưa đạt vì:
- {issue1}
- {issue2}
...

Hãy rewrite lại script để:
- giữ nguyên hook ở câu đầu
- giữ cùng cảm xúc và chủ đề
- không cắt cứng giữa câu
- nếu quá dài thì rút gọn bằng cách bỏ phần chung chung
- nếu quá ngắn thì expand bằng một quan sát đời thường cụ thể hơn
- giữ script trong khoảng 130-150 từ để chừa biên an toàn cho thời lượng
- CTA cuối phải đúng nguyên văn:
"Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống."

Chỉ xuất script mới, không giải thích thêm.
```

---

## 6. Long Script — Tạo Outline

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildLongOutlinePrompt()` |
| **Model** | `longModel` = `promptTemplates.model` (DB, stage "long") → `CONTENT_GEN_MODEL` → `NEXT_PUBLIC_LLM_TEST_MODEL` → `"openai/gpt-4o-mini"` |
| **Temperature** | `0.6` |
| **Max tokens** | `900` |
| **Mục đích** | Tạo khung cấu trúc cho video 15–18 phút: angle tiêu đề, angle mở đầu, 4 section với mục đích cảm xúc riêng, angle kết, và danh sách chapter titles để làm timestamp YouTube. |
| **Output** | JSON outline với `titleAngle`, `openingAngle`, `sections[]`, `closingAngle`, `chapters[]` |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}
Hook thắng: {selectedHook}

Nhiệm vụ:
Tạo outline cho video dài theo phong cách storytelling, đời sống, cảm xúc, có tinh thần Phật pháp nhưng không giảng đạo khô.

YÊU CẦU:
- Có title angle rõ ràng
- Opening 30-60 giây phải mạnh
- 4 section thân bài rõ ràng
- Mỗi section phải có mục đích cảm xúc riêng
- Kết lại bằng một closing nhẹ nhưng đọng
- Chapter title phải ngắn, dễ đọc
- Tránh mọi wording kiểu AI chung chung

{basePrompt}   ← DEFAULT_LONG_PROMPT hoặc template custom từ DB

Trả về JSON:
{
  "titleAngle": "...",
  "openingAngle": "...",
  "sections": [
    { "title": "...", "purpose": "...", "emotionalShift": "..." }
  ],
  "closingAngle": "...",
  "chapters": ["...", "...", "...", "...", "...", "..."]
}

Chỉ xuất JSON.
```

---

## 7. Long Script — Mở đầu

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildLongOpeningPrompt()` |
| **Model** | Cùng `longModel` với #6 |
| **Temperature** | `0.75` |
| **Max tokens** | `500` |
| **Mục đích** | Viết đoạn mở đầu 30–60 giây, đưa người nghe vào không gian câu chuyện ngay từ câu đầu. Hook thắng xuất hiện ở câu mở hoặc biến thể rất gần. |
| **Output** | Văn bản thuần 90–150 từ |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}
Title angle: {outline.titleAngle}
Opening angle: {outline.openingAngle}
Hook thắng: {selectedHook}

Viết phần mở đầu 30-60 giây cho video dài.

YÊU CẦU:
- 90-150 từ
- mở mạnh ngay từ câu đầu
- đưa người nghe vào một cảnh đời hoặc nỗi đau cụ thể
- dùng chính hook thắng làm câu mở đầu hoặc biến thể rất gần
- không giảng đạo
- không dùng ngôn ngữ marketing
- phải khiến người nghe muốn ở lại nghe tiếp

Chỉ xuất phần mở đầu.
```

---

## 8. Long Script — Từng Section

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildLongSectionPrompt()` |
| **Model** | Cùng `longModel` với #6 |
| **Temperature** | `0.72` |
| **Max tokens** | `950` |
| **Mục đích** | Viết từng section thân bài (lặp 4 lần). Mỗi lần truyền `previousSummary` (tóm tắt section trước) để duy trì mạch kể chuyện và tránh lặp ý. |
| **Output** | Văn bản thuần 320–520 từ/section, không tiêu đề |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}
Title angle: {outline.titleAngle}
Hook thắng: {selectedHook}
Section {n}: {section.title}
Purpose: {section.purpose}
Emotional shift: {section.emotionalShift}
Tóm tắt phần trước: {previousSummary}   ← "Chưa có" nếu là section đầu

Viết section này theo phong cách:
- storytelling
- đời sống
- có cảm xúc
- có chiêm nghiệm
- có tinh thần Phật pháp nhẹ
- không giảng đạo khô
- không văn AI chung chung

YÊU CẦU:
- 320-520 từ
- phải có ít nhất 1 cảnh đời hoặc quan sát cụ thể
- phải nối mượt từ phần trước
- cuối section phải mở ra nhu cầu nghe tiếp

Chỉ xuất nội dung section, không thêm tiêu đề.
```

---

## 9. Long Script — Kết bài

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildLongClosingPrompt()` |
| **Model** | Cùng `longModel` với #6 |
| **Temperature** | `0.65` |
| **Max tokens** | `500` |
| **Mục đích** | Viết đoạn kết lắng xuống, chốt bằng một hình ảnh hoặc ý đọng, không tổng kết kiểu bài giảng. |
| **Output** | Văn bản thuần 120–220 từ |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}
Title angle: {outline.titleAngle}
Closing angle: {outline.closingAngle}
Hook thắng: {selectedHook}
Tóm tắt phần thân bài: {fullBodySummary}

Viết đoạn kết:
- 120-220 từ
- lắng xuống nhưng không cụt
- chốt lại bằng một hình ảnh hoặc một ý đọng
- có tinh thần Phật pháp nhẹ
- không tổng kết kiểu bài giảng

Chỉ xuất đoạn kết.
```

### Validation toàn bộ script long (sau khi ghép)

| Tiêu chí | Điều kiện |
|----------|-----------|
| Số từ | 1600–2600 từ |
| Thời lượng | ≥570 giây ở 2.8 từ/giây |
| Opening | Không khớp BANNED_OPENINGS |
| Generic phrases | Không chứa GENERIC_AI_PHRASES |

Nếu fail → Prompt #10. Tối đa **2 lần rewrite**.

---

## 10. Long Script — Sửa lỗi Repair

| | |
|---|---|
| **File** | [`src/lib/script-engine.ts`](../src/lib/script-engine.ts) · `buildLongRepairPrompt()` |
| **Model** | Cùng `longModel` với #6 |
| **Temperature** | `0.45` |
| **Max tokens** | `2500` (đủ cho toàn bộ script ~2000 từ) |
| **Mục đích** | Rewrite toàn bộ long script khi không đạt validation. Truyền toàn văn script + danh sách lỗi. |
| **Output** | Toàn bộ long script mới |

### Prompt

```
Chủ đề: {topic}
Lĩnh vực: {nicheName}

Long script hiện tại:
---
{script}
---

Script này chưa đạt vì:
- {issue1}
- {issue2}
...

Hãy rewrite toàn bộ long script để:
- giữ nguyên tinh thần và flow
- sửa đúng các lỗi trên
- nếu có "hành trình khám phá", "bí quyết", "nghệ thuật" → thay bằng cảnh đời cụ thể hơn
- không dùng tiêu đề markdown
- không giảng đạo khô
- không dùng văn AI chung chung
- không mở đầu bằng các câu sáo rỗng

Chỉ xuất long script mới.
```

---

## 11. Image Prompts — Short video

| | |
|---|---|
| **File** | [`src/lib/pipeline/images.ts`](../src/lib/pipeline/images.ts) · `generateImagePrompts()` |
| **LLM Model** | `image_prompt_model` (DB → `appConfig`) → `"openai/gpt-4o-mini"` |
| **Image Model** | `fal_image_model` (DB → `appConfig`) → **`fal-ai/flux/schnell`** ($0.003/ảnh, 8 steps) |
| **Temperature** | `0.6` |
| **Max tokens** | `700` |
| **Image size** | `portrait_4_3` (dọc, phù hợp Shorts) |
| **Mục đích** | Từ script tiếng Việt, sinh N prompt tiếng Anh mô tả cảnh Phật giáo. Mỗi prompt ứng 1 đoạn script. Prompt sau đó được gửi lên Fal.ai để render ảnh thực. |
| **Output LLM** | JSON `{"prompts": ["...", ...]}` — N prompt EN 15–25 từ |
| **Output Fal** | N file ảnh PNG/JPG lưu tại `media/images/` |

### System prompt

```
You are an expert visual director specializing in Buddhist and contemplative photography.
Return valid JSON only, no extra text.

VISUAL LANGUAGE GUIDELINES — apply to every prompt:
- Draw from: monks meditating, ancient temples, lotus ponds, misty mountains, incense smoke,
  prayer beads, candlelight, autumn leaves, stone Buddha statues, elderly practitioners,
  forest hermitages, dawn light through bamboo
- Mood: serene, still, introspective, timeless — never dramatic, never chaotic
- Color palette: muted earth tones, soft greens, warm amber, dusty gold, grey mist
- NO religious symbols used as decoration — only as natural elements in the scene

CRITICAL RULES:
1. Each prompt must describe ONE single, unified scene — NO split-screen, before/after, dual composition
2. NEVER include text, quotes, words, letters, signs, labels or writing of any kind
3. NEVER use concepts that imply text overlays
4. Focus on concrete visuals: a person doing something, a landscape, an object, a moment
5. Keep each prompt to 15-25 words describing only visual elements
```

### User prompt

```
Buddhist script (Vietnamese):
---
{content}
---
Topic: {topic} | Niche: {niche}

Create exactly {n} English image prompts for this Buddhist script.
Divide the script into {n} meaningful segments. For each segment, write 1 prompt describing
a concrete, serene Buddhist visual scene matching the emotional content.

Respond with JSON: {"prompts": ["...", "...", ...]}
```

### Style suffix (tự động nối vào mỗi prompt)

| Style | Suffix |
|-------|--------|
| `cinematic` *(default random)* | `cinematic lighting, volumetric fog, moody atmosphere, depth of field, 35mm photograph, muted colors, zen aesthetic, highly detailed` |
| `watercolor` | `traditional East Asian ink wash painting style, watercolor, minimalist composition, soft brush strokes, elegant, ethereal, zen concept art` |
| `vintage` | `vintage film photo, Kodachrome, grainy texture, warm tones, nostalgic, rustic, wabi-sabi aesthetic, authentic look, 50mm lens` |

Suffix chống text append thêm: `, single unified composition, no text, no words, no letters, no captions, no watermarks, no overlays, no split screen, no before-after, no collage`

---

## 12. Image Prompts — Long video Landscape

| | |
|---|---|
| **File** | [`src/lib/pipeline/long-images.ts`](../src/lib/pipeline/long-images.ts) · `generateLandscapePrompts()` |
| **LLM Model** | `long_image_prompt_model` (DB) → `"openai/gpt-4o-mini"` |
| **Image Model** | `long_fal_image_model` (DB) → **`fal-ai/flux/dev`** ($0.025/ảnh, 28 steps — chất lượng cao hơn short) |
| **Temperature** | `0.7` |
| **Max tokens** | `1200` |
| **Image size** | `landscape_16_9` (1280×720, widescreen YouTube) |
| **Mục đích** | Sinh N prompt cảnh panoramic 16:9 cho video dài, **đồng thời** sinh SEO description tiếng Việt (~400–600 ký tự kèm hashtag) để dùng cho YouTube description. |
| **Output LLM** | JSON `{imagePrompts: [...], seoDescription: "..."}` |
| **Output Fal** | N file ảnh PNG/JPG lưu tại `media/images/` |

### System prompt

```
You are a visual director for Buddhist/spiritual YouTube long-form videos.
Return valid JSON only, no extra text.

VISUAL LANGUAGE (style: {style}):
- Sweeping mountain landscapes, misty forests, ancient temples at dawn, lotus fields,
  river reflections, monastery courtyards, candle-lit altars, pilgrimage paths, monks in panoramic scenes
- Mood: contemplative, serene, majestic, timeless
- Color palette: warm amber, dusty gold, misty grey-blue, soft emerald

RULES:
1. Each prompt = ONE unified widescreen scene (16:9 landscape orientation)
2. NEVER include text, signs, writing, or captions
3. Vary the scenes to match the arc of the video (opening → middle → closing)

SEO DESCRIPTION format (Vietnamese):
- Line 1: Compelling hook (1 sentence)
- Paragraph 1: Summary of video content (2-3 sentences)
- Paragraph 2: What viewers will learn/gain (2-3 sentences)
- Hashtags line: 8-12 relevant Vietnamese Buddhist hashtags
```

### User prompt

```
Video script (Vietnamese, first 3000 chars):
---
{content.slice(0, 3000)}
---
Topic: {topic} | Niche: {niche}

JSON response:
{
  "imagePrompts": ["scene 1", ...],  (exactly {n} prompts, 15-25 words each)
  "seoDescription": "..."  (Vietnamese SEO, ~400-600 chars)
}
```

### Landscape style presets

| Style | Suffix |
|-------|--------|
| `cinematic` | `cinematic widescreen, golden hour light, volumetric fog, depth of field, 35mm anamorphic lens, muted earth tones, zen landscape` |
| `watercolor` | `East Asian landscape painting, ink wash, panoramic, minimalist horizon, mist-covered mountains, ethereal and meditative` |
| `vintage` | `vintage travel photograph, Kodachrome film, wide angle, warm nostalgic tones, grainy texture, wabi-sabi, 50s aesthetic` |

---

## 13. Thumbnail Prompt — Long video

| | |
|---|---|
| **File** | [`src/lib/pipeline/long-images.ts`](../src/lib/pipeline/long-images.ts) · `generateThumbnailPrompt()` |
| **LLM Model** | `long_thumbnail_llm_model` (DB) → `"openai/gpt-4o-mini"` |
| **Image Model** | `long_thumbnail_fal_model` (DB) → **`fal-ai/flux-pro/v1.1-ultra`** ($0.060/ảnh — model VIP nhất, chất lượng cao nhất) |
| **Temperature** | `0.8` |
| **Max tokens** | `300` |
| **Image size** | 1280×720 (thumbnail chuẩn YouTube) |
| **Mục đích** | Sinh 1 prompt duy nhất cho thumbnail click-bait (theo nghĩa tốt). Thumbnail phải đọc rõ ở kích thước 120×90px, có độ tương phản cao, không có text hay khuôn mặt người. Dùng model image VIP nhất để đảm bảo chất lượng thumbnail. |
| **Output LLM** | Plain text 30–50 từ tiếng Anh (không JSON) |
| **Output Fal** | 1 file ảnh PNG/JPG `thumbnail_*.jpg` |

### System prompt

```
You are an expert YouTube thumbnail art director specializing in Buddhist/spiritual content.
Your thumbnails stop scrollers mid-swipe and compel clicks.
Return ONE thumbnail prompt only — no JSON wrapper, just the prompt text.

THUMBNAIL PSYCHOLOGY:
- Strong emotional resonance: awe, peace, curiosity, wonder
- Dramatic lighting: golden rays breaking through clouds, candlelight in darkness, dawn over misty mountains
- Bold focal point: a single breathtaking element that reads clearly at 120×90px
- Rich, saturated but harmonious colors — warm golds, deep teals, glowing ambers
- Cinematic depth: foreground detail + epic background scale
- The image must FEEL sacred and cinematic simultaneously

COMPOSITION RULES:
- Rule of thirds with a dominant subject
- One strong light source creating dramatic shadows
- Foreground element + epic background (e.g. lotus flower with mountain vista behind)
- Atmosphere: mist, light rays, golden hour, or moonlight
- Style: photorealistic, ultra-detailed, 8K, HDR, shot on Phase One medium format camera

ABSOLUTELY NO: text, words, people's faces, modern objects, clutter
```

### User prompt

```
Create ONE highly detailed thumbnail prompt for this Buddhist YouTube video.

Topic: {topic}
Niche: {niche}
Video opening (first 500 chars): {content.slice(0, 500)}

Write a single detailed English prompt (30-50 words) describing the perfect thumbnail image.
Only output the prompt text, nothing else.
```

### Thumbnail style presets (khi config chọn)

| Style | Suffix |
|-------|--------|
| `dramatic` | `dramatic cinematic lighting, extreme contrast, vivid warm saturated colors, heroic epic scale, photorealistic, ultra-detailed, 8K HDR` |
| `mystical` | `ethereal divine golden glow, celestial light rays, mystical spiritual atmosphere, radiant heavenly luminescence, dreamlike, hyper-detailed` |
| `painterly` | `classical oil painting style, rich textured brushwork, warm amber gold tones, museum masterpiece quality, Renaissance composition, lush colors` |
| `vivid` | `hyperreal vivid colors, ultra-sharp crystal clarity, maximum saturation, modern digital art, 8K HDR, jewel-toned, striking bold palette` |

---

## 14. Longform — Sinh tiêu đề YouTube

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildTitlePrompt()` |
| **Model** | `LONGFORM_MODEL` (env) → **`"google/gemini-2.0-flash"`** |
| **System** | `"Bạn là chuyên gia viết nội dung YouTube Việt Nam, chuyên mảng Phật pháp và chữa lành."` |
| **Temperature** | `0.8` |
| **Max tokens** | `600` |
| **Mục đích** | Từ chủ đề + 200 từ đầu script, sinh 10 ứng viên tiêu đề YouTube đa dạng góc nhìn. Không dùng số đếm, không clickbait rẻ, phong cách chiêm nghiệm. Gemini Flash được dùng ở đây vì tốc độ cao, chi phí thấp, đủ chất lượng cho metadata. |
| **Output** | JSON array `[{"title": "..."}, ...]` — 10 tiêu đề |

### Prompt

```
Bạn là người viết tiêu đề YouTube chuyên về Phật pháp, chữa lành và chiêm nghiệm đời sống.

Chủ đề: {topic}

Đoạn script (200 từ đầu):
{scriptExcerpt}

Tạo đúng 10 tiêu đề tiếng Việt cho video dài YouTube về chủ đề này.

YÊU CẦU:
- Tiêu đề ngắn gọn, không quá 65 ký tự
- Ngôn ngữ đời thường, gần gũi — không văn hoa
- KHÔNG dùng số đếm ("7 điều...", "5 bài học...")
- Chạm cảm xúc, không clickbait rẻ tiền
- Không mở đầu bằng "Hãy", "Bạn cần", "Bí quyết", "Cách để"
- Phong cách chiêm nghiệm, thật, sâu

Ví dụ tốt:
- Người làm bạn tổn thương có thể đã quên từ lâu
- Có những điều càng giữ càng khổ
- Khi đời bắt bạn buông xuống, hãy nhớ điều này
- Càng lớn tuổi, càng hiểu vì sao im lặng là phúc

Trả về JSON array, mỗi phần tử là object: {"title": "..."}
Chỉ JSON, không giải thích.
```

---

## 15. Longform — Chấm điểm tiêu đề

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildTitleScorePrompt()` |
| **Model** | Cùng `LONGFORM_MODEL` → `"google/gemini-2.0-flash"` |
| **System** | `"Bạn là chuyên gia viết nội dung YouTube Việt Nam, chuyên mảng Phật pháp và chữa lành."` |
| **Temperature** | `0.2` (deterministic) |
| **Max tokens** | `600` |
| **Mục đích** | Chấm điểm 10 tiêu đề theo 5 tiêu chí, chọn tiêu đề có `total` cao nhất. Tiêu chí `not_clickbait` đảm bảo tiêu đề phù hợp văn hoá kênh Phật pháp. |
| **Output** | JSON array điểm theo đúng thứ tự tiêu đề |

### Prompt

```
Chấm điểm các tiêu đề YouTube sau cho video Phật pháp / chữa lành.

Chủ đề: {topic}

Tiêu đề:
1. {title1}
2. {title2}
...

Chấm theo 5 tiêu chí, thang 0–10:
- curiosity: gây tò mò, muốn click
- clarity: rõ ràng, dễ hiểu ngay
- emotion: chạm cảm xúc
- search_potential: có từ khóa tìm kiếm tiềm năng
- not_clickbait: không rẻ tiền, không sốc, hợp Phật pháp (10 = hoàn toàn không clickbait)

Trả về JSON array theo đúng thứ tự, mỗi phần tử:
{"curiosity": N, "clarity": N, "emotion": N, "search_potential": N, "not_clickbait": N}
Chỉ JSON array, không giải thích.
```

### Chọn tiêu đề tốt nhất

```
total = round((curiosity + clarity + emotion + searchPotential + notClickbait) / 5)
best_title = candidate có total cao nhất
```

---

## 16. Longform — Description

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildDescriptionPrompt()` |
| **Model** | `LONGFORM_MODEL` → `"google/gemini-2.0-flash"` |
| **System** | `"Bạn là content writer cho kênh YouTube Phật pháp và chữa lành tiếng Việt."` |
| **Temperature** | `0.7` |
| **Max tokens** | `500` |
| **Mục đích** | Viết YouTube description 150–250 từ gồm hook mở đầu, tóm tắt nội dung, CTA nhẹ và disclaimer. Dùng tiêu đề tốt nhất từ #15 làm context. |
| **Output** | Plain text tiếng Việt, dùng trực tiếp làm description khi upload lên YouTube |

### Prompt

```
Viết phần mô tả (description) cho video YouTube về: "{bestTitle}"
Chủ đề gốc: {topic}

Đoạn script:
{scriptExcerpt}

YÊU CẦU:
- 2–3 câu mở đầu hấp dẫn (không lặp lại tiêu đề)
- Tóm tắt nội dung ngắn gọn (3–5 câu)
- CTA nhẹ: mời xem tiếp, đăng ký, chia sẻ nếu thấy ý nghĩa
- Disclaimer mềm nếu phù hợp: "Nội dung mang tính chiêm nghiệm cá nhân, không thay thế tư vấn chuyên môn."
- Tiếng Việt tự nhiên, không văn AI
- Tổng khoảng 150–250 từ

Trả về chỉ phần description, không có tiêu đề hay label.
```

---

## 17. Longform — Tags

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildTagsPrompt()` |
| **Model** | `LONGFORM_MODEL` → `"google/gemini-2.0-flash"` |
| **System** | `"Bạn là SEO specialist cho kênh YouTube Phật pháp Việt Nam."` |
| **Temperature** | `0.3` (deterministic, tập trung vào từ khoá thực) |
| **Max tokens** | `150` |
| **Mục đích** | Sinh tối đa 5 tags bổ sung, kết hợp với 10 base tags cố định → tổng ≤15 tags. Tags tối ưu cho search YouTube tiếng Việt. |
| **Output** | JSON array `["tag1", "tag2", ...]` — tối đa 5 tags bổ sung |

### Base tags cố định (luôn có, không qua LLM)

```
phật pháp, lời phật dạy, chữa lành, buông xả, nhân quả,
vô thường, bình an, chiêm nghiệm, sống đẹp, tâm lý
```

### Prompt

```
Tạo tags YouTube cho video: "{bestTitle}" (chủ đề: {topic})

Tags phải:
- Tiếng Việt, ngắn (1–4 từ mỗi tag)
- Liên quan mật thiết đến nội dung
- Không spam — tối đa 5 tags bổ sung ngoài tags cơ bản
- Ưu tiên từ khóa người Việt thật sự tìm kiếm

Trả về JSON array các tags bổ sung: ["tag1", "tag2", ...]
Chỉ JSON array, không giải thích.
```

---

## 18. Longform — Pinned Comment

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildPinnedCommentPrompt()` |
| **Model** | `LONGFORM_MODEL` → `"google/gemini-2.0-flash"` |
| **System** | `"Bạn là người điều hành kênh YouTube Phật pháp, viết bình luận thân thiện với cộng đồng."` |
| **Temperature** | `0.7` |
| **Max tokens** | `100` |
| **Mục đích** | Sinh 1 bình luận ghim dạng câu hỏi mở để khuyến khích comment, tăng engagement tự nhiên. Ghim ngay sau khi video được publish. |
| **Output** | 1–2 câu tiếng Việt, không emoji quá nhiều |

### Prompt

```
Viết 1 bình luận ghim (pinned comment) cho video YouTube: "{bestTitle}"

Yêu cầu:
- Nhẹ nhàng, chân thành, không giả tạo
- Dạng câu hỏi mở để khuyến khích người xem tương tác
- Liên quan đến chủ đề: {topic}
- Tối đa 2 câu
- Không emoji quá nhiều

Ví dụ tốt:
"Có điều gì trong cuộc đời mà quý vị đang học cách buông xuống không? Chia sẻ trong phần bình luận nhé."

Trả về chỉ nội dung bình luận, không có label.
```

---

## 19. Longform — Thumbnail Intent

| | |
|---|---|
| **File** | [`src/lib/longform-engine.ts`](../src/lib/longform-engine.ts) · `buildThumbnailIntentPrompt()` |
| **Model** | `LONGFORM_MODEL` → `"google/gemini-2.0-flash"` |
| **System** | `"Bạn là art director cho kênh YouTube Phật pháp."` |
| **Temperature** | `0.5` |
| **Max tokens** | `200` |
| **Mục đích** | Sinh metadata định hướng cho thumbnail: cảm xúc chủ đạo, hình ảnh chính nên dùng, gợi ý text overlay tối đa 5 từ, màu sắc. Kết quả lưu vào DB và có thể truyền cho thumbnail_pipeline Python để render. |
| **Output** | JSON `{emotion, mainVisual, text, colorMood}` |

### Prompt

```
Tạo metadata định hướng thumbnail cho video Phật pháp / chữa lành.

Chủ đề: {topic}
Script:
{scriptExcerpt}

Trả về JSON object:
{
  "emotion": "tên cảm xúc chủ đạo (tha_thu/buon_ba/hoi_tiec/binh_an/nhan_qua/buon_xa/vo_thuong/so_hai/tinh_than_tu_bi)",
  "mainVisual": "mô tả ngắn hình ảnh chính nên dùng",
  "text": "gợi ý text thumbnail tối đa 5 từ tiếng Việt in hoa",
  "colorMood": "mô tả màu sắc ấm lạnh"
}
Chỉ JSON, không giải thích.
```

---

## 20. Template mặc định — Short

**File:** [`src/lib/content-prompts.ts`](../src/lib/content-prompts.ts) — `DEFAULT_SHORT_PROMPT`

Đây là `{basePrompt}` inject vào Prompt #4 khi niche **không có** template custom trong DB. Người dùng có thể ghi đè bằng cách tạo template trong UI → lưu vào `promptTemplates` với stage `"short"`.

```
Viết một kịch bản video ngắn về chủ đề: {{topic}}

Lĩnh vực: {{niche}}

Mục tiêu:
Người nghe phải cảm thấy nội dung đang nói đúng nỗi đau, suy nghĩ hoặc trải nghiệm của họ.

Yêu cầu:
- 120-160 từ
- Giọng điệu trầm tĩnh, từng trải
- Không giảng đạo
- Không dạy đời
- Không giải thích dài dòng
- Không mở đầu bằng các câu sáo rỗng

Mở đầu:
- Câu đầu tiên đã là hook, phải khiến người nghe dừng lại ngay
- Không được mở đầu bằng khái niệm trừu tượng, định nghĩa, lời khuyên, hoặc lời Phật dạy
- Câu đầu phải nghe như một sự thật đắt giá, một nỗi đau quen thuộc, một điều tiếc nuối,
  hoặc một cảnh đời rất thường gặp

Sau đó:
- Khơi gợi một cảm xúc hoặc ký ức quen thuộc
- Kể một quan sát rất đời thường
- Dùng hình ảnh cụ thể, gần gũi, không chung chung
- Dẫn nhẹ tới một bài học mang tinh thần Phật pháp hoặc nhân quả
- Không trích kinh dài dòng
- Không dùng từ ngữ triết lý nặng nề

Kết thúc:
- Một câu khiến người nghe muốn suy ngẫm thêm vài giây
- Sau đó thêm nguyên văn câu này ở cuối:
"Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống."

Quy tắc quan trọng nhất:
- Mỗi câu phải khiến người nghe muốn nghe câu tiếp theo
- Nội dung phải giống lời một người từng trải đang nói ra điều mình đã nghiệm, không giống AI, không giống sách self-help
- Xưng hô: "quý vị", "chúng ta", hoặc "người ta"

Định dạng output:
- Chỉ xuất nội dung cuối cùng
- Không tiêu đề, không markdown, không ghi chú, không emoji

Chỉ xuất script, không giải thích thêm.
```

---

## 21. Template mặc định — Long

**File:** [`src/lib/content-prompts.ts`](../src/lib/content-prompts.ts) — `DEFAULT_LONG_PROMPT`

Đây là `{basePrompt}` inject vào Prompt #6 (Outline) khi niche **không có** template custom cho stage `"long"` trong DB.

```
Lĩnh vực: {{niche}}
Chủ đề gợi ý: {{topic}}

Viết nội dung video YouTube dài 15-18 phút, khoảng 2000-2400 từ Tiếng Việt.

Đây là một câu chuyện được kể để người nghe ngồi lại lắng nghe — như nghe pháp thoại,
như đọc một trang sách cũ ai đó ghi chép lại từ thời tu tập.
Không vội vã, không rao giảng, chỉ kể và để lòng người tự lắng xuống.

ĐỊNH DẠNG OUTPUT:
- Chỉ text thuần — không tiêu đề, không nhãn phần, không markdown, không bullet
- Không có câu giới thiệu hay lời kết kiểu "Đây là script..." hoặc "Hy vọng..."
- Bắt đầu ngay vào câu chuyện, kết thúc thật tự nhiên khi câu chuyện đã tròn

GIỌNG VĂN:
- Giọng kể chuyện trầm tĩnh, như người đã trải qua nhiều năm tu học đang chia sẻ lại
- Xưng hô "quý vị", "chúng ta" — lịch sự và gần gũi cùng lúc
- Câu văn có nhịp thở — đoạn ngắn để ngừng lại, đoạn dài để dẫn vào sâu hơn
- Dùng hình ảnh cụ thể: cảnh thiên nhiên, sinh hoạt tu viện, câu chuyện về các bậc thầy,
  tình huống đời thường của người tu học
- Trích dẫn lời Phật hoặc kinh điển nếu phù hợp — tự nhiên, không phô trương
- Chuyển ý bằng dòng chảy tự nhiên của câu chuyện — không dùng "Thứ nhất/Thứ hai", không đánh số
- Tuyệt đối không dùng: "hook", "CTA", "viral", "engagement", hay bất kỳ ngôn ngữ marketing nào

CHIỀU DÀI VÀ NHỊP ĐỘ:
- Mở đầu: dẫn vào không gian câu chuyện (~200 từ)
- Thân: kể chuyện theo mạch tự nhiên (~1800 từ)
- Kết: để câu chuyện tự khép lại trong lặng yên (~100 từ)
- QUAN TRỌNG: Viết đủ chiều dài, không dừng lại giữa chừng.
  Câu chuyện chỉ kết thúc khi đã tròn vẹn.
```

---

## Bảng tổng hợp

| # | Prompt | File | LLM Model | Image Model | Temp | Tokens | Mục đích |
|---|--------|------|-----------|-------------|------|--------|----------|
| 1 | Gợi ý chủ đề | `content-generator.ts` | `gpt-4o-mini` (hardcode param) | — | 0.9 | 800 | Sinh danh sách chủ đề cho cron/user chọn |
| 2 | Sinh 20 hooks | `hook-engine.ts` | `CONTENT_GEN_MODEL` | — | 0.95 | 420 | Pool hook đa dạng để chấm điểm |
| 3 | Chấm điểm hook | `hook-engine.ts` | `CONTENT_GEN_MODEL` | — | 0.2 | 900 | Chọn top 3 hook theo 4 tiêu chí cảm xúc |
| 4 | Short draft | `script-engine.ts` | `CONTENT_GEN_MODEL` (shortModel) | — | 0.75 | 500 | Script video ngắn 130–150 từ |
| 5 | Short repair | `script-engine.ts` | `CONTENT_GEN_MODEL` (shortModel) | — | 0.45 | 500 | Sửa lỗi validation script ngắn (≤3 lần) |
| 6 | Long outline | `script-engine.ts` | `CONTENT_GEN_MODEL` (longModel) | — | 0.6 | 900 | Khung JSON cho video 15–18 phút |
| 7 | Long opening | `script-engine.ts` | `CONTENT_GEN_MODEL` (longModel) | — | 0.75 | 500 | Mở đầu 90–150 từ |
| 8 | Long section ×4 | `script-engine.ts` | `CONTENT_GEN_MODEL` (longModel) | — | 0.72 | 950 | Thân bài, 320–520 từ/section |
| 9 | Long closing | `script-engine.ts` | `CONTENT_GEN_MODEL` (longModel) | — | 0.65 | 500 | Kết bài 120–220 từ |
| 10 | Long repair | `script-engine.ts` | `CONTENT_GEN_MODEL` (longModel) | — | 0.45 | 2500 | Sửa toàn bộ long script (≤2 lần) |
| 11 | Image prompts (short) | `pipeline/images.ts` | `image_prompt_model` → `gpt-4o-mini` | `fal-ai/flux/schnell` ($0.003) | 0.6 | 700 | N prompt EN → render ảnh portrait 4:3 |
| 12 | Image prompts (long) | `pipeline/long-images.ts` | `long_image_prompt_model` → `gpt-4o-mini` | `fal-ai/flux/dev` ($0.025) | 0.7 | 1200 | N prompt EN + SEO VI → render ảnh 16:9 |
| 13 | Thumbnail prompt (long) | `pipeline/long-images.ts` | `long_thumbnail_llm_model` → `gpt-4o-mini` | `fal-ai/flux-pro/v1.1-ultra` ($0.060) | 0.8 | 300 | 1 prompt EN → render thumbnail 1280×720 |
| 14 | Sinh tiêu đề | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.8 | 600 | 10 ứng viên tiêu đề YouTube |
| 15 | Chấm tiêu đề | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.2 | 600 | Chọn tiêu đề tốt nhất (5 tiêu chí) |
| 16 | Description | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.7 | 500 | YouTube description 150–250 từ |
| 17 | Tags | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.3 | 150 | 5 tags bổ sung + 10 base tags cố định |
| 18 | Pinned comment | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.7 | 100 | Câu hỏi engagement ghim sau publish |
| 19 | Thumbnail intent | `longform-engine.ts` | `LONGFORM_MODEL` → `gemini-2.0-flash` | — | 0.5 | 200 | Metadata định hướng thiết kế thumbnail |

---

## Env vars điều khiển model

| Env var | Ảnh hưởng đến | Default khi không set |
|---------|--------------|----------------------|
| `CONTENT_GEN_MODEL` | Prompt #2–10 (hook + script) | → `NEXT_PUBLIC_LLM_TEST_MODEL` → `openai/gpt-4o-mini` |
| `NEXT_PUBLIC_LLM_TEST_MODEL` | Fallback tầng 2 cho #2–10 | `openai/gpt-4o-mini` |
| `LONGFORM_MODEL` | Prompt #14–19 (metadata) | `google/gemini-2.0-flash` |
| `OPENROUTER_API_KEY` | Tất cả LLM calls | *(bắt buộc)* |
| `FAL_KEY` | Prompt #11–13 (image render) | *(bắt buộc)* |

## DB keys điều khiển image model (qua `appConfig`)

| DB key | Ảnh hưởng đến | Default |
|--------|--------------|---------|
| `image_prompt_model` | LLM sinh prompt short images (#11) | `openai/gpt-4o-mini` |
| `fal_image_model` | Render ảnh short (#11) | `fal-ai/flux/schnell` |
| `long_image_prompt_model` | LLM sinh prompt long images (#12) | `openai/gpt-4o-mini` |
| `long_fal_image_model` | Render ảnh long (#12) | `fal-ai/flux/dev` |
| `long_thumbnail_llm_model` | LLM sinh prompt thumbnail (#13) | `openai/gpt-4o-mini` |
| `long_thumbnail_fal_model` | Render thumbnail (#13) | `fal-ai/flux-pro/v1.1-ultra` |

## Model per-niche (DB `promptTemplates`)

| DB field | Ảnh hưởng đến | Fallback |
|----------|--------------|---------|
| `promptTemplates.model` (stage=`"short"`) | `shortModel` cho #2–5 | `CONTENT_GEN_MODEL` |
| `promptTemplates.model` (stage=`"long"`) | `longModel` cho #6–10 | `CONTENT_GEN_MODEL` |

Mỗi niche có thể dùng model khác nhau. Ví dụ: niche A dùng `claude-3-5-haiku` cho script, niche B dùng `google/gemini-2.5-flash`.

---

## Ước tính chi phí mỗi video

**Chế độ `both` (short + long):**

| Hạng mục | Số calls | Token ~(in/out) | Chi phí (gpt-4o-mini) |
|----------|---------|-----------------|----------------------|
| Hook gen + score | 2 | 600/450 | ~$0.0004 |
| Short script | 1–3 | 400/170 | ~$0.0002 |
| Long outline | 1 | 500/300 | ~$0.0003 |
| Long sections ×4 | 4 | 500/450 | ~$0.0007 |
| Long closing | 1 | 400/180 | ~$0.0002 |
| Image prompts (×2 files) | 2 | 700/200 | ~$0.0004 |
| Longform metadata (×6) | 6 | 400/150 | ~$0.0004 (Gemini Flash rẻ hơn) |
| **LLM tổng** | **~18 calls** | **~15.000–22.000 tokens** | **~$0.002–0.003** |
| Short images (flux/schnell) | — | — | $0.003×N ảnh |
| Long images (flux/dev) | — | — | $0.025×5 ảnh = $0.125 |
| Thumbnail (flux-pro/ultra) | — | — | $0.060×1 = $0.060 |
| **Image tổng** | — | — | **~$0.19/video long** |
