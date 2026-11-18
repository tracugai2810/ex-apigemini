# Tài Liệu Ngữ Cảnh & Kiến Trúc Hệ Thống (Handoff Context — 18/11/2026)

> **Mục đích file này:** Giúp AI (Antigravity) khi kéo repository `ex-apigemini` về máy tính khác đọc nhanh và nắm trọn 100% kiến trúc, luồng chạy, URL triển khai, quy ước kỹ thuật và các bẫy đã xử lý liên quan đến **Web App Mobile (Google Apps Script)** và **Extension PC**.

---

## 1. Cấu Trúc Thư Mục & Vai Trò Các File

| File / Thư mục | Vai trò | Trạng thái ngày 18/11/2026 |
| :--- | :--- | :--- |
| `manifest.json`, `inject.js`, `background.js`, `content.js`, `content.css`, `options.html`, `options.css`, `options.js`, `fb-content.js`, `app_automator.js` | Chrome Extension MV3 chạy trên máy tính (Sapo OmniAI) | Hoạt động ổn định; **không bị sửa** khi làm Web Mobile. |
| `bdsd.txt` | Mã nguồn Google Apps Script cho project **`BDSD`** (quét Sapo + check VPBank + tự tạo đơn + Zalo Bot) | Đã nâng cấp thêm bắt nhãn **`Mobile`** và đẩy đồng bộ 1 chiều sang `ex-ngucanhquedich`. |
| `ngu_canh_sheet.txt` | Mã nguồn Google Apps Script cho project **`ex-ngucanhquedich`** (gắn với Google Sheet Ngữ Cảnh) | Đã nâng cấp thành **2 trong 1**: API đồng bộ Sheet cho Extension PC + **Web App Mobile (`/exec`)**. |
| `backup_goc/bdsd.txt` | Bản sao lưu gốc trước khi thêm tính năng Web Mobile | Nguyên trạng (`70.618 bytes`). |
| `backup_goc/ngu_canh_sheet.txt` | Bản sao lưu gốc bản v3.1 (`TextFinder`) trước khi thêm Web Mobile | Nguyên trạng (`9.047 bytes`). |
| `backup_goc/CONTEXT_MOBILE_WEBAPP.md` | Tài liệu ngữ cảnh này | Tài liệu bàn giao. |

---

## 2. Thông Tin Định Danh, Tag & URL Cố Định (Cần Giữ Nguyên)

### A. Google Apps Script Web Apps
1. **Project `ex-ngucanhquedich` (`ngu_canh_sheet.txt` — Web Mobile + Sheet Ngữ Cảnh):**
   * URL `/exec`:
     `https://script.google.com/macros/s/AKfycbzDk2MwmRuYkdKxWndwRFa0caD7apL6k6gLW71pfQbtGQipFz6yiar3xFXhDuZq_PIAvQ/exec`
2. **Project `BDSD` (`bdsd.txt` — Check số dư VPBank, Tạo đơn Sapo & Quét nhãn):**
   * URL `/exec`:
     `https://script.google.com/macros/s/AKfycbz5DPNOoYN3w3X5ppE_DKF4zf3O3Pw7YDg10rfS18qtoQ7wIE7jtJewJ9X3rRfZ5B83/exec`
   * Google Sheet ID của `BDSD`: `16_wFwhakio-ManT-ksrj69mTsV-YJwmQTfB89zhdV-Q`

### B. Sapo OmniAI & API Lục Hào
* **Tenant Sapo:** `janet.mysapo.net`
* **3 Page IDs (`CONFIG.pageIds` trong `bdsd.txt`):**
  * `694cbdb3244df9d04b46c3cf` (Facebook Page 1)
  * `694cbdb3244df9d04b46c3d4` (Facebook Page 2)
  * `6961e838244df9d04bb4deb0` (Instagram Page 3)
