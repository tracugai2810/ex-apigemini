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
      model: "gemini-3.1-flash-lite",
      FALLBACK_MODELS: ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash"],

      async init() {
        try {
          const data = await new Promise(r => {
            if (typeof chrome !== "undefined" && chrome?.storage?.sync) {
              chrome.storage.sync.get({ geminiApiKey: "", geminiApiKey2: "", geminiApiKey3: "", geminiApiKey4: "", geminiApiKey5: "", geminiModel: "gemini-3.1-flash-lite" }, r);
            } else { r({ geminiApiKey: "", geminiModel: "gemini-3.1-flash-lite" }); }
          });
          this.apiKeys = [
            (data.geminiApiKey || "").trim(),
            (data.geminiApiKey2 || "").trim(),
            (data.geminiApiKey3 || "").trim(),
            (data.geminiApiKey4 || "").trim(),
            (data.geminiApiKey5 || "").trim()
          ].filter(k => k.length > 10);
          this.model = data.geminiModel || "gemini-3.1-flash-lite";
        } catch(e) { this.apiKeys = []; }

        // Phục hồi trí nhớ API từ ổ cứng (LocalStorage) và Reset theo giờ Việt Nam
        try {
          const saved = JSON.parse(localStorage.getItem('sa_api_state') || "{}");
          const vnTime = new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60000) + (7 * 3600000));
          const today = vnTime.toISOString().split('T')[0];
          
          if (saved.date === today) {
            this.currentKeyIdx = saved.keyIdx || 0;
            this.currentModelIdx = saved.modelIdx || 0;
          } else {
            this.currentKeyIdx = 0;
            this.currentModelIdx = 0;
            localStorage.setItem('sa_api_state', JSON.stringify({ date: today, keyIdx: 0, modelIdx: 0 }));
          }
        } catch(e) {
          this.currentKeyIdx = 0;
          this.currentModelIdx = 0;
        }
      },

      isReady() { return this.apiKeys.length > 0; },

      async _callModel(modelName, apiKey, payload, timeoutMs = 20000) {
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
            if (res.status === 429 || errMsg.toLowerCase().includes("quota")) {
              throw { quota: true, message: errMsg, model: modelName };
            }
            throw new Error(errMsg);
          }
          return await res.json();
        } finally {
          clearTimeout(timeoutId);
        }
      },

      currentKeyIdx: 0,
      currentModelIdx: 0,

      async executeWithFallback(payload, actionName, timeoutMs = 60000) {
        if (!this.isReady()) throw new Error("Chưa cấu hình API Key");
        
        const modelsToTry = [this.model, ...this.FALLBACK_MODELS.filter(m => m !== this.model)];
        let lastError = null;

        let startKey = this.currentKeyIdx || 0;
        let startModel = this.currentModelIdx || 0;

        // Quét từng API Key (xoay vòng bắt đầu từ key cuối cùng thành công)
        for (let i = 0; i < this.apiKeys.length; i++) {
          const kIdx = (startKey + i) % this.apiKeys.length;
          const apiKey = this.apiKeys[kIdx];
          
          for (let j = 0; j < modelsToTry.length; j++) {
            if (i === 0 && j < startModel) continue; // Bỏ qua các model đã tịt ở lượt trước

            const modelName = modelsToTry[j];
            try {
              SapoAuto_v1.utils.log(`${actionName} trying Key ${kIdx+1}, model: ${modelName}`);
              const json = await this._callModel(modelName, apiKey, payload, timeoutMs);
              
              // THÀNH CÔNG: Chốt hạ vị trí này để lần sau dùng tiếp luôn!
              this.currentKeyIdx = kIdx;
              this.currentModelIdx = j;
              try {
                const vnTime = new Date(new Date().getTime() + (new Date().getTimezoneOffset() * 60000) + (7 * 3600000));
                const today = vnTime.toISOString().split('T')[0];
                localStorage.setItem('sa_api_state', JSON.stringify({ date: today, keyIdx: kIdx, modelIdx: j }));
              } catch(e) {}
              
              return json;
            } catch (err) {
              lastError = err;
              if (err.name === 'AbortError') {
                 throw new Error("Quá thời gian chờ (Timeout). Dữ liệu gửi đi quá lớn hoặc nghẽn mạng.");
              }
              if (err.quota) {
                SapoAuto_v1.utils.log(`Quota exceeded Key ${kIdx+1}, ${modelName} → Đổi tự động...`);
                continue;
              }
              throw err; 
            }
          }
          startModel = 0; // Sang key mới thì test lại model từ đầu
        }
        
        // Cháy sạch API -> Reset về 0 chờ ngày mai
        this.currentKeyIdx = 0;
        this.currentModelIdx = 0;
        try { localStorage.removeItem('sa_api_state'); } catch(e) {}
        throw new Error("Tất cả API Keys và Models đều hết quota hoặc lỗi.");
      },

      async scanSerial(imgSrc) {
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
        if (!this.isReady()) return null;
        const payload = {
          contents: [{
            parts: [ { text: promptText } ]
          }]
        };
        const json = await this.executeWithFallback(payload, "TextGen", 60000); // Tăng lên 60s để AI đủ thời gian nhai file kiến thức lớn
        return (json.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      }
    },

    // 3. HÀM TIỆN ÍCH (HELPERS)
    utils: {
      wait: ms => new Promise(r => setTimeout(r, ms)),
      log: (...a) => console.log("[SA v1.0]", ...a),
      
      toast(m, c) {
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
        self.STATE.toastTimer = setTimeout(() => t.style.display = "none", 3000);
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
          self.utils.toast("⏳ (1/2) Tạo giỏ hàng...", "info");
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
          self.utils.toast("⏳ (2/2) Chốt đơn...", "info");
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

          self.utils.toast("✅ Đã chốt đơn " + self.CONFIG.LABELS[amount] + "k!", "success");
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
          btnA.textContent = "Ảnh";
          btnA.onclick = (e) => { stopAll(e); self.textScan.runImage(val, btnA, getPickerDate()); };
          btnA.onmousedown = stopAll; btnA.onmouseup = stopAll;
          actionGroup.appendChild(btnA);

          const questionInput = document.createElement("input");
          questionInput.type = "text";
          questionInput.className = "sa-question-input";
          questionInput.placeholder = "Nhập câu hỏi...";
          questionInput.onclick = stopAll;
          questionInput.onmousedown = stopAll;
          questionInput.onmouseup = stopAll;
          questionInput.onkeydown = stopAll;
          actionGroup.appendChild(questionInput);

          const btnC = document.createElement("button");
          btnC.className = "sa-mini-btn btn-c";
          btnC.textContent = "Chữ";
          btnC.onclick = (e) => { stopAll(e); self.textScan.runPopup(val, getPickerDate(), questionInput.value.trim()); };
          btnC.onmousedown = stopAll; btnC.onmouseup = stopAll;
          actionGroup.appendChild(btnC);

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
        btnImg.textContent = "Ảnh";
        btnImg.onclick = () => self.textScan.runImage(numOnly, btnImg, getPickerDate());
        badge.appendChild(btnImg);

        const questionInput = document.createElement("input");
        questionInput.type = "text";
        questionInput.className = "sa-question-input";
        questionInput.placeholder = "Nhập câu hỏi...";
        questionInput.onclick = (e) => e.stopPropagation();
        questionInput.onmousedown = (e) => e.stopPropagation();
        questionInput.onkeydown = (e) => e.stopPropagation();

        const btnTxt = document.createElement("button");
        btnTxt.className = "sa-text-btn btn-txt";
        btnTxt.textContent = "Chữ";
        btnTxt.onclick = () => self.textScan.runPopup(numOnly, getPickerDate(), questionInput.value.trim());
        badge.appendChild(btnTxt);

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
        document.querySelectorAll(".content-text, .msg-content, .message-text, .dialogue-text-content").forEach(div => {
          // CHỐNG LẶP cho các trường hợp element con/cha bị lồng nhau
          if (div.querySelector(".sa-group") || div.dataset.saV19 || div.closest("[data-sa-v19]")) return;

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
        btn.textContent = "⌛...";
        btn.disabled = true;

        const url = self.textScan.buildUrl(serial, date, "image");
        
        // v1.1: Tạo Popup Tàng hình (Silent Mode)
        const overlay = document.createElement("div");
        overlay.className = "sa-popup-overlay sa-silent"; // Thêm class sa-silent (Định vị 1x1px ngoài vùng nhìn)
        const box = document.createElement("div");
        box.className = "sa-popup-box";
        const close = document.createElement("button");
        close.textContent = "×"; close.className = "sa-popup-close";
        close.onclick = () => { overlay.remove(); btn.textContent = "Ảnh"; btn.disabled = false; };
        
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

            const imageData = e.data.payload;
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
              } catch (err) { 
                self.utils.toast("❌ Lỗi copy: " + err.message, "error");
              }
            };
          }
        };

        window.addEventListener("message", handleMsg);
        
        setTimeout(() => {
          if (!finished && document.body.contains(overlay)) {
            self.utils.toast("❌ Quá thời gian. Kiểm tra cửa sổ popup xem có lỗi gì không.", "error");
          }
        }, 60000); // Tăng lên 60s để người dùng kịp nhìn lỗi
      },

      async runPopup(serial, date, question = "") {
        const self = SapoAuto_v1;
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

          const response = await fetch(apiUrl);
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || "Không thể lập quẻ.");
          }

          let copyText = result.copyText;
          
          // --- AI 1-CLICK FLOW ---
          try {
            self.utils.toast("⌛ Đang tải Kiến thức & Gọi AI (tối đa 20s)...", "info");
            
            let mdContent = "";
            try {
               const mdRes = await fetch(`${baseUrl}kinh-dich.md`);
               if (mdRes.ok) mdContent = await mdRes.text();
            } catch(e) { console.log("Không tải được kinh-dich.md"); }
            
            let prompt = copyText + (question ? (" " + question) : "");
            if (mdContent) {
               prompt += `\n\n---\nKiến thức tham khảo:\n${mdContent}`;
            }

            const aiResult = await self.aiService.generateText(prompt);
            if (aiResult && aiResult.length > 10) {
              await navigator.clipboard.writeText(aiResult);
              self.utils.toast("✅ ĐÃ LUẬN XONG! Đang mở Claude...", "success");
              if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: 'openClaudeDirectPopup' });
              }
              return; // Dừng luồng tại đây (thành công)
            } else {
              throw new Error("AI trả kết quả rỗng");
            }
          } catch (aiError) {
            console.error("Lỗi gọi AI:", aiError);
            self.utils.toast("⚠️ AI lỗi/quá tải. Tự động chuyển luồng cũ!", "error");
          }

          // --- FALLBACK TO LEGACY FLOW ---
          await navigator.clipboard.writeText(copyText);
          self.utils.toast("✅ ĐÃ COPY QUẺ! Đang mở Gemini...", "success");

          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'openGeminiPopup' });
          }
        } catch (err) {
          self.utils.toast("❌ Lỗi lập quẻ: " + err.message, "error");
          console.error("[SapoAuto] API Error:", err);
        }
      }
    },

    init() {
      const self = SapoAuto_v1;

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
        // 1. Quét Ảnh mới
        document.querySelectorAll("img").forEach(img => {
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
          scanAll();
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
