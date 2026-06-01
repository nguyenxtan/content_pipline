from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageStat


@dataclass
class ThumbnailScores:
    readability_score: float
    contrast_score: float
    emotion_match_score: float
    curiosity_score: float
    overall_score: float
    suggested_improvements: list[str]

    def to_metadata_fragment(self) -> dict[str, Any]:
        return {
            "readability_score": round(self.readability_score, 2),
            "contrast_score": round(self.contrast_score, 2),
            "emotion_match_score": round(self.emotion_match_score, 2),
            "curiosity_score": round(self.curiosity_score, 2),
            "overall_score": round(self.overall_score, 2),
            "suggested_improvements": self.suggested_improvements,
        }


def _luminance_score(image: Image.Image, bbox: tuple[int, int, int, int] | None) -> float:
    if bbox is None:
        return 5.0
    region = image.crop(bbox).convert("L")
    stat = ImageStat.Stat(region)
    mean = stat.mean[0]
    stddev = stat.stddev[0]
    contrast = abs(238 - mean) / 18.0
    detail_penalty = stddev / 12.0
    score = 9.8 - detail_penalty + min(2.2, contrast)
    return max(1.0, min(10.0, score))


def _curiosity_score(text: str) -> float:
    score = 5.5
    markers = ["ĐỪNG", "KHÔNG", "GÌ", "MUỘN", "KHỔ", "NHẸ", "BIẾT", "SỢ", "?"]
    score += sum(0.45 for marker in markers if marker in text)
    if len(text.split()) > 5:
        score -= 1.5
    if len(text) > 28:
        score -= 0.8
    return max(1.0, min(10.0, score))


def _emotion_match_score(text: str, emotion: str) -> float:
    tokens_by_emotion = {
        "tha_thu": ["THA", "HẬN", "OÁN"],
        "buon_ba": ["BUỒN", "ĐAU", "LÒNG"],
        "hoi_tiec": ["MUỘN", "LỠ", "GIÁ"],
        "binh_an": ["AN", "YÊN", "LẶNG", "NHẸ"],
        "nhan_qua": ["NHÂN", "QUẢ", "GIEO", "NỢ"],
        "buon_xa": ["BUÔNG", "NHẸ", "GIỮ"],
        "vo_thuong": ["QUA", "MÃI", "ĐỔI", "VÔ"],
        "so_hai": ["SỢ", "TRỐN", "LO"],
        "tinh_than_tu_bi": ["THƯƠNG", "TỪ", "BI", "HIỂU"],
    }
    score = 5.8
    for token in tokens_by_emotion.get(emotion, []):
        if token in text:
            score += 1.05
    return max(1.0, min(10.0, score))


def score_thumbnail(
    image: Image.Image,
    thumbnail_text: str,
    detected_emotion: str,
    text_bbox: tuple[int, int, int, int] | None,
) -> ThumbnailScores:
    readability_score = _luminance_score(image, text_bbox)
    contrast_score = max(1.0, min(10.0, readability_score - 0.2))
    emotion_match_score = _emotion_match_score(thumbnail_text, detected_emotion)
    curiosity_score = _curiosity_score(thumbnail_text)
    overall_score = (
        readability_score + contrast_score + emotion_match_score + curiosity_score
    ) / 4.0

    improvements: list[str] = []
    if readability_score < 7:
        improvements.append("Tăng stroke chữ và làm gradient tối dày hơn ở vùng chữ.")
    if contrast_score < 7:
        improvements.append("Giảm độ sáng vùng nền dưới chữ hoặc chuyển chữ sang trắng ngà.")
    if emotion_match_score < 7:
        improvements.append("Chọn cụm chữ bám sát cảm xúc nội dung hơn.")
    if curiosity_score < 7:
        improvements.append("Rút gọn chữ thumbnail và dùng một cụm gây dừng mắt mạnh hơn.")
    if not improvements:
        improvements.append("Thumbnail đang ở mức ổn; ưu tiên test A/B text nếu cần tăng CTR.")

    return ThumbnailScores(
        readability_score=readability_score,
        contrast_score=contrast_score,
        emotion_match_score=emotion_match_score,
        curiosity_score=curiosity_score,
        overall_score=overall_score,
        suggested_improvements=improvements,
    )
