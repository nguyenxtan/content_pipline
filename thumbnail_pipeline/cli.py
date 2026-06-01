from __future__ import annotations

import argparse
from pathlib import Path

from .editor import create_thumbnail


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create YouTube thumbnails from an existing image and script.")
    parser.add_argument("--image", required=True, help="Path to the source image")
    parser.add_argument("--script", required=True, help="Path to the script text file")
    parser.add_argument("--output", required=True, help="Output thumbnail path (.jpg or .png)")
    parser.add_argument("--style", default="buddhist_warm", help="Thumbnail style preset")
    parser.add_argument("--text", default=None, help="Optional explicit thumbnail text override")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    script_path = Path(args.script)
    if not script_path.exists():
        raise FileNotFoundError(f"Script not found: {script_path}")
    script = script_path.read_text(encoding="utf-8")

    result = create_thumbnail(
        script=script,
        image_path=args.image,
        output_path=args.output,
        style=args.style,
        text=args.text,
    )

    print(f"Thumbnail saved: {result['image_path']}")
    print(f"Metadata saved: {result['metadata_path']}")
    print(f"Text: {result['thumbnail_text']}")
    print(f"Emotion: {result['detected_emotion']}")
    print(f"Layout: {result['layout']} / {result['text_position']}")
    print(f"Readability: {result['readability_score']}")


if __name__ == "__main__":
    main()
