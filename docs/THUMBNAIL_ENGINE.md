# Thumbnail Engine

## Mục tiêu

`thumbnail_pipeline` là engine local để dựng thumbnail YouTube từ:

- `script`
- `image`

Không gọi API ngoài.
Không dùng fal.ai lần nữa.
Không dùng OpenAI.
Không dùng internet.

Output:

- `thumbnail` (`1280x720`, JPG/PNG)
- `thumbnail metadata` (JSON)

## Input / Output

### Input

- `script`: nội dung video
- `image_path`: đường dẫn ảnh gốc đã có sẵn
- `output_path`: nơi lưu thumbnail
- `style`: hiện tại mặc định là `buddhist_warm`
- `text`:
  - optional
  - nếu truyền vào thì bỏ qua bước tự sinh text thumbnail

### Output

Ví dụ:

- `/path/to/thumb.jpg`
- `/path/to/thumb.json`

Metadata JSON gồm:

- `thumbnail_text`
- `detected_emotion`
- `layout`
- `text_position`
- `readability_score`
- `contrast_score`
- `emotion_match_score`
- `curiosity_score`
- `overall_score`
- `suggested_improvements`

## Kiến trúc

Module nằm ở:

- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/__init__.py`
- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/analyzer.py`
- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/editor.py`
- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/scorer.py`
- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/cli.py`

Entry point chính:

- `thumbnail_pipeline.create_thumbnail(...)`

## Pipeline xử lý

### 1. Detect emotion

File:

- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/analyzer.py`

Engine hiện dùng rule-based analyzer.

Nhận diện các nhóm cảm xúc:

- `tha_thu`
- `buon_ba`
- `hoi_tiec`
- `binh_an`
- `nhan_qua`
- `buon_xa`
- `vo_thuong`
- `so_hai`
- `tinh_than_tu_bi`

Analyzer sẽ:

- normalize tiếng Việt
- match keyword theo cảm xúc
- fallback về rule đơn giản nếu script yếu tín hiệu

### 2. Generate 5 thumbnail text variants

`analyzer.py` sẽ:

- rút `main_message`
- tạo `5` phương án text
- mỗi phương án ngắn, ưu tiên đọc tốt trên mobile

Ví dụ:

- `ĐỪNG GIỮ OÁN HẬN`
- `BUÔNG ĐƯỢC SẼ NHẸ`
- `QUÁ MUỘN MỚI HIỂU`
- `SỢ HÃI ĐIỀU GÌ`

### 3. Chọn variant tốt nhất

Analyzer chọn variant cuối cùng theo các tiêu chí:

- dễ đọc
- đúng cảm xúc
- đủ tò mò
- không giật gân quá đà
- hợp ngách Phật pháp/chữa lành

Kết quả được trả ra dưới dạng:

- `thumbnail_options`
- `thumbnail_text`

### 4. Render thumbnail

File:

- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/editor.py`

Các bước render:

1. crop ảnh về `16:9`
2. resize `1280x720`
3. tăng contrast nhẹ
4. tăng sharpness nhẹ
5. giảm saturation nhẹ
6. thêm vignette
7. chọn vị trí text bằng heuristic
8. thêm gradient tối vùng chữ
9. render text tiếng Việt
10. thêm icon `bodhi_leaf` nếu asset tồn tại

### 5. Score thumbnail

File:

- `/Users/bichtuyen/code/content_pipline/thumbnail_pipeline/scorer.py`

Engine chấm:

- `readability_score`
- `contrast_score`
- `emotion_match_score`
- `curiosity_score`
- `overall_score`

Nếu `readability_score < 7`:

- tăng stroke
- tăng gradient
- render lại tối đa `2` lần

## Layout logic

Engine không dùng computer vision nặng.

Heuristic hiện tại:

- thử các vùng `left`, `right`, `bottom`, `center`
- đo độ sáng vùng
- đo độ chi tiết vùng bằng edge density
- chọn vùng đặt chữ có rủi ro thấp hơn

Metadata trả ra:

- `layout`
- `text_position`

## Font tiếng Việt

Ưu tiên các font:

- `assets/fonts/BeVietnamPro-Bold.ttf`
- `assets/fonts/BeVietnamPro-ExtraBold.ttf`
- `assets/fonts/Lexend-Bold.ttf`
- `assets/fonts/Montserrat-ExtraBold.ttf`
- `assets/fonts/Inter-Black.ttf`

Fallback:

- font hệ thống macOS/Linux nếu repo chưa có font custom

## Style hiện có

### `buddhist_warm`

Đặc tính:

- chữ vàng ấm / trắng ngà
- stroke đen rõ
- shadow mềm
- glow nhẹ
- tổng thể sạch, ấm, trang nghiêm

## Cách chạy

### Python API

```python
from thumbnail_pipeline import create_thumbnail

