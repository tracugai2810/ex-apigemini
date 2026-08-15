/**
 * Sapo Auto Order v2.0.0 (API ORDER)
 * --------------------------------------------------
 * - v2.0: Chuyển tạo đơn từ click DOM sang gọi API trực tiếp.
 *         page_id & facebook_page_id bắt ĐỘNG từ API Sapo.
 * - v1.2: Thêm datetime picker cho text scan & manual input.
 * - Tối ưu hóa hiệu năng & độ ổn định tuyệt đối.
 * --------------------------------------------------
 */

// === INJECT TOKEN & PAGE INTERCEPTOR (trước IIFE) ===
try {
  const _s = document.createElement('script');
  _s.src = chrome.runtime.getURL('inject.js');
  (document.head || document.documentElement).appendChild(_s);
} catch(_e) { console.error('[SA] inject.js load error:', _e); }

(() => {
  "use strict";

  // Kiểm tra môi trường Sapo
  const HOST = location.hostname;
  if (HOST.includes("mysapo.net") && window === window.top) return;
  if (!HOST.includes("sapoapps.vn") && !HOST.includes("mysapo.net")) return;

  const SapoAuto_v1 = {
    // 1. CẤU HÌNH HỆ THỐNG
    CONFIG: {
      SKU: { 20000: "KDTV-CB", 50000: "KDTV-CT", 500000: "KDTV-CS" },
      AMOUNTS: [20000, 50000, 500000],
      LABELS: { 20000: "20", 50000: "50", 500000: "500" },
      CLS: { 20000: "btn-20k", 50000: "btn-50k", 500000: "btn-500k" },
      SKIP_W: ["avatar", "emoji", "sticker", "icon", "logo", "favicon", "gravatar", "badge", "sprite", "profile", "gif", "svg"],
      luchaoUrl: "https://dshc-luc-hao.vercel.app/",
      API: {
        LOCATION_ID: 885876,
        DEFAULT_TENANT: "janet.mysapo.net",
        PRODUCTS: {
          20000:  { variantId: 185634645, title: "Sản phẩm - 20K" },
          50000:  { variantId: 185634646, title: "Sản phẩm - Chi Tiết" },
          500000: { variantId: 185634647, title: "Sản phẩm - 500K" }
        }
      }
    },

    // 2. BIẾN TRẠNG THÁI (STATE)
    STATE: {
      busy: false,
      toastTimer: null,
      scanTimer: null,
      activeBadges: new Map(),   // Lưu cặp Image -> Badge để đồng bộ vị trí
      activeTextGroups: new Map(), // FIX BUG FOLLOW TAB: Lưu cặp div -> sa-group để cleanup
      textKeys: new Set(), // Track theo nội dung text — tránh re-create khi Sapo re-render
      myToken: "",         // Token xác thực Sapo (bắt từ inject.js)
      pageMap: new Map()   // Map<conversationId, {pageId, fbPageId}> — lưu per-conversation, tránh ghi đè loạn
    },

    // 2b. LƯU / ĐỌC SERI TỪ STORAGE (Persistent, per-image — không chia sẻ giữa các ảnh khác nhau)
    STORAGE_KEY: "sa_serial_img_",
    storage: {
      // Tạo key riêng cho từng ảnh dựa vào src
      _key(imgSrc) {
        // Lấy 80 ký tự cuối của src làm key (đủ unique, tránh quá dài)
        const tail = (imgSrc || "").slice(-80).replace(/[^a-zA-Z0-9]/g, "_");
        return SapoAuto_v1.STORAGE_KEY + tail;
      },
      save(imgSrc, serial) {
        try {
          const key = this._key(imgSrc);
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.set({ [key]: serial });
          }
          localStorage.setItem(key, serial);
        } catch(e) {}
      },
      load(imgSrc, cb) {
        try {
          const key = this._key(imgSrc);
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.get([key], (res) => {
              const val = res?.[key] || localStorage.getItem(key) || "";
              cb(val);
            });
          } else {
            cb(localStorage.getItem(key) || "");
          }
        } catch(e) { cb(""); }
      },
      clear(imgSrc) {
        try {
          const key = this._key(imgSrc);
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.remove(key);
          }
          localStorage.removeItem(key);
        } catch(e) {}
      }
    },

    // 2c. MODULE XỬ LÝ AI (OCR & TEXT GENERATION via Gemini API)
    aiService: {
      apiKeys: [],
      model: "gemini-3.5-flash-lite",
      FALLBACK_MODELS: [
        "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", 
        "gemini-3-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash", 
        "gemini-2.0-flash-lite", "gemini-1.5-flash"
      ],

      // === CONVERSATION HISTORY: Lưu tóm tắt quẻ đã luận để AI nhớ ngữ cảnh ===
      // Đồng bộ qua Google Sheets (Apps Script) — hoạt động trên mọi máy, mọi trình duyệt
      conversationHistory: {
        STORAGE_PREFIX: 'sa_conv_hist_',
        MAX_SUMMARIES: 3, // Giữ tối đa 3 quẻ gần nhất
        _cache: new Map(), // In-memory cache để đọc nhanh trong phiên làm việc
        _sheetUrl: null,   // URL Google Apps Script (đọc từ settings)
        _urlLoaded: false,

        _key(convId) {
          return this.STORAGE_PREFIX + (convId || 'default');
        },

        // Đọc URL Apps Script từ settings (chạy 1 lần)
        async _ensureUrl() {
          if (this._urlLoaded) return;
          this._urlLoaded = true;
          try {
            const data = await new Promise((resolve) => {
              if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
                chrome.storage.sync.get({ syncSheetUrl: '' }, resolve);
              } else { resolve({}); }
            });
            this._sheetUrl = (data.syncSheetUrl || '').trim();
            if (this._sheetUrl) console.log('[SA] Sheet URL đã load:', this._sheetUrl.substring(0, 50) + '...');
          } catch(e) { this._sheetUrl = ''; }
        },

        // Gọi Google Sheet qua Apps Script (GET request) — Có tự động thử lại khi timeout
        async _fetchSheet(params) {
          await this._ensureUrl();
          if (!this._sheetUrl) return null;
          const url = this._sheetUrl + '?' + new URLSearchParams(params).toString();
          const maxRetries = 2; // Thử tối đa 2 lần
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout nhanh để không nghẽn AI
              const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
              clearTimeout(timeoutId);
              return await res.json();
            } catch(e) {
              console.log(`[SA] Lỗi kết nối Google Sheet (lần ${attempt}/${maxRetries}):`, e.message);
              if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 600)); // Chờ 600ms rồi thử lại
              }
            }
          }
          return null;
        },

        // === LOCAL STORAGE (backup/offline) ===
        async _saveLocal(convId, summaries) {
          try {
            const key = this._key(convId);
            if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
              await new Promise(r => chrome.storage.local.set({ [key]: summaries }, r));
            }
          } catch(e) {}
        },
        async _getLocal(convId) {
          try {
            const key = this._key(convId);
            if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
              const data = await new Promise(r => chrome.storage.local.get([key], r));
              return data?.[key] || null;
            }
          } catch(e) {}
          return null;
        },
        async _removeLocal(convId) {
          try {
            const key = this._key(convId);
            if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
              await new Promise(r => chrome.storage.local.remove(key, r));
            }
          } catch(e) {}
        },

        // Migrate dữ liệu cũ từ localStorage / chrome.storage.sync (chạy 1 lần)
        async _migrateOldData(convId) {
          // 1. Thử localStorage
          try {
            const key = this._key(convId);
            const localData = localStorage.getItem(key);
            if (localData) {
              const parsed = JSON.parse(localData);
              if (Array.isArray(parsed) && parsed.length > 0) {
                await this.save(convId, parsed); // Đẩy lên Sheet + local
                localStorage.removeItem(key);
                console.log('[SA] Đã migrate ngữ cảnh từ localStorage:', key);
                return parsed;
              }
              localStorage.removeItem(key);
            }
          } catch(e) {}
          // 2. Thử chrome.storage.sync (từ phiên bản code trước)
          try {
            const key = this._key(convId);
            if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
              const data = await new Promise(r => chrome.storage.sync.get([key], r));
              if (data?.[key] && Array.isArray(data[key]) && data[key].length > 0) {
                await this.save(convId, data[key]); // Đẩy lên Sheet + local
                chrome.storage.sync.remove(key);
                console.log('[SA] Đã migrate ngữ cảnh từ chrome.storage.sync:', key);
                return data[key];
              }
            }
          } catch(e) {}
          return null;
        },

        // === CÁC METHOD CHÍNH (CHỈ QUÉT GOOGLE SHEET 100%) ===

        async get(convId) {
          try {
            const customerName = this._getCustomerName();
            // ĐỌC THẲNG TỪ GOOGLE SHEET 100% (Không dùng Cache RAM hay LocalStorage)
            const result = await this._fetchSheet({
              action: 'get',
              convId: convId,
              customerName: encodeURIComponent(customerName)
            });

            if (result && result.success && Array.isArray(result.data)) {
              return result.data;
            }
            return [];
          } catch(e) { return []; }
        },

        _getCustomerName() {
          try {
            const selectors = [
              '#dialogue-conversation-container .user-name-meta-data .user-name',
              '#dialogue-conversation-container [data-for="_tip_conversation-user-name"]',
              '#dialogue-conversation-container .user-name-first',
              '#dialogue-conversation-container .user-name',
              '[data-for="_tip_conversation-user-name"]'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.innerText && el.innerText.trim()) {
                return el.innerText.trim();
              }
            }
          } catch(e) {}
          return "";
        },

        async save(convId, summaries, customerName) {
          try {
            const finalName = customerName || this._getCustomerName();
            // GHI THẲNG LÊN GOOGLE SHEET 100%
            await this._fetchSheet({
              action: 'save',
              convId: convId,
              customerName: encodeURIComponent(finalName),
              data: encodeURIComponent(JSON.stringify(summaries))
            });
          } catch(e) { console.log('[SA] Lỗi lưu ngữ cảnh:', e); }
        },

        async add(convId, summary, customerName) {
          try {
            const finalName = customerName || this._getCustomerName();
            // GỬI TÓM TẮT MỚI THẲNG LÊN GOOGLE SHEET (Server v6.1 sẽ tự gộp với danh sách cũ)
            await this._fetchSheet({
              action: 'save',
              convId: convId,
              customerName: encodeURIComponent(finalName),
              data: encodeURIComponent(summary)
            });
          } catch(e) { console.log('[SA] Lỗi thêm ngữ cảnh:', e); }
        },

        async clear(convId) {
          try {
            const key = this._key(convId);
            this._cache.delete(key);

            // Xóa trên Google Sheet
            await this._fetchSheet({ action: 'delete', convId: convId });

            // Xóa local
            await this._removeLocal(convId);

            // Dọn dẹp cũ
            try { localStorage.removeItem(key); } catch(e) {}
            try {
              if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
                chrome.storage.sync.remove(key);
              }
            } catch(e) {}
          } catch(e) {}
        },

        async buildContext(convId) {
          const summaries = await this.get(convId);
          if (summaries.length === 0) return '';
          let ctx = '\n\n---\n[NGỮ CẢNH CÁC QUẺ ĐÃ LUẬN TRƯỚC ĐÓ CHO KHÁCH NÀY — Hãy tham khảo để luận nhất quán, không mâu thuẫn với các quẻ trước]:\n';
          summaries.forEach((s, i) => {
            const entry = typeof s === 'string' ? s : s.text;
            const time = (s && s.time) ? ` (${s.time})` : '';
            ctx += `\nQuẻ trước #${i + 1}${time}: ${entry}\n`;
          });
          return ctx;
        }
      },

      async init() {
        try {
          const data = await new Promise(r => {
            if (typeof chrome !== "undefined" && chrome?.storage?.sync) {
              chrome.storage.sync.get({ geminiApiKey: "", geminiModel: "gemini-3.7-flash" }, r);
            } else { r({ geminiApiKey: "", geminiModel: "gemini-3.7-flash" }); }
          });
          this.apiKey = (data.geminiApiKey || "").trim();
          this.model = data.geminiModel || "gemini-3.7-flash";
        } catch(e) { this.apiKey = ""; }
      },

      isReady() { return !!this.apiKey; },

      async _callModel(modelName, apiKey, payload, timeoutMs = 25000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: controller.signal
            }
          );
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData?.error?.message || `Error ${res.status}`;
            throw new Error(errMsg);
          }
          return await res.json();
        } finally {
          clearTimeout(timeoutId);
        }
      },

      async executeWithFallback(payload, actionName, timeoutMs = 45000) {
        if (!this.isReady()) throw new Error("Chưa cấu hình API Key");
        const modelName = this.model || "gemini-3.7-flash";
        SapoAuto_v1.utils.log(`${actionName} model: ${modelName}`);
        let actText = actionName === "OCR" ? "Quét Seri" : "Gọi AI";
        SapoAuto_v1.utils.toast(`⌛ Đang ${actText} (${modelName})...`, "info", 0);
        return await this._callModel(modelName, this.apiKey, payload, timeoutMs);
      },

      async scanSerial(imgSrc) {
        await this.init();
        if (!this.isReady()) return null;

        const resp = await fetch(imgSrc);
        const blob = await resp.blob();
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const mimeType = blob.type || "image/jpeg";

        const payload = {
          contents: [{
            parts: [
              { inlineData: { mimeType: mimeType, data: base64 } },
              { text: "Nhìn ảnh này, nếu có tờ tiền Việt Nam, hãy đọc số seri trên tờ tiền. Chỉ trả về ĐÚNG phần SỐ (digits) của seri, bỏ qua chữ cái prefix. Nếu không tìm thấy tờ tiền hoặc seri, trả về duy nhất chữ NONE. Không giải thích gì thêm." }
            ]
          }]
        };

        const json = await this.executeWithFallback(payload, "OCR", 15000);
        const text = (json.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (!text || text.toUpperCase() === "NONE") return null;
        const digits = text.replace(/\D/g, "");
        return digits.length >= 5 ? digits : null;
      },

      async generateText(promptText) {
        await this.init();
        if (!this.isReady()) return null;
        const payload = {
          contents: [{
            parts: [ { text: promptText } ]
          }]
        };
        const json = await this.executeWithFallback(payload, "TextGen", 60000); // Tăng lên 60s để AI đủ thời gian nhai file kiến thức lớn
        return (json.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      },

      // === LUẬN QUẺ CÓ NGỮ CẢNH: Gửi kèm tóm tắt các quẻ trước để AI nhất quán ===
      async generateTextWithHistory(promptText, conversationId, customerName) {
        await this.init();
        if (!this.isReady()) return null;

        // Lấy ngữ cảnh các quẻ đã luận trước đó cho khách này (async — đồng bộ qua Google Sheet)
        const historyContext = await this.conversationHistory.buildContext(conversationId);

        // Yêu cầu AI tóm tắt cuối bài để lưu cho lần sau (nhấn mạnh KHÔNG rút ngắn bài luận)
        const summaryInstruction = '\n\n---\n[YÊU CẦU BẮT BUỘC]: Hãy viết bài luận ĐẦY ĐỦ CHI TIẾT như bình thường, KHÔNG được rút ngắn hay lược bỏ nội dung. Sau khi viết XONG toàn bộ bài luận, hãy viết THÊM 1 đoạn tóm tắt ở cuối cùng theo đúng format sau:\n[TÓM_TẮT]: (Ghi lại: câu hỏi khách hỏi gì, tên quẻ chủ và quẻ biến, kết luận chính của quẻ, lời khuyên cốt lõi, các hào động quan trọng — viết 3-5 câu ngắn gọn nhưng đủ ý để tham khảo cho lần luận sau)';

        const fullPrompt = promptText + historyContext + summaryInstruction;

        const payload = {
          contents: [{
            parts: [{ text: fullPrompt }]
          }]
        };
        const json = await this.executeWithFallback(payload, "TextGen", 60000);
        let result = (json.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

        // Tách phần tóm tắt ra khỏi kết quả để lưu ngầm
        const summaryMatch = result.match(/\[TÓM[_ ]TẮT\]\s*:?\s*([\s\S]+)$/i);
        if (summaryMatch && summaryMatch[1] && summaryMatch[1].trim().length > 10) {
          const summary = summaryMatch[1].trim();
          // Lưu tóm tắt vào lịch sử — đồng bộ qua Google Sheet
          await this.conversationHistory.add(conversationId, summary, customerName);
          // Xóa phần tóm tắt khỏi kết quả trả về cho user (user không thấy phần này)
          result = result.replace(/\n*[-—~*_]*\s*\n*\[TÓM[_ ]TẮT\]\s*:?[\s\S]*$/i, '').trim();
          console.log('[SA] Đã lưu tóm tắt quẻ cho conversation:', conversationId);
        } else {
          console.log('[SA] AI không trả về phần tóm tắt, bỏ qua lưu history');
        }

        return result;
      }
    },

    // 3. HÀM TIỆN ÍCH (HELPERS)
    utils: {
      wait: ms => new Promise(r => setTimeout(r, ms)),
      log: (...a) => console.log("[SA v1.0]", ...a),
      
      toast(m, c, duration = 3000) {
        const self = SapoAuto_v1;
        let t = document.getElementById("sa-toast");
        if (!t) {
          t = document.createElement("div");
          t.id = "sa-toast";
          document.documentElement.appendChild(t);
        }
        t.textContent = m;
        t.className = "sapo-ao-toast " + (c || "info");
        t.style.display = "block";
        clearTimeout(self.STATE.toastTimer);
        if (duration > 0) {
          self.STATE.toastTimer = setTimeout(() => t.style.display = "none", duration);
        }
      },

      setVal(el, v) {
        el.focus();
        const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
        if (d?.set) d.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },

      dataURLtoBlob(dataurl) {
        const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length, u8arr = new Uint8Array(n);
        while(n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], {type:mime});
      },
      getActiveConversationId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('conversationId') || urlParams.get('conversation_id') || "default";
      }
    },

    // 4. (ĐÃ CHUYỂN SANG API — KHÔNG CẦN DOM SELECTORS)
    dom: {},

    // 5. LOGIC TẠO ĐƠN BẰNG API (CORE ORDER LOGIC — v2.0)
    core: {
      async runOrder(amount) {
        const self = SapoAuto_v1;
        if (self.STATE.busy) return;

        const productInfo = self.CONFIG.API.PRODUCTS[amount];
        if (!productInfo) return;

        // === PRE-CHECKS ===
        const currentToken = self.STATE.myToken || sessionStorage.getItem('sapo_token');
        if (!currentToken) {
          self.utils.toast("❌ Chưa bắt được Token! Hãy F5 lại trang.", "error");
          return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const conversationId = urlParams.get('conversationId') || urlParams.get('conversation_id');
        const tenant = urlParams.get('tenant') || self.CONFIG.API.DEFAULT_TENANT;

        if (!conversationId) {
          self.utils.toast("❌ Chọn 1 đoạn chat trước khi chốt đơn!", "error");
          return;
        }

        // Lấy page info từ Map (nhờ postMessage) hoặc Fallback từ sessionStorage
        const pageInfo = self.STATE.pageMap.get(conversationId);
        const currentPageId = (pageInfo && pageInfo.pageId) || sessionStorage.getItem('sapo_page_' + conversationId);
        const currentFbPageId = (pageInfo && pageInfo.fbPageId) || sessionStorage.getItem('sapo_fb_page_' + conversationId) || "";
        const currentCustomerId = (pageInfo && pageInfo.customerId) || sessionStorage.getItem('sapo_customer_' + conversationId) || "";

        if (!currentPageId) {
          self.utils.toast("❌ Chưa bắt được Page ID! Click vào 1 hội thoại rồi thử lại.", "error");
          return;
        }

        self.STATE.busy = true;
        self.utils.toast("⏳ Đang tạo đơn " + self.CONFIG.LABELS[amount] + "k...", "info");

        const sourceUrl = `https://sapo-socials.sapoapps.vn/social/all?conversationId=${conversationId}&tenant=${tenant}`;
        const headers = {
          "Content-Type": "application/json",
          "X-Bizweb-App-Fpage-Token": currentToken,
          "X-Sapo-Tenant": tenant
        };

        // --- TRÍCH XUẤT TÊN KHÁCH HÀNG ---
        let customerName = "Khách Hàng Facebook";
        const nameEl = document.querySelector('[data-for="_tip_conversation-user-name"]');
        if (nameEl && nameEl.innerText && nameEl.innerText.trim() !== "") {
            customerName = nameEl.innerText.trim();
        }

        try {
          // === BƯỚC 1: TẠO CHECKOUT TRỐNG ===
          self.utils.toast("⏳ (1/3) Tạo giỏ hàng...", "info");
          const res1 = await fetch(
            "https://sapo-socials.sapoapps.vn/api/checkouts?is_create_new=false&language=vi",
            {
              method: "POST",
              headers: headers,
              body: JSON.stringify({
                page_id: currentPageId,
                conversation_id: conversationId,
                conversation_id_url_param: conversationId,
                source_url: sourceUrl,
                checkout: {
                  automatic_discounts_override: true,
                  buyer_accepts_marketing: false,
                  inventory_behaviour: "decrement_obeying_policy_in_specify_location",
                  location_id: self.CONFIG.API.LOCATION_ID,
                  requires_billing_address: false,
                  requires_email: false,
                  requires_shipping_address: false,
                  requires_shipping_method: false,
                  user_id: ""
                }
              })
            }
          );

          const data1 = await res1.json();
          if (!res1.ok) {
            let errObj = data1?.errors || data1?.error;
            let errDetail = (typeof errObj === 'object' && errObj !== null) ? JSON.stringify(errObj) : (errObj || res1.status);
            throw new Error("Lỗi bước 1: " + errDetail);
          }

          const checkoutToken = data1?.checkout?.token || data1?.token;
          if (!checkoutToken) throw new Error("Không lấy được checkout token!");
          
          const s1CustomerId = data1?.checkout?.customer_id; // Lấy customer_id nếu Sapo trả về ở B1

          // Nghỉ 300ms tránh nghẽn server
          await self.utils.wait(300);

          // === BƯỚC 2: CHỐT ĐƠN VỚI SẢN PHẨM ===
          self.utils.toast("⏳ (2/3) Chốt đơn + Thanh toán...", "info");
          const completeUrl = `https://sapo-socials.sapoapps.vn/api/checkouts/${checkoutToken}/complete?conversation_id=${conversationId}&page_id=${currentPageId}&language=vi`;

          const res2 = await fetch(completeUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
              page_id: currentPageId,
              conversation_id: conversationId,
              conversation_id_url_param: conversationId,
              facebook_page_id: currentFbPageId || null,
              source_url: sourceUrl,
              comment_id: null,
              checkout: Object.assign({
                buyer_accepts_marketing: false,
                requires_shipping_method: false,
                requires_billing_address: false,
                applied_discounts: [],
                automatic_discounts_override: true,
                billing_address: null,
                currency: "VND",
                discount_codes: [],
                fulfillment_details: null,
                inventory_behaviour: "decrement_obeying_policy_in_specify_location",
                location_id: self.CONFIG.API.LOCATION_ID,
                name: customerName,
                note: "",
                note_attributes: [],
                phone: null,
                requires_email: false,
                requires_shipping_address: false,
                shipping_address: null,
                shipping_lines: [],
                tax_exempt: null,
                user_id: "",
                payment_details: {
                  payment_method_id: 6708489,
                  gateway: "Tiền mặt",
                  amount: amount,
                  reference: ""
                },
                line_items: [{
                  variant_id: productInfo.variantId,
                  custom: false,
                  quantity: 1,
                  title: productInfo.title,
                  price: amount,
                  price_override: amount,
                  requires_shipping: false,
                  taxable: false
                }]
              }, s1CustomerId ? { customer_id: s1CustomerId } : {})
            })
          });

          const data2 = await res2.json();
          if (!res2.ok) {
            let errObj = data2?.errors || data2?.error;
            let errDetail = (typeof errObj === 'object' && errObj !== null) ? JSON.stringify(errObj) : (errObj || res2.status);
            throw new Error("Lỗi bước 2: " + errDetail);
          }

          // === BƯỚC 3: XÁC NHẬN GIAO HÀNG ===
          const orderId = data2?.order?.id;
          if (orderId) {
            try {
              self.utils.toast("⏳ (3/3) Xác nhận giao hàng...", "info");
              await self.utils.wait(300);

              const res3 = await fetch(
                `https://sapo-socials.sapoapps.vn/api/order/fulfillments/${orderId}?language=vi`,
                {
                  method: "POST",
                  headers: headers,
                  body: JSON.stringify({
                    delivery_method: "pick_up",
                    delivery_status: "delivered"
                  })
                }
              );

              if (!res3.ok) {
                const data3 = await res3.json().catch(() => ({}));
                console.warn("[SA] Fulfillment warning:", data3);
                self.utils.toast("⚠️ Đã tạo đơn + thanh toán, nhưng giao hàng tự động thất bại.", "info", 4000);
              } else {
                self.utils.toast("✅ Đã chốt đơn " + self.CONFIG.LABELS[amount] + "k + Thanh toán + Giao hàng!", "success");
              }
            } catch (e3) {
              console.warn("[SA] Fulfillment error:", e3);
              self.utils.toast("⚠️ Đã tạo đơn + thanh toán OK. Giao hàng tự động lỗi.", "info", 4000);
            }
          } else {
            self.utils.toast("✅ Đã chốt đơn " + self.CONFIG.LABELS[amount] + "k + Thanh toán!", "success");
          }
        } catch (e) {
          self.utils.toast("❌ " + e.message, "error");
          console.error("[SA] Order API error:", e);
        } finally {
          self.STATE.busy = false;
        }
      }
    },

    // 6. HỆ THỐNG HIỂN THỊ (UI SYSTEM)
    ui: {
      applySavedStateImage(btn, serial, originalText, originalOnClick) {
        const imageData = localStorage.getItem("sa_img_" + serial);
        if (!imageData) return;
        
        btn.textContent = "OK";
        btn.disabled = false;
        btn.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
        btn.style.color = "white";
        btn.style.fontWeight = "bold";
        btn.style.boxShadow = "0 0 15px rgba(34, 197, 94, 0.6)";
        btn.style.pointerEvents = "auto";
        
        btn.onclick = async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          try {
            SapoAuto_v1.utils.toast("⌛ Đang copy vào Clipboard...", "info");
            const blob = SapoAuto_v1.utils.dataURLtoBlob(imageData);
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            SapoAuto_v1.utils.toast("✅ ĐÃ COPY! Bạn có thể Ctrl+V ngay.", "success");
            btn.textContent = originalText;
            btn.style.background = "";
            btn.style.boxShadow = "";
            btn.style.color = "";
            btn.style.fontWeight = "";
            btn.style.pointerEvents = "";
            btn.disabled = false;
            btn.onclick = originalOnClick;
            try { localStorage.removeItem("sa_img_" + serial); } catch(e){}
          } catch (err) { 
            SapoAuto_v1.utils.toast("❌ Lỗi copy: " + err.message, "error");
          }
        };
      },

      applySavedState(btn, serial, originalText, originalOnClick) {
        const savedStr = localStorage.getItem("sa_res_" + serial);
        if (!savedStr) {
          // Thử lấy từ chrome.storage.local nếu localStorage chưa kịp ghi
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.get(["sa_res_" + serial], (res) => {
              if (res && res["sa_res_" + serial]) {
                try {
                  localStorage.setItem("sa_res_" + serial, res["sa_res_" + serial]);
                  SapoAuto_v1.ui.applySavedState(btn, serial, originalText, originalOnClick);
                } catch(e) {}
              }
            });
          }
          return;
        }
        try {
          const saved = JSON.parse(savedStr);
          btn.textContent = "Copy";
          btn.disabled = false;
          if (saved.type === 'claude') {
             btn.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
          } else {
             btn.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
          }
          btn.style.color = "white";
          btn.onclick = async (e) => {
             e.stopPropagation(); e.preventDefault();
             try {
               await navigator.clipboard.writeText(saved.content);
               const toastMsg = saved.type === 'claude' ? "📋 Đã copy và mở Claude..." : "📋 Đã copy và mở Gemini...";
               SapoAuto_v1.utils.toast(toastMsg, "success");
               if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                 chrome.runtime.sendMessage({ 
                   action: saved.type === 'claude' ? 'openClaudeDirectPopup' : 'openGeminiPopup',
                   conversationId: SapoAuto_v1.utils.getActiveConversationId()
                 });
               }
               btn.textContent = originalText || "Luận";
               btn.style.background = "";
               btn.style.color = "";
               btn.disabled = false;
               if (typeof originalOnClick === 'function') {
                 btn.onclick = originalOnClick;
               }
               localStorage.removeItem("sa_res_" + serial);
               if (typeof chrome !== "undefined" && chrome?.storage?.local) {
                 chrome.storage.local.remove("sa_res_" + serial);
               }
             } catch (err) {
               SapoAuto_v1.utils.toast("❌ Lỗi copy: " + err.message, "error");
             }
          };
        } catch(e) {}
      },

      applyRunningState(btn, serial) {
        try {
          const raw = localStorage.getItem("sa_running_" + serial);
          if (raw) {
            const run = JSON.parse(raw);
            if (run && run.startTime && (Date.now() - run.startTime < 120000)) {
              btn.textContent = "⌛...";
              btn.disabled = true;
              return;
            } else {
              localStorage.removeItem("sa_running_" + serial);
            }
          }
          // Thử sync từ chrome.storage.local
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.get(["sa_running_" + serial], (res) => {
              const r = res?.[("sa_running_" + serial)];
              if (r && r.startTime && (Date.now() - r.startTime < 120000)) {
                btn.textContent = "⌛...";
                btn.disabled = true;
              }
            });
          }
        } catch(e) {}
      },

      isTarget(img) {
        const self = SapoAuto_v1;
        if (!img || img.tagName !== "IMG" || img.getAttribute("data-sapo-v1")) return false;
        if (!img.complete || img.naturalWidth === 0) return false;

        const rect = img.getBoundingClientRect();
        const style = getComputedStyle(img);

        // Ngưỡng 75x75 theo yêu cầu
        if (rect.width < 75 || rect.height < 75 || style.display === "none" || style.visibility === "hidden" || style.borderRadius === "50%") return false;

        const src = (img.src || "").toLowerCase();
        const isSkip = self.CONFIG.SKIP_W.find(s => src.includes(s) || (img.className || "").toLowerCase().includes(s));
        if (isSkip) return false;

        // Chỉ ưu tiên phía Khách hàng
        let el = img;
        let side = null;
        for (let i = 0; i < 10 && el && el !== document.body; i++) {
          const c = (el.className || "").toLowerCase();
          if (c.includes("right") || c.includes("sent") || c.includes("msg-out") || c.includes("outgoing") || c.includes("me")) {
            side = "shop"; break;
          }
          if (c.includes("left") || c.includes("received") || c.includes("msg-in") || c.includes("incoming") || c.includes("customer")) {
            side = "customer"; break;
          }
          el = el.parentElement;
        }
        return side === "customer";
      },

      // Đồng bộ vị trí Badge dựa trên ảnh thực tế (Body Injection)
      sync(img, badge) {
        if (!img || !badge) return;
        if (badge._pinned) return; // Đã kéo thủ công → không auto-sync
        const rect = img.getBoundingClientRect();
        // Nếu ảnh bị ẩn đi thì ẩn Badge
        if (rect.width === 0 || rect.top < 0 || rect.top > window.innerHeight) {
          badge.style.opacity = "0";
          badge.style.pointerEvents = "none";
          return;
        }
        badge.style.opacity = "1";
        badge.style.pointerEvents = "auto";
        badge.style.position = "absolute";
        badge.style.top = (window.scrollY + rect.top) + "px";
        badge.style.left = (window.scrollX + rect.left + rect.width + 8) + "px";
      },

      inject(img) {
        const self = SapoAuto_v1;
        
        // Tránh tiêm đống lần (Dùng MAP kiểm soát)
        if (self.STATE.activeBadges.has(img)) return;

        img.setAttribute("data-sapo-v1", "active");

        const badge = document.createElement("div");
        badge.className = "sapo-order-badge-vertical";
        badge.title = "Kéo để di chuyển";
        
        // stopAll cho các nút con
        const stopAll = (e) => { e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation(); };

        self.CONFIG.AMOUNTS.forEach(a => {
          const btn = document.createElement("button");
          btn.className = "ocr-btn " + self.CONFIG.CLS[a];
          btn.textContent = self.CONFIG.LABELS[a];
          btn.title = "Chốt " + self.CONFIG.LABELS[a] + "k";
          btn.onclick = (e) => {
            stopAll(e);
            self.core.runOrder(a);
          };
          btn.onmousedown = stopAll;
          btn.onmouseup = stopAll;
          badge.appendChild(btn);
        });

        // NEW: Manual Serial Entry UI + OCR Scan Button
        const inputWrapper = document.createElement("div");
        inputWrapper.className = "sa-serial-input-wrapper";
        
        const inputRow = document.createElement("div");
        inputRow.style.cssText = "display:flex;gap:3px;align-items:center;";

        const input = document.createElement("input");
        input.className = "sa-serial-input";
        input.placeholder = "Seri...";
        input.title = "Nhập seri và Enter";
        input.onclick = stopAll;
        input.onmousedown = stopAll;
        input.onmouseup = stopAll;

        // NÚT QUÉT SERI (OCR) — chỉ hiện khi có API key
        const scanBtn = document.createElement("button");
        scanBtn.className = "sa-scan-btn";
        scanBtn.textContent = "🔍";
        scanBtn.title = "Quét seri tự động (Gemini AI)";
        scanBtn.style.display = self.aiService.isReady() ? "inline-flex" : "none";
        scanBtn.onclick = async (e) => {
          stopAll(e);
          if (scanBtn.classList.contains("scanning")) return;
          scanBtn.classList.add("scanning");
          scanBtn.textContent = "";
          self.utils.toast("🔍 Đang quét seri...", "info");
          try {
            const serial = await self.aiService.scanSerial(img.src);
            if (serial && serial.length >= 5) {
              showActions(serial, true);
              self.storage.save(img.src, serial);
              self.utils.toast("✅ Đã quét seri: " + serial, "success");
            } else {
              self.utils.toast("⚠️ Không tìm thấy seri trên ảnh", "info");
            }
          } catch (err) {
            self.utils.toast("❌ Lỗi quét: " + err.message, "error");
            console.error("[SA] OCR Error:", err);
          } finally {
            scanBtn.classList.remove("scanning");
            scanBtn.textContent = "🔍";
          }
        };
        scanBtn.onmousedown = stopAll;
        scanBtn.onmouseup = stopAll;

        const actionGroup = document.createElement("div");
        actionGroup.className = "sa-serial-group";
        actionGroup.style.display = "none";
        actionGroup.onclick = stopAll;
        actionGroup.onmousedown = stopAll;
        actionGroup.onmouseup = stopAll;

        const showInput = () => {
          input.value = "";
          inputRow.style.display = "flex";
          actionGroup.style.display = "none";
          actionGroup.innerHTML = "";
        };

        const showActions = (val, isAuto) => {
          inputRow.style.display = "none";
          actionGroup.style.display = "flex";
          actionGroup.innerHTML = "";

          // Lưu seri vào storage theo đúng ảnh này
          self.storage.save(img.src, val);

          const label = document.createElement("span");
          label.className = "sa-serial-val" + (isAuto ? " auto-detected" : "");
          label.textContent = val;
          label.onclick = (e) => {
            stopAll(e);
            navigator.clipboard.writeText(val);
            self.utils.toast("📋 Đã copy seri: " + val, "success");
          };
          actionGroup.appendChild(label);

          // Datetime picker trong action group
          const pad = n => String(n).padStart(2, "0");
          const now = new Date();
          const localNow = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
          const dtWrap = document.createElement("span");
          dtWrap.className = "sa-dt-wrap";
          const dtIcon = document.createElement("span");
          dtIcon.className = "sa-dt-icon";
          dtIcon.textContent = "🕐";
          dtWrap.appendChild(dtIcon);
          const dtPicker = document.createElement("input");
          dtPicker.type = "datetime-local";
          dtPicker.className = "sa-dt-input";
          dtPicker.value = localNow;
          dtPicker.title = "Chọn ngày giờ lập quẻ";
          dtPicker.onclick = stopAll;
          dtPicker.onmousedown = stopAll;
          dtPicker.onkeydown = (e) => e.stopPropagation();
          dtWrap.appendChild(dtPicker);
          actionGroup.appendChild(dtWrap);

          const getPickerDate = () => dtPicker.value ? new Date(dtPicker.value) : null;

          const btnA = document.createElement("button");
          btnA.className = "sa-mini-btn btn-a";
          btnA.dataset.serial = val;
          btnA.textContent = "Ảnh";
          btnA.onclick = (e) => { stopAll(e); self.textScan.runImage(val, btnA, getPickerDate()); };
          btnA.onmousedown = stopAll; btnA.onmouseup = stopAll;
          self.ui.applySavedStateImage(btnA, val, "Ảnh", btnA.onclick);
          actionGroup.appendChild(btnA);

          const questionInput = document.createElement("input");
          questionInput.type = "text";
          questionInput.className = "sa-question-input";
          questionInput.placeholder = "Nhập câu hỏi...";
          const qKey = "sa_question_serial_" + val;
          questionInput.value = localStorage.getItem(qKey) || "";
          questionInput.oninput = (e) => localStorage.setItem(qKey, e.target.value);
          questionInput.onclick = stopAll;
          questionInput.onmousedown = stopAll;
          questionInput.onmouseup = stopAll;
          questionInput.onkeydown = stopAll;
          actionGroup.appendChild(questionInput);

          const btnC = document.createElement("button");
          btnC.className = "sa-mini-btn btn-c";
          btnC.dataset.serial = val;
          btnC.textContent = "Luận";
          btnC.onclick = (e) => { stopAll(e); self.textScan.runPopup(val, btnC, getPickerDate(), questionInput.value.trim(), questionInput); };
          btnC.onmousedown = stopAll; btnC.onmouseup = stopAll;
          self.ui.applySavedState(btnC, val, "Luận", btnC.onclick);
          self.ui.applyRunningState(btnC, val);
          actionGroup.appendChild(btnC);

          const btnResetHist = document.createElement("button");
          btnResetHist.className = "sa-mini-btn btn-reset-hist";
          btnResetHist.textContent = "🔄";
          btnResetHist.title = "Xóa ngữ cảnh các quẻ trước (reset lịch sử)";
          btnResetHist.style.cssText = "min-width:22px;max-width:22px;padding:2px;font-size:11px;opacity:0.6;";
          btnResetHist.onclick = async (e) => {
            stopAll(e);
            const cId = self.utils.getActiveConversationId();
            await self.aiService.conversationHistory.clear(cId);
            self.utils.toast("🔄 Đã xóa ngữ cảnh hội thoại. Luận mới sẽ bắt đầu từ đầu.", "success");
            btnResetHist.style.opacity = "0.3";
            setTimeout(() => { btnResetHist.style.opacity = "0.6"; }, 1500);
          };
          btnResetHist.onmousedown = stopAll; btnResetHist.onmouseup = stopAll;
          actionGroup.appendChild(btnResetHist);

          const btnTxtOnly = document.createElement("button");
          btnTxtOnly.className = "sa-mini-btn btn-c-only";
          btnTxtOnly.dataset.serial = val;
          btnTxtOnly.textContent = "Chữ";
          btnTxtOnly.onclick = (e) => { stopAll(e); self.textScan.runPopupTextOnly(val, btnTxtOnly, getPickerDate()); };
          btnTxtOnly.onmousedown = stopAll; btnTxtOnly.onmouseup = stopAll;
          actionGroup.appendChild(btnTxtOnly);

          const btnX = document.createElement("button");
          btnX.className = "sa-mini-btn btn-x";
          btnX.textContent = "Hủy";
          btnX.onclick = (e) => { stopAll(e); self.storage.clear(img.src); showInput(); };
          btnX.onmousedown = stopAll; btnX.onmouseup = stopAll;
          actionGroup.appendChild(btnX);
        };

        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            const val = input.value.trim().replace(/\D/g, "");
            if (val.length > 0) {
              showActions(val, false);
            } else {
              self.utils.toast("Vui lòng nhập số seri", "info");
            }
          }
        };

        inputRow.appendChild(input);
        inputRow.appendChild(scanBtn);
        inputWrapper.appendChild(inputRow);
        inputWrapper.appendChild(actionGroup);
        badge.appendChild(inputWrapper);

        // TIÊM VÀO BODY - CƠ CHẾ CÁCH LY THẦN THÁNH
        document.body.appendChild(badge);
        self.STATE.activeBadges.set(img, badge);
        self.ui.sync(img, badge);

        // AUTO-RESTORE: Chỉ restore seri của đúng ảnh này (theo img.src riêng)
        self.storage.load(img.src, (saved) => {
          if (saved && saved.length > 0) {
            showActions(saved);
          }
        });
      },

      injectLegacyGroup(container, serial) {
        const self = SapoAuto_v1;
        const numOnly = serial.replace(/\D/g, "");
        
        // Tạo khối nút theo phong cách hàng ngang tinh gọn
        const badge = document.createElement("div");
        badge.className = "sa-text-actions"; // Dùng CSS đã tối ưu của bản v1.1

        // Datetime picker — giá trị mặc định = hiện tại
        const pad = n => String(n).padStart(2, "0");
        const now = new Date();
        const localNow = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const getPickerDate = () => dtInput.value ? new Date(dtInput.value) : null;

        const label = document.createElement("span");
        label.className = "sa-text-label";
        label.textContent = "📋 " + numOnly;
        label.onclick = (e) => {
          navigator.clipboard.writeText(numOnly);
          self.utils.toast("📋 Đã copy seri", "success");
        };
        badge.appendChild(label);

        // Datetime wrapper
        const dtWrap = document.createElement("span");
        dtWrap.className = "sa-dt-wrap";
        const dtIcon = document.createElement("span");
        dtIcon.className = "sa-dt-icon";
        dtIcon.textContent = "🕐";
        dtWrap.appendChild(dtIcon);
        const dtInput = document.createElement("input");
        dtInput.type = "datetime-local";
        dtInput.className = "sa-dt-input";
        dtInput.value = localNow;
        dtInput.title = "Chọn ngày giờ lập quẻ";
        dtInput.onclick = (e) => e.stopPropagation();
        dtInput.onmousedown = (e) => e.stopPropagation();
        dtInput.onkeydown = (e) => e.stopPropagation();
        dtWrap.appendChild(dtInput);
        badge.appendChild(dtWrap);

        const btnImg = document.createElement("button");
        btnImg.className = "sa-text-btn btn-img";
        btnImg.dataset.serial = numOnly;
        btnImg.textContent = "Ảnh";
        btnImg.onclick = () => self.textScan.runImage(numOnly, btnImg, getPickerDate());
        self.ui.applySavedStateImage(btnImg, numOnly, "Ảnh", btnImg.onclick);
        badge.appendChild(btnImg);

        const questionInput = document.createElement("input");
        questionInput.type = "text";
        questionInput.className = "sa-question-input";
        questionInput.placeholder = "Nhập câu hỏi...";
        const qKey = "sa_question_serial_" + numOnly;
        questionInput.value = localStorage.getItem(qKey) || "";
        questionInput.oninput = (e) => localStorage.setItem(qKey, e.target.value);
        questionInput.onclick = (e) => e.stopPropagation();
        questionInput.onmousedown = (e) => e.stopPropagation();
        questionInput.onkeydown = (e) => e.stopPropagation();

        const btnTxt = document.createElement("button");
        btnTxt.className = "sa-text-btn btn-txt";
        btnTxt.dataset.serial = numOnly;
        btnTxt.textContent = "Luận";
        btnTxt.onclick = () => self.textScan.runPopup(numOnly, btnTxt, getPickerDate(), questionInput.value.trim(), questionInput);
        self.ui.applySavedState(btnTxt, numOnly, "Luận", btnTxt.onclick);
        self.ui.applyRunningState(btnTxt, numOnly);
        badge.appendChild(btnTxt);

        const btnResetHist = document.createElement("button");
        btnResetHist.className = "sa-text-btn btn-reset-hist";
        btnResetHist.textContent = "🔄";
        btnResetHist.title = "Xóa ngữ cảnh các quẻ trước (reset lịch sử)";
        btnResetHist.style.cssText = "min-width:22px;max-width:22px;padding:2px;font-size:11px;opacity:0.6;";
        btnResetHist.onclick = async () => {
          const cId = self.utils.getActiveConversationId();
          await self.aiService.conversationHistory.clear(cId);
          self.utils.toast("🔄 Đã xóa ngữ cảnh hội thoại. Luận mới sẽ bắt đầu từ đầu.", "success");
          btnResetHist.style.opacity = "0.3";
          setTimeout(() => { btnResetHist.style.opacity = "0.6"; }, 1500);
        };
        btnResetHist.onmousedown = (e) => e.stopPropagation();
        btnResetHist.onmouseup = (e) => e.stopPropagation();
        badge.appendChild(btnResetHist);

        const btnTxtOnly = document.createElement("button");
        btnTxtOnly.className = "sa-text-btn btn-txt-only";
        btnTxtOnly.dataset.serial = numOnly;
        btnTxtOnly.textContent = "Chữ";
        btnTxtOnly.onclick = () => self.textScan.runPopupTextOnly(numOnly, btnTxtOnly, getPickerDate());
        btnTxtOnly.onmousedown = (e) => e.stopPropagation();
        btnTxtOnly.onmouseup = (e) => e.stopPropagation();
        badge.appendChild(btnTxtOnly);

        container.appendChild(badge);
        container.appendChild(questionInput);
      }
    },

    // 7. TEXT SCANNING MODULE (MỚI)
    textScan: {
      isBubble(el) {
        if (!el) return false;
        for (let i = 0, cur = el; i < 15 && cur && cur !== document.body; i++, cur = cur.parentElement) {
          const cls = " " + (cur.className || "").toLowerCase() + " ";
          // Class chính xác từ Sapo DOM: dialogue-line-content me
          if (cls.includes(" me ")) return true;
          // Các pattern khác phòng trường hợp Sapo update UI
          if (/\s(sent|outgoing|msg-out|message-out|from-me|is-me|bubble-out|staff|agent|owner)\s/.test(cls)) return true;
          const st = (cur.getAttribute("style") || "").toLowerCase();
          if (st.includes("float: right") || st.includes("float:right")) return true;
          const dir = (cur.getAttribute("data-direction") || cur.getAttribute("data-side") || "").toLowerCase();
          if (dir === "out" || dir === "right") return true;
        }
        return false;
      },

      scan() {
        const self = SapoAuto_v1;
        document.querySelectorAll(".content-text:not([data-sa-v19]), .msg-content:not([data-sa-v19]), .message-text:not([data-sa-v19]), .dialogue-text-content:not([data-sa-v19])").forEach(div => {
          // CHỐNG LẶP cho các trường hợp element con/cha bị lồng nhau (kiểm tra dataset O(1) trước)
          if (div.dataset.saV19 || div.closest("[data-sa-v19]") || div.querySelector(".sa-group")) return;

          const txt = (div.innerText || "").trim();
          const matches = txt.match(/[a-zA-Z0-9]{0,5}\s?\d{6,12}/gi);
          if (!matches) return;

          // Lọc mã duy nhất và sạch sẽ
          const unique = [...new Set(matches)].map(m => m.replace(/\D/g, "")).filter(m => m.length >= 6);
          if (!unique.length) return;

          // Kiểm tra xem có phải tin nhắn của mình (bên phải) không
          if (self.textScan.isBubble(div)) { 
            div.dataset.saV19 = "1"; // Đánh dấu là đã xử lý 
            return; 
          }

          // CHỐNG RE-CREATE khi Sapo re-render: dùng nội dung text làm key
          const textKey = unique.join("|");
          if (self.STATE.textKeys.has(textKey)) {
            div.dataset.saV19 = "1"; // Đánh dấu div mới, badge cũ vẫn dùng
            return;
          }
          self.STATE.textKeys.add(textKey);

          // Tạo UI theo chuẩn snippet cũ
          const w = document.createElement("div"); 
          w.className = "sa-group";
          w.style.cssText = "position:absolute;z-index:9999;display:flex;flex-direction:column;gap:4px;";
          document.body.appendChild(w);

          // Lưu tham chiếu div cha để sync vị trí và cleanup
          w._sourceDiv = div;

          unique.forEach(s => {
            // Chèn các nút tính năng vào group
            self.ui.injectLegacyGroup(w, s);
          });

          div.dataset.saV19 = "1";

          // FIX BUG FOLLOW TAB: Đăng ký vào map để cleanup khi div cha biến mất
          w._textKey = textKey;
          SapoAuto_v1.STATE.activeTextGroups.set(div, w);
        });
      },

      _cachedKinhDichMd: null,

      buildUrl(serial, date, mode) {
        const base = SapoAuto_v1.CONFIG.luchaoUrl || "https://dshc-luc-hao.vercel.app/";
        const u = new URL(base);
        u.searchParams.set("sa_serial", serial);
        u.searchParams.set("sa_mode", mode || "text");
        if (date) {
          const p = n => String(n).padStart(2, "0");
          u.searchParams.set("sa_date",   `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`);
          u.searchParams.set("sa_hour",   String(date.getHours()));
          u.searchParams.set("sa_minute", String(date.getMinutes()));
        }
        return u.toString();
      },

      async runImage(serial, btn, date) {
        const self = SapoAuto_v1;
        self.utils.toast("⌛ Đang mở cửa sổ lập quẻ...", "info");
        if (btn) {
          btn.textContent = "⌛...";
          btn.disabled = true;
        }

        const url = self.textScan.buildUrl(serial, date, "image");
        
        // v1.1: Tạo Popup Tàng hình (Silent Mode)
        const overlay = document.createElement("div");
        overlay.className = "sa-popup-overlay sa-silent"; // Thêm class sa-silent (Định vị 1x1px ngoài vùng nhìn)
        const box = document.createElement("div");
        box.className = "sa-popup-box";
        const close = document.createElement("button");
        close.textContent = "×"; close.className = "sa-popup-close";
        close.onclick = () => {
          overlay.remove();
          let curBtn = document.querySelector(`.btn-a[data-serial="${serial}"], .btn-img[data-serial="${serial}"]`) || btn;
          if (curBtn) { curBtn.textContent = "Ảnh"; curBtn.disabled = false; }
        };
        
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.className = "sa-popup-iframe";
        
        box.appendChild(close);
        box.appendChild(iframe);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        let finished = false;
        let lastStatus = "Đang khởi tạo...";

        const handleMsg = async (e) => {
          if (e.data?.type === "SA_STATUS") {
             lastStatus = e.data.payload;
             self.utils.toast("⌛ " + lastStatus, "info");
             return;
          }
          if (e.data?.type === "SA_RESULT_READY") {
            finished = true;
            window.removeEventListener("message", handleMsg);

            // Xóa overlay ngay — không cần giữ iframe tàng hình nữa
            overlay.remove();
            
            let currentBtn = document.querySelector(`.btn-a[data-serial="${serial}"], .btn-img[data-serial="${serial}"]`);
            if (currentBtn) btn = currentBtn;

            const imageData = e.data.payload;
            try { localStorage.setItem("sa_img_" + serial, imageData); } catch(e) { console.warn("Lỗi lưu ảnh nháp", e); }
            const originalOnclick = btn.onclick;
            btn.textContent = "OK";
            btn.disabled = false;
            btn.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
            btn.style.color = "white";
            btn.style.fontWeight = "bold";
            btn.style.boxShadow = "0 0 15px rgba(34, 197, 94, 0.6)";
            btn.style.pointerEvents = "auto";
            
            self.utils.toast("✅ XONG! Bấm OK để lấy ảnh.", "success");

            // Gán onclick trực tiếp — override stopAll cũ, đảm bảo bấm được ngay
            btn.onclick = async (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              try {
                self.utils.toast("⌛ Đang copy vào Clipboard...", "info");
                const blob = self.utils.dataURLtoBlob(imageData);
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                self.utils.toast("✅ ĐÃ COPY! Bạn có thể Ctrl+V ngay.", "success");
                btn.textContent = "Ảnh";
                btn.style.background = "";
                btn.style.boxShadow = "";
                btn.style.color = "";
                btn.style.fontWeight = "";
                btn.style.pointerEvents = "";
                btn.disabled = false;
                btn.onclick = originalOnclick;
                try { localStorage.removeItem("sa_img_" + serial); } catch(e){}
              } catch (err) { 
                self.utils.toast("❌ Lỗi copy: " + err.message, "error");
              }
            };
          }
        };

        window.addEventListener("message", handleMsg);
        
        setTimeout(() => {
          if (!finished && document.body.contains(overlay)) {
            self.utils.toast("❌ Quá thời gian tải ảnh.", "error");
            overlay.remove();
            let currentBtn = document.querySelector(`.btn-a[data-serial="${serial}"], .btn-img[data-serial="${serial}"]`);
            if (currentBtn) { currentBtn.textContent = "Ảnh"; currentBtn.disabled = false; }
          }
        }, 40000);
      },

      async runPopup(serial, btn, date, question = "", inputEl = null) {
        const self = SapoAuto_v1;
        const originalText = (btn && (btn.classList.contains("btn-txt-only") || btn.classList.contains("btn-c-only"))) ? "Chữ" : "Luận";
        // Bắt tên khách hàng NGAY GIÂY PHÚT BẤM NÚT LUẬN (tránh bị lệch khi người dùng đổi tab chat)
        const capturedCustomerName = self.aiService.conversationHistory._getCustomerName();
        if (btn) {
          btn.textContent = "⌛...";
          btn.disabled = true;
        }

        // Đánh dấu đang chạy ngầm trong cả localStorage và chrome.storage.local (kèm timestamp)
        const runInfo = { startTime: Date.now(), customerName: capturedCustomerName };
        try {
          localStorage.setItem("sa_running_" + serial, JSON.stringify(runInfo));
          if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.set({ ['sa_running_' + serial]: runInfo });
          }
        } catch(e) {}

        const convId = self.utils.getActiveConversationId();
        const dateObj = date ? { year: date.getFullYear(), month: date.getMonth()+1, day: date.getDate(), hour: date.getHours(), min: date.getMinutes() } : null;
        const currentModel = self.aiService.model || "Gemini";

        self.utils.toast(`⌛ [${capturedCustomerName || serial}] Đang gọi AI (${currentModel})...`, "info");

        // Gửi lệnh xử lý sang Background Service Worker (Không bao giờ bị tắt khi đổi tab hay F5)
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'startAiQue',
            serial,
            date: dateObj,
            question,
            customerName: capturedCustomerName,
            conversationId: convId
          });
        }
      },

      async runPopupTextOnly(serial, btn, date) {
        const self = SapoAuto_v1;
        const originalText = "Chữ";
        if (btn) {
          btn.textContent = "⌛...";
          btn.disabled = true;
        }
        self.utils.toast("⌛ Đang tải dữ liệu quẻ...", "info");
        
        try {
          const base = self.CONFIG.luchaoUrl || "https://dshc-luc-hao.vercel.app/";
          const baseUrl = base.endsWith('/') ? base : base + '/';
          let apiUrl = `${baseUrl}api/lap-que?serial=${serial}`;
          if (date) {
            const p = n => String(n).padStart(2, "0");
            const saDate = `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`;
            const saHour = date.getHours();
            const saMin = date.getMinutes();
            apiUrl += `&sa_date=${saDate}&sa_hour=${saHour}&sa_minute=${saMin}`;
          }

          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => controller2.abort(), 15000);
          let response;
          try {
            response = await fetch(apiUrl, { signal: controller2.signal });
          } finally {
            clearTimeout(timeoutId2);
          }

          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || "Không thể lập quẻ.");
          }

          let copyText = result.copyText;
          
          await navigator.clipboard.writeText(copyText);
          self.utils.toast("📋 Đã copy và đang mở Gemini...", "success");

          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'openGeminiPopup',
              conversationId: self.utils.getActiveConversationId()
            });
          }
        } catch (err) {
          self.utils.toast("❌ Lỗi lập quẻ: " + err.message, "error");
          console.error("[SapoAuto] API Error:", err);
        } finally {
          if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
          }
        }
      }
    },

    init() {
      const self = SapoAuto_v1;

      // === TỰ ĐỘNG DỌN DẸP CỜ LOADING CŨ KHI F5/MỞ TRANG (CHỐNG TREO ⌛ VĨNH VIỄN) ===
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith("sa_running_")) {
            try {
              const run = JSON.parse(localStorage.getItem(k) || "{}");
              if (!run.startTime || Date.now() - run.startTime > 120000) {
                localStorage.removeItem(k);
              }
            } catch(e) { localStorage.removeItem(k); }
          }
          if (k.startsWith("sa_loading_")) {
            localStorage.removeItem(k);
          }
        });
      } catch(e) {}

      // === LẮNG NGHE KẾT QUẢ AI TỪ BACKGROUND SERVICE WORKER ===
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg.action === 'AI_QUE_STATUS') {
            const { customerName, message } = msg;
            self.utils.toast(`⌛ [${customerName || 'Luận Quẻ'}] ${message}`, "info");
          } else if (msg.action === 'AI_QUE_COMPLETED') {
            const { serial, type, content, customerName, model } = msg;
            try {
              localStorage.setItem("sa_res_" + serial, JSON.stringify({ type, content }));
              localStorage.removeItem("sa_running_" + serial);
            } catch(e) {}

            // Cập nhật tất cả các nút trùng serial trên màn hình hiện tại
            const allBtns = document.querySelectorAll(`.btn-c[data-serial="${serial}"], .btn-txt[data-serial="${serial}"]`);
            allBtns.forEach(b => {
              self.ui.applySavedState(b, serial, "Luận", b.onclick);
            });

            const toastType = type === 'claude' ? 'Claude' : 'Gemini';
            const modelTag = model ? ` (${model})` : '';
            self.utils.toast(`✅ [${customerName || serial}] ĐÃ LUẬN XONG${modelTag}! Bấm Copy để mở ${toastType}.`, "success", 5000);
          } else if (msg.action === 'AI_QUE_FAILED') {
            const { serial, error, customerName } = msg;
            try {
              localStorage.removeItem("sa_running_" + serial);
            } catch(e) {}

            const allBtns = document.querySelectorAll(`.btn-c[data-serial="${serial}"], .btn-txt[data-serial="${serial}"]`);
            allBtns.forEach(b => {
              b.textContent = "Luận";
              b.disabled = false;
              b.style.background = "";
              b.style.color = "";
            });

            self.utils.toast(`❌ [${customerName || serial}] Lỗi luận quẻ: ${error}`, "error", 5000);
          }
        });
      }

      // === LẮNG NGHE TOKEN & PAGE INFO TỪ inject.js ===
      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (event.data?.type === "SAPO_TOKEN") {
          self.STATE.myToken = event.data.token;
          self.utils.log("Token captured ✓");
        }
        if (event.data?.type === "SAPO_PAGE_INFO" && event.data.page_id) {
          // Lưu per-conversation: dùng conversation_id từ inject.js hoặc từ URL hiện tại
          const convId = event.data.conversation_id
            || new URLSearchParams(window.location.search).get('conversationId')
            || new URLSearchParams(window.location.search).get('conversation_id');
          if (convId) {
            const existing = self.STATE.pageMap.get(convId) || {};
            self.STATE.pageMap.set(convId, {
              pageId: event.data.page_id,
              fbPageId: event.data.facebook_page_id || existing.fbPageId || "",
              customerId: event.data.customer_id || existing.customerId || ""
            });
            self.utils.log("PageMap updated:", convId, "→", event.data.page_id);
          }
        }
      });
      
      // Load custom luchaoUrl from storage if present
      if (typeof chrome !== "undefined" && chrome?.storage?.sync) {
        chrome.storage.sync.get({ luchaoUrl: 'https://dshc-luc-hao.vercel.app/' }, (res) => {
          self.CONFIG.luchaoUrl = res.luchaoUrl || 'https://dshc-luc-hao.vercel.app/';
        });
        // Init AI module (load API keys)
        self.aiService.init();
      }
      
      const scanAll = () => {
        // 1. Quét Ảnh mới (chỉ quét các ảnh chưa xử lý)
        document.querySelectorAll("img:not([data-sapo-v1])").forEach(img => {
          if (self.ui.isTarget(img)) self.ui.inject(img);
        });
        // 2. Quét Text mới
        self.textScan.scan();
        
        // 3. Đồng bộ hóa vị trí (Body Injection Sync)
        self.STATE.activeBadges.forEach((badge, img) => {
          if (!document.body.contains(img)) { 
            badge.remove();
            self.STATE.activeBadges.delete(img);
          } else {
            self.ui.sync(img, badge);
          }
        });

        // 4. Sync + Cleanup sa-group theo div cha
        self.STATE.activeTextGroups.forEach((w, div) => {
          if (!document.body.contains(div)) {
            if (w._textKey) self.STATE.textKeys.delete(w._textKey);
            w.remove();
            self.STATE.activeTextGroups.delete(div);
          } else {
            // Sync vị trí: bên phải div, cùng hàng
            const r = div.getBoundingClientRect();
            if (r.width === 0 || r.top < -300 || r.top > window.innerHeight + 300) {
              w.style.opacity = "0"; w.style.pointerEvents = "none";
            } else {
              w.style.opacity = "1"; w.style.pointerEvents = "auto";
              w.style.top  = (window.scrollY + r.top) + "px";
              w.style.left = (window.scrollX + r.right + 8) + "px";
            }
          }
        });
      };

      console.log("[SA] Final Version 1.2.0 Ready (throttled).");
      
      // Chạy quét và đồng bộ liên tục (Đã bỏ setInterval để tránh lag, chỉ dùng MutationObserver)
      // setInterval(scanAll, 1500);

      // Đồng bộ tức thì khi cuộn hoặc thay đổi kích thước (throttle bằng rAF — max 60fps)
      // FIX LAG SCROLL: Batching DOM Read & Write để chống Layout Thrashing
      const instantSync = () => {
        const reads = [];
        
        // --- PASS 1: CHỈ ĐỌC DOM (Không thay đổi gì cả) ---
        self.STATE.activeBadges.forEach((badge, img) => {
          if (badge._pinned) return;
          const rect = img.getBoundingClientRect();
          reads.push({ 
            el: badge, 
            rect, 
            isImg: true,
            visible: rect.width !== 0 && rect.top >= 0 && rect.top <= window.innerHeight
          });
        });

        self.STATE.activeTextGroups.forEach((w, div) => {
          const rect = div.getBoundingClientRect();
          reads.push({ 
            el: w, 
            rect, 
            isImg: false,
            visible: rect.width !== 0 && rect.top >= -300 && rect.top <= window.innerHeight + 300
          });
        });

        // --- PASS 2: CHỈ GHI DOM (Cập nhật CSS hàng loạt) ---
        reads.forEach(({ el, rect, isImg, visible }) => {
          if (!visible) {
            el.style.opacity = "0"; 
            el.style.pointerEvents = "none";
          } else {
            el.style.opacity = "1"; 
            el.style.pointerEvents = "auto";
            el.style.position = "absolute";
            el.style.top = (window.scrollY + rect.top) + "px";
            if (isImg) {
              el.style.left = (window.scrollX + rect.left + rect.width + 8) + "px";
            } else {
              el.style.left = (window.scrollX + rect.right + 8) + "px";
            }
          }
        });
      };
      let syncScheduled = false;
      const throttledSync = () => {
        if (syncScheduled) return;
        syncScheduled = true;
        requestAnimationFrame(() => {
          instantSync();
          syncScheduled = false;
        });
      };
      window.addEventListener("scroll", throttledSync, { capture: true, passive: true });
      window.addEventListener("resize", throttledSync, { capture: true, passive: true });

      // Theo dõi DOM để quét khi có tin nhắn mới (debounce thực sự 300ms — chờ DOM yên tĩnh mới quét)
      let scanDebounceTimer = null;
      const debouncedScan = () => {
        if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
        scanDebounceTimer = setTimeout(() => {
          scanDebounceTimer = null;
          requestAnimationFrame(() => scanAll());
        }, 300);
      };
      // document_start: body có thể chưa tồn tại → chờ DOM ready
      const startBodyObserver = () => {
        if (document.body) {
          new MutationObserver(debouncedScan).observe(document.body, { childList: true, subtree: true });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            new MutationObserver(debouncedScan).observe(document.body, { childList: true, subtree: true });
          });
        }
        
        // Bắt sự kiện ảnh tải xong (vì MutationObserver bắt lúc DOM có img nhưng img chưa load xong nên img.naturalWidth = 0)
        document.addEventListener('load', (e) => {
          if (e.target && e.target.tagName === 'IMG') {
            debouncedScan();
          }
        }, true); // Dùng capture phase vì sự kiện load không bubble
      };
      startBodyObserver();
    }
  };

  SapoAuto_v1.init();
})();
