from __future__ import annotations

from pathlib import Path

from thumbnail_pipeline import create_thumbnail


DEMO_SCRIPT = """
Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu.
Nhưng nhiều người vẫn ôm mãi một ký ức cũ, rồi tự làm nặng lòng mình mỗi ngày.
Có khi chỉ vì một câu nói năm xưa mà quý vị mất đi rất nhiều năm bình an.
Đời thường vẫn vậy, người đi qua thì đã đi qua, chỉ có người ở lại là cứ lặng lẽ đau.
Tinh thần Phật pháp không bắt ta quên hết, nhưng nhắc ta đừng biến nỗi đau thành nghiệp mới.
Buông bớt oán hận không phải vì người kia xứng đáng, mà vì lòng mình xứng đáng được nhẹ hơn.
Đến một lúc, thứ cần tha thứ nhất có khi lại là chính mình.
Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống.
""".strip()


def find_demo_image() -> Path:
    repo_root = Path(__file__).resolve().parent
    preferred = sorted(repo_root.glob("media/images/*/0.jpg"))
    if preferred:
        return preferred[0]
    thumbs = sorted(repo_root.glob("media/videos/*-short-thumb.jpg"))
    if thumbs:
        return thumbs[0]
    raise FileNotFoundError("No sample image found under media/images or media/videos")


def main() -> None:
    repo_root = Path(__file__).resolve().parent
    image_path = find_demo_image()
    output_path = repo_root / "output" / "demo_thumbnail.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    result = create_thumbnail(
        script=DEMO_SCRIPT,
        image_path=image_path,
        output_path=output_path,
        style="buddhist_warm",
    )

    print("Demo completed")
    print(f"Image: {image_path}")
    print(f"Output: {result['image_path']}")
    print(f"Metadata: {result['metadata_path']}")
    print(f"Text: {result['thumbnail_text']}")


if __name__ == "__main__":
    main()
