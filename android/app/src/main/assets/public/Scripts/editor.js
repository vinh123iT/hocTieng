/*!
 * PinkVocab – editor.js
 * Màn hình TẠO / CHỈNH SỬA học phần: tên học phần, nhập từ vựng thủ công,
 * nhập hàng loạt (dán từ Word/Excel/Google Docs), xem trước, kiểm tra trùng lặp và lỗi.
 */
var EditorView = (function () {
    'use strict';

    var h = UI.h;
    var icon = UI.icon;

    function notFound() {
        return {
            el: h('section', { class: 'page narrow' },
                h('div', { class: 'card empty-state' },
                    h('h1', { class: 'page-title', text: 'Không tìm thấy học phần' }),
                    h('p', { class: 'muted', text: 'Học phần này có thể đã bị xóa.' }),
                    h('a', { class: 'btn btn-primary', href: '#/', text: 'Về trang chủ' }))),
            isDirty: function () { return false; },
            destroy: function () { }
        };
    }

    function radioGroup(name, legend, options, current, onChange) {
        var fs = h('fieldset', { class: 'radio-group' }, h('legend', { text: legend }));
        options.forEach(function (o) {
            var input = h('input', { type: 'radio', name: name, value: o.value, checked: o.value === current });
            input.addEventListener('change', function () { if (input.checked) { onChange(o.value); } });
            fs.appendChild(h('label', { class: 'radio' }, input, h('span', { text: o.label })));
        });
        return fs;
    }

    function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

    function create(setId) {
        var existing = setId ? Store.getSet(setId) : null;
        if (setId && !existing) { return notFound(); }

        var keySeq = 0;
        var rows = [];
        var saved = false;
        var bulkMode = false;
        var importing = false;
        var bulkOpts = { field: 'tab', card: 'newline' };
        var previewTimer = null;

        function newRow(term, definition, id) {
            return { key: ++keySeq, id: id || null, term: term || '', definition: definition || '', els: null };
        }

        if (existing) {
            existing.cards.forEach(function (c) { rows.push(newRow(c.term, c.definition, c.id)); });
        } else {
            for (var i = 0; i < 3; i++) { rows.push(newRow()); }
        }

        /* ----- Khung giao diện ----- */

        var nameInput = h('input', {
            type: 'text', id: 'set-name', class: 'input', maxlength: String(Engine.NAME_MAX), autocomplete: 'off',
            placeholder: 'Ví dụ: Từ vựng về món ăn', value: existing ? existing.name : ''
        });
        var nameError = h('p', { class: 'field-error', role: 'alert', hidden: true });

        var rowsHost = h('div', { class: 'word-rows' });
        var countBadge = h('span', { class: 'badge' });
        var errorBox = h('div', { class: 'form-errors', role: 'alert', hidden: true });

        var manualPanel = h('div', { class: 'manual-panel' });
        var bulkPanel = h('div', { class: 'bulk-panel', hidden: true });
        var bulkSummary = h('p', { class: 'muted bulk-keep' });

        var bulkText = h('textarea', {
            class: 'input bulk-textarea', rows: '9', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none',
            'aria-label': 'Dữ liệu cần nhập hàng loạt'
        });
        var previewHost = h('div', { class: 'preview', 'aria-live': 'polite' });
        var insertTabBtn = h('button', {
            type: 'button', class: 'btn btn-ghost btn-small', title: 'Chèn ký tự Tab vào vị trí con trỏ',
            onclick: function () { insertAtCursor('\t'); }
        }, icon('tab'), ' Chèn Tab');
        var importBtn = h('button', { type: 'button', class: 'btn btn-primary btn-strong', text: 'Nhập', onclick: doImport });

        var addBtn = h('button', {
            type: 'button', class: 'btn btn-ghost add-row', text: '+ Thêm từ vựng', onclick: function () { addRow(true); }
        });

        var saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-strong', text: existing ? 'Lưu thay đổi' : 'Tạo học phần', onclick: save });
        var cancelBtn = h('button', {
            type: 'button', class: 'btn btn-ghost',
            text: 'Hủy', onclick: function () { location.hash = existing ? '#/set/' + existing.id : '#/'; }
        });

        var bulkBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { setBulk(true); } }, 'Nhập hàng loạt');

        /* ----- Dòng từ vựng thủ công ----- */

        function snapshot() {
            return JSON.stringify([nameInput.value, rows.map(function (r) { return [r.id, r.term, r.definition]; })]);
        }
        var initialSnapshot = snapshot();

        function isDirty() {
            if (saved) { return false; }
            return snapshot() !== initialSnapshot || (bulkMode && bulkText.value.trim() !== '');
        }

        function updateCount() {
            var filled = rows.filter(function (r) { return r.term.trim() || r.definition.trim(); }).length;
            countBadge.textContent = filled + ' từ';
            if (bulkMode) {
                bulkSummary.textContent = filled
                    ? 'Danh sách hiện có ' + filled + ' từ vựng. Các từ này được giữ nguyên, từ nhập hàng loạt sẽ được thêm vào cuối danh sách.'
                    : 'Danh sách hiện chưa có từ vựng nào. Từ nhập hàng loạt sẽ được thêm vào danh sách này.';
            }
        }

        function clearInvalid(row) {
            if (!row.els) { return; }
            row.els.term.classList.remove('invalid');
            row.els.def.classList.remove('invalid');
        }

        function focusRow(row, which) {
            if (row.els) { row.els[which || 'term'].focus(); }
        }

        function removeRow(row) {
            var idx = rows.indexOf(row);
            if (idx < 0) { return; }
            rows.splice(idx, 1);
            if (!rows.length) { rows.push(newRow()); }
            renderRows();
            var target = rows[Math.min(idx, rows.length - 1)];
            focusRow(target, 'term');
        }

        function buildRow(row, index) {
            var termInput = h('input', {
                type: 'text', class: 'input', value: row.term, placeholder: 'Thuật ngữ tiếng Anh', lang: 'en', autocomplete: 'off',
                autocapitalize: 'none', spellcheck: 'false', maxlength: '300', 'aria-label': 'Thuật ngữ tiếng Anh, dòng ' + (index + 1)
            });
            var defInput = h('input', {
                type: 'text', class: 'input', value: row.definition, placeholder: 'Nghĩa tiếng Việt', lang: 'vi', autocomplete: 'off',
                maxlength: '500', 'aria-label': 'Nghĩa tiếng Việt, dòng ' + (index + 1)
            });
            var del = h('button', {
                type: 'button', class: 'icon-btn danger', title: 'Xóa từ vựng này', 'aria-label': 'Xóa từ vựng dòng ' + (index + 1),
                onclick: function () { removeRow(row); }
            }, icon('trash'));

            termInput.addEventListener('input', function () { row.term = termInput.value; clearInvalid(row); errorBox.hidden = true; updateCount(); });
            defInput.addEventListener('input', function () { row.definition = defInput.value; clearInvalid(row); errorBox.hidden = true; updateCount(); });
            termInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); defInput.focus(); }
            });
            defInput.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') { return; }
                e.preventDefault();
                var pos = rows.indexOf(row);
                if (pos === rows.length - 1) { addRow(true); } else { focusRow(rows[pos + 1], 'term'); }
            });

            row.els = { term: termInput, def: defInput };
            return h('div', { class: 'word-row', 'data-key': String(row.key) },
                h('span', { class: 'row-num', text: String(index + 1) }),
                h('div', { class: 'field field-term' }, termInput),
                h('div', { class: 'field field-def' }, defInput),
                del);
        }

        function renderRows() {
            rowsHost.textContent = '';
            rows.forEach(function (row, i) { rowsHost.appendChild(buildRow(row, i)); });
            updateCount();
        }

        function addRow(focus) {
            if (rows.length >= Engine.MAX_CARDS) {
                UI.toast('Mỗi học phần tối đa ' + Engine.MAX_CARDS + ' từ vựng.', 'warn');
                return;
            }
            var row = newRow();
            rows.push(row);
            rowsHost.appendChild(buildRow(row, rows.length - 1));
            updateCount();
            if (focus) { focusRow(row, 'term'); row.els.term.scrollIntoView({ block: 'nearest' }); }
        }

        /* ----- Nhập hàng loạt ----- */

        function insertAtCursor(text) {
            var start = bulkText.selectionStart;
            var end = bulkText.selectionEnd;
            var v = bulkText.value;
            bulkText.value = v.slice(0, start) + text + v.slice(end);
            bulkText.selectionStart = bulkText.selectionEnd = start + text.length;
            bulkText.focus();
            renderPreview();
        }

        function placeholderText() {
            var f = bulkOpts.field === 'tab' ? '⇥' : bulkOpts.field === 'comma' ? ', ' : ' | ';
            var lines = ['make a cake' + f + 'làm bánh', 'eat breakfast' + f + 'ăn sáng', 'go to school' + f + 'đi học'];
            var c = bulkOpts.card === 'semicolon' ? ';' : bulkOpts.card === 'tilde' ? '~' : '';
            var text = lines.map(function (l, i) { return i < lines.length - 1 ? l + c : l; }).join(bulkOpts.card === 'newline' ? '\n' : '\n');
            return text + (bulkOpts.field === 'tab' ? '\n(⇥ là ký tự Tab)' : '');
        }

        function renderPreview() {
            var parsed = Engine.parseBulk(bulkText.value, bulkOpts.field, bulkOpts.card);
            previewHost.textContent = '';
            previewHost.appendChild(h('h3', { class: 'section-title', text: 'Xem trước' }));

            if (!parsed.rows.length && !parsed.errors.length) {
                previewHost.appendChild(h('p', { class: 'muted preview-empty', text: 'Không có nội dung để xem trước' }));
                return;
            }

            var summary = parsed.rows.length + ' thẻ hợp lệ' + (parsed.errors.length ? ' · ' + parsed.errors.length + ' dòng lỗi' : '');
            previewHost.appendChild(h('p', { class: 'preview-summary', text: summary }));

            if (parsed.errors.length) {
                var errList = h('ul', { class: 'preview-errors' });
                parsed.errors.forEach(function (er) {
                    errList.appendChild(h('li', null,
                        h('div', { class: 'err-text' },
                            h('strong', { text: er.label + ': ' }), er.reason,
                            h('div', { class: 'err-raw', text: truncate(er.raw.trim().replace(/\s+/g, ' '), 90) })),
                        h('button', {
                            type: 'button', class: 'icon-btn danger', title: 'Xóa dòng lỗi này', 'aria-label': 'Xóa ' + er.label,
                            onclick: function () { bulkText.value = Engine.removeItem(bulkText.value, bulkOpts.card, er.index); renderPreview(); }
                        }, icon('x'))));
                });
                previewHost.appendChild(errList);
            }

            var LIMIT = 300;
            var list = h('ol', { class: 'preview-list' });
            parsed.rows.slice(0, LIMIT).forEach(function (r, n) {
                list.appendChild(h('li', null,
                    h('span', { class: 'row-num', text: String(n + 1) }),
                    h('div', { class: 'pv-text' },
                        h('span', { class: 'pv-term', text: r.term }),
                        h('span', { class: 'pv-def', text: r.definition }),
                        r.warning ? h('span', { class: 'pv-warn', text: r.warning }) : null),
                    h('button', {
                        type: 'button', class: 'icon-btn danger', title: 'Xóa khỏi danh sách nhập', 'aria-label': 'Xóa thẻ ' + r.term,
                        onclick: function () { bulkText.value = Engine.removeItem(bulkText.value, bulkOpts.card, r.index); renderPreview(); }
                    }, icon('x'))));
            });
            previewHost.appendChild(list);
            if (parsed.rows.length > LIMIT) {
                previewHost.appendChild(h('p', { class: 'muted', text: '… và ' + (parsed.rows.length - LIMIT) + ' thẻ nữa (vẫn sẽ được nhập).' }));
            }
        }

        function schedulePreview() {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(renderPreview, 120);
        }

        function refreshBulkOptions() {
            bulkText.placeholder = placeholderText();
            insertTabBtn.hidden = bulkOpts.field !== 'tab';
            renderPreview();
        }

        function setBulk(on) {
            bulkMode = on;
            manualPanel.hidden = on;
            bulkPanel.hidden = !on;
            bulkBtn.hidden = on;
            addBtn.hidden = on;
            updateCount();
            if (on) { refreshBulkOptions(); bulkText.focus(); }
        }

        function currentTerms() {
            return rows.filter(function (r) { return r.term.trim(); }).map(function (r) { return r.term; });
        }

        function listForDialog(items, max) {
            var ul = h('ul', { class: 'dialog-list' });
            items.slice(0, max).forEach(function (t) { ul.appendChild(h('li', { text: t })); });
            if (items.length > max) { ul.appendChild(h('li', { class: 'muted', text: '… và ' + (items.length - max) + ' mục khác' })); }
            return ul;
        }

        function doImport() {
            if (importing) { return; }
            var parsed = Engine.parseBulk(bulkText.value, bulkOpts.field, bulkOpts.card);
            if (!parsed.rows.length && !parsed.errors.length) {
                UI.toast('Chưa có nội dung để nhập. Hãy dán danh sách từ vựng vào khung nhập.', 'warn');
                bulkText.focus();
                return;
            }
            if (!parsed.rows.length) {
                UI.toast('Không có dòng hợp lệ để nhập. Hãy xem các lỗi ở phần Xem trước.', 'warn');
                return;
            }

            importing = true;
            var rowsToAdd = parsed.rows.slice();

            var step1 = parsed.errors.length
                ? UI.confirm({
                    title: 'Có ' + parsed.errors.length + ' dòng bị lỗi',
                    body: h('div', null,
                        h('p', { text: 'Các dòng sau không thể nhập vì thiếu hoặc sai dấu phân cách:' }),
                        listForDialog(parsed.errors.map(function (e) { return e.label + ': ' + e.reason; }), 6),
                        h('p', { text: 'Bạn có thể nhập ' + parsed.rows.length + ' dòng hợp lệ trước. Các dòng lỗi sẽ được giữ lại trong khung nhập để bạn sửa.' })),
                    buttons: [
                        { label: 'Quay lại sửa', value: false },
                        { label: 'Nhập ' + parsed.rows.length + ' dòng hợp lệ', kind: 'primary', value: true }
                    ],
                    dismissValue: false
                })
                : Promise.resolve(true);

            step1.then(function (go) {
                if (!go) { return false; }
                var dups = Engine.findDuplicates(currentTerms(), rowsToAdd);
                if (!dups.length) { return 'all'; }
                return UI.confirm({
                    title: 'Có từ có thể bị trùng',
                    body: h('div', null,
                        h('p', { text: 'Phát hiện ' + dups.length + ' từ đã có trong danh sách hoặc bị lặp trong dữ liệu vừa dán:' }),
                        listForDialog(dups.map(function (d) { return d.term + (d.where === 'existing' ? '  (đã có trong danh sách)' : '  (lặp trong dữ liệu dán)'); }), 8),
                        h('p', { text: 'Bạn muốn xử lý thế nào?' })),
                    buttons: [
                        { label: 'Quay lại', value: false },
                        { label: 'Vẫn thêm tất cả', value: 'all' },
                        { label: 'Bỏ qua từ trùng', kind: 'primary', value: 'skip' }
                    ],
                    dismissValue: false
                }).then(function (choice) {
                    if (choice === 'skip') {
                        var drop = {};
                        dups.forEach(function (d) { drop[d.rowIndex] = true; });
                        rowsToAdd = rowsToAdd.filter(function (r, i) { return !drop[i]; });
                    }
                    return choice;
                });
            }).then(function (choice) {
                importing = false;
                if (!choice) { return; }

                var kept = rows.filter(function (r) { return r.term.trim() || r.definition.trim(); });
                if (kept.length + rowsToAdd.length > Engine.MAX_CARDS) {
                    UI.toast('Mỗi học phần tối đa ' + Engine.MAX_CARDS + ' từ vựng. Hãy bớt dữ liệu nhập.', 'warn');
                    return;
                }
                var added = [];
                rowsToAdd.forEach(function (r) { added.push(newRow(r.term, r.definition)); });
                rows = kept.concat(added);
                if (!rows.length) { rows.push(newRow()); }

                var leftover = parsed.errors.map(function (e) { return trimLine(e.raw); });
                if (leftover.length) {
                    bulkText.value = Engine.joinItems(leftover, bulkOpts.card);
                    renderRows();
                    renderPreview();
                    UI.toast('Đã nhập ' + added.length + ' từ. Còn ' + leftover.length + ' dòng lỗi cần sửa.', 'warn');
                } else {
                    bulkText.value = '';
                    renderRows();
                    setBulk(false);
                    if (added.length) {
                        UI.toast('Đã nhập ' + added.length + ' từ vựng vào danh sách.', 'success');
                        var firstNew = added[0];
                        if (firstNew.els) {
                            firstNew.els.term.closest('.word-row').classList.add('just-added');
                            firstNew.els.term.scrollIntoView({ block: 'center' });
                        }
                    } else {
                        UI.toast('Không có từ nào được thêm (tất cả đều trùng).', 'info');
                    }
                }
            });
        }

        function trimLine(s) { return s.replace(/^[\r\n]+|[\r\n]+$/g, ''); }

        function cancelBulk() {
            if (bulkText.value.trim() === '') {
                bulkText.value = '';
                setBulk(false);
                return;
            }
            UI.confirm({
                title: 'Hủy nhập?',
                body: 'Nội dung bạn đã dán chưa được nhập vào danh sách và sẽ bị xóa nếu bạn hủy nhập.',
                buttons: [
                    { label: 'Tiếp tục nhập', value: false },
                    { label: 'Hủy nhập', kind: 'danger', value: true }
                ],
                dismissValue: false
            }).then(function (ok) {
                if (ok) { bulkText.value = ''; setBulk(false); }
            });
        }

        /* ----- Kiểm tra & lưu ----- */

        function showErrors(list) {
            errorBox.textContent = '';
            if (!list.length) { errorBox.hidden = true; return; }
            errorBox.hidden = false;
            errorBox.appendChild(h('strong', { text: 'Vui lòng sửa các mục sau:' }));
            var ul = h('ul');
            list.forEach(function (m) { ul.appendChild(h('li', { text: m })); });
            errorBox.appendChild(ul);
        }

        function validate() {
            var errors = [];
            var firstInvalid = null;
            var name = nameInput.value.replace(/\s+/g, ' ').trim();

            nameInput.classList.remove('invalid');
            nameError.hidden = true;
            if (!name) {
                errors.push('Tên học phần không được để trống.');
                nameInput.classList.add('invalid');
                nameError.textContent = 'Hãy đặt tên cho học phần của bạn.';
                nameError.hidden = false;
                firstInvalid = nameInput;
            }

            var cards = [];
            rows.forEach(function (r, i) {
                clearInvalid(r);
                var t = r.term.replace(/\s+/g, ' ').trim();
                var d = r.definition.replace(/\s+/g, ' ').trim();
                if (!t && !d) { return; }          // dòng trống hoàn toàn: bỏ qua
                if (!t) {
                    errors.push('Dòng ' + (i + 1) + ': thiếu thuật ngữ tiếng Anh.');
                    r.els.term.classList.add('invalid');
                    firstInvalid = firstInvalid || r.els.term;
                } else if (!d) {
                    errors.push('Dòng ' + (i + 1) + ': thiếu nghĩa tiếng Việt cho "' + truncate(t, 40) + '".');
                    r.els.def.classList.add('invalid');
                    firstInvalid = firstInvalid || r.els.def;
                } else {
                    cards.push({ id: r.id, term: t, definition: d });
                }
            });

            if (!cards.length && !errors.length) {
                errors.push('Hãy nhập ít nhất một từ vựng (thuật ngữ và nghĩa).');
                firstInvalid = firstInvalid || (rows[0] && rows[0].els ? rows[0].els.term : null);
            } else if (!cards.length && errors.length === 1 && !name) {
                errors.push('Hãy nhập ít nhất một từ vựng (thuật ngữ và nghĩa).');
            }
            if (cards.length > Engine.MAX_CARDS) { errors.push('Mỗi học phần tối đa ' + Engine.MAX_CARDS + ' từ vựng.'); }

            return { ok: errors.length === 0, errors: errors, cards: cards, name: name, focus: firstInvalid };
        }

        function commit(res) {
            var now = Date.now();
            var toastHost = document.getElementById('toasts');
            if (toastHost) { toastHost.textContent = ''; }   // bỏ các thông báo nhập hàng loạt cũ trước khi báo kết quả lưu
            if (!existing) {
                var set = {
                    id: Engine.uid(), name: res.name, createdAt: now, updatedAt: now, lastStudiedAt: null,
                    cards: res.cards.map(function (c) { return { id: Engine.uid(), term: c.term, definition: c.definition, starred: false, unknown: false, learned: false }; }),
                    history: [], session: null
                };
                Store.addSet(set);
                saved = true;
                UI.toast('Tạo học phần thành công!', 'success');
                location.hash = '#/';
                return;
            }

            var oldById = {};
            existing.cards.forEach(function (c) { oldById[c.id] = c; });
            var valid = {};
            existing.cards = res.cards.map(function (c) {
                var old = c.id && oldById[c.id];
                var card = old
                    ? { id: old.id, term: c.term, definition: c.definition, starred: old.starred, unknown: old.unknown, learned: old.learned }
                    : { id: Engine.uid(), term: c.term, definition: c.definition, starred: false, unknown: false, learned: false };
                valid[card.id] = true;
                return card;
            });
            existing.name = res.name;
            existing.updatedAt = now;
            existing.session = Engine.reconcileSession(existing.session, valid, now);
            Store.save();
            saved = true;
            UI.toast('Đã lưu thay đổi.', 'success');
            location.hash = '#/set/' + existing.id;
        }

        function save() {
            var res = validate();
            showErrors(res.errors);
            if (!res.ok) {
                if (res.focus) { res.focus.focus(); }
                return;
            }
            if (bulkMode && bulkText.value.trim() !== '') {
                UI.confirm({
                    title: 'Còn dữ liệu chưa nhập',
                    body: 'Khung nhập hàng loạt vẫn còn nội dung chưa bấm "Nhập". Nếu tiếp tục, nội dung đó sẽ không được thêm vào học phần.',
                    buttons: [
                        { label: 'Quay lại', value: false },
                        { label: 'Bỏ nội dung đó và lưu', kind: 'danger', value: true }
                    ],
                    dismissValue: false
                }).then(function (ok) { if (ok) { commit(res); } });
                return;
            }
            commit(res);
        }

        /* ----- Lắp ráp ----- */

        nameInput.addEventListener('input', function () {
            nameInput.classList.remove('invalid');
            nameError.hidden = true;
        });
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); if (rows[0] && rows[0].els) { rows[0].els.term.focus(); } }
        });
        bulkText.addEventListener('input', schedulePreview);

        bulkPanel.appendChild(h('div', { class: 'bulk-head' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-caps', text: 'HỦY NHẬP', onclick: cancelBulk }),
            h('div', { class: 'bulk-head-text' },
                h('h3', { class: 'section-title', text: 'Nhập dữ liệu' }),
                h('p', { class: 'muted', text: 'Chép và dán dữ liệu ở đây (từ Word, Excel, Google Docs, v.v.)' }))));
        bulkPanel.appendChild(bulkSummary);
        bulkPanel.appendChild(bulkText);
        bulkPanel.appendChild(h('div', { class: 'bulk-options' },
            radioGroup('field-sep', 'Giữa thuật ngữ và định nghĩa', [
                { value: 'tab', label: 'Tab' }, { value: 'comma', label: 'Phẩy' }, { value: 'pipe', label: 'Dấu |' }
            ], bulkOpts.field, function (v) { bulkOpts.field = v; refreshBulkOptions(); }),
            radioGroup('card-sep', 'Giữa các thẻ', [
                { value: 'newline', label: 'Dòng mới' }, { value: 'semicolon', label: 'Dấu Chấm phẩy' }, { value: 'tilde', label: 'Dấu ngã ~' }
            ], bulkOpts.card, function (v) { bulkOpts.card = v; refreshBulkOptions(); })));
        bulkPanel.appendChild(h('div', { class: 'bulk-actions' }, importBtn, insertTabBtn));
        bulkPanel.appendChild(previewHost);

        manualPanel.appendChild(rowsHost);

        var root = h('section', { class: 'page editor' },
            h('div', { class: 'topbar' },
                h('a', { class: 'icon-btn', href: existing ? '#/set/' + existing.id : '#/', title: 'Quay lại', 'aria-label': 'Quay lại' }, icon('back')),
                h('h1', { class: 'page-title', text: existing ? 'Chỉnh sửa học phần' : 'Tạo học phần mới' })),
            h('div', { class: 'card' },
                h('label', { for: 'set-name', class: 'label', text: 'Tên học phần của bạn' }), nameInput, nameError),
            h('div', { class: 'card' },
                h('div', { class: 'section-head' },
                    h('h2', { class: 'section-title', text: 'Từ vựng' }), countBadge, h('span', { class: 'spacer' }), bulkBtn),
                manualPanel, bulkPanel, addBtn),
            errorBox,
            h('div', { class: 'form-actions' }, cancelBtn, saveBtn));

        function onBeforeUnload(e) {
            if (isDirty()) { e.preventDefault(); e.returnValue = ''; return ''; }
            return undefined;
        }
        window.addEventListener('beforeunload', onBeforeUnload);

        renderRows();
        renderPreview();
        bulkText.placeholder = placeholderText();
        initialSnapshot = snapshot();

        return {
            el: root,
            isDirty: isDirty,
            focus: function () { nameInput.focus(); },
            destroy: function () { window.removeEventListener('beforeunload', onBeforeUnload); clearTimeout(previewTimer); }
        };
    }

    return { create: create };
}());
