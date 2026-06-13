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
  geminiApiKey2:   '',
  geminiApiKey3:   '',
  geminiApiKey4:   '',
  geminiApiKey5:   '',
  geminiModel:     'gemini-3.1-flash-lite'
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

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (data) => {
    ids.forEach(id => {
      if (!els[id]) return;
      if (els[id].type === 'checkbox') els[id].checked = data[id];
      else els[id].value = data[id];
    });
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

  chrome.storage.sync.set({
    geminiUrl: gUrl, geminiWidth: gW, geminiHeight: gH,
    claudeUrl: cUrl, claudeWidth: cW, claudeHeight: cH,
    businessWidth: bW, businessHeight: bH,
    luchaoUrl: lUrl,
    geminiApiKey: (els.geminiApiKey.value || '').trim(),
    geminiApiKey2: (els.geminiApiKey2.value || '').trim(),
    geminiApiKey3: (els.geminiApiKey3.value || '').trim(),
    geminiApiKey4: (els.geminiApiKey4.value || '').trim(),
    geminiApiKey5: (els.geminiApiKey5.value || '').trim(),
    geminiModel: (els.geminiModel ? els.geminiModel.value : 'gemini-3.1-flash-lite')
  }, () => showStatus('✅ Đã lưu thành công!'));
}

function resetSettings() {
  chrome.storage.sync.set(DEFAULTS, () => { loadSettings(); showStatus('↩ Đã khôi phục mặc định'); });
}

document.getElementById('btnSave').addEventListener('click', saveSettings);
document.getElementById('btnReset').addEventListener('click', resetSettings);
loadSettings();
