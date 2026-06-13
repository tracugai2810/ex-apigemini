// fb-content.js - Chạy trên trang Facebook Business Suite
// Nhiệm vụ: Tự động kéo giao diện sang phần chat và focus vào ô nhập liệu
// Tự động đóng popup sau khi gửi tin nhắn (bằng phím Enter)

let scrolled = false;

function initAutoScroll() {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    
    // Tìm ô nhập text của Facebook (thường có role="textbox" hoặc là thẻ textarea)
    const textBox = document.querySelector('div[role="textbox"]') || document.querySelector('textarea');
    
    if (textBox && !scrolled) {
      scrolled = true;
      
      // Đặt con trỏ vào ô nhập để có thể gõ ngay
      setTimeout(() => {
        textBox.focus();
      }, 500);

      // Lắng nghe sự kiện GỬI (chỉ bắt phím Enter, không bắt Shift+Enter vì đó là xuống dòng)
      textBox.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          scheduleClose();
        }
      });
      
      clearInterval(timer);
    }
    
    // Dừng sau 30 lần thử (khoảng 15 giây) nếu không tìm thấy
    if (attempts > 30) {
      clearInterval(timer);
    }
  }, 500);
}

let closeTimeout;
function scheduleClose() {
  // Đợi 1.5 giây để tin nhắn bay đi rồi mới đóng cửa sổ
  if (closeTimeout) clearTimeout(closeTimeout);
  closeTimeout = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'closePopup' });
  }, 1500);
}

// Bắt đầu chạy khi trang load
initAutoScroll();

// Theo dõi khi URL thay đổi (vì FB là React SPA, có thể load tin nhắn mới mà không tải lại trang)
// Sử dụng setInterval thay cho MutationObserver để tránh lag cực mạnh trên Facebook (do FB DOM thay đổi liên tục)
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scrolled = false;
    initAutoScroll();
  }
}, 1000);

console.log('[SapoFBExt] Auto-scroll and focus script injected!');