result = create_thumbnail(
    script=script_text,
    image_path="/path/to/input.jpg",
    output_path="/path/to/output.jpg",
    style="buddhist_warm",
)
```

Kết quả:

```python
{
  "image_path": "...",
  "metadata_path": "...",
  "thumbnail_text": "...",
  "detected_emotion": "...",
  "layout": "...",
  "text_position": "...",
  "readability_score": ...,
  "contrast_score": ...,
  "emotion_match_score": ...,
  "curiosity_score": ...,
  "overall_score": ...,
  "suggested_improvements": [...]
}
```

### CLI

```bash
python -m thumbnail_pipeline.cli \
  --image input/example.jpg \
  --script input/script.txt \
  --output output/thumb.jpg \
  --style buddhist_warm
```

Nếu muốn ép text:

```bash
python -m thumbnail_pipeline.cli \
  --image input/example.jpg \
  --script input/script.txt \
  --output output/thumb.jpg \
  --style buddhist_warm \
  --text "BUÔNG ĐƯỢC SẼ NHẸ"
```

## Demo

Repo có sẵn:

- `/Users/bichtuyen/code/content_pipline/demo_thumbnail.py`

Chạy:

```bash
python3 demo_thumbnail.py
```

Output hiện tại:

- `/Users/bichtuyen/code/content_pipline/output/demo_thumbnail.jpg`
- `/Users/bichtuyen/code/content_pipline/output/demo_thumbnail.json`

## Tích hợp vào pipeline hiện tại

Hướng dùng đúng:

### Long video

Input:

- `script = content_generations.longContent`
- `image_path = media/images/<content_id>-long/0.jpg` hoặc ảnh thumbnail source phù hợp

Output:

- `media/videos/<content_id>-thumb.jpg`
- `media/videos/<content_id>-thumb.json`

Đây là case phù hợp nhất cho thumbnail rời của YouTube.

### Short video

Không nên coi engine này là giải pháp chính cho Shorts.

Với short:

- thứ quan trọng hơn là frame đầu trong video
- title overlay trong video quan trọng hơn thumbnail rời

Nên dùng engine này cho:

- long video thumbnail
- hoặc internal preview / debug cho short

## Constraint hiện tại

1. Analyzer vẫn là rule-based
   - chưa hiểu ngữ nghĩa sâu như LLM

2. Layout chọn theo heuristic
   - chưa có segmentation/object detection

3. Chưa có A/B testing engine
   - hiện chỉ chọn 1 variant tốt nhất trong local scoring

4. Chưa có adaptive font family theo emotion
   - hiện mới ưu tiên một bộ font chung

## Hướng mở rộng sau này

1. thay analyzer bằng local LLM hoặc internal model
2. thêm face/object-aware layout
3. thêm nhiều style preset hơn
4. thêm batch mode để dựng thumbnail hàng loạt
5. nối thẳng vào upload flow long video

## Trạng thái hiện tại

Phase 2 ở mức engine local đã hoàn chỉnh:

- detect emotion
- generate 5 text variants
- chọn variant tốt nhất
- render thumbnail
- score thumbnail

Không có dependency vào API ngoài.