* **Các Tag ID trên Sapo:**
  * Tag `"Gửi bảng giá"`: `CONFIG.tagIdBangGia = "696219a92feb720001b8e624"`
  * Tag `"Đã thanh toán"`: `CONFIG.tagIdDaThanhToan = "6a87fe78314f04000121a29c"`
  * Tag **`"Mobile"` (màu tím)**: `CONFIG.tagIdMobile = "6afd6aa32d0deb00017f188e"` (đồng thời tự động nhận diện thêm qua `/api/tags?language=vi` mọi tag có tên chứa `"mobile"`).
* **API Lập Quẻ & Prompt Lục Hào:**
  * Base URL: `https://dshc-luc-hao.vercel.app/`
  * Endpoints sử dụng: `api/lap-que`, `kinh-dich.md`, `viet-lai.md`.

---

## 3. Kiến Trúc & Luồng Hoạt Động Của Web App Mobile

Mục tiêu cốt lõi của Web Mobile là giúp người dùng **xem Hồ sơ ngữ cảnh & Luận quẻ trên điện thoại** với cùng Prompt và cơ chế khóa/fallback như Extension PC, bằng cách tận dụng lại vòng quét Sapo 1 phút/lần đã có sẵn bên `BDSD` mà **không làm chậm hay hỏng luồng VPBank/Tạo đơn**, và **không làm đầy Google Sheet**.

### Sơ đồ luồng tổng thể
```text
[App Sapo Mobile]
   └─ User gắn nhãn "Mobile" cho khách
         │
         ▼ (Trigger 1 phút/lần trong bdsd.txt)
[BDSD: checkFundNow()]
   1. scanMobileTaggedConversations_()
      └─ Đọc ké trên danh sách hội thoại đã tải (0 tốn thêm request Sapo)
      └─ Quét đủ tag trong rawTags để bắt cả "Gửi bảng giá" VÀ "Mobile"
      └─ Ghi nhận tạm vào _latestMobileScanResult
   2. fetchVPBankEntries_() -> processSource_() (Tạo đơn + Zalo Bot như cũ 100%)
   3. flushMobileTaggedSync_() (Chạy SAU CÙNG trong try/catch riêng)
      └─ So sánh currentMap với STORE_KEYS.mobileTaggedMap
      └─ Phát hiện: (a) khách mới gắn nhãn Mobile, (b) khách bị gỡ nhãn Mobile
      └─ Nếu có thay đổi hoặc còn pending -> POST action="sync_mobile_tagged" sang ex-ngucanhquedich
         │
         ▼
[ex-ngucanhquedich: ngu_canh_sheet.txt]
   └─ handleSyncMobileTagged_()
      1. Lưu Sapo Token & Tenant mới nhất từ BDSD
      2. Xóa khỏi danh sách Mobile các khách nằm trong untaggedConvIds (vừa gỡ nhãn trên Sapo)
         (Lưu ý: Chỉ xóa khỏi danh sách Web Mobile, KHÔNG xóa dữ liệu Hồ sơ dài hạn trên Sheet)
      3. Với khách MỚI gắn nhãn Mobile (chưa có trong PropertiesService):
         - Tạo bản ghi với ctxStatus = "idle", unlocked = false, initialScanned = false
         - KHÔNG tự động gọi API AI
         - Chạy đúng 1 lần fetchInitialRecentMessagesOnce_(convId):
           * Tải 1 trang đầu (20 tin nhắn gần nhất từ Sapo)
           * Lọc Regex lấy danh sách Số Seri (6–12 số, mới nhất đứng đầu)
           * Lấy 5 tin nhắn chữ cuối cùng của KHÁCH (slice(-5))
           * Đánh dấu initialScanned = true
      4. Với khách ĐANG TREO NHÃN (chưa gỡ nhãn):
         - Tuyệt đối KHÔNG quét lại tin nhắn ở các chu kỳ tiếp theo (tránh spam/trùng)
         - Chỉ khi gỡ nhãn (xóa khỏi Web) rồi sau đó gắn lại nhãn -> mới coi là mới & quét lại 1 lần
```

