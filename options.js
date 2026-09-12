// options.js — Load/Save settings
const DEFAULTS = {
  geminiUrl:       'https://gemini.google.com/gem/4368ce08961a',
  geminiWidth:     950,
  geminiHeight:    700,
  claudeUrl:       'https://claude.ai/project/019e2adc-2890-7738-9366-85a2977bf2f4',
  claudeWidth:     950,
  claudeHeight:    700,
  businessWidth:   1150,
  businessHeight:  600,
  luchaoUrl:       'https://dshc-luc-hao.vercel.app/',
  geminiApiKey:    '',
  geminiModel:     'gemini-3.7-flash',
  geminiCustomModel: '',
  customGeminiModels: [],
  hiddenBuiltinModels: [],
  syncSheetUrl:    '',
  gasBankingUrl:   '',
  customAiBaseUrl: 'https://api.z.ai/api/paas/v4',
  customAiApiKey:  '',
  customAiModel:   'glm-4.7-flash',
  customAiProfiles: [
    {
      id: 'prof_zai_glm',
      label: 'Z.AI — GLM-4.7-Flash',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: '',
      model: 'glm-4.7-flash'
    },
    {
      id: 'prof_openrouter_glm52',
      label: 'OpenRouter — z-ai/glm-5.2:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'z-ai/glm-5.2:free'
    }
  ],
  customAiSelectedProfileId: 'prof_zai_glm',
  queProvider:     'gemini'
};

// Danh sách model Gemini mặc định (built-in) — giữ nguyên thứ tự
const BUILTIN_MODELS = [
  { value: 'gemini-3.7-flash', label: '🌟 Gemini 3.7 Flash — Mới nhất' },
  { value: 'gemini-3.5-flash-lite', label: '🏆 Gemini 3.5 Flash Lite — 500 lượt/ngày' },
  { value: 'gemini-3.1-flash-lite', label: '🏆 Gemini 3.1 Flash Lite — 500 lượt/ngày' },
  { value: 'gemini-3.6-flash', label: '⚡ Gemini 3.6 Flash — 20 lượt/ngày' },
  { value: 'gemini-3.5-flash', label: '🔵 Gemini 3.5 Flash — 20 lượt/ngày' },
  { value: 'gemini-3-flash', label: '🟢 Gemini 3 Flash — 20 lượt/ngày' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ Gemini 2.5 Flash Lite — 20 lượt/ngày' },
  { value: 'gemini-2.5-flash', label: '🔷 Gemini 2.5 Flash — 20 lượt/ngày' },
];

let customGeminiModels = [];
let hiddenBuiltinModels = [];

const ids = Object.keys(DEFAULTS);
const els = {};
ids.forEach(id => { els[id] = document.getElementById(id); });

const statusEl = document.getElementById('status');
function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.opacity = '1';
  setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
}

// ============================
// === Model Dropdown Logic ===
// ============================

function getVisibleModels() {
  const visibleBuiltIn = BUILTIN_MODELS.filter(m => !hiddenBuiltinModels.includes(m.value));
  return [...visibleBuiltIn, ...customGeminiModels];
}

function findModelLabel(value) {
  const allModels = [...BUILTIN_MODELS, ...customGeminiModels];
  const found = allModels.find(m => m.value === value);
  return found ? found.label : value;
}

function renderModelDropdown(selectedValue) {
  const listEl = document.getElementById('modelDropdownList');
  const labelEl = document.getElementById('modelDropdownLabel');
  if (!listEl || !labelEl) return;

  // Xóa items cũ (giữ lại .model-add-row ở cuối)
  listEl.querySelectorAll('.model-dropdown-item').forEach(el => el.remove());

  const addRow = listEl.querySelector('.model-add-row');
  const allModels = getVisibleModels();

  allModels.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-dropdown-item' + (m.value === selectedValue ? ' selected' : '');
    item.dataset.value = m.value;

    const label = document.createElement('span');
    label.className = 'model-item-label';
    label.textContent = m.label;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'model-delete-btn';
    deleteBtn.title = 'Xóa model này';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteModel(m.value);
    });

    item.appendChild(label);
    item.appendChild(deleteBtn);
    item.addEventListener('click', () => selectModel(m.value, m.label));

    listEl.insertBefore(item, addRow);
  });

  // Cập nhật label trên toggle button
  labelEl.textContent = findModelLabel(selectedValue);
}

