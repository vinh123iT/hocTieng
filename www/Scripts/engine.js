/*!
 * PinkVocab – engine.js
 * Logic thuần (không đụng tới giao diện): chuẩn hóa & kiểm tra đáp án, phân tích dữ liệu nhập hàng loạt,
 * phát hiện từ trùng, phiên học (tiến độ, tính điểm, Deep Memory) và làm sạch dữ liệu đã lưu.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Engine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MAX_CARDS = 2000;
    var NAME_MAX = 100;
    var HISTORY_MAX = 20;
    var MODES = ['all', 'starred', 'unknown'];

    var DEFAULT_SETTINGS = {
        studyMode: 'all',      // all | starred | unknown
        termFirst: true,       // true: hiện từ tiếng Anh, nhập nghĩa. false: hiện nghĩa, nhập từ tiếng Anh
        speak: true,           // tự động đọc từ tiếng Anh
        speakLang: 'en-US',
        voiceURI: '',
        hideContent: false,    // che nội dung cần ghi nhớ cho tới khi người học bấm "Hiện"
        deepMemory: 1,         // số lần phải trả lời đúng liên tiếp để hoàn thành một từ (1–5)
        soundCorrect: true,
        soundWrong: false
    };

    var FIELD_SEPS = { tab: '\t', comma: ',', pipe: '|' };
    var FIELD_NAMES = { tab: 'dấu Tab', comma: 'dấu phẩy', pipe: 'dấu |' };
    var CARD_SEPS = { newline: '\n', semicolon: ';', tilde: '~' };

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /* ------------------------------------------------------------------ */
    /* Kiểm tra đáp án                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Chuẩn hóa để so sánh: Unicode NFC (gõ bằng bộ gõ nào cũng như nhau), chữ thường,
     * bỏ dấu nháy đơn, đổi dấu câu/gạch nối thành khoảng trắng, gộp khoảng trắng.
     * Dấu thanh tiếng Việt (á, ả, ã...) được GIỮ NGUYÊN vì đổi dấu là đổi nghĩa.
     */
    function normalizeText(value) {
        var s = String(value == null ? '' : value);
        if (s.normalize) { s = s.normalize('NFC'); }
        s = s.toLowerCase();
        s = s.replace(/[​-‍﻿]/g, '');
        s = s.replace(/['’‘ʼ`´]/g, '');
        s = s.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    /** Trả về { status: 'empty' | 'correct' | 'wrong' }. */
    function checkAnswer(input, expected) {
        var rawInput = String(input == null ? '' : input).trim();
        if (!rawInput) { return { status: 'empty' }; }
        var typed = normalizeText(rawInput);
        var wanted = normalizeText(expected);
        if (!wanted || !typed) {
            // Đáp án (hoặc câu trả lời) chỉ gồm ký hiệu: so sánh nguyên văn, không phân biệt hoa/thường.
            return { status: rawInput.toLowerCase() === String(expected).trim().toLowerCase() ? 'correct' : 'wrong' };
        }
        return { status: typed === wanted ? 'correct' : 'wrong' };
    }

    /* ------------------------------------------------------------------ */
    /* Nhập hàng loạt                                                       */
    /* ------------------------------------------------------------------ */

    function trimSpaces(s) {
        // Cắt khoảng trắng và xuống dòng ở hai đầu nhưng GIỮ ký tự Tab (Tab là dấu phân cách).
        return s.replace(/^[  　\r\n]+|[  　\r\n]+$/g, '');
    }

    function cleanField(s) {
        return s.replace(/\s+/g, ' ').trim();
    }

    function splitItems(text, cardKey) {
        var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
        return t.split(CARD_SEPS[cardKey] || '\n');
    }

    function joinItems(items, cardKey) {
        if (cardKey === 'semicolon') { return items.join(';\n'); }
        if (cardKey === 'tilde') { return items.join('~\n'); }
        return items.join('\n');
    }

    /**
     * Phân tích văn bản dán vào thành danh sách thẻ.
     * Không bỏ qua dòng lỗi một cách âm thầm: mọi dòng lỗi đều được liệt kê kèm nguyên nhân.
     * @returns {{rows: Array, errors: Array, items: Array}}
     */
    function parseBulk(text, fieldKey, cardKey) {
        if (!FIELD_SEPS.hasOwnProperty(fieldKey)) { fieldKey = 'tab'; }
        if (!CARD_SEPS.hasOwnProperty(cardKey)) { cardKey = 'newline'; }
        var sep = FIELD_SEPS[fieldKey];
        var items = splitItems(text, cardKey);
        var rows = [];
        var errors = [];

        for (var i = 0; i < items.length; i++) {
            var raw = items[i];
            var item = trimSpaces(raw);
            if (cleanField(item) === '') { continue; }   // dòng trống: không phải dữ liệu

            var label = (cardKey === 'newline' ? 'Dòng ' : 'Thẻ ') + (i + 1);
            var reason = null;
            var term = '';
            var definition = '';
            var warning = null;

            if (cardKey !== 'newline' && item.indexOf('\n') >= 0) {
                reason = 'Có xuống dòng bên trong một thẻ. Có thể bạn đã chọn sai dấu phân cách giữa các thẻ.';
            } else if (item.indexOf(sep) < 0) {
                reason = 'Không tìm thấy ' + FIELD_NAMES[fieldKey] + ' giữa thuật ngữ và nghĩa.';
            } else if (fieldKey === 'comma') {
                var pos = item.indexOf(',');
                term = item.slice(0, pos);
                definition = item.slice(pos + 1);
                if (definition.indexOf(',') >= 0) {
                    warning = 'Có nhiều dấu phẩy: đã tách tại dấu phẩy đầu tiên.';
                }
            } else {
                var parts = item.split(sep);
                while (parts.length > 2 && cleanField(parts[parts.length - 1]) === '') { parts.pop(); }
                if (parts.length > 2) {
                    reason = 'Có ' + parts.length + ' cột, chỉ cần 2 cột (thuật ngữ và nghĩa).';
                } else {
                    term = parts[0];
                    definition = parts[1];
                }
            }

            if (!reason) {
                term = cleanField(term);
                definition = cleanField(definition);
                if (!term) { reason = 'Thiếu thuật ngữ tiếng Anh (phần bên trái dấu phân cách).'; }
                else if (!definition) { reason = 'Thiếu nghĩa tiếng Việt (phần bên phải dấu phân cách).'; }
            }

            if (reason) {
                errors.push({ index: i, label: label, raw: raw, reason: reason });
            } else {
                rows.push({ term: term, definition: definition, index: i, label: label, raw: raw, warning: warning });
            }
        }
        return { rows: rows, errors: errors, items: items };
    }

    /** Xóa một mục (theo chỉ số trong parseBulk().items) khỏi văn bản gốc. */
    function removeItem(text, cardKey, index) {
        var items = splitItems(text, cardKey);
        if (index >= 0 && index < items.length) { items.splice(index, 1); }
        return joinItems(items, cardKey);
    }

    /** Tìm thẻ có thuật ngữ trùng với danh sách hiện có hoặc trùng ngay trong lô nhập. */
    function findDuplicates(existingTerms, rows) {
        var seen = Object.create(null);
        var i;
        for (i = 0; i < existingTerms.length; i++) {
            var k0 = normalizeText(existingTerms[i]);
            if (k0) { seen[k0] = 'existing'; }
        }
        var dups = [];
        for (i = 0; i < rows.length; i++) {
            var key = normalizeText(rows[i].term) || rows[i].term.toLowerCase();
            if (seen[key]) {
                dups.push({ rowIndex: i, term: rows[i].term, where: seen[key] });
            } else {
                seen[key] = 'batch';
            }
        }
        return dups;
    }

    /* ------------------------------------------------------------------ */
    /* Phiên học                                                            */
    /* ------------------------------------------------------------------ */

    function buildPool(cards, mode) {
        var ids = [];
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            if (mode === 'starred' && !c.starred) { continue; }
            if (mode === 'unknown' && !c.unknown) { continue; }
            ids.push(c.id);
        }
        return ids;
    }

    function createSession(ids, poolMode, deep, now) {
        var cards = {};
        for (var i = 0; i < ids.length; i++) {
            cards[ids[i]] = { need: deep, first: null, attempts: 0, done: false };
        }
        return {
            id: uid(), poolMode: poolMode, startedAt: now || Date.now(), finishedAt: null,
            finished: false, total: ids.length, cards: cards, queue: ids.slice()
        };
    }

    function current(session) {
        return session && !session.finished && session.queue.length ? session.queue[0] : null;
    }

    function requeue(queue, id) {
        // Cho từ quay lại sau vài từ khác để nhớ chủ động, không hỏi lại ngay lập tức.
        queue.splice(Math.min(queue.length, 3), 0, id);
    }

    function markFinishedIfEmpty(session, now) {
        if (!session.queue.length) {
            session.finished = true;
            session.finishedAt = now || Date.now();
        }
    }

    /** Ghi nhận một câu trả lời ĐÚNG cho từ hiện tại. */
    function answerCorrect(session, deep, now) {
        var id = session.queue[0];
        var c = session.cards[id];
        c.attempts += 1;
        if (c.first === null) { c.first = true; }
        c.need = Math.max(0, Math.min(c.need, deep) - 1);
        session.queue.shift();
        var completed = c.need === 0;
        if (completed) { c.done = true; } else { requeue(session.queue, id); }
        markFinishedIfEmpty(session, now);
        return { id: id, completed: completed, firstTry: c.first === true, finished: session.finished };
    }

    /** Ghi nhận một câu trả lời SAI: từ vẫn là từ hiện tại để người học thử lại. */
    function answerWrong(session, deep) {
        var id = session.queue[0];
        var c = session.cards[id];
        c.attempts += 1;
        if (c.first === null) { c.first = false; }
        c.need = deep;
        return id;
    }

    /** "Không biết" hoặc "Xem đáp án": tính là sai, từ quay lại sau. */
    function giveUp(session, deep) {
        var id = session.queue[0];
        var c = session.cards[id];
        c.attempts += 1;
        if (c.first === null) { c.first = false; }
        c.need = deep;
        session.queue.shift();
        requeue(session.queue, id);
        return id;
    }

    /** Áp dụng mức Deep Memory mới cho phần chưa hoàn thành của phiên đang học. */
    function applyDeep(session, deep) {
        Object.keys(session.cards).forEach(function (id) {
            var c = session.cards[id];
            if (c.done) { return; }
            c.need = c.attempts === 0 ? deep : Math.min(c.need, deep);
            if (c.need < 1) { c.need = 1; }
        });
    }

    /** Lượt học đang dở và đã có ít nhất một câu trả lời? */
    function hasProgress(session) {
        if (!session || session.finished) { return false; }
        return Object.keys(session.cards).some(function (id) { return session.cards[id].attempts > 0; });
    }

    function progress(session) {
        var done = 0;
        Object.keys(session.cards).forEach(function (id) { if (session.cards[id].done) { done++; } });
        var total = session.total;
        return { done: done, total: total, percent: total ? Math.round(done / total * 100) : 0 };
    }

    /**
     * Kết quả: mỗi từ chỉ được tính điểm một lần, theo LẦN TRẢ LỜI ĐẦU TIÊN.
     * accuracy = số từ đúng ở lần đầu / số từ đã được tính điểm × 100 (null nếu chưa có từ nào được tính).
     */
    function results(session) {
        var correct = 0;
        var wrong = 0;
        Object.keys(session.cards).forEach(function (id) {
            var f = session.cards[id].first;
            if (f === true) { correct++; } else if (f === false) { wrong++; }
        });
        var scored = correct + wrong;
        return {
            total: session.total, correct: correct, wrong: wrong, scored: scored,
            accuracy: scored ? Math.round(correct / scored * 100) : null
        };
    }

    /** Gỡ các thẻ đã bị xóa khỏi phiên học; trả về null nếu không còn thẻ nào. */
    function reconcileSession(session, validIds, now) {
        if (!session) { return null; }
        var ids = Object.keys(session.cards);
        ids.forEach(function (id) { if (!validIds[id]) { delete session.cards[id]; } });
        session.queue = session.queue.filter(function (id) { return !!session.cards[id]; });
        session.total = Object.keys(session.cards).length;
        if (!session.total) { return null; }
        if (!session.finished) { markFinishedIfEmpty(session, now); }
        return session;
    }

    /* ------------------------------------------------------------------ */
    /* Làm sạch dữ liệu đã lưu                                              */
    /* ------------------------------------------------------------------ */

    function str(v, max) {
        return typeof v === 'string' ? v.slice(0, max || 2000) : '';
    }

    function num(v, fallback) {
        return typeof v === 'number' && isFinite(v) ? v : fallback;
    }

    function sanitizeSettings(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        var s = {};
        Object.keys(DEFAULT_SETTINGS).forEach(function (k) { s[k] = DEFAULT_SETTINGS[k]; });
        if (MODES.indexOf(raw.studyMode) >= 0) { s.studyMode = raw.studyMode; }
        ['termFirst', 'speak', 'hideContent', 'soundCorrect', 'soundWrong'].forEach(function (k) {
            if (typeof raw[k] === 'boolean') { s[k] = raw[k]; }
        });
        if (typeof raw.speakLang === 'string' && /^[a-z]{2,3}-[A-Za-z]{2,4}$/.test(raw.speakLang)) { s.speakLang = raw.speakLang; }
        if (typeof raw.voiceURI === 'string') { s.voiceURI = raw.voiceURI.slice(0, 300); }
        var d = parseInt(raw.deepMemory, 10);
        if (d >= 1 && d <= 5) { s.deepMemory = d; }
        return s;
    }

    function sanitizeSession(raw, cardIds, now) {
        if (!raw || typeof raw !== 'object' || !raw.cards || typeof raw.cards !== 'object' || !Array.isArray(raw.queue)) {
            return null;
        }
        var out = {
            id: str(raw.id, 60) || uid(),
            poolMode: MODES.indexOf(raw.poolMode) >= 0 ? raw.poolMode : 'all',
            startedAt: num(raw.startedAt, now), finishedAt: num(raw.finishedAt, null),
            finished: raw.finished === true, total: 0, cards: {}, queue: []
        };
        Object.keys(raw.cards).forEach(function (id) {
            var c = raw.cards[id];
            if (!cardIds[id] || !c || typeof c !== 'object') { return; }
            var need = parseInt(c.need, 10);
            out.cards[id] = {
                need: need >= 0 && need <= 5 ? need : 1,
                first: c.first === true ? true : (c.first === false ? false : null),
                attempts: Math.max(0, parseInt(c.attempts, 10) || 0),
                done: c.done === true
            };
        });
        out.total = Object.keys(out.cards).length;
        if (!out.total) { return null; }
        var inQueue = {};
        raw.queue.forEach(function (id) {
            if (out.cards[id] && !out.cards[id].done && !inQueue[id]) { inQueue[id] = true; out.queue.push(id); }
        });
        if (out.finished) {
            out.queue = [];
        } else {
            Object.keys(out.cards).forEach(function (id) {
                if (!out.cards[id].done && !inQueue[id]) { out.queue.push(id); }
            });
            if (!out.queue.length) { out.finished = true; out.finishedAt = out.finishedAt || now; }
        }
        return out;
    }

    function sanitizeCard(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        var id = str(raw.id, 60);
        var term = str(raw.term, 300).trim();
        var definition = str(raw.definition, 500).trim();
        if (!id || !term || !definition) { return null; }
        return {
            id: id, term: term, definition: definition,
            starred: raw.starred === true, unknown: raw.unknown === true, learned: raw.learned === true
        };
    }

    function sanitizeSet(raw, now) {
        if (!raw || typeof raw !== 'object') { return null; }
        var id = str(raw.id, 60);
        if (!id) { return null; }
        var cards = [];
        var seen = {};
        (Array.isArray(raw.cards) ? raw.cards : []).slice(0, MAX_CARDS).forEach(function (rc) {
            var c = sanitizeCard(rc);
            if (c && !seen[c.id]) { seen[c.id] = true; cards.push(c); }
        });
        var history = [];
        (Array.isArray(raw.history) ? raw.history : []).slice(-HISTORY_MAX).forEach(function (h) {
            if (h && typeof h === 'object') {
                history.push({
                    at: num(h.at, now), mode: MODES.indexOf(h.mode) >= 0 ? h.mode : 'all',
                    total: Math.max(0, parseInt(h.total, 10) || 0), correct: Math.max(0, parseInt(h.correct, 10) || 0),
                    wrong: Math.max(0, parseInt(h.wrong, 10) || 0),
                    accuracy: typeof h.accuracy === 'number' ? h.accuracy : null
                });
            }
        });
        return {
            id: id,
            name: str(raw.name, NAME_MAX).trim() || 'Học phần chưa đặt tên',
            createdAt: num(raw.createdAt, now), updatedAt: num(raw.updatedAt, now),
            lastStudiedAt: num(raw.lastStudiedAt, null),
            cards: cards, history: history,
            session: sanitizeSession(raw.session, seen, now)
        };
    }

    /* ------------------------------------------------------------------ */
    /* Nhạc nền: phân tích liên kết                                         */
    /* ------------------------------------------------------------------ */

    var MAX_TRACKS = 50;
    var DEFAULT_VOLUME = 40;
    var AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba|webm)$/i;
    var YT_HOSTS = { 'youtube.com': 1, 'youtu.be': 1, 'youtube-nocookie.com': 1 };
    var SC_RESERVED = { discover: 1, you: 1, stream: 1, search: 1, upload: 1, charts: 1, pages: 1, terms: 1, messages: 1, notifications: 1 };

    function musicFail(msg) { return { ok: false, error: msg }; }

    function decodeSeg(s) {
        try { return decodeURIComponent(s); } catch (e) { return s; }
    }

    /**
     * Nhận một liên kết nhạc do người dùng dán vào và nhận diện nguồn phát:
     *   YouTube (video, playlist), SoundCloud (bài hát, playlist, trang nghệ sĩ), hoặc tệp âm thanh trực tiếp.
     * @returns {{ok:true,type:string,url:string,key:string,title:string}|{ok:false,error:string}}
     */
    function parseMusicUrl(input) {
        var raw = String(input == null ? '' : input).trim();
        if (!raw) { return musicFail('Hãy dán liên kết nhạc vào ô nhập.'); }
        if (raw.length > 500) { return musicFail('Liên kết quá dài (tối đa 500 ký tự).'); }
        if (/\s/.test(raw)) { return musicFail('Liên kết không được chứa khoảng trắng. Hãy chỉ dán một liên kết cho mỗi lần thêm.'); }
        if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(raw)) {
            if (/^[^\s\/]+\.[^\s\/]+/.test(raw)) { raw = 'https://' + raw; }
            else { return musicFail('Đây không phải là một liên kết. Ví dụ: https://soundcloud.com/... hoặc https://www.youtube.com/watch?v=...'); }
        }
        var u;
        try { u = new URL(raw); } catch (e) { return musicFail('Liên kết không hợp lệ. Hãy kiểm tra lại.'); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') { return musicFail('Chỉ hỗ trợ liên kết bắt đầu bằng http:// hoặc https://.'); }

        var host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
        var parts = u.pathname.split('/').filter(Boolean);

        /* --- YouTube --- */
        if (YT_HOSTS[host]) {
            var video = null;
            if (host === 'youtu.be') { video = parts[0] || null; }
            else if (parts[0] === 'watch') { video = u.searchParams.get('v'); }
            else if (['embed', 'shorts', 'live', 'v'].indexOf(parts[0]) >= 0) { video = parts[1] || null; }
            if (video && !/^[A-Za-z0-9_\-]{11}$/.test(video)) { video = null; }

            var list = u.searchParams.get('list');
            if (list && !/^[A-Za-z0-9_\-]{10,80}$/.test(list)) { list = null; }
            if (list && /^(RD|UL)/.test(list)) {
                if (video) { list = null; }
                else { return musicFail('Danh sách "Mix" của YouTube không phát được ở đây. Hãy dán liên kết một video hoặc một playlist thông thường.'); }
            }
            if (!video && !list) { return musicFail('Liên kết YouTube này không có video hoặc danh sách phát hợp lệ.'); }

            var ytUrl = list && !video
                ? 'https://www.youtube.com/playlist?list=' + list
                : 'https://www.youtube.com/watch?v=' + video + (list ? '&list=' + list : '');
            return {
                ok: true, type: 'youtube', url: ytUrl, video: video, list: list,
                key: 'yt:' + (video || '') + ':' + (list || ''),
                title: video ? 'YouTube · ' + video : 'YouTube · Playlist'
            };
        }

        /* --- SoundCloud --- */
        if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
            if (!parts.length) { return musicFail('Hãy dán liên kết một bài hát hoặc playlist cụ thể trên SoundCloud, không phải trang chủ.'); }
            if (host === 'soundcloud.com' && SC_RESERVED[parts[0].toLowerCase()]) {
                return musicFail('Hãy dán liên kết một bài hát hoặc playlist cụ thể trên SoundCloud.');
            }
            var path = '/' + parts.join('/');
            var secret = u.searchParams.get('secret_token');
            var scUrl = 'https://' + host + path + (secret ? '?secret_token=' + encodeURIComponent(secret) : '');
            var last = decodeSeg(parts[parts.length - 1]).replace(/[-_]+/g, ' ').trim() || 'SoundCloud';
            return {
                ok: true, type: 'soundcloud', url: scUrl, path: path,
                isSet: /\/sets\//i.test(path) || (host === 'soundcloud.com' && parts.length === 1),
                key: 'sc:' + host + path.toLowerCase(),
                title: last + ' (SoundCloud)'
            };
        }

        /* --- Tệp âm thanh trực tiếp --- */
        if (AUDIO_EXT.test(u.pathname)) {
            var file = decodeSeg(parts[parts.length - 1] || 'audio');
            return { ok: true, type: 'audio', url: u.href, key: 'au:' + u.href, title: file };
        }

        return musicFail('Chưa hỗ trợ liên kết này. Hãy dán liên kết YouTube, SoundCloud hoặc tệp âm thanh trực tiếp (.mp3, .ogg, .wav, .m4a...).');
    }

    function sanitizeMusic(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        var out = { tracks: [], index: 0, volume: DEFAULT_VOLUME };
        var seen = {};
        (Array.isArray(raw.tracks) ? raw.tracks : []).forEach(function (t) {
            if (out.tracks.length >= MAX_TRACKS || !t || typeof t !== 'object') { return; }
            var p = parseMusicUrl(str(t.url, 500));
            if (!p.ok || seen[p.key]) { return; }
            seen[p.key] = true;
            out.tracks.push({
                id: str(t.id, 60) || uid(), type: p.type, url: p.url, key: p.key,
                title: str(t.title, 120).trim() || p.title,
                auto: t.auto === false ? false : true      // true: tiêu đề tạm suy ra từ liên kết, sẽ được thay bằng tên thật khi phát
            });
        });
        var idx = parseInt(raw.index, 10);
        out.index = idx >= 0 && idx < out.tracks.length ? idx : 0;
        var vol = parseInt(raw.volume, 10);
        out.volume = vol >= 0 && vol <= 100 ? vol : DEFAULT_VOLUME;
        return out;
    }

    function emptyState() {
        return { version: 1, savedAt: 0, sets: [], settings: sanitizeSettings(null), music: sanitizeMusic(null) };
    }

    function sanitizeState(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        var now = Date.now();
        var sets = [];
        var seen = {};
        (Array.isArray(raw.sets) ? raw.sets : []).forEach(function (rs) {
            var s = sanitizeSet(rs, now);
            if (s && !seen[s.id]) { seen[s.id] = true; sets.push(s); }
        });
        return { version: 1, savedAt: num(raw.savedAt, 0), sets: sets, settings: sanitizeSettings(raw.settings), music: sanitizeMusic(raw.music) };
    }

    return {
        MAX_CARDS: MAX_CARDS, NAME_MAX: NAME_MAX, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        uid: uid, normalizeText: normalizeText, checkAnswer: checkAnswer,
        parseBulk: parseBulk, removeItem: removeItem, joinItems: joinItems, findDuplicates: findDuplicates,
        buildPool: buildPool, createSession: createSession, current: current,
        answerCorrect: answerCorrect, answerWrong: answerWrong, giveUp: giveUp, applyDeep: applyDeep,
        progress: progress, hasProgress: hasProgress, results: results, reconcileSession: reconcileSession,
        MAX_TRACKS: MAX_TRACKS, parseMusicUrl: parseMusicUrl, sanitizeMusic: sanitizeMusic,
        sanitizeSettings: sanitizeSettings, sanitizeState: sanitizeState, emptyState: emptyState
    };
}));
