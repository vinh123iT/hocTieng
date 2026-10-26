/*!
 * PinkVocab – store.js
 * Kho dữ liệu duy nhất của website. Mọi màn hình đọc/ghi qua đây nên dữ liệu luôn đồng nhất.
 *  - Lưu ngay vào localStorage của trình duyệt (bản sao, dùng được cả khi mất kết nối).
 *  - Đồng thời gửi lên máy chủ (Api/Data.ashx -> App_Data) để dữ liệu bền vững.
 *  - Khi mở trang: lấy bản mới hơn giữa máy chủ và trình duyệt.
 * Nếu không có máy chủ (mở trực tiếp tệp), website tự chuyển sang chế độ chỉ lưu trong trình duyệt.
 */
var Store = (function () {
    'use strict';

    var cfg = window.PINKVOCAB || {};
    var API = cfg.apiUrl || 'Api/Data.ashx';
    var LS_DATA = 'pinkvocab.data.v1';
    var LS_ID = 'pinkvocab.clientId';

    var state = Engine.emptyState();
    var mode = 'local';          // 'server' | 'local'
    var serverMode = 'Shared';   // 'Shared' | 'PerBrowser' (do máy chủ báo)
    var syncError = false;
    var localOk = true;
    var pushTimer = null;
    var retryTimer = null;
    var inflight = false;
    var pending = false;
    var listeners = [];

    function genId() {
        if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
        var s = '';
        for (var i = 0; i < 32; i++) { s += Math.floor(Math.random() * 16).toString(16); }
        return s;
    }

    function clientId() {
        try {
            var id = localStorage.getItem(LS_ID);
            if (!id || !/^[A-Za-z0-9\-]{8,64}$/.test(id)) {
                id = genId();
                localStorage.setItem(LS_ID, id);
            }
            return id;
        } catch (e) {
            return genId();
        }
    }

    var cachedId = null;
    function apiUrl() {
        if (!cachedId) { cachedId = clientId(); }
        return API + (API.indexOf('?') < 0 ? '?' : '&') + 'id=' + encodeURIComponent(cachedId);
    }

    function request(method, body, cb) {
        var x = new XMLHttpRequest();
        try {
            x.open(method, apiUrl(), true);
        } catch (e) {
            cb(e);
            return;
        }
        x.timeout = 8000;
        if (method !== 'GET') {
            x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
            x.setRequestHeader('X-PinkVocab', '1');
        }
        x.onload = function () { cb(null, x); };
        x.onerror = x.ontimeout = function () { cb(new Error('network')); };
        x.send(body || null);
    }

    function readLocal() {
        try {
            var txt = localStorage.getItem(LS_DATA);
            if (!txt) { return null; }
            return Engine.sanitizeState(JSON.parse(txt));
        } catch (e) {
            return null;
        }
    }

    function writeLocal() {
        try {
            localStorage.setItem(LS_DATA, JSON.stringify(state));
            localOk = true;
        } catch (e) {
            localOk = false;
        }
    }

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](); } catch (e) { /* bỏ qua lỗi của bên nghe */ }
        }
    }

    function schedulePush() {
        if (mode !== 'server') { return; }
        pending = true;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(push, 500);
    }

    function push() {
        if (mode !== 'server' || !pending) { return; }
        if (inflight) { schedulePush(); return; }
        inflight = true;
        var stamp = state.savedAt;
        request('POST', JSON.stringify(state), function (err, x) {
            inflight = false;
            if (!err && x.status === 200) {
                syncError = false;
                if (state.savedAt === stamp) { pending = false; } else { schedulePush(); }
            } else {
                syncError = true;
                clearTimeout(retryTimer);
                retryTimer = setTimeout(push, 5000);
            }
            notify();
        });
    }

    /** Gửi nốt dữ liệu chưa đồng bộ khi người dùng đóng/chuyển tab. */
    function flush() {
        if (mode !== 'server' || !pending || !window.fetch) { return; }
        try {
            fetch(apiUrl(), {
                method: 'POST', keepalive: true,
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-PinkVocab': '1' },
                body: JSON.stringify(state)
            });
        } catch (e) { /* bản sao trong trình duyệt vẫn còn */ }
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { flush(); }
    });

    var api = {
        /** Nạp dữ liệu khi mở trang. */
        load: function (done) {
            var local = readLocal();
            if (cfg.offline) {
                // Bản đóng gói thành ứng dụng / chạy không có máy chủ: chỉ lưu trên thiết bị này.
                mode = 'local';
                state = local || Engine.emptyState();
                writeLocal();
                done();
                return;
            }
            request('GET', null, function (err, x) {
                var remote = null;
                var reachable = false;
                if (!err && x.status === 200) {
                    try {
                        var parsed = JSON.parse(x.responseText);
                        remote = parsed && typeof parsed === 'object' ? Engine.sanitizeState(parsed) : null;
                        reachable = true;
                        serverMode = x.getResponseHeader('X-PinkVocab-Mode') || 'Shared';
                    } catch (e) {
                        reachable = false;
                    }
                }
                mode = reachable ? 'server' : 'local';

                if (remote && local) {
                    state = local.savedAt > remote.savedAt ? local : remote;
                } else {
                    state = remote || local || Engine.emptyState();
                }

                if (mode === 'server' && state.savedAt > 0 && (!remote || state.savedAt > remote.savedAt)) {
                    // Bản trong trình duyệt mới hơn bản trên máy chủ: đẩy lên máy chủ.
                    pending = true;
                    schedulePush();
                }
                writeLocal();
                done();
            });
        },

        state: function () { return state; },
        settings: function () { return state.settings; },
        sets: function () { return state.sets; },
        music: function () { return state.music; },

        getSet: function (id) {
            for (var i = 0; i < state.sets.length; i++) {
                if (state.sets[i].id === id) { return state.sets[i]; }
            }
            return null;
        },

        addSet: function (set) {
            state.sets.unshift(set);
            api.save();
        },

        removeSet: function (id) {
            state.sets = state.sets.filter(function (s) { return s.id !== id; });
            api.save();
        },

        updateSettings: function (patch) {
            var merged = {};
            var cur = state.settings;
            Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
            Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
            state.settings = Engine.sanitizeSettings(merged);
            api.save();
        },

        /** Ghi dữ liệu hiện tại (gọi sau mỗi thay đổi). */
        save: function () {
            state.savedAt = Math.max(Date.now(), state.savedAt + 1);
            writeLocal();
            schedulePush();
            notify();
        },

        subscribe: function (fn) { listeners.push(fn); },

        /** Câu thông báo nơi lưu dữ liệu để hiển thị cho người dùng. */
        storageNote: function () {
            var text;
            if (mode === 'server' && serverMode === 'PerBrowser') {
                text = 'Dữ liệu được lưu trên máy chủ và gắn với trình duyệt này. Nếu bạn xóa dữ liệu trình duyệt, bạn sẽ không mở lại được các học phần cũ.';
            } else if (mode === 'server') {
                text = 'Dữ liệu được lưu trên máy chủ của website (kèm bản sao trong trình duyệt), nên vẫn còn sau khi tải lại trang hoặc mở bằng thiết bị khác.';
            } else if (cfg.app && localOk) {
                text = 'Dữ liệu được lưu ngay trong ứng dụng trên thiết bị này nên dùng được cả khi không có mạng. Dữ liệu không đồng bộ sang thiết bị khác và sẽ mất nếu bạn gỡ ứng dụng hoặc xóa dữ liệu của ứng dụng.';
            } else if (!localOk) {
                text = 'Không thể lưu dữ liệu: trình duyệt đang chặn lưu trữ (có thể do chế độ riêng tư). Dữ liệu sẽ mất khi đóng trang.';
            } else {
                text = 'Dữ liệu chỉ được lưu trong trình duyệt này. Dữ liệu không đồng bộ sang thiết bị khác và có thể mất nếu bạn xóa dữ liệu trình duyệt.';
            }
            if (mode === 'server' && syncError) {
                text += ' Hiện chưa đồng bộ được với máy chủ, website sẽ tự thử lại.';
            }
            return text;
        },

        mode: function () { return mode; },
        isDurable: function () { return localOk; }
    };

    return api;
}());
