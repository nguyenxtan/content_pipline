# Hook Engine

## Mục tiêu

Hook Engine là engine chuyên trách cho bước tạo và chấm hook.

Input:

- `topic`

Output:

- `20 hook variants`
- `score` cho từng hook
- `top 3 hooks`

Engine này **không viết script**.
Nó chỉ làm đúng 2 việc:

1. tạo hook
2. chấm hook

## File chính

- [/Users/bichtuyen/code/content_pipline/src/lib/hook-engine.ts](/Users/bichtuyen/code/content_pipline/src/lib/hook-engine.ts)
- [/Users/bichtuyen/code/content_pipline/src/actions/hook-engine.ts](/Users/bichtuyen/code/content_pipline/src/actions/hook-engine.ts)

## API nội bộ

### Core engine

`runHookEngine(...)`

Input:

- `topic`
- `nicheName`
- `nicheDescription`
- `tone`
- `model`
- `dedupBlock` (optional)
- `count` (default `20`)

Output:

- `hooks`
- `scoredHooks`
- `top3`
- `selectedHook`
- `usage`

### Server action

`runHookEngineAction(...)`

Input:

- `topic`
- `nicheId` (optional)
- `model` (optional)
- `dedupTopics` (optional)

Output:

- `20 hook variants`
- `score từng hook`
- `top 3 hooks`

## Scoring criteria

Mỗi hook được chấm theo 4 tiêu chí:

- `curiosity`
- `emotion`
- `relatability`
- `retention`

Mỗi tiêu chí:

- thang điểm `0-10`
- số nguyên

Tổng điểm:

- `total = curiosity + emotion + relatability + retention`

## Cách engine hoạt động

### Bước 1: Generate 20 hooks

Engine dùng prompt riêng để tạo đúng `20` hook theo chủ đề.

Ràng buộc chính:

- không được mở đầu sáo rỗng
- không được viết kiểu bài giảng
- phải có lực kéo trong 1-2 giây đầu
- ưu tiên:
  - sự thật gây giật mình
  - tiếc nuối
  - tình huống đời thường
  - nghịch lý
  - cảm giác người nghe thấy mình trong đó

### Bước 2: Score hooks

Engine gửi cả 20 hook vào prompt chấm điểm riêng.

Model trả về:

- score từng hook
- top 3 hooks

Nếu parse JSON lỗi hoặc score trả về không hợp lệ:

- engine fallback sang heuristic local
- vẫn trả đủ `scoredHooks` và `top3`

## Fallback local scoring

Nếu LLM scoring fail, engine dùng fallback local:

- bắt marker gây tò mò
- bắt marker cảm xúc
- bắt marker gần gũi đời thường
- bắt marker giữ chân

Fallback này không mạnh bằng LLM, nhưng giúp pipeline không gãy.

## Shape output

Ví dụ:

```json
{
  "hooks": [
    "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu.",
    "Có những thứ người ta mang theo cả đời mà không nhận ra."
  ],
  "scoredHooks": [
    {
      "index": 1,
      "hook": "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu.",
      "scores": {
        "curiosity": 8,
        "emotion": 9,
        "relatability": 9,
        "retention": 8,
        "total": 34
      }
    }
  ],
  "top3": [
    {
      "index": 1,
      "hook": "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu.",
      "scores": {
        "curiosity": 8,
        "emotion": 9,
        "relatability": 9,
        "retention": 8,
        "total": 34
      }
    }
  ],
  "selectedHook": "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu."
}
```

## Tích hợp với content pipeline hiện tại

Hook Engine hiện đã được nối vào short generation flow.

Short pipeline mới làm như sau:

1. gọi Hook Engine để tạo `20 hook`
2. nhận `top 3`
3. lấy `selectedHook`
4. chỉ sau đó mới viết script short

Tức là logic hook không còn nằm rải trong `content-generator.ts` nữa.

## Lợi ích

- tách riêng phần hook khỏi phần script
- score hook rõ ràng theo 4 tiêu chí
- có `top 3` để sau này mở UI review hook
- dễ benchmark và thay prompt riêng
- dễ thay scoring model sau này mà không đụng script pipeline

## Điều chưa làm trong Phase 3

Phase này **không** làm:

- UI chọn hook tay
- A/B testing hook
- lưu score hook vào DB
- generate script

Phase 3 chỉ dừng ở mức:

- generate hooks
- score hooks
- top 3 hooks