function selectModel(value, label) {
  els.geminiModel.value = value;
  const labelEl = document.getElementById('modelDropdownLabel');
  if (labelEl) labelEl.textContent = label;
  const listEl = document.getElementById('modelDropdownList');
  if (listEl) listEl.style.display = 'none';
  renderModelDropdown(value);
}

function deleteModel(value) {
  const allModels = getVisibleModels();

  if (allModels.length <= 1) {
    showStatus('❌ Cần giữ lại ít nhất 1 model!');
    return;
  }

  const isBuiltIn = BUILTIN_MODELS.some(m => m.value === value);
  if (isBuiltIn) {
    if (!hiddenBuiltinModels.includes(value)) {
      hiddenBuiltinModels.push(value);
    }
  } else {
    customGeminiModels = customGeminiModels.filter(m => m.value !== value);
  }

  // Nếu model bị xóa đang được chọn → chuyển sang model đầu tiên còn lại
  let currentSelected = els.geminiModel.value;
  if (currentSelected === value) {
    const remaining = getVisibleModels();
    if (remaining.length > 0) {
      currentSelected = remaining[0].value;
      els.geminiModel.value = currentSelected;
    }
  }

  // Lưu ngay vào storage (đồng bộ qua Google Account)
  chrome.storage.sync.set({
    customGeminiModels: customGeminiModels,
    hiddenBuiltinModels: hiddenBuiltinModels,
    geminiModel: currentSelected
  }, () => showStatus('🗑️ Đã xóa model'));

  renderModelDropdown(currentSelected);
}

function addCustomModel() {
  const input = document.getElementById('addCustomModelInput');
  if (!input) return;
  const modelName = input.value.trim();

  if (!modelName) {
    showStatus('❌ Vui lòng nhập tên model!');
    return;
  }

  // Kiểm tra trùng lặp
  const isBuiltIn = BUILTIN_MODELS.some(m => m.value === modelName);
  const isCustomExists = customGeminiModels.some(m => m.value === modelName);

  if (isBuiltIn) {
    // Nếu là model built-in bị ẩn → bỏ ẩn
    hiddenBuiltinModels = hiddenBuiltinModels.filter(v => v !== modelName);
  } else if (!isCustomExists) {
    // Thêm model mới vào danh sách custom
    customGeminiModels.push({ value: modelName, label: '✏️ ' + modelName });
  } else {
    // Model đã tồn tại → chỉ chọn nó
    showStatus('⚠️ Model này đã tồn tại trong danh sách!');
    selectModel(modelName, findModelLabel(modelName));
    input.value = '';
    return;
  }

  // Chọn model vừa thêm
  els.geminiModel.value = modelName;
  input.value = '';

  // Lưu vào storage (đồng bộ qua Google Account)
  chrome.storage.sync.set({
    customGeminiModels: customGeminiModels,
    hiddenBuiltinModels: hiddenBuiltinModels,
    geminiModel: modelName
  }, () => showStatus('✅ Đã thêm model: ' + modelName));

  renderModelDropdown(modelName);
}

// ================================
// === Profile Functions (giữ nguyên) ===
// ================================

let currentProfiles = [
  {
    id: 'prof_zai_glm',
    label: 'Z.AI — GLM-4.7-Flash',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiKey: '',
    model: 'glm-4.7-flash'
  },
  {
    id: 'prof_openrouter_glm52',
    label: 'OpenRouter — z-ai/glm-5.2:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'z-ai/glm-5.2:free'
  }
];
let activeProfileId = 'prof_zai_glm';

function getProviderNameFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^api\./, '').replace(/\.(com|ai|cn|org|net)$/, '');
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch(e) {
    return 'Custom';
  }
}

function makeProfileLabel(baseUrl, model) {
  const prov = getProviderNameFromUrl(baseUrl);
  return `${prov} — ${model || 'model'}`;
}

