# Content Pipeline

Web app quản lý pipeline tạo nội dung YouTube bằng AI. Từ ideation → script → short → long metadata, tất cả trong một giao diện.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL 16
- **ORM**: Drizzle ORM
- **LLM**: Anthropic Claude (Sonnet/Opus/Haiku)
- **Deploy**: Docker Compose

## Yêu cầu

- Node.js 22+
- pnpm
- Docker & Docker Compose (cho PostgreSQL)

## Setup local

### 1. Cài dependencies

```bash
pnpm install
```

### 2. Khởi động PostgreSQL

```bash
# Dùng Docker Compose (port 5433 để tránh conflict)
docker compose up -d postgres

# Hoặc dùng postgres đã có sẵn, tạo database:
docker exec <container_name> psql -U admin -d postgres -c "CREATE DATABASE content_pipeline;"
```

### 3. Cấu hình environment

```bash
cp .env.example .env.local
# Chỉnh sửa .env.local với thông tin thực:
# - DATABASE_URL
# - APP_PASSWORD (mật khẩu đăng nhập)
# - AUTH_SECRET (chuỗi random 32+ ký tự)
# - ANTHROPIC_API_KEY
```

### 4. Chạy migration

```bash
pnpm db:migrate
```

### 5. Seed dữ liệu mẫu (Phật pháp ngách)

```bash
pnpm db:seed
```

### 6. Khởi động dev server

```bash
pnpm dev
```

Mở [http://localhost:3000](http://localhost:3000) và đăng nhập với `APP_PASSWORD`.

## Commands

| Command | Mô tả |
|---------|-------|
| `pnpm dev` | Chạy dev server |
| `pnpm build` | Build production |
| `pnpm db:generate` | Tạo migration từ schema |
| `pnpm db:migrate` | Chạy migration |
| `pnpm db:push` | Push schema trực tiếp (dev only) |
| `pnpm db:studio` | Mở Drizzle Studio |
| `pnpm db:seed` | Seed dữ liệu mẫu |

## Cấu trúc folder

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Dashboard
│   ├── login/              # Trang đăng nhập
│   ├── niches/             # Quản lý ngách (Phase 2)
│   ├── content/            # Kanban board (Phase 3)
│   ├── agent/              # Prompt suggester (Phase 4)
│   └── settings/           # Cài đặt (Phase 5)
├── actions/                # Server Actions
├── components/
│   ├── ui/                 # shadcn components
│   ├── layout/             # Sidebar, Topbar, AppShell
│   └── ...
├── lib/
│   ├── db/                 # Drizzle schema, client, seed
│   ├── llm/                # Anthropic client, pricing
│   └── prompt/             # Template render/parse
├── proxy.ts                # Route protection (Next.js 16)
└── types/                  # TypeScript types
```

## Cách thêm ngách mới

1. Vào **Ngách** → **Tạo ngách mới**
2. Điền name, slug (auto-generate), description, audience, tone
3. Sau khi tạo → dùng **Agent** để gợi ý 4 prompt template
4. Hoặc tự tạo prompt trong tab **Prompts** của ngách

## Chạy pipeline

1. Vào **Nội dung** → **+ Nội dung mới**
2. Chọn ngách → hệ thống tạo piece và chạy ideation tự động
3. Duyệt ý tưởng → chạy script → short → long
4. Export markdown/JSON khi xong

## Project notes

- [YouTube video analytics notes](docs/youtube-video-analytics-notes.md)

## Thumbnail pipeline

Repo hiện có thêm module Python `thumbnail_pipeline` để dựng thumbnail YouTube từ:

- `script`
- `image_path` có sẵn từ pipeline ảnh hiện tại
- không gọi OpenAI
- không gọi fal.ai
- không gọi internet

Module này làm các bước:

1. Phân tích script bằng rule-based analyzer
2. Chọn cảm xúc chính và đề xuất chữ thumbnail ngắn
3. Crop ảnh về `1280x720`
4. Tăng contrast/sharpness nhẹ, thêm vignette và gradient tối vùng chữ
5. Chọn vị trí chữ bằng heuristic `left/right/bottom/center`
6. Render chữ tiếng Việt với stroke/shadow theo style `buddhist_warm`
7. Chấm điểm readability/contrast/emotion/curiosity và tự render lại tối đa 2 lần nếu chữ chưa đủ rõ

### Cài Python dependencies

```bash
pip install -r requirements.txt
```

### Chạy demo

```bash
python demo_thumbnail.py
```

Demo sẽ:

- tìm một ảnh có sẵn trong `media/images/*/0.jpg` hoặc `media/videos/*-short-thumb.jpg`
- dùng một đoạn script mẫu
- xuất ra:
  - `output/demo_thumbnail.jpg`
  - `output/demo_thumbnail.json`

### Chạy CLI

```bash
python -m thumbnail_pipeline.cli \
  --image input/example.jpg \
  --script input/script.txt \
  --output output/thumb.jpg \
  --style buddhist_warm
```

Nếu muốn ép một câu chữ cố định:

```bash
python -m thumbnail_pipeline.cli \
  --image input/example.jpg \
  --script input/script.txt \
  --output output/thumb.jpg \
  --style buddhist_warm \
  --text "BUÔNG ĐƯỢC SẼ NHẸ"
```

### Font tiếng Việt

Module sẽ ưu tiên các font sau nếu có:

- `assets/fonts/BeVietnamPro-Bold.ttf`
- `assets/fonts/BeVietnamPro-ExtraBold.ttf`
- `assets/fonts/Lexend-Bold.ttf`
- `assets/fonts/Montserrat-ExtraBold.ttf`
- `assets/fonts/Inter-Black.ttf`

Nếu repo chưa có các font này, module sẽ fallback sang font hệ thống. Để chữ tiếng Việt đẹp và ổn định hơn, nên thêm ít nhất một trong các font trên vào `assets/fonts/`.

### Tích hợp vào pipeline video hiện tại

Đầu vào phù hợp nhất là:

- `script = content_generations.longContent` hoặc `shortContent`
- `image_path =` ảnh gốc đầu tiên từ `media/images/<content_id>/0.jpg` hoặc thumbnail frame hiện có
- `output_path = media/videos/<content_id>-thumb.jpg`

Ví dụ tích hợp Python side:

```python
from thumbnail_pipeline import create_thumbnail

create_thumbnail(
    script=script_text,
    image_path=image_path,
    output_path=output_path,
    style="buddhist_warm",
)
```

Sau đó app hiện tại có thể lấy:

- file ảnh thumbnail
- file JSON metadata đi kèm

để upload YouTube hoặc lưu vào analytics/debug pipeline.

## Troubleshoot

**Lỗi connect database:**
```bash
# Kiểm tra postgres đang chạy
docker ps | grep postgres
# Kiểm tra DATABASE_URL đúng format:
# postgresql://user:password@host:port/dbname
# Nếu password có ký tự đặc biệt phải URL-encode: @ → %40, $ → %24
```

**Lỗi ANTHROPIC_API_KEY:**
- Vào Settings → nhập API key và test connection

**Lỗi migration:**
```bash
# Reset và generate lại
pnpm db:generate
pnpm db:migrate
```

**Next.js 16 note:**
Project dùng Next.js 16 thay vì 15 (spec). Middleware được đặt tên `proxy.ts` theo convention mới của Next.js 16.
