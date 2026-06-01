# ── VieNeu-TTS Docker image ──────────────────────────────────────────────────
# Bullseye (GCC 10) thay Bookworm (GCC 12) — tránh lỗi -Werror với llama.cpp
# Platform: linux/arm64 (Mac M4 native, CPU mode — không có Metal trong Docker)
# Model mount từ host ~/.cache/huggingface — không cần download lại
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim-bullseye

# Build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake build-essential gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# llama-cpp-python: tắt native CPU + openmp + warnings-as-errors
# Dùng -w để tắt toàn bộ warnings (tránh -Werror fail với GCC 10)
RUN CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DCMAKE_C_FLAGS=-w -DCMAKE_CXX_FLAGS=-w" \
    FORCE_CMAKE=1 \
    pip install --no-cache-dir "llama-cpp-python==0.3.16"

# VieNeu + FastAPI stack
RUN pip install --no-cache-dir \
    "vieneu==2.7.0" \
    "fastapi>=0.110.0" \
    "uvicorn[standard]>=0.27.0" \
    "pydantic>=2.0.0" \
    "numpy" \
    "onnxruntime"

COPY server.py .

ENV TTS_PORT=8765
ENV MEDIA_AUDIO_DIR=/media/audio
ENV HF_HOME=/root/.cache/huggingface

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/health')" || exit 1

CMD ["python", "server.py"]
