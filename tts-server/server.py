"""
TTS FastAPI Server — wrapper cho VieNeu-TTS v2.7+
Chạy trên Mac M4, lắng nghe tại http://localhost:8765

Cách chạy:
  source ~/venv-tts-new/bin/activate
  python /Users/bichtuyen/code/content_pipline/tts-server/server.py
"""

import os
import re
import time
import uuid
import asyncio
import logging
import wave
from pathlib import Path
from typing import Optional, List, Dict, Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("tts-server")

# ── Config ──────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("TTS_PORT", "8765"))
MEDIA_AUDIO_DIR = Path(os.getenv(
    "MEDIA_AUDIO_DIR",
    str(Path(__file__).parent.parent / "media" / "audio")
))
MEDIA_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ── Load VieNeu-TTS khi khởi động (1 lần duy nhất) ─────────────────────────────
log.info("⏳ Đang load VieNeu-TTS (lần đầu sẽ tải model từ HuggingFace ~800MB)...")
log.info("   Dùng chế độ standard/GGUF trên CPU (M4 Metal được tự động dùng nếu có)")
t0 = time.time()
try:
    from vieneu import Vieneu
    tts_engine = Vieneu(
        mode="standard",
        backbone_device="cpu",   # llama-cpp-python tự dùng Metal nếu n_gpu_layers=-1
        emotion="natural",
    )
    log.info(f"✅ VieNeu-TTS sẵn sàng sau {time.time()-t0:.1f}s")
except Exception as e:
    log.error(f"❌ Không load được VieNeu-TTS: {e}")
    tts_engine = None

# ── Load Whisper (faster-whisper) cho word-level timestamps ─────────────────────
log.info("⏳ Đang load Whisper model (base, lần đầu tải ~140MB)...")
t1 = time.time()
try:
    from faster_whisper import WhisperModel
    whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    log.info(f"✅ Whisper sẵn sàng sau {time.time()-t1:.1f}s")
except Exception as e:
    log.error(f"⚠️  Không load được Whisper: {e}")
    whisper_model = None

# ── Chỉ chạy 1 TTS job cùng lúc (tránh OOM trên 16GB) ─────────────────────────
_tts_lock = asyncio.Semaphore(1)

# ── Async job registry (for long-running polling requests) ─────────────────────
_jobs: Dict[str, Dict[str, Any]] = {}
_job_queue: Optional[asyncio.Queue] = None

# ── FastAPI ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="VieNeu-TTS Server", version="2.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.on_event("startup")
async def _startup():
    global _job_queue
    _job_queue = asyncio.Queue()
    asyncio.create_task(_async_job_worker())


async def _async_job_worker():
    """Background worker: drains _job_queue one job at a time, holding _tts_lock."""
    while True:
        job_id = await _job_queue.get()
        job = _jobs.get(job_id)
        if not job:
            _job_queue.task_done()
            continue

        req: "TTSRequest" = job["req"]
        job["status"] = "processing"

        text = req.text.strip()
        if req.output_path:
            out_path = Path(req.output_path)
        elif req.content_id:
            out_path = MEDIA_AUDIO_DIR / f"{req.content_id}.wav"
        else:
            out_path = MEDIA_AUDIO_DIR / f"tts_{int(time.time())}.wav"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        text = re.sub(r'\n{2,}', '\n', text)
        text = re.sub(r'[ \t]{2,}', ' ', text)

        async with _tts_lock:
            voice_id = req.voice or "Ly"
            log.info(f"🎙️  TTS-async [{req.content_id or 'anon'}] voice={voice_id}: {len(text)} ký tự → {out_path.name}")
            t0 = time.time()
            try:
                try:
                    voice_data = tts_engine.get_preset_voice(voice_id)
                except ValueError:
                    log.warning(f"Voice '{voice_id}' không tìm thấy, dùng voice mặc định")
                    voice_data = tts_engine.get_preset_voice()

                audio = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: tts_engine.infer(text=text, voice=voice_data)
                )
                tts_engine.save(audio, str(out_path))
                elapsed = time.time() - t0
                duration = _wav_duration(out_path)
                log.info(f"✅ TTS-async xong: {out_path.name} | audio={duration:.1f}s | xử lý={elapsed:.1f}s")
                job.update({"status": "done", "path": str(out_path),
                            "duration_seconds": duration, "processing_time": elapsed})
            except Exception as e:
                elapsed = time.time() - t0
                log.error(f"❌ TTS-async lỗi ({elapsed:.1f}s): {e}")
                job.update({"status": "error", "error": str(e), "processing_time": elapsed})

        job.pop("req", None)  # release memory
        _job_queue.task_done()


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "Ly"        # voice preset ID (Ly, Ngoc, Binh, ...)
    content_id: Optional[str] = None   # dùng làm tên file: {content_id}.wav
    output_path: Optional[str] = None  # nếu truyền thì ghi ra đây
    emotion: Optional[str] = "natural"


class TTSResponse(BaseModel):
    success: bool
    path: str = ""
    duration_seconds: float = 0.0
    processing_time: float = 0.0
    error: Optional[str] = None


class TimestampsRequest(BaseModel):
    audio_path: str   # absolute path to wav/mp3 file
    text: Optional[str] = None  # optional hint for alignment accuracy


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float


