# VieNeu-TTS Server

FastAPI wrapper cho [VieNeu-TTS v2.7](https://github.com/pnnbao97/VieNeu-TTS) — tiếng Việt, 7 giọng, chạy local.

## Chạy bằng Docker (khuyên dùng)

```bash
# Lần đầu: build image (~10-15 phút do compile llama-cpp-python)
docker compose build tts

# Chạy
docker compose up tts -d

# Xem log
docker compose logs tts -f

# Dừng
docker compose stop tts
```

> **Lưu ý:** Docker dùng CPU mode (không có Metal).  
> Model mount từ `~/.cache/huggingface` trên host → không cần tải lại.

---

## Chạy native (nhanh hơn ~2-3x, dùng Metal M4)

```bash
source ~/venv-tts-new/bin/activate
python tts-server/server.py
```

Server chạy tại `http://localhost:8765`

---

## Thông số trên Mac M4 16GB

| Mode | Load lần đầu | Tốc độ TTS |
|------|-------------|------------|
| Native Metal | ~7-40s | ~1.5-3s / 100 từ |
| Docker CPU | ~30-60s | ~5-10s / 100 từ |

---

## API

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/health` | Kiểm tra server |
| GET | `/voices` | Danh sách giọng đọc |
| POST | `/tts` | Tổng hợp giọng nói |

### POST /tts

```json
{
  "text": "Kính chào quý đạo hữu...",
  "voice": "Ly",
  "content_id": "content-abc123"
}
```

### Giọng đọc

| ID | Tên | Giới tính | Vùng |
|----|-----|-----------|------|
| Ly | Trúc Ly | Nữ | Bắc |
| Ngoc | Bích Ngọc | Nữ | Bắc |
| Binh | Thanh Bình | Nam | Bắc |
| Tuyen | Phạm Tuyên | Nam | Bắc |
| Doan | Thục Đoan | Nữ | Nam |
| Vinh | Xuân Vĩnh | Nam | Nam |
| Sơn | Thái Sơn | Nam | Nam |

---

## Lưu ý

- Server chỉ xử lý **1 request tại một thời điểm** (semaphore) để tránh OOM
- Model GGUF Q4 (~490MB) cache tại `~/.cache/huggingface/`
- File WAV chỉ bị xóa khi cả YouTube lẫn Facebook đều upload xong
