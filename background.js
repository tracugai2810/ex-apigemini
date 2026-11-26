// background.js v19 - Gemini + Claude popup flow (settings)
// Luồng: Sapo → Gemini popup → đóng Gemini → Claude popup → đóng Claude → quay về Sapo
// v19: Đọc settings từ options page

// === CÀI ĐẶT MẶC ĐỊNH ===
const DEFAULTS = {
  geminiUrl:       'https://gemini.google.com/gem/4368ce08961a',
  geminiWidth:     950,
  geminiHeight:    700,
  claudeUrl:       'https://claude.ai/project/019e2adc-2890-7738-9366-85a2977bf2f4',
  claudeWidth:     950,
  claudeHeight:    700,
  businessWidth:   1150,
  businessHeight:  600,
  luchaoUrl:       'https://dshc-luc-hao.vercel.app/'
};


// === HELPER POPUP CHO BUSINESS ===
async function getPopupWindows() {
  const data = await chrome.storage.session.get('popupWindows');
  return data.popupWindows || {};
}
async function savePopupWindow(threadId, windowId, sapoUrl) {
  const windows = await getPopupWindows();
  windows[threadId] = { windowId, sapoUrl };
  await chrome.storage.session.set({ popupWindows: windows });
}
async function removePopupWindowByWindowId(windowId) {
  const windows = await getPopupWindows();
  let changed = false;
  let removedData = null;
  for (const [threadId, data] of Object.entries(windows)) {
    if (data.windowId === windowId) {
      removedData = data;
      delete windows[threadId];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.session.set({ popupWindows: windows });
  }
  return removedData;
}
function getThreadKey(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.searchParams.get('thread_id') || url.searchParams.get('selected_item_id') || urlStr;
  } catch(e) {
    return urlStr;
  }
}

// === BỘ NHỚ TOÀN CỤC CHỐNG MỞ TRÙNG POPUP BUSINESS FACEBOOK (DEBOUNCE 2.5s) ===
const _recentPopupCreations = new Map();

function createNewPopup(fbUrl, sapoTab, threadKey, sapoUrl, offsetIndex) {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    function createWindow(left, top, width, height) {
      const options = {
        url: fbUrl,
        type: 'popup',
        width: Math.round(width || settings.businessWidth),
        height: Math.round(height || settings.businessHeight)
      };
      if (left !== undefined && top !== undefined) {
        options.left = Math.round(left);
        options.top = Math.round(top);
      }
      chrome.windows.create(options, async function(win) {
        await savePopupWindow(threadKey, win.id, sapoUrl);
        console.log(`[SapoFBExt v19] Business Popup created for ${threadKey}`);
      });
    }

    if (sapoTab && sapoTab.windowId) {
      chrome.windows.get(sapoTab.windowId, function(sapoWin) {
        if (!chrome.runtime.lastError && sapoWin) {
          const sapoW = sapoWin.width;
          const sapoH = sapoWin.height;
          let popupW = settings.businessWidth; 
          let popupH = settings.businessHeight; 

          const offset = (offsetIndex % 5) * 30;
          const left = sapoWin.left + (sapoW - popupW) / 2 + offset;
          const top = sapoWin.top + 80 + offset; 
          
          createWindow(left, top, popupW, popupH);
        } else {
          createWindow();
        }
      });
    } else {
      createWindow();
    }
  });
}

async function openPopupWindow(fbUrl, sapoTab) {
  const threadKey = getThreadKey(fbUrl);
  const now = Date.now();
  if (_recentPopupCreations.has(threadKey) && (now - _recentPopupCreations.get(threadKey) < 2500)) {
    console.log(`[SapoFBExt] Bỏ qua mở popup trùng cho ${threadKey}`);
    return;
  }
  _recentPopupCreations.set(threadKey, now);
  setTimeout(() => _recentPopupCreations.delete(threadKey), 10000);

  const popupWindows = await getPopupWindows();
  const existingData = popupWindows[threadKey];
  const sapoUrl = sapoTab ? sapoTab.url : null;

  if (existingData && existingData.windowId) {
    chrome.windows.get(existingData.windowId, async function(win) {
      if (chrome.runtime.lastError || !win) {
        await removePopupWindowByWindowId(existingData.windowId);
        createNewPopup(fbUrl, sapoTab, threadKey, sapoUrl, Object.keys(popupWindows).length);
      } else {
        chrome.windows.update(existingData.windowId, { focused: true, drawAttention: true, state: 'normal' });
        if (sapoUrl) {
          await savePopupWindow(threadKey, existingData.windowId, sapoUrl);
        }
      }
    });
  } else {
    createNewPopup(fbUrl, sapoTab, threadKey, sapoUrl, Object.keys(popupWindows).length);
  }
}

chrome.tabs.onCreated.addListener(async function(newTab) {
  const popupWindows = await getPopupWindows();
  const allPopupIds = Object.values(popupWindows).map(d => d.windowId);
  if (allPopupIds.includes(newTab.windowId)) return;

  async function handleUrl(tabId, url) {
    if (!url || !url.includes('business.facebook.com')) return;
    const currentPopups = await getPopupWindows();
    if (Object.values(currentPopups).map(d => d.windowId).includes(newTab.windowId)) return;

    chrome.tabs.query({ url: '*://*.mysapo.net/*' }, function(sapoTabs) {
      if (sapoTabs && sapoTabs.length > 0) {
        const sapoTab = sapoTabs[0];
        chrome.tabs.update(sapoTab.id, { active: true });
        chrome.windows.update(sapoTab.windowId, { focused: true });
        chrome.tabs.remove(tabId).catch(() => {});
        openPopupWindow(url, sapoTab);
      } else {
        chrome.tabs.remove(tabId).catch(() => {});
        openPopupWindow(url);
      }
    });
  }

  if (!newTab.url || newTab.url === 'about:blank' || newTab.url === '') {
    const listener = function(tabId, changeInfo) {
      if (tabId !== newTab.id) return;
      const url = changeInfo.url || '';
      if (!url) return;
      chrome.tabs.onUpdated.removeListener(listener);
      handleUrl(tabId, url);
    };
    chrome.tabs.onUpdated.addListener(listener);
  } else {
    handleUrl(newTab.id, newTab.url);
  }
});

// === STARTUP CLEANUP: Xóa session cũ nếu window không còn tồn tại ===
async function cleanupStaleSessions() {
  try {
    const data = await chrome.storage.session.get(['geminiSessions', 'claudeSessions']);
    let gemini = data.geminiSessions || {};
    let claude = data.claudeSessions || {};
    let changed = false;

    for (const url in gemini) {
      try {
        await chrome.windows.get(gemini[url].windowId);
      } catch {
        delete gemini[url];
        changed = true;
      }
    }

    for (const url in claude) {
      try {
        await chrome.windows.get(claude[url].windowId);
      } catch {
        delete claude[url];
        changed = true;
      }
    }

    if (changed) {
      await chrome.storage.session.set({ geminiSessions: gemini, claudeSessions: claude });
      console.log('[SapoFBExt v18] Cleaned up stale sessions');
    }
  } catch (e) {
    console.error('[SapoFBExt v18] Cleanup error:', e);
  }
}

// === TỰ ĐỘNG DỌN DẸP RÁC LOCAL STORAGE SAU 24 GIỜ ===
const LOCAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 giờ
let _lastLocalCleanupAt = 0;