function renderProfileSelect(profiles, selectedId) {
  const sel = document.getElementById('customProfileSelect');
  if (!sel) return;
  sel.innerHTML = '';

  const list = (Array.isArray(profiles) && profiles.length > 0) ? profiles : currentProfiles;
  list.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label || `${p.baseUrl} (${p.model})`;
    sel.appendChild(opt);
  });

  if (selectedId && list.some(p => p.id === selectedId)) {
    sel.value = selectedId;
  } else if (list.length > 0) {
    sel.value = list[0].id;
  }
}

function applyProfileToForm(profile) {
  if (!profile) return;
  if (els.customAiBaseUrl) els.customAiBaseUrl.value = profile.baseUrl || '';
  if (els.customAiApiKey) els.customAiApiKey.value = profile.apiKey || '';
  if (els.customAiModel) els.customAiModel.value = profile.model || '';
}

// ============================
// === Load / Save Settings ===
// ============================

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (data) => {
    ids.forEach(id => {
      if (!els[id]) return;
      if (els[id].type === 'checkbox') els[id].checked = data[id];
      else els[id].value = data[id];
    });

    // === Gemini Model Dropdown ===
    // Backward compat: nếu geminiModel cũ là 'custom', dùng geminiCustomModel làm model thực
    let currentModel = data.geminiModel || 'gemini-3.7-flash';
    if (currentModel === 'custom' && data.geminiCustomModel) {
      currentModel = data.geminiCustomModel;
    }

    // Load danh sách custom models và hidden built-in models từ storage
    customGeminiModels = Array.isArray(data.customGeminiModels) ? [...data.customGeminiModels] : [];
    hiddenBuiltinModels = Array.isArray(data.hiddenBuiltinModels) ? [...data.hiddenBuiltinModels] : [];

    // Nếu model hiện tại không nằm trong bất kỳ danh sách nào → tự động thêm vào custom
    const isBuiltIn = BUILTIN_MODELS.some(m => m.value === currentModel);
    const isCustom = customGeminiModels.some(m => m.value === currentModel);
    if (!isBuiltIn && !isCustom && currentModel) {
      customGeminiModels.push({ value: currentModel, label: '✏️ ' + currentModel });
    }

    // Nếu model hiện tại là built-in nhưng bị ẩn → tự bỏ ẩn (vì đang dùng)
    if (isBuiltIn && hiddenBuiltinModels.includes(currentModel)) {
      hiddenBuiltinModels = hiddenBuiltinModels.filter(v => v !== currentModel);
    }

    // Cập nhật hidden input value
    els.geminiModel.value = currentModel;

    // Render custom dropdown
    renderModelDropdown(currentModel);

    // === Model Phụ: Nạp danh sách Profiles (Bộ URL + Key + Model) ===
    let profiles = data.customAiProfiles;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      profiles = [
        {
          id: 'prof_zai_glm',
          label: 'Z.AI — GLM-4.7-Flash',
          baseUrl: 'https://api.z.ai/api/paas/v4',
          apiKey: data.glmApiKey || '',
          model: data.glmModel || 'glm-4.7-flash'
        },
        {
          id: 'prof_openrouter_glm52',
          label: 'OpenRouter — z-ai/glm-5.2:free',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: '',
          model: 'z-ai/glm-5.2:free'
        }
      ];
    } else {
      // Tự động chuyển giao key cũ của GLM sang profile Z.AI nếu có
      if (data.glmApiKey) {
        const zaiProf = profiles.find(p => p.baseUrl && p.baseUrl.includes('z.ai'));
        if (zaiProf && !zaiProf.apiKey) {
          zaiProf.apiKey = data.glmApiKey;
        }
      }
    }
    currentProfiles = profiles;
    activeProfileId = data.customAiSelectedProfileId || profiles[0].id;
    renderProfileSelect(currentProfiles, activeProfileId);

    const activeProf = currentProfiles.find(p => p.id === activeProfileId) || currentProfiles[0];
    applyProfileToForm(activeProf);
  });
}

