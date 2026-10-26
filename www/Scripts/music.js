/*!
 * PinkVocab – music.js
 * NHẠC NỀN: nút nổi ở góc màn hình. Bấm để phát/dừng, bấm biểu tượng danh sách để thêm link nhạc.
 * Hỗ trợ 3 nguồn: YouTube (video/playlist), SoundCloud (bài hát/playlist) và tệp âm thanh trực tiếp (.mp3, .ogg, .wav...).
 * Trình phát nằm ngoài vùng nội dung (#app) nên nhạc KHÔNG bị ngắt khi chuyển trang trong website.
 * Danh sách nhạc và âm lượng được lưu cùng dữ liệu học tập; nhạc không tự phát khi mở trang (trình duyệt không cho phép).
 */
var Music = (function () {
    'use strict';

    var h = UI.h;
    var icon = UI.icon;

    var els = {};
    var panelOpen = false;
    var current = null;        // { token, provider, trackId }
    var token = 0;
    var playing = false;       // trình phát báo đang phát thật sự
    var wantPlay = false;      // người dùng muốn phát (bao gồm lúc đang tải)
    var slow = false;          // đã chờ quá lâu mà chưa phát
    var errorStreak = 0;
    var watchTimer = null;
    var libs = {};

    function data() { return Store.music(); }
    function trackList() { return data().tracks; }
    function currentTrack() { var m = data(); return m.tracks[m.index] || null; }

    /* ------------------------------------------------------------------ */
    /* Nạp thư viện ngoài (chỉ khi thật sự cần)                             */
    /* ------------------------------------------------------------------ */

    function loadScript(src, ready, timeoutMs) {
        return new Promise(function (resolve, reject) {
            if (ready()) { resolve(); return; }
            var done = false;
            var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, timeoutMs || 15000);
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function () {
                var tries = 0;
                (function wait() {            // YouTube gọi onYouTubeIframeAPIReady sau khi tập lệnh nạp xong
                    if (done) { return; }
                    if (ready()) { done = true; clearTimeout(timer); resolve(); }
                    else if (tries++ < 100) { setTimeout(wait, 100); }
                    else { done = true; clearTimeout(timer); reject(new Error('not ready')); }
                }());
            };
            s.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('load')); } };
            document.head.appendChild(s);
        });
    }

    function ensureYouTube() {
        if (!libs.yt) {
            libs.yt = loadScript('https://www.youtube.com/iframe_api', function () { return !!(window.YT && window.YT.Player); });
            libs.yt.catch(function () { libs.yt = null; });
        }
        return libs.yt;
    }

    function ensureSoundCloud() {
        if (!libs.sc) {
            libs.sc = loadScript('https://w.soundcloud.com/player/api.js', function () { return !!(window.SC && window.SC.Widget); });
            libs.sc.catch(function () { libs.sc = null; });
        }
        return libs.sc;
    }

    /* ------------------------------------------------------------------ */
    /* Ba nguồn phát. Mỗi nguồn trả về { play, pause, setVolume, restart, destroy }
       và báo trạng thái qua ctx.emit('playing'|'paused'|'ended'|'error'|'blocked'|'loadfail') */
    /* ------------------------------------------------------------------ */

    function audioProvider(parsed, ctx, autoplay, volume) {
        var a = new Audio();
        var dead = false;
        a.preload = 'auto';
        a.volume = volume / 100;
        a.addEventListener('playing', function () { ctx.emit('playing'); });
        a.addEventListener('pause', function () { if (!a.ended) { ctx.emit('paused'); } });
        a.addEventListener('ended', function () { ctx.emit('ended'); });
        a.addEventListener('error', function () { if (!dead) { ctx.emit('error'); } });
        function start() {
            var p = a.play();
            if (p && p.catch) {
                p.catch(function (e) {
                    if (dead || (e && e.name === 'AbortError')) { return; }
                    ctx.emit(e && e.name === 'NotAllowedError' ? 'blocked' : 'error');
                });
            }
        }
        a.src = parsed.url;
        if (autoplay) { start(); }
        return {
            play: start,
            pause: function () { a.pause(); },
            setVolume: function (v) { a.volume = v / 100; },
            restart: function () { a.currentTime = 0; start(); },
            destroy: function () { dead = true; a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) { /* bỏ qua */ } }
        };
    }

    function youtubeProvider(parsed, ctx, autoplay, volume, slot) {
        var api = {};
        var player = null;
        var ready = false;
        var want = autoplay;
        var vol = volume;
        var dead = false;
        var mount = h('div');
        slot.appendChild(mount);

        ensureYouTube().then(function () {
            if (dead) { return; }
            var vars = { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 };
            if (/^https?:$/.test(location.protocol)) { vars.origin = location.origin; }
            if (parsed.list) { vars.listType = 'playlist'; vars.list = parsed.list; }
            var opts = {
                width: '100%', height: '100%', playerVars: vars,
                events: {
                    onReady: function () {
                        ready = true;
                        try { player.setVolume(vol); if (parsed.list) { player.setLoop(true); } } catch (e) { /* bỏ qua */ }
                        if (want) { player.playVideo(); }
                    },
                    onStateChange: function (e) {
                        if (dead) { return; }
                        if (e.data === 1) {
                            ctx.emit('playing');
                            try { var d = player.getVideoData(); if (d && d.title) { ctx.title(d.title); } } catch (err) { /* bỏ qua */ }
                        } else if (e.data === 2) { ctx.emit('paused'); }
                        else if (e.data === 0 && !parsed.list) { ctx.emit('ended'); }
                    },
                    onError: function () { if (!dead) { ctx.emit('error'); } }
                }
            };
            if (parsed.video) { opts.videoId = parsed.video; }
            player = new window.YT.Player(mount, opts);
        }, function () { if (!dead) { ctx.emit('loadfail'); } });

        api.play = function () { want = true; if (ready) { player.playVideo(); } };
        api.pause = function () { want = false; if (ready) { player.pauseVideo(); } };
        api.setVolume = function (v) { vol = v; if (ready) { player.setVolume(v); } };
        api.restart = function () { if (ready) { player.seekTo(0, true); player.playVideo(); } };
        api.destroy = function () {
            dead = true;
            try { if (player && player.destroy) { player.destroy(); } } catch (e) { /* bỏ qua */ }
            slot.textContent = '';
        };
        return api;
    }

    function soundcloudProvider(parsed, ctx, autoplay, volume, slot) {
        var api = {};
        var widget = null;
        var ready = false;
        var want = autoplay;
        var vol = volume;
        var dead = false;
        var src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(parsed.url) +
            '&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false';
        var iframe = h('iframe', { src: src, title: 'Trình phát SoundCloud', allow: 'autoplay', scrolling: 'no', frameborder: 'no', width: '100%', height: '166' });

        ensureSoundCloud().then(function () {
            if (dead) { return; }
            slot.appendChild(iframe);
            var E = window.SC.Widget.Events;
            widget = window.SC.Widget(iframe);
            widget.bind(E.READY, function () {
                ready = true;
                widget.setVolume(vol);
                if (want) { widget.play(); }
            });
            widget.bind(E.PLAY, function () {
                if (dead) { return; }
                ctx.emit('playing');
                widget.getCurrentSound(function (s) { if (s && s.title && !dead) { ctx.title(s.title); } });
            });
            widget.bind(E.PAUSE, function () { if (!dead) { ctx.emit('paused'); } });
            widget.bind(E.ERROR, function () { if (!dead) { ctx.emit('error'); } });
            widget.bind(E.FINISH, function () {
                if (dead) { return; }
                if (!parsed.isSet) { ctx.emit('ended'); return; }
                // Với playlist, SoundCloud tự chuyển bài; chỉ coi là kết thúc nếu sau đó trình phát vẫn đứng yên.
                setTimeout(function () {
                    if (dead) { return; }
                    widget.isPaused(function (paused) { if (paused && !dead) { ctx.emit('ended'); } });
                }, 700);
            });
        }, function () { if (!dead) { ctx.emit('loadfail'); } });

        api.play = function () { want = true; if (ready) { widget.play(); } };
        api.pause = function () { want = false; if (ready) { widget.pause(); } };
        api.setVolume = function (v) { vol = v; if (ready) { widget.setVolume(v); } };
        api.restart = function () { if (ready) { widget.seekTo(0); widget.play(); } };
        api.destroy = function () {
            dead = true;
            try {
                if (widget) {
                    var E = window.SC.Widget.Events;
                    [E.READY, E.PLAY, E.PAUSE, E.FINISH, E.ERROR].forEach(function (ev) { widget.unbind(ev); });
                }
            } catch (e) { /* bỏ qua */ }
            slot.textContent = '';
        };
        return api;
    }

    /* ------------------------------------------------------------------ */
    /* Điều khiển chung                                                     */
    /* ------------------------------------------------------------------ */

    function clearWatch() { clearTimeout(watchTimer); watchTimer = null; }

    function startWatch() {
        clearWatch();
        slow = false;
        watchTimer = setTimeout(function () {
            if (wantPlay && !playing) { slow = true; updateUI(); }
        }, 8000);
    }

    function teardown() {
        token++;
        clearWatch();
        if (current) { try { current.provider.destroy(); } catch (e) { /* bỏ qua */ } }
        current = null;
        playing = false;
        slow = false;
        els.slot.textContent = '';
        els.slot.removeAttribute('data-type');
    }

    function loadTrack(index, autoplay) {
        var m = data();
        var track = m.tracks[index];
        if (!track) { return; }
        teardown();
        m.index = index;
        Store.save();

        var parsed = Engine.parseMusicUrl(track.url);
        if (!parsed.ok) { UI.toast('Liên kết nhạc không hợp lệ: ' + track.title, 'warn'); updateUI(); return; }

        var tok = token;
        var ctx = {
            emit: function (s) { onProviderState(tok, s); },
            title: function (t) { onProviderTitle(tok, t); }
        };
        wantPlay = !!autoplay;
        els.slot.setAttribute('data-type', parsed.type);

        var provider;
        if (parsed.type === 'youtube') { provider = youtubeProvider(parsed, ctx, autoplay, m.volume, els.slot); }
        else if (parsed.type === 'soundcloud') { provider = soundcloudProvider(parsed, ctx, autoplay, m.volume, els.slot); }
        else { provider = audioProvider(parsed, ctx, autoplay, m.volume); }
        current = { token: tok, provider: provider, trackId: track.id, type: parsed.type };
        if (autoplay) { startWatch(); }
        renderList();
        updateUI();
    }

    function advance(dir) {
        var m = data();
        var n = m.tracks.length;
        if (!n) { return; }
        if (n === 1 && current) {
            wantPlay = true;
            current.provider.restart();
            startWatch();
            updateUI();
            return;
        }
        loadTrack((m.index + dir + n) % n, true);
    }

    function toggle() {
        if (!trackList().length) {
            openPanel(true);
            UI.toast('Hãy thêm link nhạc (YouTube, SoundCloud...) để bắt đầu phát.', 'info');
            if (els.input) { els.input.focus(); }
            return;
        }
        if (!current) { loadTrack(data().index, true); return; }
        if (wantPlay) {
            wantPlay = false;
            clearWatch();
            current.provider.pause();
            if (!playing) { slow = false; }
        } else {
            wantPlay = true;
            current.provider.play();
            startWatch();
        }
        updateUI();
    }

    function onProviderTitle(tok, title) {
        if (tok !== token) { return; }
        var track = currentTrack();
        title = String(title || '').trim().slice(0, 120);
        if (!track || !title || track.title === title) { return; }
        track.title = title;
        track.auto = false;
        Store.save();
        renderList();
        updateUI();
    }

    function onProviderState(tok, state) {
        if (tok !== token) { return; }       // thông báo của bài cũ đã bị thay
        switch (state) {
            case 'playing':
                playing = true;
                wantPlay = true;
                slow = false;
                errorStreak = 0;
                clearWatch();
                break;
            case 'paused':
                playing = false;
                wantPlay = false;
                clearWatch();
                break;
            case 'ended':
                playing = false;
                advance(1);
                return;
            case 'blocked':
                playing = false;
                wantPlay = false;
                clearWatch();
                UI.toast('Trình duyệt chưa cho phát tự động. Hãy bấm nút phát nhạc một lần nữa.', 'warn');
                break;
            case 'loadfail':
                UI.toast('Không tải được trình phát. Hãy kiểm tra kết nối mạng rồi thử lại.', 'warn');
                teardown();              // lần bấm kế tiếp sẽ tải lại từ đầu
                wantPlay = false;
                break;
            case 'error':
                handleError();
                return;
            default:
                break;
        }
        updateUI();
    }

    function handleError() {
        var track = currentTrack();
        var type = current ? current.type : 'audio';
        var hint = type === 'youtube' ? 'Video có thể đã bị xóa hoặc không cho phép nhúng.'
            : type === 'soundcloud' ? 'Bài hát có thể ở chế độ riêng tư hoặc không cho phép nhúng.'
                : 'Không mở được tệp âm thanh từ liên kết này.';
        UI.toast('Không phát được "' + (track ? track.title : 'bài này') + '". ' + hint, 'warn');
        errorStreak++;
        playing = false;
        var again = wantPlay && trackList().length > 1 && errorStreak < trackList().length;
        if (again) {
            var tok = token;
            setTimeout(function () { if (tok === token && wantPlay) { advance(1); } }, 700);
        } else {
            teardown();                  // bài lỗi: bỏ trình phát hỏng để lần bấm sau tải lại
            wantPlay = false;
        }
        updateUI();
    }

    /* ------------------------------------------------------------------ */
    /* Thêm / xóa bài                                                      */
    /* ------------------------------------------------------------------ */

    function setFormError(msg) {
        els.formError.textContent = msg || '';
        els.formError.hidden = !msg;
        els.input.classList.toggle('invalid', !!msg);
    }

    function addTrack() {
        var parsed = Engine.parseMusicUrl(els.input.value);
        if (!parsed.ok) { setFormError(parsed.error); els.input.focus(); return; }
        var m = data();
        if (m.tracks.length >= Engine.MAX_TRACKS) { setFormError('Danh sách đã đầy (tối đa ' + Engine.MAX_TRACKS + ' bài). Hãy xóa bớt trước khi thêm.'); return; }
        for (var i = 0; i < m.tracks.length; i++) {
            if (m.tracks[i].key === parsed.key) { setFormError('Liên kết này đã có trong danh sách rồi.'); return; }
        }
        m.tracks.push({ id: Engine.uid(), type: parsed.type, url: parsed.url, key: parsed.key, title: parsed.title, auto: true });
        Store.save();
        setFormError('');
        els.input.value = '';
        var idle = !wantPlay && !playing;
        renderList();
        if (idle) {
            loadTrack(m.tracks.length - 1, true);          // bấm "Thêm" cũng là thao tác của người dùng nên được phép phát
            UI.toast('Đã thêm bài nhạc. Đang phát…', 'success');
        } else {
            updateUI();
            UI.toast('Đã thêm vào danh sách nhạc.', 'success');
        }
    }

    function removeTrack(index) {
        var m = data();
        var removed = m.tracks[index];
        if (!removed) { return; }
        var wasCurrent = index === m.index;
        var keepPlaying = wasCurrent && wantPlay;
        m.tracks.splice(index, 1);
        if (index < m.index) { m.index--; }
        if (m.index >= m.tracks.length) { m.index = Math.max(0, m.tracks.length - 1); }
        Store.save();
        if (wasCurrent) {
            teardown();
            wantPlay = false;
            if (m.tracks.length && keepPlaying) { loadTrack(m.index, true); return; }
        }
        renderList();
        updateUI();
    }

    function selectTrack(index) {
        var m = data();
        if (index === m.index && current) { toggle(); return; }
        loadTrack(index, true);
    }

    /* ------------------------------------------------------------------ */
    /* Giao diện                                                            */
    /* ------------------------------------------------------------------ */

    function statusText() {
        if (!trackList().length) { return 'Chưa có bài nào'; }
        if (playing) { return 'Đang phát'; }
        if (wantPlay) { return slow ? 'Chưa phát được… hãy thử bấm nút phát lần nữa' : 'Đang tải…'; }
        return 'Đã dừng';
    }

    function renderList() {
        var m = data();
        els.list.textContent = '';
        els.empty.hidden = m.tracks.length > 0;
        m.tracks.forEach(function (t, i) {
            var active = i === m.index;
            var typeLabel = t.type === 'youtube' ? 'YouTube' : t.type === 'soundcloud' ? 'SoundCloud' : 'Tệp âm thanh';
            var row = h('li', { class: 'music-item' + (active ? ' is-active' : '') + (active && playing ? ' is-playing' : '') },
                h('button', {
                    type: 'button', class: 'music-item-main', title: 'Phát bài này', 'aria-current': active ? 'true' : null,
                    onclick: function () { selectTrack(i); }
                },
                    h('span', { class: 'music-item-icon' }, icon(active && playing ? 'pause' : 'play', !(active && playing))),
                    h('span', { class: 'music-item-text' },
                        h('span', { class: 'music-item-title', text: t.title }),
                        h('span', { class: 'music-item-meta', text: typeLabel }))),
                h('button', {
                    type: 'button', class: 'icon-btn danger', title: 'Xóa bài này', 'aria-label': 'Xóa ' + t.title,
                    onclick: function () { removeTrack(i); }
                }, icon('trash')));
            els.list.appendChild(row);
        });
    }

    function updateUI() {
        if (!els.fab) { return; }
        var t = currentTrack();
        var has = trackList().length > 0;
        els.dock.classList.toggle('is-playing', playing);
        els.dock.classList.toggle('is-loading', wantPlay && !playing);
        els.fab.setAttribute('aria-pressed', wantPlay ? 'true' : 'false');
        els.fab.setAttribute('aria-label', wantPlay ? 'Dừng nhạc nền' : 'Phát nhạc nền');
        els.fab.title = wantPlay ? 'Dừng nhạc nền' : (has ? 'Phát nhạc nền' : 'Thêm nhạc nền');
        els.nowTitle.textContent = t ? t.title : 'Chưa có bài nhạc nào';
        els.nowStatus.textContent = statusText();
        els.playBtn.textContent = '';
        els.playBtn.appendChild(icon(wantPlay ? 'pause' : 'play', !wantPlay));
        els.playBtn.setAttribute('aria-label', wantPlay ? 'Dừng' : 'Phát');
        els.playBtn.disabled = !has;
        els.prevBtn.disabled = !has;
        els.nextBtn.disabled = !has;
        els.volume.value = String(data().volume);
        els.volumeText.textContent = data().volume + '%';
        renderListState();
    }

    function renderListState() {
        var m = data();
        var items = els.list.children;
        for (var i = 0; i < items.length; i++) {
            var active = i === m.index;
            items[i].classList.toggle('is-active', active);
            items[i].classList.toggle('is-playing', active && playing);
            var iconHost = items[i].querySelector('.music-item-icon');
            if (iconHost) {
                var wantPause = active && playing;
                if (iconHost.getAttribute('data-p') !== (wantPause ? '1' : '0')) {
                    iconHost.setAttribute('data-p', wantPause ? '1' : '0');
                    iconHost.textContent = '';
                    iconHost.appendChild(icon(wantPause ? 'pause' : 'play', !wantPause));
                }
            }
        }
    }

    function openPanel(open) {
        panelOpen = open;
        els.dock.classList.toggle('is-open', open);
        els.more.setAttribute('aria-expanded', open ? 'true' : 'false');
        els.panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) { els.panel.removeAttribute('inert'); } else { els.panel.setAttribute('inert', ''); }
    }

    function build(host) {
        els.eq = h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
        els.fab = h('button', {
            type: 'button', class: 'music-fab', 'aria-pressed': 'false', 'aria-label': 'Phát nhạc nền', onclick: toggle
        }, h('span', { class: 'music-fab-icon' }, icon('music'), els.eq), h('span', { class: 'music-fab-label', text: 'Nhạc' }));
        els.more = h('button', {
            type: 'button', class: 'music-more', title: 'Danh sách nhạc & thêm link', 'aria-label': 'Mở danh sách nhạc',
            'aria-expanded': 'false', 'aria-controls': 'music-panel', onclick: function () { openPanel(!panelOpen); }
        }, icon('list'));

        els.nowTitle = h('div', { class: 'music-now-title' });
        els.nowStatus = h('div', { class: 'music-now-status', 'aria-live': 'polite' });
        els.prevBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Bài trước', 'aria-label': 'Bài trước', onclick: function () { advance(-1); } }, icon('prev'));
        els.playBtn = h('button', { type: 'button', class: 'icon-btn music-play', onclick: toggle });
        els.nextBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Bài kế tiếp', 'aria-label': 'Bài kế tiếp', onclick: function () { advance(1); } }, icon('next'));
        els.volumeText = h('span', { class: 'music-volume-text' });
        els.volume = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'range', 'aria-label': 'Âm lượng nhạc nền' });
        els.volume.addEventListener('input', function () {
            var v = parseInt(els.volume.value, 10) || 0;
            data().volume = v;
            els.volumeText.textContent = v + '%';
            if (current) { current.provider.setVolume(v); }
        });
        els.volume.addEventListener('change', function () { Store.save(); });

        els.slot = h('div', { class: 'music-slot' });

        els.input = h('input', {
            type: 'text', class: 'input', placeholder: 'Dán link YouTube / SoundCloud / .mp3', autocomplete: 'off', autocapitalize: 'none',
            spellcheck: 'false', inputmode: 'url', 'aria-label': 'Link nhạc', maxlength: '500'
        });
        els.input.addEventListener('input', function () { setFormError(''); });
        els.formError = h('p', { class: 'field-error', role: 'alert', hidden: true });
        var form = h('form', { class: 'music-form', novalidate: true },
            h('div', { class: 'music-form-row' }, els.input, h('button', { type: 'submit', class: 'btn btn-primary', text: 'Thêm' })), els.formError);
        form.addEventListener('submit', function (e) { e.preventDefault(); addTrack(); });

        els.list = h('ul', { class: 'music-list' });
        els.empty = h('p', { class: 'muted small music-empty', text: 'Chưa có bài nhạc nào. Dán một link ở trên rồi bấm "Thêm" để bắt đầu nghe.' });

        els.panel = h('section', { class: 'music-panel', id: 'music-panel', 'aria-label': 'Nhạc nền', inert: true, 'aria-hidden': 'true' },
            h('div', { class: 'music-head' },
                h('h2', { class: 'section-title', text: 'Nhạc nền' }),
                h('button', { type: 'button', class: 'icon-btn', title: 'Đóng', 'aria-label': 'Đóng danh sách nhạc', onclick: function () { openPanel(false); els.more.focus(); } }, icon('x'))),
            h('div', { class: 'music-now' }, els.nowTitle, els.nowStatus),
            h('div', { class: 'music-controls' }, els.prevBtn, els.playBtn, els.nextBtn,
                h('div', { class: 'music-volume' }, icon('volume'), els.volume, els.volumeText)),
            els.slot,
            form, els.empty, els.list,
            h('p', { class: 'music-note', text: 'Hỗ trợ link YouTube, SoundCloud và tệp âm thanh trực tiếp (.mp3, .ogg, .wav, .m4a). Một số video/bài hát không cho phép nhúng nên có thể không phát được.' }));

        els.dock = h('div', { class: 'music-dock' }, els.panel, h('div', { class: 'music-bar' }, els.fab, els.more));
        host.appendChild(els.dock);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panelOpen && !document.body.classList.contains('modal-open')) { openPanel(false); els.more.focus(); }
        });
        document.addEventListener('pointerdown', function (e) {
            if (panelOpen && !els.dock.contains(e.target) && !document.body.classList.contains('modal-open')) { openPanel(false); }
        });
    }

    return {
        init: function (host) {
            build(host || document.body);
            renderList();
            updateUI();
        },
        toggle: toggle
    };
}());