async function cleanupExpiredLocalStorage(force = false) {
  const now = Date.now();
  if (!force && (now - _lastLocalCleanupAt < 15 * 60 * 1000)) return;
  _lastLocalCleanupAt = now;
  try {
    const allData = await chrome.storage.local.get(null);
    if (!allData) return;
    const keysToRemove = [];
    const keysToStamp = {};

    for (const [k, v] of Object.entries(allData)) {
      if (k.startsWith('sa_running_') || k.startsWith('sa_ctx_running_')) {
        if (!v || !v.startTime || (now - v.startTime > 240000)) {
          keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('sa_unlock_')) {
        if (!v || !v.unlockedAt || (now - v.unlockedAt > LOCAL_TTL_MS)) {
          keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('sa_ctx_')) {
        if (!v || !v.savedAt || (now - v.savedAt > LOCAL_TTL_MS)) {
          keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('sa_res_')) {
        try {
          const obj = (typeof v === 'string') ? JSON.parse(v) : v;
          if (!obj) {
            keysToRemove.push(k);
          } else if (obj.savedAt) {
            if (now - obj.savedAt > LOCAL_TTL_MS) keysToRemove.push(k);
          } else {
            obj.savedAt = now;
            keysToStamp[k] = JSON.stringify(obj);
          }
        } catch {
          keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('sa_img_')) {
        if (!v) {
          keysToRemove.push(k);
        } else if (typeof v === 'string') {
          keysToStamp[k] = { data: v, savedAt: now };
        } else if (typeof v === 'object') {
          if (!v.savedAt || (now - v.savedAt > LOCAL_TTL_MS)) {
            keysToRemove.push(k);
          }
        }
        continue;
      }
      if (k.startsWith('sa_question_serial_')) {
        if (typeof v === 'string') {
          if (!v.trim()) keysToRemove.push(k);
          else keysToStamp[k] = { text: v, savedAt: now };
        } else if (v && typeof v === 'object') {
          if (!v.savedAt || (now - v.savedAt > LOCAL_TTL_MS)) keysToRemove.push(k);
        }
        continue;
      }
      if (k.startsWith('sa_serial_img_')) {
        if (!v) {
          keysToRemove.push(k);
        } else if (typeof v === 'string') {
          keysToStamp[k] = { serial: v, savedAt: now };
        } else if (typeof v === 'object') {
          if (!v.savedAt || (now - v.savedAt > LOCAL_TTL_MS)) {
            keysToRemove.push(k);
          }
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[SA-BG] 🧹 Đã dọn ${keysToRemove.length} mục local quá hạn (24h).`);
    }
    if (Object.keys(keysToStamp).length > 0) {
      await chrome.storage.local.set(keysToStamp);
    }
  } catch (e) {
    console.warn('[SA-BG] Lỗi dọn local storage:', e);
  }
}

// Chạy cleanup khi extension được install/reload hoặc browser khởi động
chrome.runtime.onInstalled.addListener(() => {
  cleanupStaleSessions();
  cleanupExpiredLocalStorage(true);
});
chrome.runtime.onStartup.addListener(() => {
  cleanupStaleSessions();
  cleanupExpiredLocalStorage(true);
});

// === CƠ CHẾ GIỮ NHỊP TIM NỘI BỘ TRONG BACKGROUND (CHROME MV3 KEEP-ALIVE) ===
// Tự động gọi API nhẹ của Chrome mỗi 20s để reset bộ đếm 30s của Service Worker,
// giúp tác vụ AI chạy bền bỉ không bao giờ bị tắt ngầm kể cả khi user ẩn tab hay chơi game.
let _bgActiveTasksCount = 0;
let _bgKeepAliveTimer = null;

function bgStartKeepAlive() {
  _bgActiveTasksCount++;
  if (!_bgKeepAliveTimer) {
    try { chrome.runtime.getPlatformInfo(() => {}); } catch(e) {}
    _bgKeepAliveTimer = setInterval(() => {
      try {
        chrome.runtime.getPlatformInfo(() => {});
      } catch(e) {}
    }, 20000);
  }
}

function bgStopKeepAlive() {
  _bgActiveTasksCount = Math.max(0, _bgActiveTasksCount - 1);
  if (_bgActiveTasksCount === 0 && _bgKeepAliveTimer) {
    clearInterval(_bgKeepAliveTimer);
    _bgKeepAliveTimer = null;
  }
}

// === BỘ KHÓA CHỐNG CHẠY ĐÈ TÁC VỤ TRONG BỘ NHỚ ===
const _runningAiTasks = new Set();
const _runningCtxTasks = new Set();

// === BACKGROUND AI QUE SERVICE (CHẠY TRONG SERVICE WORKER ĐỂ KHÔNG BAO GIỜ BỊ NGẮT KHI ĐỔI TAB / F5) ===
const bgAiService = {
  _cachedKinhDichMd: null,
  _cachedVietLaiMd: null,
  FALLBACK_MODELS: [
    "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", 
    "gemini-3-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash", 
    "gemini-2.0-flash-lite", "gemini-1.5-flash"
  ],

  async getSettings() {
    const data = await chrome.storage.sync.get({
      geminiApiKey: '',
      geminiModel: 'gemini-3.7-flash',
      rewriteGeminiApiKey: '',
      rewriteGeminiModel: 'gemini-3.5-flash-lite',
      rewriteTemperature: '',
      rewriteTopP: '',
      customRewriteGeminiModels: [],
      profileGeminiApiKey: '',
      profileGeminiModel: 'gemini-3.5-flash-lite',
      customProfileGeminiModels: [],
      syncSheetUrl: '',
      luchaoUrl: 'https://dshc-luc-hao.vercel.app/',
      customAiBaseUrl: '',
      customAiApiKey: '',
      customAiModel: '',
      glmApiKey: '',
      glmModel: 'glm-4.7-flash',
      queProvider: 'gemini',
      aiTemperature: '',
      aiTopP: ''
    });

    // Fallback thông minh: nếu chưa có customAiBaseUrl mà có glmApiKey cũ -> tự động dùng Z.AI
    let customBase = (data.customAiBaseUrl || '').trim();
    let customKey = (data.customAiApiKey || '').trim();
    let customMod = (data.customAiModel || '').trim();
    if (!customBase && data.glmApiKey) {
      customBase = 'https://api.z.ai/api/paas/v4';
      customKey = (data.glmApiKey || '').trim();
      customMod = data.glmModel || 'glm-4.7-flash';
    }

    const customRwModels = data.customRewriteGeminiModels || [];
    const rwModelVal = (data.rewriteGeminiModel || '').trim() || 'gemini-3.5-flash-lite';
    const customRwItem = customRwModels.find(m => m && m.value === rwModelVal);

    let rwType = 'gemini';
    let rwModel = rwModelVal;
    let rwKey = (data.rewriteGeminiApiKey || '').trim() || (data.geminiApiKey || '').trim();
    let rwBaseUrl = '';

    if (customRwItem && (customRwItem.type === 'openai_compatible' || customRwItem.baseUrl)) {
      rwType = 'openai_compatible';
      rwModel = customRwItem.model || customRwItem.value;
      rwKey = (customRwItem.apiKey || '').trim();
      rwBaseUrl = (customRwItem.baseUrl || '').trim();
    }

    const customProfModels = data.customProfileGeminiModels || [];
    const profModelVal = (data.profileGeminiModel || '').trim() || 'gemini-3.5-flash-lite';
    const customProfItem = customProfModels.find(m => m && m.value === profModelVal);

    let profType = 'gemini';
    let profModel = profModelVal;
    let profKey = (data.profileGeminiApiKey || '').trim() || (data.geminiApiKey || '').trim();
    let profBaseUrl = '';

    if (customProfItem && (customProfItem.type === 'openai_compatible' || customProfItem.baseUrl)) {
      profType = 'openai_compatible';
      profModel = customProfItem.model || customProfItem.value;
      profKey = (customProfItem.apiKey || '').trim();
      profBaseUrl = (customProfItem.baseUrl || '').trim();
    }

    const rwTemp = (data.rewriteTemperature !== '' && data.rewriteTemperature !== undefined && data.rewriteTemperature !== null && !isNaN(parseFloat(data.rewriteTemperature))) ? parseFloat(data.rewriteTemperature) : null;
    const rwTopP = (data.rewriteTopP !== '' && data.rewriteTopP !== undefined && data.rewriteTopP !== null && !isNaN(parseFloat(data.rewriteTopP))) ? parseFloat(data.rewriteTopP) : null;
    const aiTemp = (data.aiTemperature !== '' && data.aiTemperature !== undefined && data.aiTemperature !== null && !isNaN(parseFloat(data.aiTemperature))) ? parseFloat(data.aiTemperature) : null;
    const aiTopP = (data.aiTopP !== '' && data.aiTopP !== undefined && data.aiTopP !== null && !isNaN(parseFloat(data.aiTopP))) ? parseFloat(data.aiTopP) : null;

    return {
      apiKey: (data.geminiApiKey || '').trim(),
      model: data.geminiModel || 'gemini-3.7-flash',
      rewriteType: rwType,
      rewriteBaseUrl: rwBaseUrl,
      rewriteApiKey: rwKey,
      rewriteModel: rwModel,
      rewriteTemperature: rwTemp,
      rewriteTopP: rwTopP,
      profileType: profType,
      profileBaseUrl: profBaseUrl,
      profileApiKey: profKey,
      profileModel: profModel,
      syncSheetUrl: (data.syncSheetUrl || '').trim(),
      luchaoUrl: data.luchaoUrl || 'https://dshc-luc-hao.vercel.app/',
      customAiBaseUrl: customBase,
      customAiApiKey: customKey,
      customAiModel: customMod,
      queProvider: data.queProvider || 'gemini',
      aiTemperature: aiTemp,
      aiTopP: aiTopP
    };
  },

  async fetchSheet(syncSheetUrl, params) {
    if (!syncSheetUrl) return null;
    const url = syncSheetUrl + '?' + new URLSearchParams(params).toString();
    const maxAttempts = (params && params.action === 'save') ? 1 : 2; // Lưu chỉ gửi 1 lần (tránh ghi đúp khi mạng Google redirect chậm), Đọc thử 2 lần
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout để Apps Script kịp ghi Sheet
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data;
      } catch(e) {
        console.warn(`[SA-BG] Lỗi kết nối Google Sheet (lần ${attempt}/${maxAttempts}):`, e.message);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000));
      }
    }
    return null;
  },

  async saveSheetPost(syncSheetUrl, { convId, customerName, profileText }) {
    if (!syncSheetUrl || !convId || !profileText) return null;
    const payload = JSON.stringify({
      action: 'save_profile',
      convId,
      customerName: customerName || '',
      data: profileText
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch(syncSheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: payload,
          redirect: 'follow',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data;
      } catch (e) {
        console.warn(`[SA-BG] Lỗi POST Google Sheet (lần ${attempt}/2):`, e.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }
    return null;
  },

  extractSheetContext(result) {
    if (!result || !result.success || !Array.isArray(result.data) || result.data.length === 0) {
      return { text: '', updatedAt: result?.updatedAt || '', items: [] };
    }
    const items = result.data.map(s => ({
      text: (typeof s === 'string' ? s : (s?.text || '')).trim(),
      time: (s && typeof s === 'object' && s.time) ? String(s.time) : ''
    })).filter(x => x.text);
    const updatedAt = result.updatedAt || (items[items.length - 1]?.time || '');
    const text = items.length === 1
      ? items[0].text
      : items.map((it, i) => `Quẻ trước #${i + 1}${it.time ? ` (${it.time})` : ''}: ${it.text}`).join('\n');
    return { text, updatedAt, items };
  },

  async buildContext(syncSheetUrl, convId, customerName, serial = '') {
    try {
      if (syncSheetUrl && convId) {
        const result = await this.fetchSheet(syncSheetUrl, {
          action: 'get',
          convId: convId
        });
        const extracted = this.extractSheetContext(result);
        if (extracted.items.length === 1) {
          const timeTag = extracted.updatedAt ? ` (cập nhật ${extracted.updatedAt})` : '';
          return `\n\n---\n[NGỮ CẢNH HỒ SƠ KHÁCH HÀNG & CÁC QUẺ ĐÃ LUẬN TRƯỚC ĐÓ${timeTag} — Hãy tham khảo kỹ hoàn cảnh, diễn biến thực tế và các kết luận/ứng kỳ đã báo để luận giải sâu sát, nhất quán, không mâu thuẫn với các lần trước]:\n${extracted.items[0].text}\n`;
        }
        if (extracted.items.length > 1) {
          let ctx = '\n\n---\n[NGỮ CẢNH CÁC QUẺ ĐÃ LUẬN TRƯỚC ĐÓ CHO KHÁCH NÀY — Hãy tham khảo để luận nhất quán, không mâu thuẫn với các quẻ trước]:\n';
          extracted.items.forEach((it, i) => {
            const time = it.time ? ` (${it.time})` : '';
            ctx += `\nQuẻ trước #${i + 1}${time}: ${it.text}\n`;
          });
          return ctx;
        }
      }
    } catch (e) {}

    // Fallback khẩn cấp: nếu Sheet lỗi, lấy bản local của đúng convId + serial
    if (convId && serial) {
      try {
        const localKey = `sa_ctx_${convId}_${serial}`;
        const localRes = await chrome.storage.local.get([localKey]);
        const item = localRes?.[localKey];
        if (item && item.content && (!item.savedAt || Date.now() - item.savedAt <= LOCAL_TTL_MS)) {
          const timeTag = item.time ? ` (cập nhật ${item.time})` : '';
          return `\n\n---\n[NGỮ CẢNH HỒ SƠ KHÁCH HÀNG & CÁC QUẺ ĐÃ LUẬN TRƯỚC ĐÓ${timeTag} — Hãy tham khảo kỹ hoàn cảnh, diễn biến thực tế và các kết luận/ứng kỳ đã báo để luận giải sâu sát, nhất quán, không mâu thuẫn với các lần trước]:\n${item.content}\n`;
        }
      } catch (e2) {}
    }
    return '';
  },

  async saveSummary(syncSheetUrl, convId, summary, customerName) {
    if (!syncSheetUrl || !summary) {
      console.warn('[SA-BG] Bỏ qua lưu tóm tắt: thiếu syncSheetUrl hoặc summary');
      return false;
    }
    try {
      const result = await this.fetchSheet(syncSheetUrl, {
        action: 'save',
        convId: convId,
        customerName: customerName || '',
        data: summary
      });
      if (result && result.success) {
        console.log('[SA-BG] ✅ ĐÃ LƯU TÓM TẮT LÊN GOOGLE SHEET THÀNH CÔNG:', convId, customerName);
        return true;
      } else {
        console.error('[SA-BG] ❌ Lỗi lưu Google Sheet:', result ? result.error : 'Không có phản hồi');
        return false;
      }
    } catch(e) {
      console.error('[SA-BG] ❌ Ngoại lệ lưu tóm tắt:', e);
      return false;
    }
  },

  async callModel(modelName, apiKey, payload, timeoutMs = 25000) {
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

  async executeWithFallback(apiKey, primaryModel, payload, timeoutMs = 120000, onStatusUpdate = null) {
    if (!apiKey) throw new Error("Chưa cấu hình API Key");
    const modelName = primaryModel || "gemini-3.7-flash";
    if (typeof onStatusUpdate === 'function') {
      onStatusUpdate(`Đang luận quẻ với Gemini (${modelName})...`);
    }
    console.log(`[SA-BG] Calling Model: ${modelName}`);
    const json = await this.callModel(modelName, apiKey, payload, timeoutMs);
    return { json, modelName };
  },

  // === GỌI API OPENAI-COMPATIBLE (GLM, OpenRouter, DeepSeek, v.v.) ===
  async callOpenAICompatible(baseUrl, modelName, apiKey, promptText, timeoutMs = 120000, systemPrompt = '', temperature = null, topP = null, withMeta = false) {
    if (!apiKey) throw new Error("Chưa cấu hình API Key cho provider này");
    if (!modelName) throw new Error("Chưa cấu hình tên Model");

    // Chuẩn hóa base URL: bỏ trailing slash
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanBase}/chat/completions`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(`[SA-BG] Calling OpenAI-Compatible: ${endpoint} | Model: ${modelName}`);

      // Tách riêng System (kiến thức cố định, cache) và User (quẻ + câu hỏi)
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: promptText });

      const requestBody = {
        model: modelName,
        messages
      };
      if (typeof temperature === 'number' && !isNaN(temperature)) {
        requestBody.temperature = temperature;
      }
      if (typeof topP === 'number' && !isNaN(topP)) {
        requestBody.top_p = topP;
      }

      // Tắt suy luận ngầm (thinking) cho Z.AI để tăng tốc phản hồi tối đa, tránh timeout
      if (cleanBase.includes('z.ai') || cleanBase.includes('bigmodel')) {
        requestBody.thinking = { type: "disabled" };
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept-Language": "en-US,en"
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `Error ${res.status}`;
        throw new Error(`[${modelName}] ${errMsg}`);
      }

      const json = await res.json();
      const text = (json.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error(`[${modelName}] API trả về kết quả rỗng`);
      if (withMeta === true) {
        return {
          text,
          finishReason: json.choices?.[0]?.finish_reason || ''
        };
      }
      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async runAiQue({ serial, date, tz = '+07:00', question, customerName, conversationId, triggerSource = 'luan' }) {
    bgStartKeepAlive();
    try {
      console.log(`[SA-BG] Bắt đầu chạy tiến trình Luận quẻ ngầm cho Serial: ${serial} (Khách: ${customerName}, Nguồn: ${triggerSource}, Múi giờ: ${tz})`);
    const settings = await this.getSettings();
    const base = settings.luchaoUrl || "https://dshc-luc-hao.vercel.app/";
    const baseUrl = base.endsWith('/') ? base : base + '/';

    const sendStatus = (msg) => {
      broadcastMessage({
        action: 'AI_QUE_STATUS',
        serial,
        customerName,
        triggerSource,
        message: msg
      });
    };
    
    sendStatus(`Đang tải dữ liệu quẻ & ngữ cảnh...`);

    // 1. Lập quẻ
    let apiUrl = `${baseUrl}api/lap-que?serial=${serial}`;
    if (tz) {
      apiUrl += `&tz=${encodeURIComponent(tz)}`;
    }
    if (date) {
      const p = n => String(n).padStart(2, "0");
      apiUrl += `&sa_date=${date.year}-${p(date.month)}-${p(date.day)}&sa_hour=${date.hour}&sa_minute=${date.min}`;
    }

    const cLapQue = new AbortController();
    const tLapQue = setTimeout(() => cLapQue.abort(), 15000);
    let lapQueRes;
    try {
      lapQueRes = await fetch(apiUrl, { signal: cLapQue.signal });
    } finally {
      clearTimeout(tLapQue);
    }

    if (!lapQueRes.ok) throw new Error(`Lỗi kết nối Lập quẻ (${lapQueRes.status})`);
    const lapQueData = await lapQueRes.json();
    if (!lapQueData.success) throw new Error(lapQueData.error || "Không thể lập quẻ.");
    const copyText = lapQueData.copyText;

    // 2. Tải kinh-dich.md
    if (!this._cachedKinhDichMd) {
      try {
        const cMd = new AbortController();
        const tMd = setTimeout(() => cMd.abort(), 8000);
        const mdRes = await fetch(`${baseUrl}kinh-dich.md`, { signal: cMd.signal });
        clearTimeout(tMd);
        if (mdRes.ok) this._cachedKinhDichMd = await mdRes.text();
      } catch(e) {
        console.log('[SA-BG] Không tải được kinh-dich.md:', e.message);
      }
    }
    const mdContent = this._cachedKinhDichMd || "";

    // 3. Lấy ngữ cảnh hồ sơ từ Google Sheet (hoặc fallback local nếu Sheet lỗi)
    const historyContext = await this.buildContext(settings.syncSheetUrl, conversationId, customerName, serial);

    // 4. Tạo prompt — Tách riêng System (chỉ kinh-dich.md) và User (quẻ + câu hỏi + hồ sơ ngữ cảnh)
    let systemPrompt = '';
    if (mdContent) {
      systemPrompt = `---\nKiến thức tham khảo:\n${mdContent}`;
    }
    const userPrompt = copyText + (question ? (' ' + question) : '') + historyContext;

    // 5. Gọi AI theo provider đã chọn cho nút bấm tương ứng
    try {
      let aiResult = "";
      let usedModelName = "";

      if (triggerSource === 'chu') {
        // === MODEL PHỤ (NÚT "KHÁC" — TÙY CHỈNH OPENAI-COMPATIBLE: Z.AI, OPENROUTER, DEEPSEEK...) ===
        usedModelName = settings.customAiModel || "Model Phụ";
        sendStatus(`Đang luận quẻ với ${usedModelName}...`);
        aiResult = await this.callOpenAICompatible(
          settings.customAiBaseUrl,
          settings.customAiModel,
          settings.customAiApiKey,
          userPrompt,
          120000,
          systemPrompt,
          settings.aiTemperature,
          settings.aiTopP
        );
      } else {
        // === GEMINI (MẶC ĐỊNH CHO NÚT GEMINI) ===
        usedModelName = settings.model;
        sendStatus(`Đang gọi AI (${usedModelName})...`);
        const payload = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }]
        };
        const genConfig = {};
        if (settings.aiTemperature !== null && typeof settings.aiTemperature === 'number' && !isNaN(settings.aiTemperature)) {
          genConfig.temperature = settings.aiTemperature;
        }
        if (settings.aiTopP !== null && typeof settings.aiTopP === 'number' && !isNaN(settings.aiTopP)) {
          genConfig.topP = settings.aiTopP;
        }
        if (Object.keys(genConfig).length > 0) {
          payload.generationConfig = genConfig;
        }
        const { json, modelName } = await this.executeWithFallback(settings.apiKey, usedModelName, payload, 120000, (msg) => sendStatus(msg));
        usedModelName = modelName;
        aiResult = (json.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      }

      if (aiResult && aiResult.length > 10) {
        // Không lưu Google Sheet sau khi luận nữa (đã tổng hợp hồ sơ ở bước trước); chỉ cắt bỏ nếu model lỡ tự viết thêm [TÓM_TẮT]
        aiResult = aiResult.replace(/(?:\n+[-—~*_]*)*\s*(?:\n+\s*(?:[#*`_~-]*\s*)?\[?\s*TÓM[_ ]TẮT(?:\s+QUẺ)?\s*\]?\s*[*`_~-]*\s*:?[\s\S]*)$/i, '').trim();

        // ==============================================================
        // === BƯỚC 2: TỰ ĐỘNG GỌI AI VIẾT LẠI THEO PHONG CÁCH THỰC TẾ ===
        // ==============================================================
        const rwModelDisplay = settings.rewriteModel || 'AI';
        sendStatus(`✍️ Đang viết lại bằng ${rwModelDisplay}...`);

        // 1. Tải viet-lai.md từ web (nếu chưa có trong cache ngầm)
        if (!this._cachedVietLaiMd) {
          try {
            const cVl = new AbortController();
            const tVl = setTimeout(() => cVl.abort(), 8000);
            const vlRes = await fetch(`${baseUrl}viet-lai.md`, { signal: cVl.signal });
            clearTimeout(tVl);
            if (vlRes.ok) this._cachedVietLaiMd = await vlRes.text();
          } catch(e) {
            console.log('[SA-BG] Không tải được viet-lai.md từ web:', e.message);
          }
        }
        const vietLaiPrompt = this._cachedVietLaiMd || "";

        let rewrittenResult = null;
        if (vietLaiPrompt && settings.rewriteApiKey) {
          try {
            console.log(`[SA-BG] Calling Rewrite Model: ${settings.rewriteModel} (Type: ${settings.rewriteType || 'gemini'})`);
            
            if (settings.rewriteType === 'openai_compatible') {
              const textRw = await this.callOpenAICompatible(
                settings.rewriteBaseUrl,
                settings.rewriteModel,
                settings.rewriteApiKey,
                aiResult,
                120000,
                vietLaiPrompt,
                settings.rewriteTemperature,
                settings.rewriteTopP
              );
              if (textRw && textRw.length > 20) {
                rewrittenResult = textRw;
              }
            } else {
              const rwPayload = {
                systemInstruction: { parts: [{ text: vietLaiPrompt }] },
                contents: [{ parts: [{ text: aiResult }] }]
              };
              const genConfig = {};
              if (settings.rewriteTemperature !== null) genConfig.temperature = settings.rewriteTemperature;
              if (settings.rewriteTopP !== null) genConfig.topP = settings.rewriteTopP;
              if (Object.keys(genConfig).length > 0) {
                rwPayload.generationConfig = genConfig;
              }

              console.log(`[SA-BG] Calling Gemini Rewrite Model: ${settings.rewriteModel}`);
              const rwRes = await this.callModel(settings.rewriteModel, settings.rewriteApiKey, rwPayload, 120000);
              const textRw = (rwRes?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
              if (textRw && textRw.length > 20) {
                rewrittenResult = textRw;
              }
            }
          } catch(rwErr) {
            console.warn('[SA-BG] Viết lại bài luận gặp sự cố, kích hoạt fallback giữ bài gốc:', rwErr);
          }
        }

        // ==============================================================
        // === XỬ LÝ KẾT QUẢ VÀ TRẢ VỀ NÚT TƯƠNG ỨNG ===
        // ==============================================================
        const resKey = `sa_res_${triggerSource}_${serial}`;
        await chrome.storage.local.remove('sa_running_' + serial);

        if (rewrittenResult) {
          // THÀNH CÔNG CẢ 2 BƯỚC -> NÚT XANH DƯƠNG FB (MỞ FACEBOOK BUSINESS)
          await chrome.storage.local.set({
            [resKey]: JSON.stringify({ 
              type: 'business', 
              content: rewrittenResult, 
              rawContent: aiResult, 
              model: settings.rewriteModel, 
              triggerSource,
              savedAt: Date.now()
            })
          });

          broadcastMessage({
            action: 'AI_QUE_COMPLETED',
            serial,
            conversationId,
            type: 'business',
            content: rewrittenResult,
            customerName,
            model: settings.rewriteModel,
            triggerSource
          });
          return { success: true, type: 'business', content: rewrittenResult, model: settings.rewriteModel, triggerSource };
        } else {
          // BƯỚC 2 LỖI (FALLBACK) -> NÚT XANH LÁ (BÀI LUẬN GỐC, MỞ CLAUDE NHƯ CŨ)
          await chrome.storage.local.set({
            [resKey]: JSON.stringify({ 
              type: 'claude', 
              content: aiResult, 
              model: usedModelName, 
              triggerSource,
              savedAt: Date.now()
            })
          });

          broadcastMessage({
            action: 'AI_QUE_COMPLETED',
            serial,
            conversationId,
            type: 'claude',
            content: aiResult,
            customerName,
            model: usedModelName,
            triggerSource
          });
          return { success: true, type: 'claude', content: aiResult, model: usedModelName, triggerSource };
        }
      }
      throw new Error("AI trả về kết quả rỗng");
    } catch(aiError) {
      console.warn('[SA-BG] AI thất bại, fallback sang Gemini web:', aiError);
      // Fallback Gemini
      const resKey = `sa_res_${triggerSource}_${serial}`;
      await chrome.storage.local.set({
        [resKey]: JSON.stringify({ type: 'gemini', content: copyText, triggerSource, savedAt: Date.now() })
      });
      await chrome.storage.local.remove('sa_running_' + serial);

      broadcastMessage({
        action: 'AI_QUE_COMPLETED',
        serial,
        conversationId,
        type: 'gemini',
        content: copyText,
        customerName,
        triggerSource
      });
      return { success: true, type: 'gemini', content: copyText, triggerSource };
    }
  } finally {
    bgStopKeepAlive();
    try {
      const portName = 'sa_keepalive_' + serial;
      if (typeof _bgKeepAlivePorts !== 'undefined' && _bgKeepAlivePorts.has(portName)) {
        const p = _bgKeepAlivePorts.get(portName);
        if (p) p.disconnect();
        _bgKeepAlivePorts.delete(portName);
      }
    } catch(e) {}
  }
}
};

// === BACKGROUND CONTEXT PROFILE SERVICE (LẤY TỐI ĐA 500 TIN NHẮN & TỔNG HỢP HỒ SƠ) ===
const bgContextService = {
  MAX_PAGES: 25, // 25 lượt x 20 tin = tối đa 500 tin nhắn gần nhất
  SKIP_PATTERNS: [
    "tập trung nghĩ về",
    "rút lấy 1 tờ tiền bất kỳ",
    "rút 1 tờ tiền bất kỳ",
    "hướng dẫn cách gieo khác",
    "không có tiền mặt thì",
    "mình gửi bạn giá các gói",
    "chọn gói xem và chuyển khoản",
    "nội dung ck:",
    "ok bạn, để mình xem",
    "bạn cân nhắc và tham khảo thông tin nhé",
    "khi nào bạn cần xem thêm vấn đề nào khác",
    "đã trả lời một quảng cáo",
    "xem ngay với giá chỉ 20k",
    "cần xem về vấn đề gì",
    "mình gửi bạn bảng giá",
    "bảng giá các gói dịch vụ",
    "bạn ơi, quẻ mình gieo rồi ấy",
    "bạn đợi mình chút"
  ],
  DIVINATION_KEYWORDS: /\b(hào|dụng thần|tử tôn|thê tài|quan quỷ|phụ mẫu|huynh đệ|tuần không|ứng kỳ|nguyệt lệnh|nhật thần|lục hợp|lục xung|phản ngâm|phục ngâm|hồi đầu|ám động|bạch hổ|chu tước|đằng xà|thanh long|huyền vũ|câu trần|vượng|suy|khắc)\b/i,

  formatMsgTime(ts) {
    try {
      const d = new Date(Number(ts));
      if (isNaN(d.getTime())) return "";
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
      return "";
    }
  },

  async fetchSapoMessages(convId, token, tenant) {
    if (!convId || convId === 'default') throw new Error('Thiếu mã hội thoại Sapo');
    if (!token) throw new Error('Chưa bắt được Token Sapo');

    const headers = {
      'Content-Type': 'application/json',
      'X-Bizweb-App-Fpage-Token': token,
      'X-Sapo-Tenant': tenant || 'janet.mysapo.net'
    };

    const allMsgs = [];
    const seenIds = new Set();
    let lastTime = null;
    let userMeta = { name: '', gender: '' };
    let pagesFetched = 0;
    let lastAdded = 0;

    for (let page = 1; page <= this.MAX_PAGES; page++) {
      let url = `https://sapo-socials.sapoapps.vn/api/conversations/${encodeURIComponent(convId)}/messages?language=vi`;
      if (lastTime) url += `&last_time=${encodeURIComponent(lastTime)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      let res;
      try {
        res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) throw new Error(`Lỗi tải tin nhắn Sapo (HTTP ${res.status})`);
      const data = await res.json();

      if (page === 1) {
        userMeta.name = data?.user?.name || data?.conversation?.account_name || '';
        userMeta.gender = data?.user?.gender || '';
      }

      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      if (msgs.length === 0) break;

      pagesFetched = page;
      let added = 0;
      let oldestTs = Infinity;

      for (const m of msgs) {
        const ts = Number(m.channel_created_on || 0);
        if (ts > 0 && ts < oldestTs) oldestTs = ts;
        if (m.id && !seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMsgs.push(m);
          added++;
        }
      }

      lastAdded = added;
      if (added === 0 || !Number.isFinite(oldestTs)) break;
      lastTime = oldestTs;
    }

    allMsgs.sort((a, b) => Number(a.channel_created_on || 0) - Number(b.channel_created_on || 0));
    const hitCap = (pagesFetched >= this.MAX_PAGES && lastAdded > 0);
    return { messages: allMsgs, userMeta, hitCap };
  },

  filterMessages(messages) {
    const filteredLines = [];
    const shopManualTexts = [];

    for (const m of messages) {
      if (m.type !== 'text') continue;
      if (m.action === 'SEND_AUTOMATION_MESSAGE') continue;

      const txt = String(m.content || '').trim();
      if (!txt || txt.length <= 2) continue;

      const isShop = !!m.is_page_message;
      const lower = txt.toLowerCase();
      // Chỉ lọc mẫu câu hướng dẫn/bảng giá ở tin nhắn phía SHOP, tuyệt đối không lọc tin nhắn của KHÁCH
      if (isShop && this.SKIP_PATTERNS.some(pat => lower.includes(pat))) continue;

      const dt = this.formatMsgTime(m.channel_created_on);
      const senderLabel = isShop ? 'THẦY (SHOP)' : 'KHÁCH';

      filteredLines.push(`${dt ? `[${dt}] ` : ''}${senderLabel}: ${txt}`);
      if (isShop) shopManualTexts.push(txt);
    }

    return { filteredLines, shopManualTexts };
  },

  isNewCustomer(shopManualTexts, oldSheetText) {
    if (oldSheetText && oldSheetText.trim().length > 0) return false;
    for (const txt of shopManualTexts) {
      if (txt.length >= 80) return false;
      if (txt.length >= 25 && this.DIVINATION_KEYWORDS.test(txt)) return false;
    }
    return true;
  },

  countWords(text) {
    const clean = String(text || '').trim();
    if (!clean) return 0;
    const tokens = clean.split(/\s+/);
    let count = 0;
    for (const tk of tokens) {
      if (/[0-9A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/.test(tk)) count++;
    }
    return count;
  },

  detectProfileTruncation(text, finishReason = '') {
    const reason = String(finishReason || '').trim().toUpperCase();
    if (reason && reason !== 'STOP' && reason !== 'END_TURN') {
      return { truncated: true, reason: `API dừng bất thường (${reason})` };
    }
    const str = String(text || '').trim();
    if (!str) {
      return { truncated: true, reason: 'Hồ sơ rỗng' };
    }
    const hasSection3 = /(?:^|\n)\s*(?:[#*_>\-\s]*)(?:(?:3|III)\s*[\.\):]\s*(?:[#*_]*\s*)?(?:GHI\s*CHÚ|LƯU\s*Ý|TRẠNG\s*THÁI|TỔNG\s*KẾT|CHỐT|MÂU\s*THUẪN)|GHI\s*CHÚ\s*QUAN\s*TRỌNG|KHÔNG\s*MÂU\s*THUẪN)/i.test(str);
    if (!hasSection3) {
      return { truncated: true, reason: 'Thiếu Mục 3 (có thể bị cắt đoạn)' };
    }
    return { truncated: false, reason: '' };
  },

  async summarizeContext({ providerType = 'gemini', baseUrl = '', apiKey, model, customerName, gender, filteredLines }) {
    const useModel = model || 'gemini-3.5-flash-lite';
    if (providerType === 'openai_compatible') {
      if (!baseUrl) throw new Error('Chưa cấu hình Base URL cho Model Hồ sơ');
      if (!apiKey) throw new Error('Chưa cấu hình API Key cho Model Hồ sơ');
      if (!useModel) throw new Error('Chưa cấu hình tên Model Hồ sơ');
    } else {
      if (!apiKey) throw new Error('Chưa cấu hình Gemini API Key');
    }

    const systemPrompt = [
      'Bạn là trợ lý phân tích và lập hồ sơ khách hàng xem Kinh Dịch Lục Hào.',
      'Nhiệm vụ: Đọc dữ liệu hội thoại, tổng hợp thành 1 BẢN HỒ SƠ NGỮ CẢNH ĐẦY ĐỦ, CHÍNH XÁC TUYỆT ĐỐI.',
      '',
      'QUY TẮC BẮT BUỘC:',
      '1. Không bỏ sót bất kỳ thông tin cá nhân (tên, giới tính, tuổi/năm sinh), con số tiền bạc, mốc thời gian, tình tiết câu chuyện, tên quẻ, hào động, dụng thần, kết luận Cát/Hung và Ứng Kỳ nào.',
      '2. Bắt trọn cả những câu luận giải ngắn của Thầy (Shop) và toàn bộ phản hồi/diễn biến thực tế của khách sau khi xem quẻ.',
      '3. Chỉ dùng thông tin có trong dữ liệu, không tự suy diễn thêm; chỗ nào không có thì ghi "Chưa rõ". Nếu diễn biến mới khác trước, ghi nhận rõ quá trình thay đổi và chốt trạng thái mới nhất ở tin nhắn cuối cùng.',
      '4. Trình bày chi tiết, đầy đủ nhất đối với 5-7 lần xem gần nhất; các lần xem quá cũ (nếu có nhiều hơn) thì tóm lược ý chính và kết luận để tổng độ dài toàn bài không vượt quá 2.500 - 3.000 từ. Không viết lời chào mở đầu hay kết thúc.',
      '',
      'CẤU TRÚC BẢN HỒ SƠ:',
      '1. HỒ SƠ & THÔNG TIN CÁ NHÂN KHÁCH HÀNG:',
      '   - Tên khách, giới tính, tuổi/năm sinh, nghề nghiệp/hoàn cảnh và các đối tượng liên quan.',
      '2. LỊCH SỬ CÁC QUẺ ĐÃ XEM & DIỄN BIẾN THỰC TẾ THEO THỜI GIAN:',
      '   - Liệt kê theo từng lần xem (Ngày giờ -> Câu hỏi & Hoàn cảnh khách chia sẻ -> Quẻ & Luận giải/Kết luận/Ứng kỳ của Thầy -> Phản hồi/Diễn biến thực tế của khách sau đó).',
      '3. GHI CHÚ QUAN TRỌNG ĐỂ KHÔNG MÂU THUẪN KHI LUẬN QUẺ TIẾP THEO:',
      '   - Trạng thái sự việc hiện tại tính đến tin nhắn cuối cùng đang dừng ở đâu?',
      '   - Các kết luận và mốc Ứng Kỳ cốt lõi Thầy đã chốt mà lần luận tiếp theo phải giữ đúng mạch, tuyệt đối không mâu thuẫn.'
    ].join('\n');

    const genderLabel = gender === 'female' ? 'Nữ' : (gender === 'male' ? 'Nam' : (gender || 'Chưa rõ'));
    let userPrompt = `Khách hàng: ${customerName || 'Khách Hàng'} | Giới tính: ${genderLabel}\n`;
    userPrompt += `\n[LỊCH SỬ HỘI THOẠI TRÊN SAPO (Đã lọc ${filteredLines.length} tin nhắn cốt lõi)]:\n${filteredLines.join('\n')}`;

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }]
    };

    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let text = '';
        let finishReason = '';
        if (providerType === 'openai_compatible') {
          const aiMeta = await bgAiService.callOpenAICompatible(baseUrl, useModel, apiKey, userPrompt, 120000, systemPrompt, null, null, true);
          text = aiMeta.text;
          finishReason = aiMeta.finishReason || '';
        } else {
          const json = await bgAiService.callModel(useModel, apiKey, payload, 120000);
          text = (json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          finishReason = json?.candidates?.[0]?.finishReason || '';
        }
        if (!text || text.length < 20) throw new Error('AI trả về hồ sơ rỗng');
        const wordCount = this.countWords(text);
        const truncInfo = this.detectProfileTruncation(text, finishReason);
        return {
          text,
          wordCount,
          truncated: truncInfo.truncated,
          truncReason: truncInfo.reason,
          finishReason
        };
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || '').toLowerCase();
        const isTransient = !!(e?.quota || e?.name === 'AbortError' || msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('fetch') || msg.includes('network') || msg.includes('overloaded'));
        if (attempt < 2 && isTransient) {
          console.warn(`[SA-BG] Tổng hợp hồ sơ gặp lỗi tạm (${e.message}), thử lại sau 2.5s...`);
          await new Promise(r => setTimeout(r, 2500));
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('Lỗi tổng hợp hồ sơ');
  },

  async runContextBuild({ serial, convId, customerName, sapoToken, tenant }) {
    bgStartKeepAlive();
    cleanupExpiredLocalStorage();
    const ctxKey = `sa_ctx_${convId}_${serial}`;
    const unlockKey = `sa_unlock_${convId}_${serial}`;
    const runKey = `sa_ctx_running_${convId}_${serial}`;

    const sendStatus = (msg) => {
      broadcastMessage({
        action: 'CTX_STATUS',
        serial,
        convId,
        customerName,
        message: msg
      });
    };

    try {
      sendStatus('Đang tải lịch sử tin nhắn Sapo...');
      const settings = await bgAiService.getSettings();

      let sapoData;
      try {
        sapoData = await this.fetchSapoMessages(convId, sapoToken, tenant);
      } catch (msgErr) {
        const errMsg = msgErr?.message || 'Lỗi tải tin nhắn Sapo';
        console.warn('[SA-BG] Không tải được tin nhắn Sapo:', errMsg);
        await chrome.storage.local.set({
          [ctxKey]: { type: 'error_no_old', content: '', time: '', error: errMsg, convId, serial, savedAt: Date.now() },
          [unlockKey]: { unlockedAt: Date.now(), convId, serial }
        });
        await chrome.storage.local.remove(runKey);
        broadcastMessage({
          action: 'CTX_DONE',
          serial,
          convId,
          status: 'error_no_old',
          content: '',
          time: '',
          error: errMsg,
          customerName
        });
        return;
      }

      const { messages, userMeta } = sapoData;
      const finalName = customerName || userMeta.name || 'Khách Hàng';
      const { filteredLines } = this.filterMessages(messages);

      if (filteredLines.length === 0) {
        await chrome.storage.local.set({
          [ctxKey]: { type: 'new_customer', content: '', time: '', convId, serial, savedAt: Date.now() },
          [unlockKey]: { unlockedAt: Date.now(), convId, serial }
        });
        await chrome.storage.local.remove(runKey);
        broadcastMessage({
          action: 'CTX_DONE',
          serial,
          convId,
          status: 'new_customer',
          rawCount: messages.length,
          filteredCount: 0,
          customerName: finalName
        });
        return;
      }

      const useModel = settings.profileModel || 'gemini-3.5-flash-lite';
      sendStatus(`Đã đọc ${messages.length} tin (lọc ${filteredLines.length} tin). Đang tổng hợp (${useModel})...`);

      try {
        const summaryRes = await this.summarizeContext({
          providerType: settings.profileType,
          baseUrl: settings.profileBaseUrl,
          apiKey: settings.profileApiKey,
          model: useModel,
          customerName: finalName,
          gender: userMeta.gender,
          filteredLines
        });
        const profileText = summaryRes.text;
        const wordCount = summaryRes.wordCount;
        const truncated = !!summaryRes.truncated;
        const truncReason = summaryRes.truncReason || '';

        sendStatus('Đang lưu hồ sơ lên Google Sheet...');
        const postRes = await bgAiService.saveSheetPost(settings.syncSheetUrl, {
          convId,
          customerName: finalName,
          profileText
        });
        const nowTime = (postRes && postRes.time) ? postRes.time : new Date().toLocaleString('vi-VN');
        const sheetSaved = !!(postRes && postRes.success);

        await chrome.storage.local.set({
          [ctxKey]: {
            type: 'ok',
            content: profileText,
            wordCount,
            truncated,
            truncReason,
            time: nowTime,
            sheetSaved,
            convId,
            serial,
            savedAt: Date.now()
          },
          [unlockKey]: { unlockedAt: Date.now(), convId, serial }
        });
        await chrome.storage.local.remove(runKey);
        broadcastMessage({
          action: 'CTX_DONE',
          serial,
          convId,
          status: 'ok',
          content: profileText,
          wordCount,
          truncated,
          truncReason,
          time: nowTime,
          sheetSaved,
          rawCount: messages.length,
          filteredCount: filteredLines.length,
          customerName: finalName
        });
      } catch (aiErr) {
        const errMsg = aiErr?.message || 'Lỗi AI tổng hợp hồ sơ';
        console.warn('[SA-BG] Tổng hợp hồ sơ AI lỗi:', errMsg);
        await chrome.storage.local.set({
          [ctxKey]: { type: 'error_no_old', content: '', time: '', error: errMsg, convId, serial, savedAt: Date.now() },
          [unlockKey]: { unlockedAt: Date.now(), convId, serial }
        });
        await chrome.storage.local.remove(runKey);
        broadcastMessage({
          action: 'CTX_DONE',
          serial,
          convId,
          status: 'error_no_old',
          content: '',
          time: '',
          error: errMsg,
          customerName: finalName
        });
      }
    } finally {
      bgStopKeepAlive();
      try {
        const portName = 'sa_keepalive_ctx_' + serial;
        if (typeof _bgKeepAlivePorts !== 'undefined' && _bgKeepAlivePorts.has(portName)) {
          const p = _bgKeepAlivePorts.get(portName);
          if (p) p.disconnect();
          _bgKeepAlivePorts.delete(portName);
        }
      } catch (e) {}
    }
  }
};

function broadcastMessage(msg) {
  chrome.tabs.query({}, (tabs) => {
    if (tabs && tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      });
    }
  });
}

// === QUẢN LÝ KẾT NỐI PORT KEEP-ALIVE TỪ CONTENT SCRIPT (CHỐNG CHROME SERVICE WORKER NGỦ ĐÔNG) ===
const _bgKeepAlivePorts = new Map();
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port && port.name && port.name.startsWith('sa_keepalive_')) {
      _bgKeepAlivePorts.set(port.name, port);
      console.log(`[SA-BG] 🔌 Đã kết nối Port giữ nhịp tim: ${port.name} (Active: ${_bgKeepAlivePorts.size})`);
      
      port.onMessage.addListener(() => {
        // Nhận ping nhẹ định kỳ từ tab chat để Chrome MV3 luôn ghi nhận Service Worker đang bận
      });

      port.onDisconnect.addListener(() => {
        _bgKeepAlivePorts.delete(port.name);
        console.log(`[SA-BG] 🔌 Đã ngắt Port giữ nhịp tim: ${port.name} (Active: ${_bgKeepAlivePorts.size})`);
      });
    }
  });
}

// === MESSAGE HANDLER ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Bắt đầu Luận quẻ trong nền (chạy trong Service Worker)
  if (msg.action === 'startAiQue') {
    const { serial, date, tz = '+07:00', question, customerName, conversationId, triggerSource = 'luan' } = msg;
    if (_runningAiTasks.has(serial)) {
      sendResponse({ started: false, alreadyRunning: true });
      return true;
    }
    _runningAiTasks.add(serial);
    cleanupExpiredLocalStorage();
    chrome.storage.local.set({
      ['sa_running_' + serial]: { startTime: Date.now(), customerName: customerName || '', triggerSource, tz }
    });

    bgAiService.runAiQue({ serial, date, tz, question, customerName, conversationId, triggerSource })
      .catch((err) => {
        console.error('[SA-BG] Lỗi chạy task Luận quẻ:', err);
        chrome.storage.local.remove('sa_running_' + serial);
        broadcastMessage({
          action: 'AI_QUE_FAILED',
          serial,
          conversationId,
          error: err.message || 'Lỗi không xác định',
          customerName,
          triggerSource
        });
      })
      .finally(() => _runningAiTasks.delete(serial));

    sendResponse({ started: true });
    return true;
  }

  // Bắt đầu lấy tin nhắn & tổng hợp Hồ sơ ngữ cảnh (nút 📋)
  if (msg.action === 'startContextBuild') {
    const { serial, convId, customerName, sapoToken, tenant } = msg;
    const ctxTaskKey = `${convId}_${serial}`;
    if (_runningCtxTasks.has(ctxTaskKey)) {
      sendResponse({ started: false, alreadyRunning: true });
      return true;
    }
    _runningCtxTasks.add(ctxTaskKey);
    const runKey = `sa_ctx_running_${convId}_${serial}`;
    chrome.storage.local.set({
      [runKey]: { startTime: Date.now(), customerName: customerName || '', convId, serial }
    });

    bgContextService.runContextBuild({ serial, convId, customerName, sapoToken, tenant })
      .catch((err) => {
        console.error('[SA-BG] Lỗi chạy task Hồ sơ ngữ cảnh:', err);
        chrome.storage.local.remove(runKey);
        chrome.storage.local.set({
          [`sa_unlock_${convId}_${serial}`]: { unlockedAt: Date.now(), convId, serial }
        });
        broadcastMessage({
          action: 'CTX_DONE',
          serial,
          convId,
          status: 'error_no_old',
          error: err?.message || 'Lỗi không xác định',
          customerName
        });
      })
      .finally(() => _runningCtxTasks.delete(ctxTaskKey));

    sendResponse({ started: true });
    return true;
  }

  // Lấy giờ cập nhật ngữ cảnh lần cuối từ Google Sheet cho nút 📋
  if (msg.action === 'getContextMeta') {
    const convId = msg.convId;
    if (!convId || convId === 'default') {
      sendResponse({ success: true, hasContext: false, updatedAt: '' });
      return true;
    }
    (async () => {
      try {
        const settings = await bgAiService.getSettings();
        if (!settings.syncSheetUrl) {
          sendResponse({ success: true, hasContext: false, updatedAt: '' });
          return;
        }
        const res = await bgAiService.fetchSheet(settings.syncSheetUrl, { action: 'get', convId });
        const extracted = bgAiService.extractSheetContext(res);
        sendResponse({
          success: true,
          hasContext: extracted.items.length > 0,
          updatedAt: extracted.updatedAt || ''
        });
      } catch (e) {
        sendResponse({ success: false, hasContext: false, updatedAt: '' });
      }
    })();
    return true;
  }

  // Đóng popup business khi nhận được lệnh closePopup từ fb-content.js
  if (msg.action === 'closePopup' && sender.tab && sender.tab.windowId) {
    chrome.windows.remove(sender.tab.windowId).catch(() => {});
    return;
  }

  // Mở thẳng Facebook Business chat khi bấm nút Xanh dương
  if (msg.action === 'openBusinessChat') {
    const sapoTabId = sender.tab ? sender.tab.id : null;
    if (sapoTabId) {
      chrome.scripting.executeScript({
        target: { tabId: sapoTabId, allFrames: true },
        world: "MAIN",
        func: () => {
          let attempts = 0;
          let timer = setInterval(() => {
            attempts++;
            let btns = document.querySelectorAll('span.direct-messenger-fb');
            let btn = Array.from(btns).find(b => b.offsetWidth > 0 && b.offsetHeight > 0); 
            if (btn) {
              clearInterval(timer);
              try {
                if (window.top && window.top.__saFbClickLock && Date.now() - window.top.__saFbClickLock < 2500) return;
                if (window.top) window.top.__saFbClickLock = Date.now();
              } catch(e) {
                if (window.__saFbClickLock && Date.now() - window.__saFbClickLock < 2500) return;
                window.__saFbClickLock = Date.now();
              }
              btn.scrollIntoView({ block: 'center', behavior: 'instant' });
              const key = Object.keys(btn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
              let reactClicked = false;
              if (key && btn[key] && typeof btn[key].onClick === 'function') {
                try {
                  btn[key].onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: new MouseEvent('click', { bubbles: true }) });
                  reactClicked = true;
                } catch(e) {}
              }
              if (!reactClicked) {
                btn.click();
              }
              console.log('[SapoFBExt] Đã bấm nút Facebook Messenger.');
            } else if (attempts > 12) {
              clearInterval(timer);
            }
          }, 300);
        }
      }).catch(err => console.error("Lỗi executeScript click FB:", err));
    }
    return;
  }

  if (msg.action === 'openGeminiPopup') {
    const sapoUrl = sender.tab ? sender.tab.url : null;
    const sapoTabId = sender.tab ? sender.tab.id : null;
    const sapoWindowId = sender.tab ? sender.tab.windowId : null;
    const conversationId = msg.conversationId || 'default';

    if (!sapoUrl) return;

    // Đọc settings rồi mới mở popup (dùng callback trực tiếp — không dùng Promise để tránh SW tắt)
    chrome.storage.sync.get(DEFAULTS, (settings) => {
      chrome.storage.session.get('geminiSessions', (data) => {
        let sessions = data.geminiSessions || {};
        let existingSession = sessions[conversationId];
        
        let options = {
          url: settings.geminiUrl,
          type: 'popup',
          width: settings.geminiWidth,
          height: settings.geminiHeight
        };

        const openOrFocusGemini = () => {
          if (existingSession && existingSession.windowId) {
            chrome.windows.get(existingSession.windowId, (win) => {
              if (chrome.runtime.lastError || !win) {
                chrome.windows.create(options, (newWin) => {
                  if (chrome.runtime.lastError || !newWin) {
                    console.error('[SapoFBExt v19] Lỗi mở Gemini:', chrome.runtime.lastError);
                    return;
                  }
                  sessions[conversationId] = { windowId: newWin.id, tabId: sapoTabId, sapoWindowId: sapoWindowId, url: sapoUrl };
                  chrome.storage.session.set({ geminiSessions: sessions });
                });
              } else {
                chrome.windows.update(existingSession.windowId, { focused: true, drawAttention: true });
              }
            });
          } else {
            chrome.windows.create(options, (newWin) => {
              if (chrome.runtime.lastError || !newWin) {
                console.error('[SapoFBExt v19] Lỗi mở Gemini:', chrome.runtime.lastError);
                return;
              }
              sessions[conversationId] = { windowId: newWin.id, tabId: sapoTabId, sapoWindowId: sapoWindowId, url: sapoUrl };
              chrome.storage.session.set({ geminiSessions: sessions });
            });
          }
        };

        if (sender.tab && sender.tab.windowId) {
          chrome.windows.get(sender.tab.windowId, (win) => {
            if (win && win.left !== undefined && win.top !== undefined) {
               options.left = Math.round(win.left + (win.width / 2) - Math.round(settings.geminiWidth / 2));
               options.top = Math.round(win.top + 50);
            }
            openOrFocusGemini();
          });
        } else {
          openOrFocusGemini();
        }
      });
    });
  }

  // === NEW: OPEN CLAUDE DIRECTLY ===
  if (msg.action === 'openClaudeDirectPopup') {
    const sapoUrl = sender.tab ? sender.tab.url : null;
    const sapoTabId = sender.tab ? sender.tab.id : null;
    const sapoWindowId = sender.tab ? sender.tab.windowId : null;
    const conversationId = msg.conversationId || 'default';

    if (!sapoUrl) return;

    chrome.storage.sync.get(DEFAULTS, (settings) => {
      chrome.storage.session.get('claudeSessions', (data) => {
        let sessions = data.claudeSessions || {};
        let existingSession = sessions[conversationId];
        
        let options = {
          url: settings.claudeUrl,
          type: 'popup',
          width: settings.claudeWidth,
          height: settings.claudeHeight
        };

        const openOrFocusClaude = () => {
          if (existingSession && existingSession.windowId) {
            chrome.windows.get(existingSession.windowId, (win) => {
              if (chrome.runtime.lastError || !win) {
                chrome.windows.create(options, (newWin) => {
                  if (chrome.runtime.lastError || !newWin) return;
                  sessions[conversationId] = { windowId: newWin.id, tabId: sapoTabId, sapoWindowId: sapoWindowId, url: sapoUrl };
                  chrome.storage.session.set({ claudeSessions: sessions });
                });
              } else {
                chrome.windows.update(existingSession.windowId, { focused: true, drawAttention: true });
              }
            });
          } else {
            chrome.windows.create(options, (newWin) => {
              if (chrome.runtime.lastError || !newWin) return;
              sessions[conversationId] = { windowId: newWin.id, tabId: sapoTabId, sapoWindowId: sapoWindowId, url: sapoUrl };
              chrome.storage.session.set({ claudeSessions: sessions });
            });
          }
        };

        if (sender.tab && sender.tab.windowId) {
          chrome.windows.get(sender.tab.windowId, (win) => {
            if (win && win.left !== undefined && win.top !== undefined) {
               options.left = Math.round(win.left + (win.width / 2) - Math.round(settings.claudeWidth / 2));
               options.top = Math.round(win.top + 50);
            }
            openOrFocusClaude();
          });
        } else {
          openOrFocusClaude();
        }
      });
    });
  }
});

// === WINDOW CLOSE HANDLER ===
chrome.windows.onRemoved.addListener(async function(windowId) {
  // 0. Xử lý cho FB Business Popup
  const popupWindows = await getPopupWindows();
  const allPopupIds = Object.values(popupWindows).map(d => d.windowId);
  if (allPopupIds.includes(windowId)) {
    const removedData = await removePopupWindowByWindowId(windowId);
    console.log('[SapoFBExt v19] Business Popup closed:', windowId);
    
    chrome.tabs.query({ url: '*://*.mysapo.net/*' }, function(tabs) {
      if (tabs && tabs.length > 0) {
        const sapoTab = tabs[0];
        chrome.windows.update(sapoTab.windowId, { focused: true }).catch(() => {});
        chrome.tabs.update(sapoTab.id, { active: true }).catch(() => {});

        if (removedData && removedData.sapoUrl && sapoTab.url !== removedData.sapoUrl) {
          chrome.scripting.executeScript({
            target: { tabId: sapoTab.id },
            func: (targetUrl) => {
              try {
                const path = new URL(targetUrl).pathname + new URL(targetUrl).search;
                const link = document.querySelector(`a[href="${path}"], a[href$="${path}"]`);
                if (link) {
                  link.click();
                } else {
                  window.history.pushState(null, '', targetUrl);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  setTimeout(() => {
                    if (window.location.href !== targetUrl) {
                       window.location.href = targetUrl;
                    }
                  }, 100);
                }
              } catch(e) {
                window.location.href = targetUrl;
              }
            },
            args: [removedData.sapoUrl]
          }).catch(err => console.error("Lỗi restore URL", err));
        }
      }
    });
    return; // Đã xử lý FB Business
  }

  // 1. Xử lý cho Gemini Popup Multi-Session
  const sessionData = await chrome.storage.session.get(['geminiSessions']);
  let sessions = sessionData.geminiSessions || {};
  let context = null;
  let closedKey = null;

  for (let key in sessions) {
      if (sessions[key].windowId === windowId) {
          closedKey = key;
          context = sessions[key];
          break;
      }
  }

  if (context) {
    console.log('[SapoFBExt v19] Gemini Popup closed for:', closedKey);
    delete sessions[closedKey];
    await chrome.storage.session.set({ geminiSessions: sessions });
    
    // Đọc settings để lấy Claude URL + size, rồi mở popup Claude
    chrome.storage.sync.get(DEFAULTS, (settings) => {
      chrome.storage.session.get('claudeSessions', (data) => {
      let claudeSessions = data.claudeSessions || {};
      let existingClaude = claudeSessions[closedKey];

      const createNewClaudePopup = () => {
        let options = {
          url: settings.claudeUrl,
          type: 'popup',
          width: settings.claudeWidth,
          height: settings.claudeHeight
        };
        
        chrome.windows.get(context.sapoWindowId, (sapoWin) => {
          if (!chrome.runtime.lastError && sapoWin && sapoWin.left !== undefined && sapoWin.top !== undefined) {
             options.left = Math.round(sapoWin.left + (sapoWin.width / 2) - Math.round(settings.claudeWidth / 2));
             options.top = Math.round(sapoWin.top + 50);
          }
          
          chrome.windows.create(options, (newWin) => {
            if (chrome.runtime.lastError || !newWin) {
              console.error('[SapoFBExt v18] Lỗi mở Claude popup:', chrome.runtime.lastError);
              // Fallback: quay về Sapo nếu không mở được Claude
              if (context.tabId) {
                chrome.windows.update(context.sapoWindowId, { focused: true }).catch(() => {});
                chrome.tabs.update(context.tabId, { active: true }).catch(() => {});
              }
              return;
            }
            claudeSessions[closedKey] = {
               windowId: newWin.id, 
               tabId: context.tabId, 
               sapoWindowId: context.sapoWindowId, 
               url: context.url 
            };
            chrome.storage.session.set({ claudeSessions: claudeSessions });
          });
        });
      };

      // Kiểm tra nếu đã có Claude popup cho URL này → focus thay vì mở mới
      if (existingClaude && existingClaude.windowId) {
        chrome.windows.get(existingClaude.windowId, (win) => {
          if (!chrome.runtime.lastError && win) {
            // Claude popup đã tồn tại → focus vào nó
            chrome.windows.update(existingClaude.windowId, { focused: true, drawAttention: true });
          } else {
            // Window không còn → tạo mới
            createNewClaudePopup();
          }
        });
      } else {
        createNewClaudePopup();
      }
      }); // close chrome.storage.session.get('claudeSessions')
    }); // close chrome.storage.sync.get(DEFAULTS)
    return; // Đã xử lý Gemini → không cần check Claude bên dưới
  }

  // 2. Xử lý cho Claude Popup Multi-Session
  const claudeData = await chrome.storage.session.get(['claudeSessions']);
  let claudeSessions = claudeData.claudeSessions || {};
  let claudeContext = null;
  let closedClaudeKey = null;

  for (let key in claudeSessions) {
      if (claudeSessions[key].windowId === windowId) {
          closedClaudeKey = key;
          claudeContext = claudeSessions[key];
          break;
      }
  }

  if (claudeContext) {
    console.log('[SapoFBExt v19] Claude Popup closed for:', closedClaudeKey);
    delete claudeSessions[closedClaudeKey];
    await chrome.storage.session.set({ claudeSessions: claudeSessions });
    
    if (claudeContext.tabId) {
      // Focus Sapo Window & Tab
      chrome.windows.update(claudeContext.sapoWindowId, { focused: true }).catch(() => {});
      chrome.tabs.update(claudeContext.tabId, { active: true }).catch(() => {});
      
      // Khôi phục URL hội thoại Sapo, chờ load và click FB Messenger
      chrome.scripting.executeScript({
        target: { tabId: claudeContext.tabId }, // Chỉ chạy ở Top Frame
        args: [claudeContext.url],
        func: (targetUrl) => {
          if (targetUrl && window.location.href !== targetUrl) {
            try {
              const path = new URL(targetUrl).pathname + new URL(targetUrl).search;
              const link = document.querySelector(`a[href="${path}"], a[href$="${path}"]`);
              if (link) {
                link.click();
              } else {
                window.history.pushState(null, '', targetUrl);
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
              return true; // Trả về true báo hiệu có chuyển tab
            } catch(e) {}
          }
          return false; // Không chuyển tab
        }
      }).then((results) => {
         let didNavigate = results && results[0] && results[0].result;
         
         // Đợi 2 giây nếu có chuyển tab (để Sapo hủy Iframe cũ và tạo Iframe mới)
         // Nếu không chuyển tab, chỉ đợi 300ms cho an toàn
         let waitTime = didNavigate ? 2000 : 300;
         
         setTimeout(() => {
            // Inject script vào TẤT CẢ iframe để tìm và bấm nút Facebook
            chrome.scripting.executeScript({
              target: { tabId: claudeContext.tabId, allFrames: true },
              world: "MAIN",
              func: () => {
                let attempts = 0;
                let timer = setInterval(() => {
                  attempts++;
                  // Chỉ tìm nút đang hiển thị thực sự
                  let btns = document.querySelectorAll('span.direct-messenger-fb');
                  let btn = Array.from(btns).find(b => b.offsetWidth > 0 && b.offsetHeight > 0); 
                  
                  if (btn) {
                     clearInterval(timer); // Tắt loop ngay lập tức
                     try {
                       if (window.top && window.top.__saFbClickLock && Date.now() - window.top.__saFbClickLock < 2500) return;
                       if (window.top) window.top.__saFbClickLock = Date.now();
                     } catch(e) {
                       if (window.__saFbClickLock && Date.now() - window.__saFbClickLock < 2500) return;
                       window.__saFbClickLock = Date.now();
                     }
                     btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                     
                     // Kích hoạt React onClick
                     const key = Object.keys(btn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                     let reactClicked = false;
                     if (key && btn[key] && typeof btn[key].onClick === 'function') {
                       try { 
                         btn[key].onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: new MouseEvent('click', { bubbles: true }) }); 
                         reactClicked = true;
                       } catch(e) {}
                     }
                     // Dự phòng Native click
                     if (!reactClicked) {
                       btn.click();
                     }
                     console.log('[SapoFBExt] Đã ra lệnh CLICK FB sau khi đợi load.');
                  } else if (attempts > 15) { 
                     // Quá 7.5 giây không thấy nút thì bỏ cuộc
                     clearInterval(timer);
                  }
                }, 500);
              }
            }).catch(err => console.error("Lỗi executeScript click FB:", err));
         }, waitTime);
      }).catch(err => console.error("Lỗi executeScript khôi phục URL Sapo:", err));
    }
  }
});
