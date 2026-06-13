/**
 * inject.js — Sapo Token & Page Info Interceptor (v3.0 — Bulletproof XHR + SessionStorage)
 * --------------------------------------------------
 * FIX 1: Intercept XHR (Axios) response ngoài fetch. Sapo dùng XHR/Axios nên fetch bị miss.
 * FIX 2: Lưu vào sessionStorage để bypass hoàn toàn lỗi bất đồng bộ của postMessage.
 * --------------------------------------------------
 */
(function() {
    'use strict';

    function extractPageInfo(obj, conversationId) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.page_id) {
            var info = { type: "SAPO_PAGE_INFO", page_id: obj.page_id };
            if (obj.facebook_page_id) info.facebook_page_id = obj.facebook_page_id;
            if (obj.account_id) info.customer_id = obj.account_id;
            if (conversationId) info.conversation_id = conversationId;
            
            // Lưu vào sessionStorage để chống miss message khi F5
            if (conversationId) {
                try {
                    sessionStorage.setItem('sapo_page_' + conversationId, obj.page_id);
                    if (obj.facebook_page_id) {
                        sessionStorage.setItem('sapo_fb_page_' + conversationId, obj.facebook_page_id);
                    }
                    if (obj.account_id) {
                        sessionStorage.setItem('sapo_customer_' + conversationId, obj.account_id);
                    }
                } catch(e) {}
            }
            window.postMessage(info, "*");
        }
    }

    function getConversationIdFromUrl(url) {
        try {
            var match = url.match(/\/api\/conversations\/([a-f0-9]+)/i);
            return match ? match[1] : null;
        } catch(e) { return null; }
    }

    function saveToken(token) {
        if (token) {
            try { sessionStorage.setItem('sapo_token', token); } catch(e) {}
            window.postMessage({ type: "SAPO_TOKEN", token: token }, "*");
        }
    }

    // === 1. INTERCEPT FETCH ===
    var originalFetch = window.fetch;
    window.fetch = async function() {
        var args = arguments;
        var init = args.length > 1 ? args[1] : undefined;

        if (init && init.headers) {
            try {
                var token = null;
                if (init.headers instanceof Headers) {
                    token = init.headers.get('X-Bizweb-App-Fpage-Token') || init.headers.get('x-bizweb-app-fpage-token');
                } else if (typeof init.headers === 'object') {
                    token = init.headers['X-Bizweb-App-Fpage-Token'] || init.headers['x-bizweb-app-fpage-token'];
                }
                saveToken(token);
            } catch(e) {}
        }

        var response = await originalFetch.apply(this, args);

        try {
            var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            if (url.indexOf('/api/conversations/') !== -1) {
                var convId = getConversationIdFromUrl(url);
                var cloned = response.clone();
                cloned.json().then(function(data) {
                    if (data && typeof data === 'object') {
                        extractPageInfo(data, convId);
                        var keys = Object.keys(data);
                        for (var i = 0; i < keys.length; i++) {
                            var val = data[keys[i]];
                            if (val && typeof val === 'object' && !Array.isArray(val)) {
                                extractPageInfo(val, convId);
                            }
                        }
                    }
                }).catch(function() {});
            }
        } catch(e) {}

        return response;
    };

    // === 2. INTERCEPT XHR (Axios/XMLHttpRequest) ===
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    var origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (name.toLowerCase() === 'x-bizweb-app-fpage-token') {
            saveToken(value);
        }
        return origSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            var url = this._url || '';
            if (url.indexOf('/api/conversations/') !== -1) {
                try {
                    var data = JSON.parse(this.responseText);
                    var convId = getConversationIdFromUrl(url);
                    if (data && typeof data === 'object') {
                        extractPageInfo(data, convId);
                        var keys = Object.keys(data);
                        for (var i = 0; i < keys.length; i++) {
                            var val = data[keys[i]];
                            if (val && typeof val === 'object' && !Array.isArray(val)) {
                                extractPageInfo(val, convId);
                            }
                        }
                    }
                } catch(e) {}
            }
        });
        return origSend.apply(this, arguments);
    };
})();