### Luồng thao tác của người dùng trên Web Mobile (`getMobileWebHtml_()`)
1. **1 Link `/exec` duy nhất cho nhiều khách:**
   * Thanh trên cùng hiển thị danh sách khách đang gắn nhãn `Mobile` (Avatar / chữ cái đầu + Tên Facebook + icon trạng thái: `⏳` đang chạy, `🔵` có bài `Copy`, `🟣` đã có HS, `🔴` lỗi).
   * Dữ liệu nháp (`serial`, `question`, `dtVal`, `tz`) của từng khách lưu tách biệt theo `convId` trong `localStorage` điện thoại (`sa_mob_draft_<convId>`, tự xóa sau 24h).
2. **Nút `📋 Hồ sơ` & Nút `🔄` (Khóa an toàn giống Extension PC):**
   * Mặc định lúc mới gắn nhãn: Nút ở trạng thái `📋 Hồ sơ` (`ctxStatus: 'idle'`), 2 nút `Gemini` và `Khác` bị khóa mờ (`.locked`).
   * **Chỉ khi người dùng chủ động bấm `📋 Hồ sơ`:** Gọi `mobileBuildContext(convId)` -> `buildCustomerContextOnServer_()` -> tải tối đa 25 trang (500 tin nhắn), lọc bằng `MOB_SKIP_PATTERNS` + `[DD/MM/YYYY HH:mm] KHÁCH / THẦY (SHOP)`, gọi AI tóm tắt theo đúng 3 phần trong `summarizeContextServer_()`, lưu đè vào đúng dòng `convId` trên Sheet Ngữ Cảnh, chuyển nút sang màu tím **`📋 Đã lấy HS (Chạm xem)`** và mở khóa `Gemini` / `Khác`.
   * Bấm **`🔄`**: Xóa dòng ngữ cảnh cũ của `convId` trên Google Sheet (`deleteConvProfileFromSheet_`) và mở khóa ngay `Gemini` / `Khác` để bỏ qua bước lấy HS.
3. **Số Seri, Ngày giờ & Ghép câu hỏi nối tiếp:**
   * Hiển thị các chip Số Seri tự lọc từ 5 tin cuối (chạm chip -> điền vào ô Seri; mặc định tự chọn seri mới nhất nếu ô đang trống).
   * Không tải ảnh tờ tiền của khách và không có nút `Ảnh` lá số (để màn hình mobile gọn nhẹ).
   * Bộ chọn Ngày giờ (`datetime-local`) + 10 múi giờ (`VN (+7)` mặc định).
   * Danh sách 5 tin nhắn chữ gần nhất của khách: **Chạm lần lượt nhiều dòng sẽ tự động nối tiếp (`\n`) vào ô Câu hỏi** để người dùng sửa lại trước khi bấm luận.
4. **Luận quẻ 2 bước & 3 tầng Fallback (`runMobileDivinationServer_`):**
   * **Khóa tương hỗ:** Khi `Gemini` (`triggerSource: 'luan'`) đang `⌛...`, nút `Khác` (`triggerSource: 'chu'`) bị vô hiệu hóa (kể cả khi đang hiện `Copy`), và ngược lại.
   * **Prompt & Flow giống hệt `background.js`:**
     * Gọi `api/lap-que` -> `copyText`.
     * Tải `kinh-dich.md` làm `systemPrompt`; `userPrompt = copyText + question + historyContext` (đọc từ Sheet).
     * Nút `Khác` gọi OpenAI-Compatible (`customAiBaseUrl`, `customAiModel`, `customAiApiKey` — tự thêm `thinking: { type: "disabled" }` nếu URL chứa `z.ai` hoặc `bigmodel`).
     * Cắt bỏ `[TÓM_TẮT]` nếu AI tự sinh thêm.
     * Bước 2 tải `viet-lai.md` -> gọi AI Viết lại (`gemini` hoặc `openai_compatible`).
   * **3 tầng màu nút `Copy`:**
     * Xong cả 2 bước -> **`business`** (`Copy` xanh dương).
     * Bước 1 xong, Bước 2 lỗi/bỏ qua -> **`claude`** (`Copy` xanh lá - giữ bài luận Bước 1).
     * Bước 1 lỗi -> **`gemini`** (`Copy` cam - giữ nội dung quẻ thô `copyText`).
   * **Lưu tạm không làm đầy Google Sheet:** Kết quả chờ copy lưu ở `CacheService` (6 giờ, key `res_<convId>_<triggerSource>_<serial>`) và `localStorage` điện thoại (24 giờ, key `sa_mob_res_<convId>_<triggerSource>_<serial>`). Thoát trình duyệt hoặc đổi tab quay lại vẫn giữ trạng thái `⏳...` hoặc nút `Copy`. Có Modal Copy thủ công dự phòng nếu trình duyệt điện thoại chặn `clipboard`.
