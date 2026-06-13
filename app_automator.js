(function() {
    "use strict";

    const log = (msg) => {
      console.log("[SA-APP]", msg);
      window.parent.postMessage({ type: "SA_STATUS", payload: msg }, "*");
    };

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const urlParams = new URLSearchParams(window.location.search);
    const serial = urlParams.get('sa_serial') || urlParams.get('serial');
    const mode   = urlParams.get('sa_mode') || 'text';
    const saDate = urlParams.get('sa_date');
    const saHour = urlParams.get('sa_hour');
    const saMin  = urlParams.get('sa_minute');

    if (!serial) return;

    log("Automator v8.2 [DATETIME] - Sẵn sàng!");

    const runFlow = async () => {
      try {
        const isSilent = mode === 'image';
        log("Chờ trang tự động xử lý URL...");

        // THEO DÕI KẾT QUẢ & CUỘN TRUNG ĐÍCH
        // Web đã tự động điền form và ấn submit dựa trên URL param sau 300ms
        let resultsFound = false;
        
        const monitorResult = setInterval(() => {
          const resultImg = document.querySelector('#imageDisplay img, #canvasContainer canvas, canvas');
          const resultSection = document.querySelector('#resultSection');
          const resultCard = document.querySelector('#result-display, .card.result-card');

          if ((resultSection && resultSection.classList.contains('visible')) || resultImg) {
            if (!resultsFound) {
              log("✅ Đã có kết quả!");
              resultsFound = true;

              // CHẾ ĐỘ CHỮ: CUỘN ĐẾN CUỐI KẾT QUẢ (BLOCK: END) ĐỂ HIỆN NÚT BẤM
              if (mode === 'text' && resultCard) {
                log("Đang tối ưu vị trí hiển thị...");
                // Cuộn sao cho phần cuối của khung kết quả (nơi có nút bấm) nằm ở giữa/dưới màn hình
                resultCard.scrollIntoView({ behavior: "smooth", block: "end" });
              }

              // Giải phóng cuộn sau 1.5s
              setTimeout(() => {
                clearInterval(monitorResult); 
                log("Hoàn tất! Bạn có thể tự do xem quẻ.");
              }, 1500);
            }

            // Gửi ảnh về Sapo
            if (resultImg && !state.sent) {
              state.sent = true;
              try {
                let dataUrl = "";
                if (resultImg.tagName === "CANVAS") {
                  dataUrl = resultImg.toDataURL("image/png");
                } else {
                  if (resultImg.naturalWidth < 50 && !resultImg.src.startsWith("data:")) {
                     state.sent = false; 
                     return;
                  }
                  const canvas = document.createElement("canvas");
                  canvas.width = resultImg.naturalWidth || resultImg.width;
                  canvas.height = resultImg.naturalHeight || resultImg.height;
                  const ctx = canvas.getContext("2d");
                  ctx.drawImage(resultImg, 0, 0);
                  dataUrl = canvas.toDataURL("image/png");
                }
                log("📡 Gửi DataURL thành công");
                window.parent.postMessage({ type: "SA_RESULT_READY", payload: dataUrl }, "*");
              } catch (e) {
                log("⚠️ Gửi link gốc (CORS)");
                window.parent.postMessage({ type: "SA_RESULT_READY", payload: resultImg.src || "ready" }, "*");
              }
            }
          }
        }, isSilent ? 600 : 1200);

      } catch (e) {
        log("❌ Lỗi v8.1: " + e.message);
      }
    };

    const state = { sent: false };

    document.addEventListener('click', (e) => {
       const btn = e.target.closest('button, .btn');
       if (btn) {
          const txt = (btn.textContent || "").toLowerCase();
          if (txt.includes("văn bản") || txt.includes("tải ảnh") || txt.includes("van ban")) {
            window.parent.postMessage({ type: "SA_POPUP_CLOSE" }, "*");
          }
       }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFlow);
    } else {
        runFlow();
    }

})();
