from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata


EMOTION_LABELS = {
    "tha_thu": "tha thứ",
    "buon_ba": "buồn bã",
    "hoi_tiec": "hối tiếc",
    "binh_an": "bình an",
    "nhan_qua": "nhân quả",
    "buon_xa": "buông xả",
    "vo_thuong": "vô thường",
    "so_hai": "sợ hãi",
    "tinh_than_tu_bi": "tinh thần từ bi",
}


EMOTION_KEYWORDS = {
    "tha_thu": [
        "tha thứ", "oán hận", "tổn thương", "giận", "hận", "tha cho",
        "buông oán", "ôm hận", "người làm mình đau",
    ],
    "buon_ba": [
        "buồn", "trống rỗng", "cô đơn", "nước mắt", "mệt mỏi", "đau lòng",
        "lụi tàn", "u uất",
    ],
    "hoi_tiec": [
        "hối tiếc", "giá như", "quá muộn", "ước gì", "đáng lẽ", "muộn màng",
        "lỡ", "day dứt",
    ],
    "binh_an": [
        "bình an", "an yên", "tĩnh lặng", "im lặng", "nhẹ lòng", "thảnh thơi",
        "thở chậm", "thư thái",
    ],
    "nhan_qua": [
        "nhân quả", "gieo", "gặt", "nghiệp", "quả báo", "duyên", "trả giá",
        "gieo gì gặt nấy",
    ],
    "buon_xa": [
        "buông", "buông bỏ", "xả", "nhẹ", "đừng giữ", "thả xuống", "rời tay",
        "không níu",
    ],
    "vo_thuong": [
        "vô thường", "đổi thay", "không còn", "mai này", "mất đi", "tan biến",
        "tạm bợ", "sớm muộn",
    ],
    "so_hai": [
        "sợ", "sợ hãi", "lo lắng", "hoảng", "bất an", "run", "đêm dài",
        "tránh né",
    ],
    "tinh_than_tu_bi": [
        "từ bi", "thương người", "bao dung", "dịu dàng", "hiểu người",
        "không trách", "mở lòng", "ôm lấy nỗi đau",
    ],
}


EMOTION_TEMPLATES = {
    "tha_thu": [
        "ĐỪNG GIỮ OÁN HẬN",
        "THA ĐI CHO NHẸ",
        "NGƯỜI ẤY ĐÃ QUÊN",
        "BUÔNG HẬN MỚI YÊN",
        "GIỮ HOÀI ĐỂ LÀM GÌ",
    ],
    "buon_ba": [
        "CÀNG IM CÀNG ĐAU",
        "NỖI BUỒN KHÓ NÓI",
        "KHÔNG AI THẤY ĐÂU",
        "MỆT RỒI PHẢI KHÔNG",
        "TRONG LÒNG ĐANG NẶNG",
    ],
    "hoi_tiec": [
        "QUÁ MUỘN MỚI HIỂU",
        "GIÁ NHƯ BIẾT SỚM",
        "LỠ RỒI MỚI ĐAU",
        "CÓ NHỮNG ĐIỀU MUỘN",
        "DAY DỨT VÌ MỘT LẦN",
    ],
    "binh_an": [
        "IM LẶNG MÀ SÁNG",
        "AN YÊN LÀ ĐỦ",
        "BÌNH AN KHÔNG XA",
        "THỞ CHẬM LÒNG NHẸ",
        "CÀNG LẶNG CÀNG SÁNG",
    ],
    "nhan_qua": [
        "NHÂN QUẢ KHÔNG QUÊN",
        "GIEO GÌ GẶT NẤY",
        "NỢ ĐỜI KHÓ TRỐN",
        "ĐỪNG COI THƯỜNG NHÂN QUẢ",
        "QUẢ ĐẾN RẤT ĐÚNG LÚC",
    ],
    "buon_xa": [
        "BUÔNG ĐƯỢC SẼ NHẸ",
        "GIỮ NỮA LÀ KHỔ",
        "THẢ XUỐNG ĐI THÔI",
        "BUÔNG MỚI THẤY NHẸ",
        "ĐỪNG ÔM NỮA",
    ],
    "vo_thuong": [
        "RỒI CŨNG SẼ QUA",
        "KHÔNG GÌ GIỮ MÃI",
        "ĐỜI ĐANG ĐỔI THAY",
        "VÔ THƯỜNG RẤT GẦN",
        "MAI NÀY KHÁC RỒI",
    ],
    "so_hai": [
        "SỢ HÃI ĐIỀU GÌ",
        "ĐỪNG CHẠY TRỐN NỮA",
        "CÀNG SỢ CÀNG KHỔ",
        "NỖI SỢ ĐANG GIỮ BẠN",
        "BƯỚC QUA NỖI SỢ",
    ],
    "tinh_than_tu_bi": [
        "HIỂU RỒI SẼ THƯƠNG",
        "TỪ BI KHÔNG YẾU",
        "THƯƠNG ĐÚNG CÁCH",
        "MỞ LÒNG THÌ NHẸ",
        "HIỀN KHÔNG PHẢI NHỊN",
    ],
}


