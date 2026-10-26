/*!
 * PinkVocab – audio.js
 * Hai hệ thống ÂM THANH ĐỘC LẬP:
 *   Sfx    : tiếng "ting" khi đúng / tiếng báo nhẹ khi sai, tạo bằng Web Audio API (không cần tệp ngoài).
 *   Speech : đọc từ tiếng Anh bằng Web Speech API (speechSynthesis) của trình duyệt.
 */
var Sfx = (function () {
    'use strict';

    var ctx = null;
    var last = { type: '', at: 0 };

    function getContext() {
        if (ctx) { return ctx; }
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) { return null; }
        try { ctx = new Ctor(); } catch (e) { ctx = null; }
        return ctx;
    }

    /** Trình duyệt chỉ cho phát âm thanh sau một thao tác của người dùng; gọi hàm này ở lần chạm/nhấn đầu tiên. */
    function unlock() {
        var c = getContext();
        if (c && c.state === 'suspended' && c.resume) { c.resume(); }
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
        document.addEventListener(evt, unlock, { passive: true });
    });

    function tone(c, freq, start, duration, peak, type) {
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    function play(type) {
        var now = Date.now();
        // Chặn phát lặp do thao tác kép / hiển thị lại.
        if (last.type === type && now - last.at < 400) { return false; }
        last = { type: type, at: now };

        var c = getContext();
        if (!c) { return false; }
        var run = function () {
            var t0 = c.currentTime + 0.01;
            if (type === 'success') {
                tone(c, 1046.5, t0, 0.22, 0.10, 'sine');          // Do6
                tone(c, 1568.0, t0 + 0.09, 0.30, 0.08, 'sine');   // Sol6  -> tiếng "ting" nhẹ
            } else {
                tone(c, 392.0, t0, 0.20, 0.06, 'triangle');       // báo lỗi rất nhẹ, không chói
                tone(c, 330.0, t0 + 0.12, 0.24, 0.05, 'triangle');
            }
        };
        if (c.state === 'suspended' && c.resume) {
            c.resume().then(run, function () { /* bị chặn: bỏ qua */ });
        } else {
            run();
        }
        return true;
    }

    return {
        unlock: unlock,
        success: function () { return play('success'); },
        error: function () { return play('error'); }
    };
}());

var Speech = (function () {
    'use strict';

    var synth = window.speechSynthesis || null;
    var supported = !!(synth && typeof window.SpeechSynthesisUtterance !== 'undefined');
    var voices = [];
    var warned = false;

    function loadVoices() {
        if (!supported) { return; }
        try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
    }

    if (supported) {
        loadVoices();
        if (synth.addEventListener) { synth.addEventListener('voiceschanged', loadVoices); }
        else { synth.onvoiceschanged = loadVoices; }
    }

    function sameLang(voiceLang, lang) {
        return String(voiceLang || '').replace('_', '-').toLowerCase() === String(lang).toLowerCase();
    }

    /** Danh sách giọng đọc phù hợp với ngôn ngữ đã chọn. */
    function voicesFor(lang) {
        loadVoices();
        return voices.filter(function (v) { return sameLang(v.lang, lang); });
    }

    function pickVoice(settings) {
        var list = voicesFor(settings.speakLang);
        if (settings.voiceURI) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].voiceURI === settings.voiceURI) { return list[i]; }
            }
        }
        return list.length ? list[0] : null;
    }

    function speak(text, settings, onUnsupported) {
        if (!text) { return false; }
        if (!supported) {
            if (!warned && onUnsupported) { warned = true; onUnsupported(); }
            return false;
        }
        try {
            synth.cancel();
            var u = new window.SpeechSynthesisUtterance(text);
            u.lang = settings.speakLang || 'en-US';
            var v = pickVoice(settings);
            if (v) { u.voice = v; u.lang = v.lang; }
            u.rate = 0.9;
            u.volume = 1;
            setTimeout(function () { try { synth.speak(u); } catch (e) { /* bỏ qua */ } }, 30);
            return true;
        } catch (e) {
            return false;
        }
    }

    function stop() {
        if (supported) { try { synth.cancel(); } catch (e) { /* bỏ qua */ } }
    }

    return { supported: supported, voicesFor: voicesFor, speak: speak, stop: stop };
}());
