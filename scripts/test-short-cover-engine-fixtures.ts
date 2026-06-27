import { generateShortCover } from "@/lib/short-cover-engine";

type Fixture = {
  name: string;
  input: {
    topic: string;
    selectedHook?: string | null;
    script?: string | null;
    formatType?: string | null;
    topicFamily?: string | null;
  };
  forbid?: string[];
  allowOneOf?: string[];
  forbidEnding?: string[];
  maxWords?: number;
};

const FIXTURES: Fixture[] = [
  {
    name: "Bi co lap should not end with Vo",
    input: {
      topic: "Bị cô lập",
      selectedHook: "Chỉ một câu nói không hợp lòng có thể đẩy xa những người ta yêu thương.",
      script: "Chỉ một câu nói không hợp lòng có thể đẩy xa những người ta yêu thương.",
    },
    forbid: ["Nhận Ra Khoảng Cách Vô"],
    allowOneOf: ["Bị Cô Lập"],
    forbidEnding: ["vô"],
  },
  {
    name: "Su im lang dang so should stay anchored to silence",
    input: {
      topic: "Sự im lặng đáng sợ",
      selectedHook: "Im lặng đôi khi lại là cách tốt nhất để thể hiện nỗi buồn.",
      script: "Im lặng đôi khi lại là cách tốt nhất để thể hiện nỗi buồn.",
    },
    forbid: ["Nỗi Đau Nhưng Trong Tĩnh"],
    allowOneOf: ["Im Lặng Đáng Sợ", "Sức Mạnh Im Lặng"],
  },
  {
    name: "Chua duoc chap nhan should not drift to qua khu",
    input: {
      topic: "Chưa được chấp nhận",
      selectedHook: "Người ta thường chọn cách quên đi những kỷ niệm tươi đẹp nhưng lại giữ mãi nỗi buồn.",
      script: "Người ta thường chọn cách quên đi những kỷ niệm tươi đẹp nhưng lại giữ mãi nỗi buồn.",
    },
    forbid: ["Đừng Kẹt Quá Khứ"],
    allowOneOf: ["Cần Được Chấp Nhận", "Chấp Nhận Chính Mình"],
  },
  {
    name: "Mong moi cha me should avoid awkward fragment",
    input: {
      topic: "Mong mỏi cha mẹ",
      selectedHook: "Nhiều người chỉ nhận ra tình yêu của cha mẹ khi không còn bên cạnh.",
      script: "Nhiều người chỉ nhận ra tình yêu của cha mẹ khi không còn bên cạnh.",
    },
    forbid: ["Chỉ Nhận Ra Tình Yêu"],
    allowOneOf: ["Tình Cha Mẹ", "Mong Cha Mẹ Hiểu"],
  },
  {
    name: "Quote short im lang la tri tue should prefer tri tue of silence",
    input: {
      topic: "Im lặng là trí tuệ của người từng trải",
      selectedHook: "Góc nhìn nhân quả: Im lặng không phải là yếu đuối, mà là sức mạnh của tâm hồn.",
      script: "Góc nhìn nhân quả: Im lặng không phải là yếu đuối, mà là sức mạnh của tâm hồn.",
    },
    forbid: ["Giúp Ta Nhận Ra Giá"],
    allowOneOf: ["Trí Tuệ Của Im Lặng", "Sức Mạnh Im Lặng"],
  },
  {
    name: "Quote: nhieu lua chon should produce compact Tu Do Trong Tam",
    input: {
      topic: "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
      selectedHook: "Nhiều lựa chọn chỉ khiến tâm hồn thêm mỏi mệt, tự do thật sự đến từ bên trong.",
      script: "Nhiều lựa chọn chỉ khiến tâm hồn thêm mỏi mệt, tự do thật sự đến từ bên trong.",
      formatType: "legacy_quote_short",
      topicFamily: "(unclassified)",
    },
    allowOneOf: ["Tự Do Trong Tâm"],
    maxWords: 6,
  },
  {
    name: "Quote: khoanh khac hien tai should produce Song Trong Hien Tai",
    input: {
      topic: "Khoảnh khắc hiện tại là quà tặng lớn nhất",
      selectedHook: "Sống trọn vẹn từng khoảnh khắc, đó là hạnh phúc vĩnh cửu.",
      script: "Sống trọn vẹn từng khoảnh khắc, đó là hạnh phúc vĩnh cửu.",
      formatType: "legacy_quote_short",
      topicFamily: "binh_yen_an_lac",
    },
    allowOneOf: ["Sống Trong Hiện Tại"],
    maxWords: 6,
  },
  {
    name: "Quote: hanh phuc bat dau should produce Hanh Phuc Tu Tam",
    input: {
      topic: "Hạnh phúc bắt đầu từ bên trong tâm trí",
      selectedHook: "Hạnh phúc vững bền khi tâm an lạc giữa dòng đời.",
      script: "Hạnh phúc vững bền khi tâm an lạc giữa dòng đời.",
      formatType: "legacy_quote_short",
      topicFamily: "binh_yen_an_lac",
    },
    allowOneOf: ["Hạnh Phúc Từ Tâm"],
    maxWords: 6,
  },
  {
    name: "Quote: nhan qua khong bao gio quen should produce natural compact phrase",
    input: {
      topic: "Nhân quả không bao giờ quên",
      selectedHook: "Nhân quả luôn theo ta, chính mình tạo nên số phận.",
      script: "Nhân quả luôn theo ta, chính mình tạo nên số phận.",
      formatType: "legacy_quote_short",
      topicFamily: "phuoc_bao_nghiep_duyen",
    },
    allowOneOf: ["Nhân Quả Không Quên"],
    maxWords: 6,
  },
  {
    name: "Quote: song cham de cam nhan should produce Song Cham Lai",
    input: {
      topic: "Sống chậm để cảm nhận sâu hơn",
      selectedHook: "Sống chậm, lắng nghe tâm hồn, để thấy rõ đẹp đẽ của cuộc sống.",
      script: "Sống chậm, lắng nghe tâm hồn, để thấy rõ đẹp đẽ của cuộc sống.",
      formatType: "legacy_quote_short",
      topicFamily: "binh_yen_an_lac",
    },
    allowOneOf: ["Sống Chậm Lại"],
    maxWords: 6,
  },
];

