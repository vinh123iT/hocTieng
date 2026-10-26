/*!
 * PinkVocab – ui.js
 * Các thành phần giao diện dùng chung: tạo phần tử DOM an toàn, biểu tượng, thông báo nhanh, hộp thoại.
 * Mọi văn bản người dùng nhập đều được chèn bằng textContent nên không thể chèn mã HTML/JS.
 */
var UI = (function () {
    'use strict';

    /* ---------- Tạo phần tử ---------- */

    function append(el, child) {
        if (child == null || child === false) { return; }
        if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
        el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }

    function h(tag, attrs) {
        var el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                var v = attrs[k];
                if (v == null || v === false) { return; }
                if (k === 'class') { el.className = v; }
                else if (k === 'text') { el.textContent = v; }
                else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') { el[k] = v; }
                else if (k.slice(0, 2) === 'on' && typeof v === 'function') { el.addEventListener(k.slice(2), v); }
                else if (v === true) { el.setAttribute(k, ''); }
                else { el.setAttribute(k, v); }
            });
        }
        for (var i = 2; i < arguments.length; i++) { append(el, arguments[i]); }
        return el;
    }

    /* ---------- Biểu tượng (SVG tĩnh, do chúng ta tự viết) ---------- */

    var ICONS = {
        back: '<path d="M15 5l-7 7 7 7"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        speaker: '<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
        star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z"/>',
        trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        x: '<path d="M6 6l12 12M18 6L6 18"/>',
        pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
        play: '<path d="M7 5l12 7-12 7V5z"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
        tab: '<path d="M4 12h15M15 8l4 4-4 4M20 5v14"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="3"/>',
        pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
        next: '<path d="M5 5l10 7-10 7V5z"/><path d="M19 5v14"/>',
        prev: '<path d="M19 5L9 12l10 7V5z"/><path d="M5 5v14"/>',
        volume: '<path d="M11 5L6 9H3v6h3l5 4V5z"/>'
    };

    function icon(name, filled) {
        var span = document.createElement('span');
        span.className = 'icon';
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="' + (filled ? 'currentColor' : 'none') +
            '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
        return span;
    }

    /* ---------- Thông báo nhanh ---------- */

    function toast(message, kind) {
        var host = document.getElementById('toasts');
        if (!host) { return; }
        var el = h('div', { class: 'toast toast-' + (kind || 'info'), role: 'status', text: message });
        el.addEventListener('click', function () { el.remove(); });
        host.appendChild(el);
        setTimeout(function () { if (el.parentNode) { el.classList.add('toast-out'); } }, 3200);
        setTimeout(function () { if (el.parentNode) { el.remove(); } }, 3700);
    }

    /* ---------- Hộp thoại ---------- */

    var stack = [];
    var dialogSeq = 0;

    function focusables(box) {
        var nodes = box.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
        return Array.prototype.filter.call(nodes, function (n) {
            return !n.disabled && n.getAttribute('tabindex') !== '-1' && n.offsetParent !== null;
        });
    }

    document.addEventListener('keydown', function (e) {
        var top = stack[stack.length - 1];
        if (!top) { return; }
        if (e.key === 'Escape') {
            e.preventDefault();
            top.dismiss();
        } else if (e.key === 'Tab') {
            var list = focusables(top.box);
            if (!list.length) { return; }
            var first = list[0];
            var last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });

    /**
     * opts: { title, body (Node | string), buttons: [{label, value, kind, onClick, autofocus}],
     *         dismissValue, backdropClose, wide }
     * Trả về { promise, close(value), box }.
     */
    function dialog(opts) {
        var root = document.getElementById('modal-root') || document.body;
        var previous = document.activeElement;
        var titleId = 'dlg-title-' + (++dialogSeq);
        var resolveFn;
        var promise = new Promise(function (resolve) { resolveFn = resolve; });
        var closed = false;

        var body = h('div', { class: 'modal-body' });
        if (typeof opts.body === 'string') { body.appendChild(h('p', { text: opts.body })); } else { append(body, opts.body); }

        var footer = h('div', { class: 'modal-footer' });
        var overlay;
        var entry;

        function close(value) {
            if (closed) { return; }
            closed = true;
            stack = stack.filter(function (s) { return s !== entry; });
            overlay.remove();
            if (!stack.length) { document.body.classList.remove('modal-open'); }
            if (previous && previous.focus && document.body.contains(previous)) { try { previous.focus(); } catch (e) { /* bỏ qua */ } }
            resolveFn(value);
        }

        var focusTarget = null;
        (opts.buttons || []).forEach(function (b) {
            var btn = h('button', {
                type: 'button', class: 'btn ' + (b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : 'btn-ghost'),
                text: b.label,
                onclick: function () {
                    if (b.onClick && b.onClick() === false) { return; }
                    close(b.value);
                }
            });
            if (b.autofocus || (!focusTarget && b.kind === 'primary')) { focusTarget = btn; }
            footer.appendChild(btn);
        });

        var box = h('div', {
            class: 'modal' + (opts.wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId
        }, h('h2', { id: titleId, class: 'modal-title', text: opts.title || '' }), body, footer);

        overlay = h('div', { class: 'modal-overlay' }, box);
        entry = {
            box: box,
            dismiss: function () { close(opts.dismissValue === undefined ? null : opts.dismissValue); }
        };
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay && opts.backdropClose !== false) { entry.dismiss(); }
        });

        stack.push(entry);
        root.appendChild(overlay);
        document.body.classList.add('modal-open');
        setTimeout(function () {
            var target = focusTarget || focusables(box)[0];
            if (target) { target.focus(); }
        }, 20);

        return { promise: promise, close: close, box: box };
    }

    /** Hộp xác nhận: trả về Promise<giá trị của nút được bấm> (null nếu đóng bằng Esc). */
    function confirmDialog(opts) {
        return dialog({
            title: opts.title, body: opts.body || opts.message, buttons: opts.buttons, dismissValue: opts.dismissValue === undefined ? null : opts.dismissValue
        }).promise;
    }

    /* ---------- Tiện ích ---------- */

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function formatDate(ts) {
        var d = new Date(ts);
        if (isNaN(d.getTime())) { return ''; }
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function wordCount(n) { return n + ' từ vựng'; }

    return { h: h, icon: icon, toast: toast, dialog: dialog, confirm: confirmDialog, formatDate: formatDate, wordCount: wordCount };
}());
