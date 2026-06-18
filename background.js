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

  async function openPopupWindow(fbUrl, sapoTab) {
    const threadKey = getThreadKey(fbUrl);
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

// Chạy cleanup khi extension được install/reload hoặc browser khởi động
chrome.runtime.onInstalled.addListener(() => cleanupStaleSessions());
chrome.runtime.onStartup.addListener(() => cleanupStaleSessions());

// === MESSAGE HANDLER ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Đóng popup business khi nhận được lệnh closePopup từ fb-content.js
  if (msg.action === 'closePopup' && sender.tab && sender.tab.windowId) {
    chrome.windows.remove(sender.tab.windowId).catch(() => {});
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
                     btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                     
                     // Kích hoạt React onClick
                     const key = Object.keys(btn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                     if (key && btn[key] && typeof btn[key].onClick === 'function') {
                       try { btn[key].onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: new MouseEvent('click', { bubbles: true }) }); } catch(e) {}
                     }
                     // Dự phòng Native click
                     btn.click();
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