const failures: string[] = [];

for (const fixture of FIXTURES) {
  const result = generateShortCover(fixture.input);
  const lower = result.coverText.toLocaleLowerCase("vi-VN");

  if (fixture.forbid?.some((text) => result.coverText === text)) {
    failures.push(`${fixture.name}: produced forbidden text "${result.coverText}"`);
  }
  if (fixture.allowOneOf && !fixture.allowOneOf.includes(result.coverText)) {
    failures.push(`${fixture.name}: got "${result.coverText}" instead of one of [${fixture.allowOneOf.join(", ")}]`);
  }
  if (fixture.forbidEnding?.some((ending) => lower.endsWith(ending))) {
    failures.push(`${fixture.name}: ended with forbidden token "${result.coverText}"`);
  }
  if (fixture.maxWords != null && result.coverText.split(/\s+/).filter(Boolean).length > fixture.maxWords) {
    failures.push(`${fixture.name}: "${result.coverText}" exceeds maxWords ${fixture.maxWords}`);
  }
  if (result.qualityFlags.length > 0) {
    failures.push(`${fixture.name}: quality flags present [${result.qualityFlags.join(", ")}] for "${result.coverText}"`);
  }
}

console.log("## Short Cover Fixture Test");
console.log(`- Fixtures: ${FIXTURES.length}`);
console.log(`- Passed: ${FIXTURES.length - failures.length}`);
console.log(`- Failed: ${failures.length}`);

for (const failure of failures) {
  console.log(`- ${failure}`);
}

if (failures.length > 0) {
  process.exit(1);
}