5. **Cài đặt riêng cho Web Mobile (`⚙️`):**
   * Lưu trong `PropertiesService` dưới key `MOBILE_SETTINGS_V1`.
   * Các ô `Temperature` và `Top P` nếu để trống thì không gửi lên API (dùng mặc định của model/provider — giống hệt Extension PC).
   * Khi lưu cài đặt có `bdsdUrl`, tự gọi `register_context_url` sang `BDSD` để đồng bộ ngược URL và kéo về `sapo_token` + danh sách khách hiện có.

---

## 4. Các Ràng Buộc Kỹ Thuật & Lỗi Đã Khắc Phục (PHẢI ĐỌC TRƯỚC KHI SỬA CODE GAS)

1. **CẤM DÙNG TOÁN TỬ `?.` (Optional Chaining) TRONG FILE GAS (`ngu_canh_sheet.txt`, `bdsd.txt`):**
   * Bộ phân tích tĩnh (AST parser) của Google Apps Script khi xuất các hàm top-level ra `google.script.run` cho `HtmlService` bị lỗi nếu trong file có toán tử `?.` (như `e?.parameter`), làm toàn bộ hàm `mobileSaveSettings`, `mobileGetDashboardState`... bị `undefined` ở client và văng lỗi `Cannot read properties of undefined (reading 'apply')`.
   * Hiện đã xóa sạch 100% `?.` ở cả `ngu_canh_sheet.txt` và `bdsd.txt`. Khi viết thêm code GAS mới, **luôn dùng `a && a.b` thay cho `a?.b`**.
2. **Cơ chế dự phòng kép cho RPC & Khởi tạo trang:**
   * `doGet(e)` nhúng sẵn dữ liệu `mobileGetDashboardState({})` vào `window.__INITIAL_STATE__` (đã escape `<`, `>`, `\u2028`, `\u2029`) để render ngay lập tức khi mở trang.
   * `doPost(e)` có thêm nhánh `action: "mobile_rpc"` để hàm `runGas()` ở client tự fallback sang `fetch(selfUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" } })` nếu `google.script.run[fnName]` gặp sự cố.
3. **Giới hạn 9KB/key của `PropertiesService` & 100KB của `CacheService` trong GAS:**
   * KHÔNG lưu gộp tất cả khách vào 1 key `PropertiesService`, và KHÔNG lưu nội dung Hồ sơ AI dài vào `PropertiesService`!
   * Hiện tại dùng 1 key chỉ mục nhẹ `MOBILE_CUST_INDEX_V1` + mỗi khách 1 key riêng `MOB_CUST_<convId>` (chỉ giữ metadata + tối đa 5 tin cuối cắt ngắn 350 ký tự/tin); toàn bộ Hồ sơ dài nằm trên Google Sheet. Mọi khách tự dọn sau `86400000` ms (24h).
   * `CacheService` (`fetchTextWithCacheServer_`, `runMobileDivinationServer_`) chỉ `cache.put` khi chuỗi `< 90KB–95KB` trong `try/catch`.
