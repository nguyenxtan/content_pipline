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
