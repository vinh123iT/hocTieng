/*!
 * PinkVocab – study.js
 * Màn hình HỌC từ vựng: hỏi – trả lời – kiểm tra – tính tiến độ, đánh dấu sao / "Không biết",
 * cửa sổ cài đặt học tập và màn hình kết quả. Mọi số liệu đều lấy từ phiên học thật (Engine).
 */
var StudyView = (function () {
    'use strict';

    var h = UI.h;
    var icon = UI.icon;

    var MODE_LABELS = { all: 'Học tất cả', starred: 'Chỉ các thuật ngữ có dấu sao', unknown: 'Ôn các từ chưa biết' };

    function notFound() {
        return {
            el: h('section', { class: 'page narrow' },
                h('div', { class: 'card empty-state' },
                    h('h1', { class: 'page-title', text: 'Không tìm thấy học phần' }),
                    h('a', { class: 'btn btn-primary', href: '#/', text: 'Về trang chủ' }))),
            isDirty: function () { return false; },
            destroy: function () { }
        };
    }

    function unsupportedSpeech() {
        UI.toast('Trình duyệt này chưa hỗ trợ đọc giọng nói.', 'warn');
    }

    /** Dòng công tắc dùng trong cửa sổ cài đặt. */
    function switchRow(label, hint, checked, onChange, disabled) {
        var input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, disabled: !!disabled });
        input.addEventListener('change', function () { onChange(input.checked); });
        return h('div', { class: 'setting-row' + (disabled ? ' is-disabled' : '') },
            h('div', { class: 'setting-text' }, h('strong', { text: label }), h('small', { text: hint })),
            h('label', { class: 'switch', 'aria-label': label }, input, h('span', { class: 'slider' })));
    }

    function create(setId) {
        var set = Store.getSet(setId);
        if (!set) { return notFound(); }

        var root = h('section', { class: 'page study-page' });
        var advanceTimer = null;
        var phase = 'ask';            // ask | wrong | correct | revealed
        var lastActionAt = 0;
        var ui = {};                  // tham chiếu tới các phần tử của câu hỏi hiện tại
        var cardById = {};

        function reindex() {
            cardById = {};
            set.cards.forEach(function (c) { cardById[c.id] = c; });
        }
        reindex();

        function st() { return Store.settings(); }

        /* ---------- Phiên học ---------- */

        function startSession(mode) {
            var ids = Engine.buildPool(set.cards, mode);
            if (!ids.length) { set.session = null; return false; }
            set.session = Engine.createSession(ids, mode, st().deepMemory, Date.now());
            Store.save();
            return true;
        }

        function ensureSession() {
            if (set.session) { return true; }
            return startSession(st().studyMode);
        }

        function recordResult() {
            var s = set.session;
            var r = Engine.results(s);
            set.history.push({ at: Date.now(), mode: s.poolMode, total: r.total, correct: r.correct, wrong: r.wrong, accuracy: r.accuracy });
            if (set.history.length > 20) { set.history = set.history.slice(-20); }
        }

        function activeMode() {
            return set.session && !set.session.finished ? set.session.poolMode : st().studyMode;
        }

        /* ---------- Hiển thị tổng ---------- */

        function render() {
            clearTimeout(advanceTimer);
            Speech.stop();
            root.textContent = '';
            if (!ensureSession()) { renderEmpty(); return; }
            if (set.session.finished) { renderResults(); return; }
            renderStudy();
        }

        function topbar(opts) {
            var children = [
                h('a', { class: 'icon-btn', href: '#/set/' + set.id, title: 'Quay lại', 'aria-label': 'Quay lại học phần' }, icon('back'))
            ];
            children.push(opts.middle);
            if (opts.gear) {
                children.push(h('button', {
                    type: 'button', class: 'icon-btn', title: 'Cài đặt học tập', 'aria-label': 'Cài đặt học tập', onclick: openSettings
                }, icon('gear')));
            }
            return h('div', { class: 'study-top' }, children);
        }

        /* ---------- Chưa có từ để học ---------- */

        function renderEmpty() {
            var mode = st().studyMode;
            var title = mode === 'starred' ? 'Chưa có thuật ngữ nào được đánh dấu sao' : 'Chưa có từ nào cần ôn tập';
            var text = mode === 'starred'
                ? 'Hãy đánh dấu sao cho những từ quan trọng (ở trang học phần hoặc trong lúc học), hoặc chuyển sang học tất cả các từ.'
                : 'Bạn chưa nhấn "Không biết" ở từ nào, hoặc đã ghi nhớ hết các từ đó. Hãy học tất cả các từ trước nhé.';
            root.appendChild(topbar({ gear: true, middle: h('h1', { class: 'study-title', text: set.name }) }));
            root.appendChild(h('div', { class: 'card empty-state' },
                h('div', { class: 'empty-icon' }, icon('star')),
                h('h2', { class: 'section-title', text: title }),
                h('p', { class: 'muted', text: text }),
                h('div', { class: 'actions center' },
                    h('button', {
                        type: 'button', class: 'btn btn-primary', text: 'Học tất cả',
                        onclick: function () { Store.updateSettings({ studyMode: 'all' }); set.session = null; render(); }
                    }),
                    h('button', { type: 'button', class: 'btn btn-ghost', text: 'Mở cài đặt', onclick: openSettings }))));
        }

        /* ---------- Màn hình học ---------- */

        function updateProgress() {
            var p = Engine.progress(set.session);
            ui.fill.style.width = p.percent + '%';
            ui.progress.setAttribute('aria-valuenow', String(p.percent));
            ui.progressText.textContent = 'Đã hoàn thành ' + p.done + '/' + p.total + ' từ · ' + p.percent + '%';
        }

        function renderStudy() {
            ui = {};
            ui.fill = h('div', { class: 'progress-fill' });
            ui.progress = h('div', {
                class: 'progress', role: 'progressbar', 'aria-label': 'Tiến độ', 'aria-valuemin': '0', 'aria-valuemax': '100'
            }, ui.fill);
            ui.progressText = h('div', { class: 'progress-text' });
            ui.stage = h('div', { class: 'study-stage' });

            root.appendChild(topbar({
                gear: true,
                middle: h('div', { class: 'progress-wrap' }, ui.progress, ui.progressText)
            }));
            root.appendChild(h('p', { class: 'study-set-name', text: set.name + ' · ' + MODE_LABELS[set.session.poolMode] }));
            root.appendChild(ui.stage);
            updateProgress();
            showQuestion('');
        }

        function setFeedback(kind, message, extra) {
            ui.feedback.textContent = '';
            ui.feedback.className = 'feedback fb-' + kind;
            if (!message) { return; }
            ui.feedback.appendChild(h('strong', { class: 'fb-message', text: message }));
            if (extra && extra.answer) {
                ui.feedback.appendChild(h('div', { class: 'fb-answer' }, 'Đáp án: ', h('span', { text: extra.answer })));
            }
            if (extra && extra.note) { ui.feedback.appendChild(h('div', { class: 'fb-note', text: extra.note })); }
            if (extra && extra.buttons) {
                var row = h('div', { class: 'fb-actions' });
                extra.buttons.forEach(function (b) { row.appendChild(b); });
                ui.feedback.appendChild(row);
            }
        }

        function burst() {
            var wrap = h('div', { class: 'burst', 'aria-hidden': 'true' });
            for (var i = 0; i < 6; i++) {
                var s = h('span', { class: 'burst-star' }, icon('star', true));
                s.style.setProperty('--a', (i * 60 - 90) + 'deg');
                wrap.appendChild(s);
            }
            ui.card.appendChild(wrap);
            setTimeout(function () { wrap.remove(); }, 1000);
        }

        function speakEnglish(text) {
            return Speech.speak(text, st(), unsupportedSpeech);
        }

        function showQuestion(keepText) {
            clearTimeout(advanceTimer);
            var session = set.session;
            var id = Engine.current(session);
            var card = id ? cardById[id] : null;
            if (!card) {
                // Từ không còn tồn tại (đã xóa): bỏ khỏi phiên rồi hỏi tiếp.
                var valid = {};
                set.cards.forEach(function (c) { valid[c.id] = true; });
                set.session = Engine.reconcileSession(session, valid, Date.now());
                Store.save();
                render();
                return;
            }

            var settings = st();
            var termFirst = settings.termFirst;
            var promptText = termFirst ? card.term : card.definition;
            var expected = termFirst ? card.definition : card.term;
            var masked = settings.hideContent;
            phase = 'ask';

            ui.card = h('div', { class: 'study-card card' });
            ui.stage.textContent = '';
            ui.stage.appendChild(ui.card);

            /* hàng trên: sao – loa – Không biết */
            ui.star = h('button', {
                type: 'button', class: 'icon-btn star-btn' + (card.starred ? ' is-on' : ''), 'aria-pressed': card.starred ? 'true' : 'false',
                title: 'Đánh dấu sao', 'aria-label': 'Đánh dấu sao từ này'
            }, icon('star', card.starred));
            ui.star.addEventListener('click', function () {
                card.starred = !card.starred;
                Store.save();
                ui.star.classList.toggle('is-on', card.starred);
                ui.star.setAttribute('aria-pressed', card.starred ? 'true' : 'false');
                ui.star.replaceChild(icon('star', card.starred), ui.star.firstChild);
            });

            var top = h('div', { class: 'study-card-top' }, ui.star);
            ui.speaker = h('button', {
                type: 'button', class: 'icon-btn', title: 'Nghe phát âm', 'aria-label': 'Nghe phát âm',
                onclick: function () { speakEnglish(card.term); }
            }, icon('speaker'));
            if (termFirst) { top.appendChild(ui.speaker); }
            top.appendChild(h('span', { class: 'spacer' }));
            ui.unknownBtn = h('button', {
                type: 'button', class: 'btn btn-soft', text: 'Không biết', onclick: function () { giveUp('unknown'); }
            });
            top.appendChild(ui.unknownBtn);
            ui.card.appendChild(top);

            /* từ cần học */
            ui.prompt = h('p', { class: 'prompt', lang: termFirst ? 'en' : 'vi', text: masked ? '• • • • •' : promptText });
            var promptArea = h('div', { class: 'prompt-area' }, ui.prompt);
            if (masked) {
                ui.prompt.classList.add('is-masked');
                ui.reveal = h('button', {
                    type: 'button', class: 'btn btn-ghost btn-small', onclick: function () {
                        ui.prompt.textContent = promptText;
                        ui.prompt.classList.remove('is-masked');
                        ui.reveal.remove();
                        ui.answer.focus();
                    }
                }, icon('eye'), ' Hiện');
                promptArea.appendChild(ui.reveal);
            }
            ui.card.appendChild(promptArea);
            ui.card.appendChild(h('hr', { class: 'divider' }));

            /* ô nhập đáp án */
            var placeholder = termFirst ? 'Nhập bằng định nghĩa' : 'Nhập bằng thuật ngữ';
            ui.answer = h('input', {
                type: 'text', class: 'input answer-input', placeholder: placeholder, 'aria-label': placeholder,
                autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', lang: termFirst ? 'vi' : 'en',
                enterkeyhint: 'done', value: keepText || ''
            });
            ui.submit = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Trả lời' });
            var form = h('form', { class: 'answer-form', novalidate: true }, ui.answer, ui.submit);
            form.addEventListener('submit', function (e) { e.preventDefault(); handleSubmit(card, expected); });
            ui.card.appendChild(form);

            ui.feedback = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
            ui.card.appendChild(ui.feedback);

            ui.answer.addEventListener('input', function () {
                if (phase === 'ask') { setFeedback('none', ''); }
            });

            if (settings.speak && termFirst) { speakEnglish(card.term); }
            if (!masked || !keepText) { ui.answer.focus(); }
            ui.current = { card: card, expected: expected };
        }

        function continueButton() {
            return h('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Tiếp tục', onclick: next });
        }

        function lockInput() {
            ui.answer.disabled = true;
            ui.submit.disabled = true;
            ui.unknownBtn.disabled = true;
        }

        function handleSubmit(card, expected) {
            if (phase === 'correct' || phase === 'revealed') {
                if (Date.now() - lastActionAt > 400) { next(); }   // chống nhấn Enter đúp làm bỏ qua phản hồi
                return;
            }
            var res = Engine.checkAnswer(ui.answer.value, expected);
            if (res.status === 'empty') {
                setFeedback('warn', 'Hãy nhập đáp án của bạn, hoặc nhấn "Không biết".');
                ui.answer.focus();
                return;
            }
            if (res.status === 'correct') { onCorrect(card, expected); } else { onWrong(card, expected); }
        }

        function onCorrect(card, expected) {
            var settings = st();
            phase = 'correct';
            lastActionAt = Date.now();
            var out = Engine.answerCorrect(set.session, settings.deepMemory, lastActionAt);
            if (out.completed) {
                card.learned = out.firstTry;
                if (out.firstTry && card.unknown) { card.unknown = false; }
            }
            set.lastStudiedAt = lastActionAt;
            if (set.session.finished) { recordResult(); }
            Store.save();

            if (settings.soundCorrect) { Sfx.success(); }
            lockInput();
            if (ui.reveal && ui.reveal.parentNode) { ui.reveal.click(); }   // nếu đang ẩn nội dung thì hiện lại
            ui.card.classList.add('is-correct');
            burst();
            setFeedback('success', 'Chính xác! Bạn làm tốt lắm!', { answer: expected, buttons: [continueButton()] });
            updateProgress();
            if (!settings.termFirst && settings.speak) { speakEnglish(card.term); }
            advanceTimer = setTimeout(next, set.session.finished ? 1200 : 1300);
        }

        function onWrong(card, expected) {
            var settings = st();
            phase = 'wrong';
            lastActionAt = Date.now();
            Engine.answerWrong(set.session, settings.deepMemory);
            card.learned = false;
            set.lastStudiedAt = lastActionAt;
            Store.save();

            if (settings.soundWrong) { Sfx.error(); }
            ui.card.classList.remove('is-shake');
            void ui.card.offsetWidth;
            ui.card.classList.add('is-shake');
            var retry = h('button', {
                type: 'button', class: 'btn btn-ghost btn-small', text: 'Thử lại',
                onclick: function () { ui.answer.focus(); ui.answer.select(); }
            });
            var show = h('button', { type: 'button', class: 'btn btn-soft btn-small', text: 'Xem đáp án', onclick: function () { giveUp('show'); } });
            setFeedback('warn', 'Chưa chính xác, hãy thử lại nhé!', { buttons: [retry, show] });
            ui.answer.focus();
            ui.answer.select();
        }

        /** kind = 'unknown' (nút "Không biết") hoặc 'show' (xem đáp án sau khi trả lời sai). */
        function giveUp(kind) {
            if (phase === 'correct' || phase === 'revealed') { return; }
            var settings = st();
            var info = ui.current;
            var card = info.card;
            phase = 'revealed';
            lastActionAt = Date.now();
            Engine.giveUp(set.session, settings.deepMemory);
            card.learned = false;
            if (kind === 'unknown') { card.unknown = true; }
            set.lastStudiedAt = lastActionAt;
            Store.save();

            lockInput();
            if (ui.reveal && ui.reveal.parentNode) { ui.reveal.click(); }
            setFeedback('info', kind === 'unknown' ? 'Không sao, mình sẽ cho từ này quay lại sau nhé.' : 'Đây là đáp án của từ này.', {
                answer: info.expected,
                note: kind === 'unknown' ? 'Từ này đã được đánh dấu cần ôn tập thêm.' : null,
                buttons: [continueButton()]
            });
            var continueBtn = ui.feedback.querySelector('button');
            if (continueBtn) { continueBtn.focus(); }
            if (!settings.termFirst && settings.speak) { speakEnglish(card.term); }
        }

        function next() {
            clearTimeout(advanceTimer);
            if (set.session && set.session.finished) { render(); return; }
            showQuestion('');
        }

        /* ---------- Màn hình kết quả ---------- */

        function startAgain(mode) {
            if (mode !== st().studyMode) { Store.updateSettings({ studyMode: mode }); }
            set.session = null;
            if (!startSession(mode)) { set.session = null; }
            render();
        }

        /** "Bắt đầu lại": học lại từ đầu đúng những từ của lượt vừa xong (không tính lại danh sách theo cờ hiện tại). */
        function restartSame() {
            var old = set.session;
            var ids;
            if (old.poolMode === 'all') {
                ids = Engine.buildPool(set.cards, 'all');
            } else {
                ids = set.cards.filter(function (c) { return old.cards[c.id]; }).map(function (c) { return c.id; });
            }
            if (!ids.length) { ids = Engine.buildPool(set.cards, 'all'); old = { poolMode: 'all' }; }
            set.session = Engine.createSession(ids, old.poolMode, st().deepMemory, Date.now());
            Store.save();
            render();
        }

        function renderResults() {
            var r = Engine.results(set.session);
            var unknownCount = Engine.buildPool(set.cards, 'unknown').length;
            var hasScore = r.accuracy !== null;

            root.appendChild(h('div', { class: 'study-top' },
                h('a', { class: 'icon-btn', href: '#/set/' + set.id, title: 'Quay lại', 'aria-label': 'Quay lại học phần' }, icon('back')),
                h('h1', { class: 'study-title', text: set.name })));

            var ring = h('div', { class: 'ring' + (hasScore ? '' : ' ring-empty'), role: 'img', 'aria-label': hasScore ? 'Tỉ lệ chính xác ' + r.accuracy + '%' : 'Chưa có điểm' },
                h('div', { class: 'ring-inner' }, hasScore ? h('span', { class: 'ring-value', text: r.accuracy + '%' }) : h('span', { class: 'ring-value', text: '—' })));
            if (hasScore) { ring.style.setProperty('--p', String(r.accuracy)); }

            var actions = h('div', { class: 'actions center' },
                h('button', {
                    type: 'button', class: 'btn btn-primary btn-strong', onclick: restartSame
                }, icon('refresh'), ' Bắt đầu lại'),
                h('a', { class: 'btn btn-ghost', href: '#/set/' + set.id, text: 'Quay về học phần' }));
            if (unknownCount > 0 && set.session.poolMode !== 'unknown') {
                actions.appendChild(h('button', {
                    type: 'button', class: 'btn btn-soft', text: 'Ôn ' + unknownCount + ' từ chưa biết', onclick: function () { startAgain('unknown'); }
                }));
            }

            root.appendChild(h('div', { class: 'card results' },
                h('div', { class: 'result-badge' }, icon('check')),
                h('h2', { class: 'results-title', text: 'Hoàn thành lượt học!' }),
                h('p', { class: 'muted', text: MODE_LABELS[set.session.poolMode] }),
                h('div', { class: 'ring-wrap' },
                    ring,
                    h('div', { class: 'ring-label', text: 'Tỉ lệ chính xác' })),
                hasScore ? null : h('p', { class: 'muted', text: 'Chưa có câu trả lời nào được tính điểm.' }),
                h('dl', { class: 'stats' },
                    h('div', null, h('dt', { text: 'Tổng số từ' }), h('dd', { text: String(r.total) })),
                    h('div', { class: 'stat-ok' }, h('dt', { text: 'Trả lời đúng' }), h('dd', { text: String(r.correct) })),
                    h('div', { class: 'stat-bad' }, h('dt', { text: 'Trả lời sai' }), h('dd', { text: String(r.wrong) }))),
                h('p', { class: 'fineprint', text: 'Mỗi từ chỉ được tính điểm một lần, theo lần trả lời đầu tiên.' }),
                actions));
        }

        /* ---------- Cửa sổ cài đặt ---------- */

        function openSettings() {
            var cur = st();
            var draft = {};
            Object.keys(cur).forEach(function (k) { draft[k] = cur[k]; });
            draft.studyMode = activeMode();

            var counts = {
                all: set.cards.length,
                starred: Engine.buildPool(set.cards, 'starred').length,
                unknown: Engine.buildPool(set.cards, 'unknown').length
            };

            var modeBox = h('div', { class: 'setting-group' }, h('h3', { class: 'group-title', text: 'Chế độ học' }));
            [
                ['all', 'Học tất cả', 'Học toàn bộ ' + counts.all + ' từ vựng của học phần.'],
                ['starred', 'Học các thuật ngữ có dấu sao', 'Chỉ học ' + counts.starred + ' từ đã đánh dấu sao.'],
                ['unknown', 'Ôn các từ chưa biết', 'Chỉ ôn ' + counts.unknown + ' từ bạn đã nhấn "Không biết".']
            ].forEach(function (m) {
                var input = h('input', { type: 'radio', name: 'study-mode', value: m[0], checked: draft.studyMode === m[0] });
                input.addEventListener('change', function () { if (input.checked) { draft.studyMode = m[0]; } });
                modeBox.appendChild(h('label', { class: 'radio radio-block' }, input,
                    h('span', null, h('strong', { text: m[1] }), h('small', { text: m[2] }))));
            });

            var supported = Speech.supported;

            var langSelect = h('select', { class: 'input', 'aria-label': 'Ngôn ngữ đọc', disabled: !supported });
            [['en-US', 'Tiếng Anh (Mỹ)'], ['en-GB', 'Tiếng Anh (Anh)'], ['en-AU', 'Tiếng Anh (Úc)'], ['en-IN', 'Tiếng Anh (Ấn Độ)']].forEach(function (l) {
                langSelect.appendChild(h('option', { value: l[0], text: l[1], selected: draft.speakLang === l[0] }));
            });
            var voiceSelect = h('select', { class: 'input', 'aria-label': 'Giọng đọc', disabled: !supported });

            function fillVoices() {
                var chosen = voiceSelect.value || draft.voiceURI;
                voiceSelect.textContent = '';
                voiceSelect.appendChild(h('option', { value: '', text: 'Tự động chọn giọng' }));
                var found = false;
                Speech.voicesFor(draft.speakLang).forEach(function (v) {
                    var isChosen = v.voiceURI === chosen;
                    if (isChosen) { found = true; }
                    voiceSelect.appendChild(h('option', { value: v.voiceURI, text: v.name, selected: isChosen }));
                });
                if (!found) { draft.voiceURI = ''; voiceSelect.value = ''; }
            }
            langSelect.addEventListener('change', function () { draft.speakLang = langSelect.value; draft.voiceURI = ''; voiceSelect.value = ''; fillVoices(); });
            voiceSelect.addEventListener('change', function () { draft.voiceURI = voiceSelect.value; });
            fillVoices();
            setTimeout(fillVoices, 700);   // danh sách giọng đọc của một số trình duyệt nạp chậm

            var testBtn = h('button', {
                type: 'button', class: 'btn btn-ghost btn-small', disabled: !supported,
                onclick: function () { speakEnglish_(draft, 'Hello! Welcome to PinkVocab.'); }
            }, icon('speaker'), ' Nghe thử giọng đọc');

            function speakEnglish_(settingsLike, text) { Speech.speak(text, settingsLike, unsupportedSpeech); }

            var readBox = h('div', { class: 'setting-group' }, h('h3', { class: 'group-title', text: 'Đọc từ vựng' }),
                switchRow('Đọc nội dung', supported
                    ? 'Tự động đọc từ tiếng Anh bằng giọng đọc của trình duyệt. Bạn vẫn có thể bấm nút loa để nghe lại.'
                    : 'Trình duyệt này không hỗ trợ đọc giọng nói.', draft.speak && supported, function (v) { draft.speak = v; }, !supported),
                h('div', { class: 'setting-field' }, h('label', { text: 'Ngôn ngữ đọc' }), langSelect),
                h('div', { class: 'setting-field' }, h('label', { text: 'Giọng đọc' }), voiceSelect),
                testBtn);

            var deepValue = h('span', { class: 'deep-value', text: String(draft.deepMemory) });
            var deepHint = h('small', { class: 'deep-hint' });
            function describeDeep(n) {
                return n === 1
                    ? 'Mỗi từ chỉ cần trả lời đúng 1 lần.'
                    : 'Mỗi từ phải trả lời đúng ' + n + ' lần liên tiếp mới hoàn thành. Trả lời sai thì làm lại từ đầu; từ sẽ quay lại sau vài từ khác.';
            }
            deepHint.textContent = describeDeep(draft.deepMemory);
            var deepInput = h('input', {
                type: 'range', min: '1', max: '5', step: '1', value: String(draft.deepMemory), class: 'range', 'aria-label': 'Deep Memory'
            });
            deepInput.addEventListener('input', function () {
                draft.deepMemory = parseInt(deepInput.value, 10);
                deepValue.textContent = String(draft.deepMemory);
                deepHint.textContent = describeDeep(draft.deepMemory);
            });

            var memoryBox = h('div', { class: 'setting-group' }, h('h3', { class: 'group-title', text: 'Ghi nhớ' }),
                switchRow('Hiển thị thuật ngữ đầu tiên',
                    'Bật: hiện từ tiếng Anh và bạn nhập nghĩa tiếng Việt. Tắt: hiện nghĩa tiếng Việt và bạn nhập từ tiếng Anh.',
                    draft.termFirst, function (v) { draft.termFirst = v; }),
                switchRow('Ẩn nội dung',
                    'Che nội dung cần ghi nhớ bằng dấu chấm cho tới khi bạn nhấn "Hiện". Kết hợp với "Đọc nội dung" để luyện nghe.',
                    draft.hideContent, function (v) { draft.hideContent = v; }),
                h('div', { class: 'setting-row column' },
                    h('div', { class: 'setting-text' }, h('strong', { text: 'Deep Memory' }), h('span', { class: 'deep-badge' }, 'Mức ', deepValue)),
                    deepInput,
                    h('div', { class: 'range-scale', 'aria-hidden': 'true' }, h('span', { text: '1' }), h('span', { text: '5' })),
                    deepHint));

            var soundBox = h('div', { class: 'setting-group' }, h('h3', { class: 'group-title', text: 'Âm thanh' }),
                switchRow('Âm thanh khi trả lời đúng', 'Phát tiếng "ting" nhẹ khi bạn trả lời đúng.', draft.soundCorrect, function (v) { draft.soundCorrect = v; }),
                switchRow('Âm thanh khi trả lời sai', 'Phát âm báo nhẹ nhàng khi trả lời sai. Mặc định tắt.', draft.soundWrong, function (v) { draft.soundWrong = v; }));

            var body = h('div', { class: 'settings-body' }, modeBox, readBox, memoryBox, soundBox);

            UI.dialog({
                title: 'Cài đặt học tập', body: body, wide: true, backdropClose: false, dismissValue: false,
                buttons: [
                    { label: 'Cancel', value: false },
                    { label: 'OK', kind: 'primary', value: true }
                ]
            }).promise.then(function (ok) {
                if (!ok) { return; }
                applySettings(draft);
            });
        }

        function applySettings(draft) {
            var oldMode = activeMode();
            var wantsRestart = draft.studyMode !== oldMode;

            function commit(restart) {
                if (!restart) { draft.studyMode = oldMode; }
                var keep = ui.answer && phase === 'ask' ? ui.answer.value : '';
                Store.updateSettings(draft);
                var s = st();
                if (restart) {
                    set.session = null;
                    Store.save();
                    render();
                    return;
                }
                if (set.session && !set.session.finished) { Engine.applyDeep(set.session, s.deepMemory); Store.save(); }
                if (set.session && !set.session.finished && phase !== 'correct' && phase !== 'revealed') {
                    ui.stage.textContent = '';
                    showQuestion(keep);
                } else if (!set.session || set.session.finished) {
                    render();
                }
                UI.toast('Đã lưu cài đặt.', 'success');
            }

            if (wantsRestart && Engine.hasProgress(set.session)) {
                var p = Engine.progress(set.session);
                UI.confirm({
                    title: 'Bắt đầu lượt học mới?',
                    body: 'Đổi chế độ học sẽ bắt đầu một lượt học mới và thay thế lượt đang học dở (' + p.done + '/' + p.total + ' từ).',
                    buttons: [
                        { label: 'Giữ chế độ cũ', value: false },
                        { label: 'Bắt đầu lượt mới', kind: 'primary', value: true }
                    ],
                    dismissValue: false
                }).then(function (go) { commit(!!go); });
            } else {
                commit(wantsRestart);
            }
        }

        render();

        return {
            el: root,
            isDirty: function () { return false; },
            destroy: function () { clearTimeout(advanceTimer); Speech.stop(); }
        };
    }

    return { create: create };
}());
