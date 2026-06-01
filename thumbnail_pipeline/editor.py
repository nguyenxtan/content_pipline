from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps, ImageStat

from .analyzer import AnalysisResult, analyze_script
from .scorer import score_thumbnail


TARGET_SIZE = (1280, 720)
MARGIN_X = 68
MARGIN_Y = 52
TEXT_COLORS = {
    "buddhist_warm": {
        "primary": "#F6E7B5",
        "secondary": "#E4BF63",
        "stroke": "#101010",
        "shadow": "#000000",
        "glow": "#C9972D",
    }
}


@dataclass
class LayoutCandidate:
    name: str
    bbox: tuple[int, int, int, int]
    gradient_direction: str


@dataclass
class RenderResult:
    image: Image.Image
    text_bbox: tuple[int, int, int, int] | None
    text_position: str
    layout: str
    readability_score: float
    metadata: dict[str, Any]


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _find_font(font_names: list[str]) -> Path | None:
    root = _repo_root()
    candidates = [
        root / "assets" / "fonts" / name for name in font_names
    ]
    candidates.extend([
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Helvetica.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"),
    ])
    for path in candidates:
        if path.exists():
            return path
    return None


def _load_font(size: int, heavy: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_names = [
        "BeVietnamPro-ExtraBold.ttf" if heavy else "BeVietnamPro-Bold.ttf",
        "BeVietnamPro-Bold.ttf",
        "Lexend-Bold.ttf",
        "Montserrat-ExtraBold.ttf",
        "Inter-Black.ttf",
    ]
    font_path = _find_font(font_names)
    if font_path is not None:
        return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def _fit_crop_to_16_9(image: Image.Image) -> Image.Image:
    width, height = image.size
    target_ratio = TARGET_SIZE[0] / TARGET_SIZE[1]
    current_ratio = width / height

    if current_ratio > target_ratio:
        new_width = int(height * target_ratio)
        left = (width - new_width) // 2
        box = (left, 0, left + new_width, height)
    else:
        new_height = int(width / target_ratio)
        top = max(0, int(height * 0.10))
        top = min(top, height - new_height)
        box = (0, top, width, top + new_height)
    cropped = image.crop(box)
    return cropped.resize(TARGET_SIZE, Image.Resampling.LANCZOS)


def _apply_base_adjustments(image: Image.Image) -> Image.Image:
    image = ImageEnhance.Contrast(image).enhance(1.08)
    image = ImageEnhance.Sharpness(image).enhance(1.10)
    image = ImageEnhance.Color(image).enhance(0.96)
    return image


def _add_vignette(image: Image.Image, strength: float = 0.22) -> Image.Image:
    width, height = image.size
    vignette = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(vignette)
    max_radius = math.hypot(width / 2, height / 2)
    for y in range(height):
        for x in range(width):
            dx = x - width / 2
            dy = y - height / 2
            distance = math.hypot(dx, dy) / max_radius
            darkness = int(max(0, min(255, (distance ** 1.7) * 255 * strength)))
            vignette.putpixel((x, y), darkness)
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    overlay.putalpha(vignette)
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def _layout_candidates() -> list[LayoutCandidate]:
    width, height = TARGET_SIZE
    return [
        LayoutCandidate("left", (MARGIN_X, 84, width // 2 - 28, height - 96), "left"),
        LayoutCandidate("right", (width // 2 + 28, 84, width - MARGIN_X, height - 96), "right"),
        LayoutCandidate("bottom", (112, height // 2 + 110, width - 112, height - 58), "bottom"),
        LayoutCandidate("center", (190, 150, width - 190, height - 140), "center"),
    ]


def _region_score(image: Image.Image, bbox: tuple[int, int, int, int]) -> float:
    region = image.crop(bbox).convert("L")
    brightness = ImageStat.Stat(region).mean[0]
    detail = ImageStat.Stat(region.filter(ImageFilter.FIND_EDGES)).mean[0]
    brightness_penalty = abs(brightness - 132) / 22.0
    detail_penalty = detail / 10.0
    return brightness_penalty + detail_penalty


def choose_text_position(image: Image.Image) -> LayoutCandidate:
    candidates = _layout_candidates()
    return min(candidates, key=lambda candidate: _region_score(image, candidate.bbox))


def _gradient_mask(size: tuple[int, int], direction: str, strength: int) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    for y in range(height):
        for x in range(width):
            if direction == "left":
                ratio = 1.0 - (x / max(1, width - 1))
            elif direction == "right":
                ratio = x / max(1, width - 1)
            elif direction == "bottom":
                ratio = y / max(1, height - 1)
            else:
                dx = abs(x - width / 2) / (width / 2)
                dy = abs(y - height / 2) / (height / 2)
                ratio = max(0.0, 1.0 - (dx + dy) / 1.9)
            value = int(max(0, min(255, ratio * strength)))
            mask.putpixel((x, y), value)
    return mask


def _apply_gradient(image: Image.Image, candidate: LayoutCandidate, pass_index: int) -> Image.Image:
    gradient_strength = 120 + pass_index * 28
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    mask = _gradient_mask(image.size, candidate.gradient_direction, gradient_strength)
    overlay.putalpha(mask)
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int, max_lines: int) -> list[str] | None:
    words = text.split()
    if not words:
        return None
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        left, top, right, bottom = draw.textbbox((0, 0), trial, font=font, stroke_width=0)
        if (right - left) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    if len(lines) <= max_lines:
        return lines
    return None


def _fit_text_block(text: str, candidate: LayoutCandidate, pass_index: int) -> tuple[ImageFont.ImageFont, list[str], tuple[int, int, int, int], int]:
    temp_image = Image.new("RGB", TARGET_SIZE)
    draw = ImageDraw.Draw(temp_image)
    x0, y0, x1, y1 = candidate.bbox
    max_width = x1 - x0
    max_height = y1 - y0

    for size in range(84, 34, -2):
        font = _load_font(size, heavy=True)
        max_lines = 2 if len(text.split()) <= 4 else 3
        lines = _wrap_lines(draw, text, font, max_width, max_lines=max_lines)
        if not lines:
            continue
        spacing = max(8, size // 7)
        line_boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=0) for line in lines]
        text_width = max(box[2] - box[0] for box in line_boxes)
        text_height = sum(box[3] - box[1] for box in line_boxes) + spacing * (len(lines) - 1)
        if text_width <= max_width and text_height <= max_height:
            top = y0 + (max_height - text_height) // 2
            if candidate.name == "bottom":
                top = max(y0, y1 - text_height - 18)
            left = x0 + (max_width - text_width) // 2
            if candidate.name == "left":
                left = x0 + 12
            elif candidate.name == "right":
                left = x1 - text_width - 12
            stroke = max(4, size // 14 + pass_index)
            return font, lines, (left, top, left + text_width, top + text_height), stroke
    raise RuntimeError("Không thể fit text vào thumbnail")


def _draw_text(
    image: Image.Image,
    text: str,
    candidate: LayoutCandidate,
    style: str,
    pass_index: int,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    colors = TEXT_COLORS.get(style, TEXT_COLORS["buddhist_warm"])
    font, lines, bbox, stroke_width = _fit_text_block(text, candidate, pass_index)
    draw = ImageDraw.Draw(image)
    x0, y0, x1, y1 = bbox
    spacing = max(8, getattr(font, "size", 56) // 7 if hasattr(font, "size") else 8)
    line_heights = [draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)[3] for line in lines]

    shadow_offset = 4 + pass_index
    glow_color = ImageColor.getrgb(colors["glow"])
    shadow_color = ImageColor.getrgb(colors["shadow"]) + (120,)
    text_color = colors["secondary"] if pass_index == 0 else colors["primary"]

    text_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    current_y = y0
    for idx, line in enumerate(lines):
        line_box = text_draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        line_width = line_box[2] - line_box[0]
        line_x = x0 + (x1 - x0 - line_width) // 2

        text_draw.text(
            (line_x + shadow_offset, current_y + shadow_offset),
            line,
            font=font,
            fill=shadow_color,
            stroke_width=0,
        )
        text_draw.text(
            (line_x, current_y),
            line,
            font=font,
            fill=glow_color + (110,),
            stroke_width=max(2, stroke_width - 2),
            stroke_fill=glow_color,
        )
        text_draw.text(
            (line_x, current_y),
            line,
            font=font,
            fill=text_color,
            stroke_width=stroke_width,
            stroke_fill=colors["stroke"],
        )
        current_y += line_heights[idx] + spacing

    composed = Image.alpha_composite(image.convert("RGBA"), text_layer.filter(ImageFilter.GaussianBlur(radius=0.35)))
    return composed.convert("RGB"), bbox


def _maybe_add_bodhi_icon(image: Image.Image) -> Image.Image:
    icon_path = _repo_root() / "assets" / "icons" / "bodhi_leaf.png"
    if not icon_path.exists():
        return image
    icon = Image.open(icon_path).convert("RGBA")
    icon.thumbnail((72, 72), Image.Resampling.LANCZOS)
    canvas = image.convert("RGBA")
    pos = (TARGET_SIZE[0] - icon.width - 24, 22)
    canvas.alpha_composite(icon, dest=pos)
    return canvas.convert("RGB")


def _build_metadata(
    analysis: AnalysisResult,
    candidate: LayoutCandidate,
    scores: dict[str, Any],
) -> dict[str, Any]:
    return {
        "thumbnail_text": analysis.thumbnail_text,
        "detected_emotion": analysis.detected_emotion,
        "layout": f"{candidate.name}_focus",
        "text_position": candidate.name,
        **scores,
    }


def render_thumbnail(
    script: str,
    image_path: str | Path,
    output_path: str | Path,
    style: str = "buddhist_warm",
    override_text: str | None = None,
) -> RenderResult:
    source = Path(image_path)
    if not source.exists():
        raise FileNotFoundError(f"Image not found: {source}")

    analysis = analyze_script(script, override_text=override_text)
    base = Image.open(source).convert("RGB")
    base = _fit_crop_to_16_9(base)
    base = _apply_base_adjustments(base)
    base = _add_vignette(base)

    candidate = choose_text_position(base)
    best_image = base
    best_bbox: tuple[int, int, int, int] | None = None
    best_scores: dict[str, Any] | None = None

    for pass_index in range(3):
        current = _apply_gradient(base, candidate, pass_index)
        current, bbox = _draw_text(current, analysis.thumbnail_text, candidate, style, pass_index)
        current = _maybe_add_bodhi_icon(current)

        scores = score_thumbnail(current, analysis.thumbnail_text, analysis.detected_emotion, bbox)
        best_image = current
        best_bbox = bbox
        best_scores = scores.to_metadata_fragment()
        if scores.readability_score >= 7:
            break

    if best_scores is None:
        raise RuntimeError("Failed to score thumbnail")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    save_kwargs: dict[str, Any] = {}
    if output.suffix.lower() in {".jpg", ".jpeg"}:
        save_kwargs = {"quality": 94, "subsampling": 0}
    best_image.save(output, **save_kwargs)

    metadata = _build_metadata(analysis, candidate, best_scores)
    metadata_path = output.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    return RenderResult(
        image=best_image,
        text_bbox=best_bbox,
        text_position=candidate.name,
        layout=metadata["layout"],
        readability_score=float(best_scores["readability_score"]),
        metadata=metadata,
    )


def create_thumbnail(
    script: str,
    image_path: str | Path,
    output_path: str | Path,
    style: str = "buddhist_warm",
    text: str | None = None,
) -> dict[str, Any]:
    result = render_thumbnail(
        script=script,
        image_path=image_path,
        output_path=output_path,
        style=style,
        override_text=text,
    )
    return {
        "image_path": str(Path(output_path)),
        "metadata_path": str(Path(output_path).with_suffix(".json")),
        **result.metadata,
    }