GENERIC_CANDIDATES = [
    "ĐỪNG TỰ LÀM KHỔ",
    "BUÔNG ĐƯỢC SẼ NHẸ",
    "QUÁ MUỘN MỚI HIỂU",
    "NGƯỜI KHÔN ĐỀU BIẾT",
    "SỢ HÃI ĐIỀU GÌ",
]


@dataclass
class AnalysisResult:
    detected_emotion: str
    main_message: str
    thumbnail_options: list[str]
    thumbnail_text: str


def _normalize_text(text: str) -> str:
    lowered = text.lower()
    decomposed = unicodedata.normalize("NFD", lowered)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _clean_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-zÀ-ỹà-ỹ0-9']+", text)


def _sentence_split(script: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+", script.strip())
    return [part.strip() for part in parts if part.strip()]


def detect_emotion(script: str) -> str:
    normalized = _normalize_text(script)
    scores: dict[str, int] = {}
    for emotion, keywords in EMOTION_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            score += normalized.count(_normalize_text(keyword))
        scores[emotion] = score

    best = max(scores.items(), key=lambda item: item[1])
    if best[1] > 0:
        return best[0]

    fallback_rules = [
        ("tha_thu", ["tha", "han", "ton thuong"]),
        ("so_hai", ["so", "lo", "bat an"]),
        ("binh_an", ["yen", "lang", "nhe"]),
        ("nhan_qua", ["nghiep", "qua"]),
    ]
    for emotion, markers in fallback_rules:
        if any(marker in normalized for marker in markers):
            return emotion
    return "binh_an"


def extract_main_message(script: str, detected_emotion: str) -> str:
    sentences = _sentence_split(script)
    if not sentences:
        return ""

    emotion_words = EMOTION_KEYWORDS.get(detected_emotion, [])
    normalized_sentences = [_normalize_text(sentence) for sentence in sentences]
    scored: list[tuple[int, int, str]] = []
    for index, (sentence, normalized) in enumerate(zip(sentences, normalized_sentences)):
        score = 0
        for keyword in emotion_words:
            if _normalize_text(keyword) in normalized:
                score += 3
        words = len(_clean_words(sentence))
        if 8 <= words <= 24:
            score += 2
        if "," in sentence or "nhưng" in normalized or "vì" in normalized:
            score += 1
        scored.append((score, -index, sentence))

    best = max(scored, key=lambda item: item[0])
    return best[2]


def _compress_to_short_phrase(message: str) -> str:
    words = _clean_words(message.upper())
    if not words:
        return "BÌNH AN SẼ ĐẾN"
    if len(words) <= 5:
        return " ".join(words[:5])

    trimmed = words[:5]
    if len(trimmed) >= 4 and trimmed[0] in {"KHI", "NẾU", "RỒI", "VÀ", "NHƯNG"}:
        trimmed = trimmed[1:]
    return " ".join(trimmed[:5])


def generate_thumbnail_text_options(script: str, detected_emotion: str, main_message: str) -> list[str]:
    options: list[str] = []
    for candidate in EMOTION_TEMPLATES.get(detected_emotion, []):
        if candidate not in options:
            options.append(candidate)

    compressed = _compress_to_short_phrase(main_message)
    if compressed and compressed not in options:
        options.append(compressed)

    normalized_script = _normalize_text(script)
    dynamic_rules = [
        ("qua muon", "QUÁ MUỘN MỚI HIỂU"),
        ("im lang", "CÀNG LẶNG CÀNG SÁNG"),
        ("oan han", "ĐỪNG GIỮ OÁN HẬN"),
        ("nhan qua", "NHÂN QUẢ KHÔNG QUÊN"),
        ("so hai", "SỢ HÃI ĐIỀU GÌ"),
        ("buong", "BUÔNG ĐƯỢC SẼ NHẸ"),
    ]
    for marker, text in dynamic_rules:
        if marker in normalized_script and text not in options:
            options.append(text)

    for candidate in GENERIC_CANDIDATES:
        if candidate not in options:
            options.append(candidate)

    cleaned: list[str] = []
    for option in options:
        words = _clean_words(option)
        if not words:
            continue
        text = " ".join(words).upper()
        if len(text.split()) > 5:
            continue
        if text not in cleaned:
            cleaned.append(text)
        if len(cleaned) == 5:
            break

    while len(cleaned) < 5:
        fallback = GENERIC_CANDIDATES[len(cleaned) % len(GENERIC_CANDIDATES)]
        if fallback not in cleaned:
            cleaned.append(fallback)
        else:
            cleaned.append(f"{fallback} {len(cleaned) + 1}")
    return cleaned[:5]


def score_thumbnail_text_option(text: str, detected_emotion: str) -> float:
    words = text.split()
    readability = max(0.0, 5.5 - abs(len(words) - 4) * 0.8)
    char_penalty = max(0.0, (len(text) - 24) * 0.08)
    readability = max(0.5, readability - char_penalty)

    curiosity_markers = ["ĐỪNG", "KHÔNG", "SAO", "GÌ", "MUỘN", "BIẾT", "NHẸ", "KHỔ", "SỢ"]
    curiosity = sum(1 for marker in curiosity_markers if marker in text)
    curiosity_score = min(4.0, 1.2 + curiosity * 0.6)

    emotion_fit = 1.5
    if any(template == text for template in EMOTION_TEMPLATES.get(detected_emotion, [])):
        emotion_fit = 4.0
    elif detected_emotion == "binh_an" and any(token in text for token in ["AN", "LẶNG", "NHẸ"]):
        emotion_fit = 3.6
    elif detected_emotion == "tha_thu" and any(token in text for token in ["HẬN", "THA"]):
        emotion_fit = 3.6
    elif detected_emotion == "nhan_qua" and "NHÂN QUẢ" in text:
        emotion_fit = 4.0

    tone_guard = 4.0
    if "!!!" in text or len(words) > 5:
        tone_guard = 2.0
    if any(token in text for token in ["SỐC", "KINH HOÀNG", "BÍ MẬT ĐỘNG TRỜI"]):
        tone_guard = 0.5

    return readability + curiosity_score + emotion_fit + tone_guard


def choose_best_thumbnail_text(options: list[str], detected_emotion: str) -> str:
    return max(options, key=lambda option: score_thumbnail_text_option(option, detected_emotion))


def analyze_script(script: str, override_text: str | None = None) -> AnalysisResult:
    detected_emotion = detect_emotion(script)
    main_message = extract_main_message(script, detected_emotion)
    thumbnail_options = generate_thumbnail_text_options(script, detected_emotion, main_message)
    thumbnail_text = override_text.strip().upper() if override_text else choose_best_thumbnail_text(
        thumbnail_options,
        detected_emotion,
    )
    return AnalysisResult(
        detected_emotion=detected_emotion,
        main_message=main_message,
        thumbnail_options=thumbnail_options,
        thumbnail_text=thumbnail_text,
    )
