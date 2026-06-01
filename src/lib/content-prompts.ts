export const DEFAULT_SHORT_PROMPT = `Viết một kịch bản video ngắn về chủ đề: {{topic}}

Lĩnh vực: {{niche}}

Mục tiêu:

Người nghe phải cảm thấy nội dung đang nói đúng nỗi đau, suy nghĩ hoặc trải nghiệm của họ.

Yêu cầu:

- 120-160 từ
- Giọng điệu trầm tĩnh, từng trải
- Không giảng đạo
- Không dạy đời
- Không giải thích dài dòng
- Không mở đầu bằng các câu sáo rỗng

Mở đầu:

- Câu đầu tiên đã là hook, phải khiến người nghe dừng lại ngay
- Không được mở đầu bằng khái niệm trừu tượng, định nghĩa, lời khuyên, hoặc lời Phật dạy
- Câu đầu phải nghe như một sự thật đắt giá, một nỗi đau quen thuộc, một điều tiếc nuối, hoặc một cảnh đời rất thường gặp

Sau đó:

- Khơi gợi một cảm xúc hoặc ký ức quen thuộc
- Kể một quan sát rất đời thường
- Dùng hình ảnh cụ thể, gần gũi, không chung chung
- Dẫn nhẹ tới một bài học mang tinh thần Phật pháp hoặc nhân quả
- Không trích kinh dài dòng
- Không dùng từ ngữ triết lý nặng nề

Kết thúc:

- Một câu khiến người nghe muốn suy ngẫm thêm vài giây
- Sau đó thêm nguyên văn câu này ở cuối:
"Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống."

Quy tắc quan trọng nhất:

- Mỗi câu phải khiến người nghe muốn nghe câu tiếp theo
- Nội dung phải giống lời một người từng trải đang nói ra điều mình đã nghiệm, không giống AI, không giống sách self-help
- Xưng hô: "quý vị", "chúng ta", hoặc "người ta"

Định dạng output:

- Chỉ xuất nội dung cuối cùng
- Không tiêu đề, không markdown, không ghi chú, không emoji

Chỉ xuất script, không giải thích thêm.`;

export const DEFAULT_LONG_PROMPT = `Lĩnh vực: {{niche}}
Chủ đề gợi ý: {{topic}}

Viết nội dung video YouTube dài 15-18 phút, khoảng 2000-2400 từ Tiếng Việt.

Đây là một câu chuyện được kể để người nghe ngồi lại lắng nghe — như nghe pháp thoại, như đọc một trang sách cũ ai đó ghi chép lại từ thời tu tập. Không vội vã, không rao giảng, chỉ kể và để lòng người tự lắng xuống.

ĐỊNH DẠNG OUTPUT:
- Chỉ text thuần — không tiêu đề, không nhãn phần, không markdown, không bullet
- Không có câu giới thiệu hay lời kết kiểu "Đây là script..." hoặc "Hy vọng..."
- Bắt đầu ngay vào câu chuyện, kết thúc thật tự nhiên khi câu chuyện đã tròn

GIỌNG VĂN:
- Giọng kể chuyện trầm tĩnh, như người đã trải qua nhiều năm tu học đang chia sẻ lại
- Xưng hô "quý vị", "chúng ta" — lịch sự và gần gũi cùng lúc
- Câu văn có nhịp thở — đoạn ngắn để ngừng lại, đoạn dài để dẫn vào sâu hơn
- Dùng hình ảnh cụ thể: cảnh thiên nhiên, sinh hoạt tu viện, câu chuyện về các bậc thầy, tình huống đời thường của người tu học
- Trích dẫn lời Phật hoặc kinh điển nếu phù hợp — tự nhiên, không phô trương
- Chuyển ý bằng dòng chảy tự nhiên của câu chuyện — không dùng "Thứ nhất/Thứ hai", không đánh số, không tiêu đề phụ
- Tuyệt đối không dùng: "hook", "CTA", "call to action", "viral", "engagement", hay bất kỳ ngôn ngữ marketing nào
- Chủ đề có thể triển khai theo bất kỳ hướng nào trong lĩnh vực — câu chuyện về một vị Tổ, một bài học thiền, một cuộc đời chuyển hóa, một khoảnh khắc giác ngộ nhỏ trong đời thường

CHIỀU DÀI VÀ NHỊP ĐỘ:
- Mở đầu: dẫn vào không gian câu chuyện, để người nghe bước vào từ từ (~200 từ)
- Thân: kể chuyện theo mạch tự nhiên, có cao có thấp, có lúc đi sâu vào pháp lý, có lúc dừng lại ở một cảnh đẹp (~1800 từ)
- Kết: để câu chuyện tự khép lại trong lặng yên — một câu, một hình ảnh, không cần tổng kết (~100 từ)
- QUAN TRỌNG: Viết đủ chiều dài, không dừng lại giữa chừng. Câu chuyện chỉ kết thúc khi đã tròn vẹn.`;