function saveSettings() {
  const gUrl = els.geminiUrl.value.trim();
  const cUrl = els.claudeUrl.value.trim();
  const lUrl = els.luchaoUrl.value.trim();
  if (!gUrl.startsWith('https://')) { showStatus('❌ Gemini URL phải bắt đầu bằng https://'); return; }
  if (!cUrl.startsWith('https://')) { showStatus('❌ Claude URL phải bắt đầu bằng https://'); return; }
  if (!lUrl.startsWith('https://')) { showStatus('❌ URL Lập Quẻ phải bắt đầu bằng https://'); return; }

  const gW = parseInt(els.geminiWidth.value) || DEFAULTS.geminiWidth;
  const gH = parseInt(els.geminiHeight.value) || DEFAULTS.geminiHeight;
  const cW = parseInt(els.claudeWidth.value) || DEFAULTS.claudeWidth;
  const cH = parseInt(els.claudeHeight.value) || DEFAULTS.claudeHeight;
  const bW = parseInt(els.businessWidth.value) || DEFAULTS.businessWidth;
  const bH = parseInt(els.businessHeight.value) || DEFAULTS.businessHeight;

  if (gW < 400 || gH < 300 || cW < 400 || cH < 300 || bW < 400 || bH < 300) { showStatus('❌ Kích thước tối thiểu: 400×300'); return; }

  // geminiModel giờ là hidden input, luôn chứa tên model thật (VD: "gemini-3.7-flash")
  const selectedModel = els.geminiModel ? els.geminiModel.value : 'gemini-3.7-flash';

  const customAiBaseUrlVal = (els.customAiBaseUrl ? els.customAiBaseUrl.value : '').trim();
  const customAiApiKeyVal = (els.customAiApiKey ? els.customAiApiKey.value : '').trim();
  const customAiModelVal = (els.customAiModel ? els.customAiModel.value : '').trim();

  if (customAiBaseUrlVal && !customAiBaseUrlVal.startsWith('https://')) {
    showStatus('❌ Base URL Model Phụ phải bắt đầu bằng https://');
    return;
  }

  // Cập nhật thông tin profile đang chọn
  const activeProfIndex = currentProfiles.findIndex(p => p.id === activeProfileId);
  if (activeProfIndex >= 0) {
    currentProfiles[activeProfIndex].baseUrl = customAiBaseUrlVal;
    currentProfiles[activeProfIndex].apiKey = customAiApiKeyVal;
    currentProfiles[activeProfIndex].model = customAiModelVal;
    currentProfiles[activeProfIndex].label = makeProfileLabel(customAiBaseUrlVal, customAiModelVal);
  }
  renderProfileSelect(currentProfiles, activeProfileId);

  chrome.storage.sync.set({
    geminiUrl: gUrl, geminiWidth: gW, geminiHeight: gH,
    claudeUrl: cUrl, claudeWidth: cW, claudeHeight: cH,
    businessWidth: bW, businessHeight: bH,
    luchaoUrl: lUrl,
    geminiApiKey: (els.geminiApiKey.value || '').trim(),
    geminiModel: selectedModel,
    geminiCustomModel: '',
    customGeminiModels: customGeminiModels,
    hiddenBuiltinModels: hiddenBuiltinModels,
    syncSheetUrl: (els.syncSheetUrl ? els.syncSheetUrl.value.trim() : ''),
    gasBankingUrl: (els.gasBankingUrl ? els.gasBankingUrl.value.trim() : ''),
    customAiBaseUrl: customAiBaseUrlVal,
    customAiApiKey: customAiApiKeyVal,
    customAiModel: customAiModelVal,
    customAiProfiles: currentProfiles,
    customAiSelectedProfileId: activeProfileId,
    queProvider: 'gemini'
  }, () => showStatus('✅ Đã lưu thành công!'));
}

function resetSettings() {
  chrome.storage.sync.set(DEFAULTS, () => { loadSettings(); showStatus('↩ Đã khôi phục mặc định'); });
}

// =====================================
// === Event Listeners: Model Dropdown ===
// =====================================

// Toggle dropdown mở/đóng
const modelToggleEl = document.getElementById('modelDropdownToggle');
if (modelToggleEl) {
  modelToggleEl.addEventListener('click', () => {
    const listEl = document.getElementById('modelDropdownList');
    if (listEl) {
      listEl.style.display = listEl.style.display === 'none' ? 'block' : 'none';
    }
  });
}