4. **Không giữ `ScriptLock` lâu khi gọi API Sapo/Gemini:**
   * `LockService.getScriptLock()` chỉ giữ trong tích tắc (< 0.2s) khi cập nhật danh sách index hoặc ghi/xóa dòng Google Sheet để tuyệt đối không làm nghẽn yêu cầu `save_profile` từ Extension PC. Việc chạy song song bị chặn bằng khóa theo từng `convId` trong `CacheService` (`init_scan_<convId>`, `ctx_run_<convId>`, `run_<convId>_<serial>`).
5. **Quy trình Deploy lên Google Apps Script (Không làm mất link `/exec`):**
   * Luôn dùng: **Triển khai $\rightarrow$ Quản lý các bản triển khai $\rightarrow$ biểu tượng Chỉnh sửa ✏️ $\rightarrow$ Phiên bản mới $\rightarrow$ Triển khai** (quyền *Thực thi với tư cách: Tôi*, *Ai có quyền truy cập: Bất kỳ ai*). **KHÔNG bấm "Triển khai mới"**.
6. **Bẫy trong `bdsd.txt` khi hội thoại có 2 nhãn:**
   * Khách gắn nhãn `Mobile` thường đã có sẵn nhãn `Gửi bảng giá`. Vòng lặp đọc `rawTags` trong `scanMobileTaggedConversations_()` không được `break` sớm ngay khi thấy `hasTagBangGia` mà phải kiểm tra xong cả `hasTagBangGia` và `hasTagMobile`.
7. **Không phá Poll UX khi đang gõ trên điện thoại:**
   * Trong `renderCustomerWorkspace(cust, forceFull)` của `ngu_canh_sheet.txt`, khi poll nền mỗi 4 giây cập nhật trạng thái cho cùng 1 `convId`, code không ghi đè lại giá trị đang gõ ở `serialInput`, `questionInput`, `dtInput`.

---

## 5. Tóm Tắt Các Nâng Cấp Trên Extension PC Cùng Ngày (18/11/2026)

Để AI ở nhà nắm luôn trạng thái mới nhất của các file Extension trong thư mục gốc:
* **`background.js`:** Thêm khóa chống chạy trùng trong bộ nhớ (`_runningAiTasks`, `_runningCtxTasks`), bỏ đọc trước Sheet và heuristic `isNewCustomer` dư thừa trong `runContextBuild`, tự động dọn 8 loại key `chrome.storage.local` quá hạn 24h (`cleanupExpiredLocalStorage`).
* **`content.js` & `content.css`:** Bỏ polling `getContextMeta` tự động khi mở chat (nút giữ tĩnh `📋 Hồ sơ`); nút `🔄` khóa nút anh em và chờ xóa Sheet xong mới mở khóa; bỏ `chrome.storage.local.get(null)` trong timer 30s; lọc `MutationObserver` & check nhanh `/\d{6}/` trước `innerText`; thiết kế lại card quẻ text (3 tầng Dark Slate) & card quẻ ảnh (4 tầng, tự kẹp mép phải khung chat); đưa nút `Khác` về màu xanh lá `#059669` đồng bộ `Gemini` và nới rộng ô ngày giờ (`.sa-dt-input`).
* **`options.html`, `options.css`, `options.js`:** Thiết kế lại giao diện 3 Tab (`🤖 AI & Model`, `🔗 Đồng bộ & ĐH`, `🪟 Cửa sổ Popup`) kèm thanh footer cố định, giữ nguyên toàn bộ 41 ID phần tử DOM.

---

## 6. Lệnh Kiểm Tra Nhanh Trước Khi Paste Lên Apps Script

Khi chỉnh sửa `bdsd.txt` hoặc `ngu_canh_sheet.txt` ở máy nhà, nên kiểm tra:
1. Không có toán tử `?.` trong cả `bdsd.txt` và `ngu_canh_sheet.txt`.
2. Copy tạm ra file `.js` để chạy `node --check` cho cả code server lẫn đoạn `<script>` bên trong `getMobileWebHtml_()` trước khi dán vào Google Apps Script.