class TimestampsResponse(BaseModel):
    success: bool
    words: List[WordTimestamp] = []
    error: Optional[str] = None


@app.get("/voices")
async def list_voices():
    """Trả về danh sách giọng đọc có sẵn."""
    if not tts_engine:
        raise HTTPException(503, "TTS engine chưa load")
    voices = tts_engine.list_preset_voices()
    return {
        "voices": [
            {"id": vid, "name": name}
            for name, vid in voices
        ]
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tts_engine": "loaded" if tts_engine else "not_loaded",
        "whisper": "loaded" if whisper_model else "not_loaded",
        "media_audio_dir": str(MEDIA_AUDIO_DIR),
    }


@app.post("/tts", response_model=TTSResponse)
async def synthesize(req: TTSRequest):
    if not tts_engine:
        raise HTTPException(503, "VieNeu-TTS chưa load xong hoặc bị lỗi khi khởi động")

    text = req.text.strip()
    if len(text) < 5:
        raise HTTPException(400, "Text quá ngắn (min 5 ký tự)")

    # Xác định output path
    if req.output_path:
        out_path = Path(req.output_path)
    elif req.content_id:
        out_path = MEDIA_AUDIO_DIR / f"{req.content_id}.wav"
    else:
        out_path = MEDIA_AUDIO_DIR / f"tts_{int(time.time())}.wav"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Normalize paragraph breaks → single newline to avoid TTS chunking artifacts (2-3s silence)
    text = re.sub(r'\n{2,}', '\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)

    async with _tts_lock:
        voice_id = req.voice or "Ly"
        log.info(f"🎙️  TTS [{req.content_id or 'anon'}] voice={voice_id}: {len(text)} ký tự → {out_path.name}")
        t0 = time.time()
        try:
            # Lấy voice preset theo ID
            try:
                voice_data = tts_engine.get_preset_voice(voice_id)
            except ValueError:
                log.warning(f"Voice '{voice_id}' không tìm thấy, dùng voice mặc định")
                voice_data = tts_engine.get_preset_voice()

            audio = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: tts_engine.infer(text=text, voice=voice_data)
            )
            tts_engine.save(audio, str(out_path))
            elapsed = time.time() - t0
            duration = _wav_duration(out_path)
            log.info(f"✅ Xong: {out_path.name} | audio={duration:.1f}s | xử lý={elapsed:.1f}s")
            return TTSResponse(
                success=True,
                path=str(out_path),
                duration_seconds=duration,
                processing_time=elapsed,
            )
        except Exception as e:
            elapsed = time.time() - t0
            log.error(f"❌ TTS lỗi ({elapsed:.1f}s): {e}")
            return TTSResponse(success=False, error=str(e), processing_time=elapsed)


@app.post("/tts/async")
async def synthesize_async(req: TTSRequest):
    """Submit a TTS job and return immediately. Poll /tts/status/{job_id} for result."""
    if not tts_engine:
        raise HTTPException(503, "VieNeu-TTS chưa load xong hoặc bị lỗi khi khởi động")
    text = req.text.strip()
    if len(text) < 5:
        raise HTTPException(400, "Text quá ngắn (min 5 ký tự)")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "queued", "req": req, "created_at": time.time()}
    await _job_queue.put(job_id)
    log.info(f"📥 TTS-async queued [{req.content_id or 'anon'}] → job={job_id[:8]}")
    return {"job_id": job_id, "status": "queued"}


@app.get("/tts/status/{job_id}")
async def get_tts_job_status(job_id: str):
    """Poll this endpoint until status == 'done' or 'error'."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' không tồn tại hoặc đã hết hạn")
    return {k: v for k, v in job.items() if k not in ("req",)}


@app.post("/timestamps", response_model=TimestampsResponse)
async def get_timestamps(req: TimestampsRequest):
    """Dùng Whisper để lấy word-level timestamps cho file audio."""
    if not whisper_model:
        return TimestampsResponse(success=False, error="Whisper chưa load")

    audio_path = Path(req.audio_path)
    if not audio_path.exists():
        return TimestampsResponse(success=False, error=f"File không tồn tại: {req.audio_path}")

    log.info(f"🔍 Timestamps [{audio_path.name}]...")
    t0 = time.time()
    try:
        def _run_whisper():
            segments, _ = whisper_model.transcribe(
                str(audio_path),
                language="vi",
                word_timestamps=True,
                beam_size=5,
                initial_prompt=req.text or None,
            )
            words = []
            for segment in segments:
                if segment.words:
                    for w in segment.words:
                        word = w.word.strip()
                        if word:
                            words.append(WordTimestamp(word=word, start=w.start, end=w.end))
            return words

        words = await asyncio.get_event_loop().run_in_executor(None, _run_whisper)
        log.info(f"✅ Timestamps: {len(words)} words trong {time.time()-t0:.1f}s")
        return TimestampsResponse(success=True, words=words)
    except Exception as e:
        log.error(f"❌ Whisper lỗi: {e}")
        return TimestampsResponse(success=False, error=str(e))


def _wav_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "r") as f:
            return f.getnframes() / float(f.getframerate())
    except Exception:
        return 0.0


if __name__ == "__main__":
    log.info(f"🚀 TTS Server tại http://localhost:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
