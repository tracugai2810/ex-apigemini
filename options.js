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
  syncSheetUrl:    '',
  gasBankingUrl:   '',
  glmApiKey:       '',
  glmModel:        'glm-4.7-flash',
  glmCustomModel:  '',
  customAiBaseUrl: 'https://openrouter.ai/api/v1',
  customAiApiKey:  '',
  customAiModel:   'z-ai/glm-5.2:free',
  customAiProfiles: [
    {
      id: 'prof_openrouter_glm52',
      label: 'OpenRouter — z-ai/glm-5.2:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'z-ai/glm-5.2:free'
    }
  ],
  customAiSelectedProfileId: 'prof_openrouter_glm52',
  queProvider:     'gemini',
  chuProvider:     'glm'
};

const ids = Object.keys(DEFAULTS);
const els = {};
ids.forEach(id => { els[id] = document.getElementById(id); });

const statusEl = document.getElementById('status');
function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.opacity = '1';
  setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
}

function updateCustomModelVisibility() {
  const modelSelect = els.geminiModel;
  const customGroup = document.getElementById('customModelGroup');
  if (modelSelect && customGroup) {
    if (modelSelect.value === 'custom') {
      customGroup.style.display = 'block';
    } else {
      customGroup.style.display = 'none';
    }
  }
}

function updateGlmCustomModelVisibility() {
  const glmSelect = els.glmModel;
  const glmCustomGroup = document.getElementById('glmCustomModelGroup');
  if (glmSelect && glmCustomGroup) {
    if (glmSelect.value === 'custom') {
      glmCustomGroup.style.display = 'block';
    } else {
      glmCustomGroup.style.display = 'none';
    }
  }
}

let currentProfiles = [
  {
    id: 'prof_openrouter_glm52',
    label: 'OpenRouter — z-ai/glm-5.2:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'z-ai/glm-5.2:free'
  }
];
let activeProfileId = 'prof_openrouter_glm52';

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

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (data) => {
    ids.forEach(id => {
      if (!els[id]) return;
      if (els[id].type === 'checkbox') els[id].checked = data[id];
      else els[id].value = data[id];
    });

    // Fallback thông minh cho chuProvider nếu trước đó từng chọn queProvider
    if (els.chuProvider) {
      els.chuProvider.value = data.chuProvider || (data.queProvider === 'custom' ? 'custom' : 'glm');
    }

    // Gemini model: detect custom
    const modelSelect = els.geminiModel;
    const customInput = els.geminiCustomModel;
    if (modelSelect && customInput) {
      const isKnownOption = Array.from(modelSelect.options).some(opt => opt.value === data.geminiModel && opt.value !== 'custom');
      if (data.geminiModel && !isKnownOption) {
        modelSelect.value = 'custom';
        customInput.value = data.geminiModel;
      } else if (modelSelect.value === 'custom') {
        customInput.value = data.geminiCustomModel || '';
      }
    }
    updateCustomModelVisibility();

    // GLM model: detect custom
    const glmSelect = els.glmModel;
    const glmCustomInput = els.glmCustomModel;
    if (glmSelect && glmCustomInput) {
      const isKnownGlm = Array.from(glmSelect.options).some(opt => opt.value === data.glmModel && opt.value !== 'custom');
      if (data.glmModel && !isKnownGlm) {
        glmSelect.value = 'custom';
        glmCustomInput.value = data.glmModel;
      } else if (glmSelect.value === 'custom') {
        glmCustomInput.value = data.glmCustomModel || '';
      }
    }
    updateGlmCustomModelVisibility();

    // Model Trung gian: Nạp danh sách Profiles (Bộ URL + Key + Model)
    let profiles = data.customAiProfiles;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      profiles = [{
        id: 'prof_default',
        label: makeProfileLabel(data.customAiBaseUrl || 'https://openrouter.ai/api/v1', data.customAiModel || 'z-ai/glm-5.2:free'),
        baseUrl: data.customAiBaseUrl || 'https://openrouter.ai/api/v1',
        apiKey: data.customAiApiKey || '',
        model: data.customAiModel || 'z-ai/glm-5.2:free'
      }];
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

  let selectedModel = els.geminiModel ? els.geminiModel.value : 'gemini-3.7-flash';
  const customModelVal = els.geminiCustomModel ? els.geminiCustomModel.value.trim() : '';

  if (selectedModel === 'custom') {
    if (!customModelVal) {
      showStatus('❌ Vui lòng nhập tên model tùy chỉnh!');
      return;
    }
    selectedModel = customModelVal;
  }

  // Validate provider luận quẻ cho nút Chữ
  const chuProviderVal = els.chuProvider ? els.chuProvider.value : 'glm';
  const glmApiKeyVal = (els.glmApiKey ? els.glmApiKey.value : '').trim();
  const glmCustomModelVal = els.glmCustomModel ? els.glmCustomModel.value.trim() : '';
  let selectedGlmModel = els.glmModel ? els.glmModel.value : 'glm-4.7-flash';
  if (selectedGlmModel === 'custom') {
    if (chuProviderVal === 'glm' && !glmCustomModelVal) {
      showStatus('❌ Vui lòng nhập tên model GLM tùy chỉnh!');
      return;
    }
    selectedGlmModel = glmCustomModelVal || 'glm-4.7-flash';
  }

  const customAiBaseUrlVal = (els.customAiBaseUrl ? els.customAiBaseUrl.value : '').trim();
  const customAiApiKeyVal = (els.customAiApiKey ? els.customAiApiKey.value : '').trim();
  const customAiModelVal = (els.customAiModel ? els.customAiModel.value : '').trim();

  if (customAiBaseUrlVal && !customAiBaseUrlVal.startsWith('https://')) {
    showStatus('❌ Base URL Model Trung gian phải bắt đầu bằng https://');
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
    geminiCustomModel: customModelVal,
    syncSheetUrl: (els.syncSheetUrl ? els.syncSheetUrl.value.trim() : ''),
    gasBankingUrl: (els.gasBankingUrl ? els.gasBankingUrl.value.trim() : ''),
    glmApiKey: glmApiKeyVal,
    glmModel: selectedGlmModel,
    glmCustomModel: glmCustomModelVal,
    customAiBaseUrl: customAiBaseUrlVal,
    customAiApiKey: customAiApiKeyVal,
    customAiModel: customAiModelVal,
    customAiProfiles: currentProfiles,
    customAiSelectedProfileId: activeProfileId,
    queProvider: 'gemini',
    chuProvider: chuProviderVal
  }, () => showStatus('✅ Đã lưu thành công!'));
}

function resetSettings() {
  chrome.storage.sync.set(DEFAULTS, () => { loadSettings(); showStatus('↩ Đã khôi phục mặc định'); });
}

if (els.geminiModel) {
  els.geminiModel.addEventListener('change', updateCustomModelVisibility);
}
if (els.glmModel) {
  els.glmModel.addEventListener('change', updateGlmCustomModelVisibility);
}

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

document.getElementById('btnSave').addEventListener('click', saveSettings);
document.getElementById('btnReset').addEventListener('click', resetSettings);
loadSettings();

