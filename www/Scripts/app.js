/*!
 * PinkVocab – app.js
 * Điểm khởi động, điều hướng giữa các màn hình (#/ , #/new , #/set/:id , #/set/:id/edit , #/study/:id),
 * trang chủ (danh sách học phần) và trang chi tiết học phần.
 */
(function () {
    'use strict';

    var h = UI.h;
    var icon = UI.icon;
    var appEl = document.getElementById('app');
    var view = null;
    var currentHash = null;
    var bypassGuard = false;
    var restoring = false;

    /* ---------- Tiện ích hiển thị ---------- */

    function setProgress(set) {
        // Trả về { percent, label } hoặc null nếu chưa có dữ liệu học.
        var s = set.session;
        if (s && !s.finished && Engine.hasProgress(s)) {
            var p = Engine.progress(s);
            return { percent: p.percent, label: 'Đang học dở ' + p.done + '/' + p.total + ' từ' };
        }
        var learned = set.cards.filter(function (c) { return c.learned; }).length;
        if (learned > 0 || set.history.length) {
            var pct = set.cards.length ? Math.round(learned / set.cards.length * 100) : 0;
            return { percent: pct, label: 'Đã thuộc ' + learned + '/' + set.cards.length + ' từ' };
        }
        return null;
    }

    function progressBar(p) {
        return h('div', { class: 'mini-progress-wrap' },
            h('div', { class: 'mini-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.percent), 'aria-label': 'Tiến độ học tập' },
                (function () { var f = h('div', { class: 'progress-fill' }); f.style.width = p.percent + '%'; return f; }())),
            h('span', { class: 'mini-progress-text', text: p.percent + '% · ' + p.label }));
    }

    function confirmDelete(set) {
        return UI.confirm({
            title: 'Xóa học phần?',
            body: 'Học phần "' + set.name + '" cùng ' + set.cards.length + ' từ vựng, tiến độ học và kết quả liên quan sẽ bị xóa vĩnh viễn. Bạn không thể hoàn tác thao tác này.',
            buttons: [
                { label: 'Hủy', value: false, autofocus: true },
                { label: 'Xóa học phần', kind: 'danger', value: true }
            ],
            dismissValue: false
        }).then(function (ok) {
            if (!ok) { return false; }
            Store.removeSet(set.id);
            UI.toast('Đã xóa học phần "' + set.name + '".', 'info');
            return true;
        });
    }

    /* ---------- Trang chủ ---------- */

    function homeView() {
        var root = h('section', { class: 'page home' });

        function setCard(set) {
            var p = setProgress(set);
            return h('article', { class: 'card set-card' },
                h('h3', { class: 'set-name' }, h('a', { href: '#/set/' + set.id, text: set.name })),
                h('p', { class: 'set-meta' },
                    h('span', { text: UI.wordCount(set.cards.length) }), h('span', { class: 'dot', text: '·' }), h('span', { text: 'Tạo ngày ' + UI.formatDate(set.createdAt) })),
                p ? progressBar(p) : h('p', { class: 'muted small', text: 'Chưa học' }),
                h('div', { class: 'set-actions' },
                    h('a', { class: 'btn btn-primary', href: '#/study/' + set.id, text: 'Học ngay' }),
                    h('a', { class: 'btn btn-ghost', href: '#/set/' + set.id + '/edit', text: 'Chỉnh sửa' }),
                    h('button', {
                        type: 'button', class: 'btn btn-ghost btn-danger-text', text: 'Xóa',
                        onclick: function () { confirmDelete(set).then(function (done) { if (done) { render(); } }); }
                    })));
        }

        function render() {
            root.textContent = '';
            var sets = Store.sets();

            root.appendChild(h('header', { class: 'hero' },
                h('div', { class: 'hero-deco', 'aria-hidden': 'true' }, icon('star', true), icon('check'), icon('star', true)),
                h('h1', { class: 'brand', text: 'PinkVocab' }),
                h('p', { class: 'tagline', text: 'Học từ vựng mỗi ngày, ghi nhớ dễ dàng hơn.' }),
                h('a', { class: 'btn btn-primary btn-strong btn-hero', href: '#/new', text: '+ Tạo học phần' })));

            if (!sets.length) {
                root.appendChild(h('div', { class: 'card empty-state' },
                    h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('star', true)),
                    h('p', { class: 'empty-text', text: 'Bạn chưa có học phần nào. Hãy tạo học phần đầu tiên để bắt đầu học tiếng Anh!' }),
                    h('a', { class: 'btn btn-primary btn-strong', href: '#/new', text: '+ Tạo học phần' })));
            } else {
                root.appendChild(h('div', { class: 'section-head' },
                    h('h2', { class: 'section-title', text: 'Học phần của bạn' }), h('span', { class: 'badge', text: String(sets.length) })));
                var grid = h('div', { class: 'set-grid' });
                sets.forEach(function (s) { grid.appendChild(setCard(s)); });
                root.appendChild(grid);
            }

            var note = h('p', { class: 'storage-note', text: Store.storageNote() });
            root.appendChild(note);
        }

        render();
        return { el: root, isDirty: function () { return false; }, destroy: function () { } };
    }

    /* ---------- Trang chi tiết học phần ---------- */

    function detailView(id) {
        var set = Store.getSet(id);
        if (!set) {
            return {
                el: h('section', { class: 'page narrow' }, h('div', { class: 'card empty-state' },
                    h('h1', { class: 'page-title', text: 'Không tìm thấy học phần' }),
                    h('p', { class: 'muted', text: 'Học phần này có thể đã bị xóa.' }),
                    h('a', { class: 'btn btn-primary', href: '#/', text: 'Về trang chủ' }))),
                isDirty: function () { return false; }, destroy: function () { }
            };
        }

        var root = h('section', { class: 'page detail' });

        function render() {
            root.textContent = '';
            var p = setProgress(set);
            var inProgress = set.session && !set.session.finished && Engine.hasProgress(set.session);
            var starredCount = set.cards.filter(function (c) { return c.starred; }).length;
            var unknownCount = set.cards.filter(function (c) { return c.unknown; }).length;

            root.appendChild(h('div', { class: 'topbar' },
                h('a', { class: 'icon-btn', href: '#/', title: 'Về trang chủ', 'aria-label': 'Về trang chủ' }, icon('back')),
                h('h1', { class: 'page-title', text: set.name })));

            var actions = h('div', { class: 'set-actions' },
                h('a', {
                    class: 'btn btn-primary btn-strong', href: '#/study/' + set.id,
                    text: inProgress ? 'Học tiếp' : 'Học ngay'
                }));
            if (inProgress) {
                actions.appendChild(h('button', {
                    type: 'button', class: 'btn btn-ghost', text: 'Học lại từ đầu',
                    onclick: function () {
                        UI.confirm({
                            title: 'Học lại từ đầu?',
                            body: 'Lượt học đang dở sẽ bị thay thế bằng một lượt học mới.',
                            buttons: [{ label: 'Hủy', value: false }, { label: 'Học lại từ đầu', kind: 'primary', value: true }],
                            dismissValue: false
                        }).then(function (ok) {
                            if (!ok) { return; }
                            set.session = null;
                            Store.save();
                            location.hash = '#/study/' + set.id;
                        });
                    }
                }));
            }
            actions.appendChild(h('a', { class: 'btn btn-ghost', href: '#/set/' + set.id + '/edit', text: 'Chỉnh sửa' }));
            actions.appendChild(h('button', {
                type: 'button', class: 'btn btn-ghost btn-danger-text', text: 'Xóa',
                onclick: function () { confirmDelete(set).then(function (done) { if (done) { location.hash = '#/'; } }); }
            }));

            var last = set.history.length ? set.history[set.history.length - 1] : null;
            root.appendChild(h('div', { class: 'card' },
                h('p', { class: 'set-meta' },
                    h('span', { text: UI.wordCount(set.cards.length) }), h('span', { class: 'dot', text: '·' }),
                    h('span', { text: 'Tạo ngày ' + UI.formatDate(set.createdAt) }), h('span', { class: 'dot', text: '·' }),
                    h('span', { text: starredCount + ' có dấu sao' }), h('span', { class: 'dot', text: '·' }),
                    h('span', { text: unknownCount + ' cần ôn' })),
                p ? progressBar(p) : h('p', { class: 'muted small', text: 'Chưa học' }),
                last && last.accuracy !== null
                    ? h('p', { class: 'muted small', text: 'Lượt học hoàn thành gần nhất: ' + last.correct + '/' + (last.correct + last.wrong) + ' từ đúng ngay lần đầu · ' + last.accuracy + '% · ' + UI.formatDate(last.at) })
                    : null,
                actions));

            root.appendChild(h('div', { class: 'section-head' }, h('h2', { class: 'section-title', text: 'Danh sách từ vựng' })));
            var list = h('ul', { class: 'word-list card' });
            set.cards.forEach(function (c) {
                var star = h('button', {
                    type: 'button', class: 'icon-btn star-btn' + (c.starred ? ' is-on' : ''), 'aria-pressed': c.starred ? 'true' : 'false',
                    title: c.starred ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao', 'aria-label': (c.starred ? 'Bỏ đánh dấu sao: ' : 'Đánh dấu sao: ') + c.term,
                    onclick: function () { c.starred = !c.starred; Store.save(); render(); }
                }, icon('star', c.starred));
                var speak = h('button', {
                    type: 'button', class: 'icon-btn', title: 'Nghe phát âm', 'aria-label': 'Nghe phát âm: ' + c.term,
                    onclick: function () { Speech.speak(c.term, Store.settings(), function () { UI.toast('Trình duyệt này chưa hỗ trợ đọc giọng nói.', 'warn'); }); }
                }, icon('speaker'));
                var unknownBtn = c.unknown
                    ? h('button', {
                        type: 'button', class: 'tag tag-warn', title: 'Bấm để bỏ khỏi danh sách cần ôn', text: 'Cần ôn',
                        onclick: function () { c.unknown = false; Store.save(); render(); }
                    })
                    : null;
                list.appendChild(h('li', { class: 'word-item' },
                    star,
                    h('div', { class: 'word-text' },
                        h('span', { class: 'word-term', lang: 'en', text: c.term }),
                        h('span', { class: 'word-def', lang: 'vi', text: c.definition })),
                    unknownBtn, speak));
            });
            root.appendChild(list);
        }

        render();
        return { el: root, isDirty: function () { return false; }, destroy: function () { } };
    }

    /* ---------- Điều hướng ---------- */

    function parseRoute(hash) {
        var path = (hash || '').replace(/^#/, '').replace(/\/+$/, '');
        if (path === '' || path === '/') { return { name: 'home' }; }
        var m;
        if (path === '/new') { return { name: 'new' }; }
        if ((m = /^\/set\/([^/]+)\/edit$/.exec(path))) { return { name: 'edit', id: decodeURIComponent(m[1]) }; }
        if ((m = /^\/set\/([^/]+)$/.exec(path))) { return { name: 'detail', id: decodeURIComponent(m[1]) }; }
        if ((m = /^\/study\/([^/]+)$/.exec(path))) { return { name: 'study', id: decodeURIComponent(m[1]) }; }
        return { name: 'home' };
    }

    function mount(route) {
        if (view && view.destroy) { view.destroy(); }
        var next;
        switch (route.name) {
            case 'new': next = EditorView.create(null); break;
            case 'edit': next = EditorView.create(route.id); break;
            case 'detail': next = detailView(route.id); break;
            case 'study': next = StudyView.create(route.id); break;
            default: next = homeView();
        }
        view = next;
        appEl.textContent = '';
        appEl.appendChild(view.el);
        window.scrollTo(0, 0);
        document.body.setAttribute('data-route', route.name);
        if (view.focus) { view.focus(); }
    }

    function go() {
        var hash = location.hash;
        if (restoring) { restoring = false; currentHash = hash; return; }

        if (!bypassGuard && view && view.isDirty && view.isDirty()) {
            // Trả địa chỉ về như cũ rồi hỏi người dùng trước khi bỏ dữ liệu chưa lưu.
            var target = hash;
            restoring = true;
            location.hash = currentHash || '#/';
            UI.confirm({
                title: 'Rời khỏi trang này?',
                body: 'Bạn có thay đổi chưa được lưu. Nếu rời đi, các thay đổi này sẽ bị mất.',
                buttons: [
                    { label: 'Ở lại chỉnh sửa', value: false, autofocus: true },
                    { label: 'Rời đi', kind: 'danger', value: true }
                ],
                dismissValue: false
            }).then(function (leave) {
                if (!leave) { return; }
                bypassGuard = true;
                location.hash = target;
            });
            return;
        }
        bypassGuard = false;
        currentHash = hash;
        mount(parseRoute(hash));
    }

    window.addEventListener('hashchange', go);

    // Dữ liệu được lưu mới (ví dụ ở tab khác của cùng trình duyệt): chỉ cần tải lại trang để thấy bản mới nhất.
    Store.load(function () {
        Music.init(document.getElementById('music-root'));
        currentHash = location.hash;
        mount(parseRoute(currentHash));
    });
}());