// Đóng dropdown khi click ra ngoài
document.addEventListener('click', (e) => {
  const container = document.getElementById('modelDropdownContainer');
  const listEl = document.getElementById('modelDropdownList');
  if (container && listEl && !container.contains(e.target)) {
    listEl.style.display = 'none';
  }
});

// Nút ➕ Thêm model
const btnAddModel = document.getElementById('btnAddCustomModel');
if (btnAddModel) {
  btnAddModel.addEventListener('click', addCustomModel);
}

// Enter key trên ô input thêm model
const addModelInput = document.getElementById('addCustomModelInput');
if (addModelInput) {
  addModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomModel();
    }
  });
}

// =========================================
// === Event Listeners: Profile Select ===
// =========================================

// Khi chuyển đổi Cấu hình trong dropdown
const selProfile = document.getElementById('customProfileSelect');
if (selProfile) {
  selProfile.addEventListener('change', () => {
    activeProfileId = selProfile.value;
    const target = currentProfiles.find(p => p.id === activeProfileId);
    if (target) {
      applyProfileToForm(target);
      chrome.storage.sync.set({
        customAiSelectedProfileId: activeProfileId,
        customAiBaseUrl: target.baseUrl || '',
        customAiApiKey: target.apiKey || '',
        customAiModel: target.model || ''
      }, () => showStatus(`Đã chọn: ${target.label}`));
    }
  });
}

// Khi bấm "➕ Lưu thành Cấu hình Mới"
const btnSaveNew = document.getElementById('btnSaveAsNewProfile');
if (btnSaveNew) {
  btnSaveNew.addEventListener('click', () => {
    const bUrl = (els.customAiBaseUrl ? els.customAiBaseUrl.value : '').trim();
    const key = (els.customAiApiKey ? els.customAiApiKey.value : '').trim();
    const mod = (els.customAiModel ? els.customAiModel.value : '').trim();

    if (!bUrl || !bUrl.startsWith('https://')) {
      showStatus('❌ Base URL phải bắt đầu bằng https://');
      return;
    }
    if (!key) {
      showStatus('❌ Vui lòng nhập API Key cho cấu hình này!');
      return;
    }
    if (!mod) {
      showStatus('❌ Vui lòng nhập Tên Model!');
      return;
    }

    const newProf = {
      id: 'prof_' + Date.now(),
      label: makeProfileLabel(bUrl, mod),
      baseUrl: bUrl,
      apiKey: key,
      model: mod
    };

    currentProfiles.push(newProf);
    activeProfileId = newProf.id;
    renderProfileSelect(currentProfiles, activeProfileId);

    chrome.storage.sync.set({
      customAiProfiles: currentProfiles,
      customAiSelectedProfileId: activeProfileId,
      customAiBaseUrl: bUrl,
      customAiApiKey: key,
      customAiModel: mod
    }, () => showStatus(`✅ Đã lưu cấu hình mới: ${newProf.label}`));
  });
}

// Khi bấm nút 🗑️ Xóa cấu hình
const btnDelProfile = document.getElementById('btnDeleteProfile');
if (btnDelProfile) {
  btnDelProfile.addEventListener('click', () => {
    if (currentProfiles.length <= 1) {
      showStatus('❌ Cần giữ lại ít nhất 1 cấu hình trong danh sách!');
      return;
    }

    const toDelete = currentProfiles.find(p => p.id === activeProfileId);
    currentProfiles = currentProfiles.filter(p => p.id !== activeProfileId);
    activeProfileId = currentProfiles[0].id;
    renderProfileSelect(currentProfiles, activeProfileId);
    applyProfileToForm(currentProfiles[0]);

    chrome.storage.sync.set({
      customAiProfiles: currentProfiles,
      customAiSelectedProfileId: activeProfileId,
      customAiBaseUrl: currentProfiles[0].baseUrl || '',
      customAiApiKey: currentProfiles[0].apiKey || '',
      customAiModel: currentProfiles[0].model || ''
    }, () => showStatus(`🗑️ Đã xóa: ${toDelete ? toDelete.label : ''}`));
  });
}

// === Init ===
document.getElementById('btnSave').addEventListener('click', saveSettings);
document.getElementById('btnReset').addEventListener('click', resetSettings);
loadSettings();
