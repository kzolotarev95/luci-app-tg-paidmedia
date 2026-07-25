'use strict';
'require dom';
'require form';
'require fs';
'require poll';
'require rpc';
'require ui';
'require view';

var callInitList = rpc.declare({
	object: 'luci',
	method: 'getInitList',
	params: [ 'name' ],
	expect: { '': {} }
});

var callInitAction = rpc.declare({
	object: 'luci',
	method: 'setInitAction',
	params: [ 'name', 'action' ],
	expect: { result: false }
});

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function parseJSON(text, fallback) {
	try {
		return JSON.parse(text || '');
	}
	catch (err) {
		return fallback;
	}
}

function trimLog(text, lines) {
	var parts = (text || '').split(/\r?\n/).filter(function(line) {
		return line.length > 0;
	});

	if (parts.length <= lines)
		return parts.join('\n');

	return parts.slice(parts.length - lines).join('\n');
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function boolLabel(value) {
	return value ? '\u0414\u0430' : '\u041d\u0435\u0442';
}

function escapeHTML(text) {
	return String(text == null ? '' : text).replace(/[&<>"']/g, function(ch) {
		return {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			'\'': '&#39;'
		}[ch];
	});
}

function classifyLogLine(line) {
	var source = String(line || '').toLowerCase();

	if (/(traceback|exception|fatal|failed|error|daemon\.err|crash loop|attributeerror|runtimeerror)/.test(source))
		return 'tg-log-error';

	if (/(warning|warn|timeout|retry|network unreachable|unable|unavailable)/.test(source))
		return 'tg-log-warn';

	if (/(info|started|running|success|accepted login|reply |poll|loaded|installed|connected)/.test(source))
		return 'tg-log-info';

	return 'tg-log-neutral';
}

function renderLogMarkup(text) {
	var lines = String(text || '').split(/\r?\n/);

	return lines.map(function(line) {
		return '<span class="tg-log-line ' + classifyLogLine(line) + '">' +
			escapeHTML(line.length ? line : ' ') +
		'</span>';
	}).join('\n');
}

return view.extend({
	renderStyles: function() {
		return E('style', {}, [ `
			.tg-paidmedia-page {
				--tg-bg-top: #0f1725;
				--tg-bg-middle: #171429;
				--tg-bg-bottom: #0b0f18;
				--tg-surface: rgba(20, 24, 38, 0.72);
				--tg-surface-strong: rgba(12, 15, 27, 0.86);
				--tg-panel: linear-gradient(180deg, rgba(24, 28, 45, 0.78), rgba(11, 14, 24, 0.86));
				--tg-panel-soft: linear-gradient(180deg, rgba(30, 35, 56, 0.7), rgba(17, 19, 31, 0.74));
				--tg-border: rgba(122, 160, 255, 0.18);
				--tg-border-strong: rgba(101, 221, 255, 0.34);
				--tg-text: #f5f7ff;
				--tg-text-soft: #ccd5f1;
				--tg-text-muted: #8fa0c8;
				--tg-accent: #67d7ff;
				--tg-accent-strong: #ffb34d;
				--tg-success: #69e6a0;
				--tg-warning: #ffd166;
				--tg-danger: #ff7f96;
				--tg-shadow: 0 34px 90px rgba(1, 5, 13, 0.44);
				position: relative;
				overflow: hidden;
				padding: 20px 0 38px;
				color: var(--tg-text);
				font-family: "Segoe UI Variable Display", "Trebuchet MS", "Segoe UI", sans-serif;
				background:
					radial-gradient(circle at 12% 18%, rgba(255, 172, 84, 0.16), transparent 0 22%),
					radial-gradient(circle at 86% 12%, rgba(88, 213, 255, 0.18), transparent 0 20%),
					radial-gradient(circle at 50% 100%, rgba(173, 88, 255, 0.12), transparent 0 28%),
					linear-gradient(180deg, var(--tg-bg-top) 0%, var(--tg-bg-middle) 48%, var(--tg-bg-bottom) 100%);
			}

			.tg-paidmedia-shell {
				position: relative;
				z-index: 1;
				max-width: 1220px;
				margin: 0 auto;
				padding: 0 16px;
			}

			.tg-paidmedia-orb {
				position: absolute;
				border-radius: 999px;
				filter: blur(14px);
				opacity: 0.78;
				pointer-events: none;
			}

			.tg-paidmedia-orb-one {
				top: 26px;
				right: 6%;
				width: 260px;
				height: 260px;
				background: radial-gradient(circle, rgba(105, 215, 255, 0.22), rgba(105, 215, 255, 0.02) 68%);
			}

			.tg-paidmedia-orb-two {
				left: -1%;
				bottom: 52px;
				width: 320px;
				height: 320px;
				background: radial-gradient(circle, rgba(255, 164, 73, 0.14), rgba(255, 164, 73, 0.02) 70%);
			}

			.tg-paidmedia-hero {
				position: relative;
				margin-bottom: 1.05rem;
				padding: 1.5rem 1.55rem 1.6rem;
				border: 1px solid var(--tg-border-strong);
				border-radius: 30px;
				background:
					radial-gradient(circle at top right, rgba(99, 211, 255, 0.22), transparent 0 26%),
					radial-gradient(circle at bottom left, rgba(255, 177, 84, 0.14), transparent 0 28%),
					linear-gradient(180deg, rgba(22, 27, 44, 0.82), rgba(12, 15, 25, 0.88));
				backdrop-filter: blur(24px);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-hero-topline {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: .85rem;
				margin-bottom: 1.1rem;
			}

			.tg-paidmedia-pillbar {
				display: flex;
				flex-wrap: wrap;
				gap: .7rem;
			}

			.tg-paidmedia-pill {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-height: 40px;
				padding: .38rem 1rem;
				border: 1px solid rgba(117, 152, 238, 0.28);
				border-radius: 999px;
				background: linear-gradient(180deg, rgba(38, 47, 76, 0.72), rgba(24, 29, 47, 0.72));
				color: var(--tg-text);
				font-size: .84rem;
				font-weight: 700;
				letter-spacing: .02em;
				box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
			}

			.tg-paidmedia-kicker {
				margin: 0 0 .35rem;
				color: #8fe7ff;
				font-size: .78rem;
				font-weight: 700;
				letter-spacing: .08em;
				text-transform: uppercase;
			}

			.tg-paidmedia-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.95rem;
				font-weight: 800;
				line-height: 1.2;
				text-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
			}

			.tg-paidmedia-lead {
				max-width: 58rem;
				margin: .6rem 0 0;
				color: var(--tg-text-soft);
				font-size: .99rem;
				line-height: 1.6;
			}

			.tg-paidmedia-section {
				margin-bottom: 1rem;
				padding: 1.25rem 1.25rem 1.3rem;
				border: 1px solid var(--tg-border);
				border-radius: 26px;
				background: var(--tg-panel);
				backdrop-filter: blur(22px);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-section h3,
			.tg-paidmedia-section-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.14rem;
				font-weight: 800;
			}

			.tg-paidmedia-section-head {
				display: flex;
				flex-wrap: wrap;
				align-items: flex-start;
				justify-content: space-between;
				gap: 1rem;
				margin-bottom: 1rem;
			}

			.tg-paidmedia-section-subtitle {
				margin: .4rem 0 0;
				color: var(--tg-text-soft);
				line-height: 1.55;
			}

			.tg-paidmedia-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
				gap: .95rem;
			}

			.tg-paidmedia-card {
				padding: 1rem 1rem 1.05rem;
				border: 1px solid rgba(122, 155, 230, 0.18);
				border-radius: 22px;
				background: var(--tg-panel-soft);
				backdrop-filter: blur(14px);
				box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
			}

			.tg-paidmedia-card-label {
				margin: 0 0 .45rem;
				color: var(--tg-text-muted);
				font-size: .8rem;
				font-weight: 700;
				letter-spacing: .03em;
				text-transform: uppercase;
			}

			.tg-paidmedia-card-value {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.22rem;
				font-weight: 800;
				line-height: 1.35;
				word-break: break-word;
			}

			.tg-paidmedia-card-subtle {
				font-size: 1rem;
				font-weight: 600;
			}

			.tg-paidmedia-badge {
				display: inline-flex;
				align-items: center;
				gap: .45rem;
				padding: .38rem .72rem;
				border-radius: 999px;
				font-size: .9rem;
				font-weight: 700;
				line-height: 1;
			}

			.tg-paidmedia-badge::before {
				content: "";
				width: .58rem;
				height: .58rem;
				border-radius: 50%;
				background: currentColor;
				box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
			}

			.tg-paidmedia-badge-running {
				color: var(--tg-success);
				background: rgba(105, 230, 160, 0.12);
			}

			.tg-paidmedia-badge-stopped {
				color: var(--tg-danger);
				background: rgba(255, 125, 158, 0.12);
			}

			.tg-paidmedia-actions {
				display: flex;
				flex-wrap: wrap;
				gap: .8rem;
				margin-top: 1rem;
			}

			.tg-paidmedia-actions .btn {
				min-width: 11rem;
				padding: .72rem 1rem;
				border-radius: 16px;
				font-weight: 800;
				letter-spacing: .01em;
				box-shadow: none;
			}

			.tg-paidmedia-actions .cbi-button-action {
				border-color: rgba(92, 212, 255, 0.3);
				background: linear-gradient(180deg, #2d85bc 0%, #225ca6 100%);
				color: #fff;
			}

			.tg-paidmedia-actions .cbi-button-negative {
				border-color: rgba(255, 125, 158, 0.24);
				background: linear-gradient(180deg, rgba(127, 50, 77, 0.78), rgba(86, 34, 57, 0.82));
				color: #ffe2ea;
			}

			.tg-paidmedia-log-panel {
				overflow: hidden;
			}

			.tg-paidmedia-log-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .75rem;
			}

			.tg-paidmedia-toolbar-btn {
				min-width: 10rem;
				padding: .7rem 1rem;
				border-radius: 16px;
				font-weight: 800;
			}

			.tg-paidmedia-log-toggle {
				border-color: rgba(100, 219, 255, 0.26);
				background: linear-gradient(180deg, rgba(48, 82, 126, 0.86), rgba(28, 54, 95, 0.9));
			}

			.tg-paidmedia-log-copy {
				border-color: rgba(255, 181, 87, 0.24);
				background: linear-gradient(180deg, rgba(92, 70, 35, 0.86), rgba(67, 49, 22, 0.9));
			}

			.tg-paidmedia-log-body {
				display: block;
			}

			.tg-paidmedia-log-panel.is-collapsed .tg-paidmedia-log-body {
				display: none;
			}

			.tg-paidmedia-log {
				max-height: 28rem;
				overflow: auto;
				margin: 0;
				padding: 1rem 1.05rem;
				border-radius: 20px;
				border: 1px solid rgba(95, 124, 194, 0.2);
				background:
					linear-gradient(180deg, rgba(9, 13, 24, 0.96), rgba(7, 10, 18, 0.96)),
					radial-gradient(circle at top right, rgba(90, 208, 255, 0.08), transparent 0 35%);
				color: #f4f7ff;
				font-family: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
				font-size: .85rem;
				line-height: 1.62;
				white-space: pre-wrap;
				word-break: break-word;
				user-select: text;
				cursor: text;
				box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
			}

			.tg-log-line {
				display: block;
				padding: .12rem .48rem;
				border-left: 3px solid transparent;
				border-radius: 10px;
			}

			.tg-log-info {
				border-left-color: rgba(105, 230, 160, 0.9);
				background: rgba(105, 230, 160, 0.08);
				color: #c8ffe0;
			}

			.tg-log-warn {
				border-left-color: rgba(255, 209, 102, 0.92);
				background: rgba(255, 209, 102, 0.08);
				color: #ffe6aa;
			}

			.tg-log-error {
				border-left-color: rgba(255, 127, 150, 0.96);
				background: rgba(255, 127, 150, 0.1);
				color: #ffd2da;
			}

			.tg-log-neutral {
				border-left-color: rgba(114, 134, 179, 0.34);
				color: #d6def5;
			}

			.tg-paidmedia-note {
				margin: -.2rem 0 1rem;
				color: var(--tg-text-soft);
				line-height: 1.55;
			}

			.tg-paidmedia-error {
				margin-bottom: 1rem;
				padding: 1rem;
				border: 1px solid rgba(255, 125, 158, 0.18);
				border-radius: 18px;
				background: linear-gradient(180deg, rgba(84, 30, 49, 0.74), rgba(53, 22, 34, 0.8));
			}

			.tg-paidmedia-error strong {
				display: block;
				margin-bottom: .45rem;
				color: #ffd5de;
			}

			.tg-paidmedia-error pre {
				margin: 0;
				color: #fff0f4;
				font-family: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
				font-size: .82rem;
				line-height: 1.55;
				white-space: pre-wrap;
				word-break: break-word;
			}

			.tg-paidmedia-form-wrap {
				padding-top: 1.45rem;
			}

			.tg-paidmedia-page .cbi-map {
				margin: 0;
				border: none;
				box-shadow: none;
				background: transparent;
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-map h3,
			.tg-paidmedia-page .cbi-map h4,
			.tg-paidmedia-page .cbi-section h3,
			.tg-paidmedia-page .cbi-section legend,
			.tg-paidmedia-page .cbi-tabmenu li a {
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-section,
			.tg-paidmedia-page .cbi-section-node {
				margin-top: 1rem;
				padding: 1.15rem 1.2rem;
				border: 1px solid var(--tg-border);
				border-radius: 24px;
				background: var(--tg-panel-soft);
				backdrop-filter: blur(18px);
			}

			.tg-paidmedia-page .cbi-section-descr,
			.tg-paidmedia-page .cbi-value-description {
				color: var(--tg-text-soft);
			}

			.tg-paidmedia-page .cbi-value-title,
			.tg-paidmedia-page label,
			.tg-paidmedia-page .cbi-value-field,
			.tg-paidmedia-page .cbi-value {
				color: var(--tg-text);
			}

			.tg-paidmedia-page input[type="text"],
			.tg-paidmedia-page input[type="password"],
			.tg-paidmedia-page input[type="number"],
			.tg-paidmedia-page textarea,
			.tg-paidmedia-page select {
				border: 1px solid rgba(118, 144, 203, 0.34);
				border-radius: 14px;
				background: rgba(8, 12, 21, 0.88);
				color: var(--tg-text);
				box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
			}

			.tg-paidmedia-page input::placeholder,
			.tg-paidmedia-page textarea::placeholder {
				color: rgba(215, 198, 244, 0.52);
			}

			.tg-paidmedia-page input[type="text"]:focus,
			.tg-paidmedia-page input[type="password"]:focus,
			.tg-paidmedia-page input[type="number"]:focus,
			.tg-paidmedia-page textarea:focus,
			.tg-paidmedia-page select:focus {
				border-color: rgba(103, 215, 255, 0.62);
				box-shadow: 0 0 0 3px rgba(103, 215, 255, 0.12);
			}

			.tg-paidmedia-page .cbi-button,
			.tg-paidmedia-page .btn {
				border-radius: 14px;
				font-weight: 800;
				border-color: rgba(120, 142, 198, 0.32);
				background: linear-gradient(180deg, rgba(43, 52, 80, 0.9), rgba(28, 34, 56, 0.94));
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-button-apply,
			.tg-paidmedia-page .cbi-button-save {
				border-color: rgba(103, 215, 255, 0.34);
				background: linear-gradient(180deg, #2d85bc 0%, #225ca6 100%);
				color: #fff;
			}

			.tg-paidmedia-page .cbi-button-reset {
				border-color: rgba(255, 178, 87, 0.26);
				background: linear-gradient(180deg, rgba(121, 79, 28, 0.8), rgba(84, 55, 19, 0.82));
			}

			.tg-paidmedia-page .cbi-input-checkbox {
				accent-color: #7cd6ff;
			}

			.tg-paidmedia-page .cbi-tabmenu li a {
				border-radius: 999px;
				background: rgba(33, 40, 64, 0.72);
			}

			.tg-paidmedia-page .cbi-tabmenu li.active a,
			.tg-paidmedia-page .cbi-tabmenu li.cbi-tab a {
				background: linear-gradient(180deg, rgba(103, 215, 255, 0.2), rgba(255, 179, 77, 0.18));
			}

			@media (max-width: 700px) {
				.tg-paidmedia-page {
					padding-top: 12px;
				}

				.tg-paidmedia-shell {
					padding: 0 10px;
				}

				.tg-paidmedia-hero,
				.tg-paidmedia-section,
				.tg-paidmedia-page .cbi-section,
				.tg-paidmedia-page .cbi-section-node {
					padding: 1rem;
					border-radius: 18px;
				}

				.tg-paidmedia-title {
					font-size: 1.4rem;
				}

				.tg-paidmedia-actions .btn {
					width: 100%;
					min-width: 0;
				}

				.tg-paidmedia-log-toolbar,
				.tg-paidmedia-section-head {
					flex-direction: column;
					align-items: stretch;
				}

				.tg-paidmedia-toolbar-btn {
					width: 100%;
					min-width: 0;
				}
			}
		` ]);
	},

	load: function() {
		return Promise.all([
			callInitList('tg-paidmedia'),
			callServiceList('tg-paidmedia').catch(function() {
				return {};
			}),
			fs.exec('/bin/cat', [ '/var/run/tg-paidmedia/status.json' ]).catch(function() {
				return { code: 1, stdout: '{}', stderr: '' };
			}),
			fs.exec('/sbin/logread', [ '-l', '200' ]).catch(function() {
				return { code: 1, stdout: '', stderr: '' };
			})
		]);
	},

	renderForm: function() {
		var m, s, o;

		m = new form.Map('tg-paidmedia', 'TG Paid Media');
		m.description = '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0442\u043e\u043a\u0435\u043d \u0431\u043e\u0442\u0430, \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432, \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b long polling \u0438 \u043f\u0443\u0442\u0438 \u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f \u0434\u0430\u043d\u043d\u044b\u0445.';

		s = m.section(form.TypedSection, 'bot', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0431\u043e\u0442\u0430');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0441\u0435\u0440\u0432\u0438\u0441');
		o.rmempty = false;

		o = s.option(form.Value, 'token', '\u0422\u043e\u043a\u0435\u043d \u0431\u043e\u0442\u0430');
		o.password = true;
		o.rmempty = false;
		o.placeholder = '123456:ABCDEF';

		o = s.option(form.DynamicList, 'admin_ids', 'Telegram ID \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432');
		o.datatype = 'uinteger';
		o.placeholder = '123456789';

		o = s.option(form.Value, 'bot_title', '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430');
		o.rmempty = false;

		o = s.option(form.Value, 'welcome_text', '\u041f\u0440\u0438\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 \u0442\u0435\u043a\u0441\u0442');
		o.rmempty = false;

		o = s.option(form.Value, 'poll_timeout', '\u0422\u0430\u0439\u043c\u0430\u0443\u0442 long polling (\u0441\u0435\u043a\u0443\u043d\u0434\u044b)');
		o.datatype = 'uinteger';
		o.placeholder = '25';
		o.rmempty = false;

		o = s.option(form.Flag, 'drop_pending', '\u0421\u0431\u0440\u0430\u0441\u044b\u0432\u0430\u0442\u044c \u043d\u0430\u043a\u043e\u043f\u043b\u0435\u043d\u043d\u044b\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f Telegram \u043f\u0440\u0438 \u0441\u0442\u0430\u0440\u0442\u0435');
		o.rmempty = false;

		o = s.option(form.Value, 'catalog_path', '\u041f\u0443\u0442\u044c \u043a \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0443');
		o.rmempty = false;
		o.placeholder = '/etc/tg-paidmedia/catalog.json';

		o = s.option(form.Value, 'data_dir', '\u041a\u0430\u0442\u0430\u043b\u043e\u0433 \u0434\u0430\u043d\u043d\u044b\u0445');
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia';

		o = s.option(form.Value, 'state_path', '\u041f\u0443\u0442\u044c \u043a \u0444\u0430\u0439\u043b\u0443 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u044f');
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia/state.json';

		o = s.option(form.Value, 'status_path', '\u041f\u0443\u0442\u044c \u043a \u0444\u0430\u0439\u043b\u0443 \u0441\u0442\u0430\u0442\u0443\u0441\u0430');
		o.rmempty = false;
		o.placeholder = '/var/run/tg-paidmedia/status.json';

		return m.render();
	},

	extractServiceRunning: function(serviceStatus) {
		var root = serviceStatus['tg-paidmedia'] || serviceStatus || {};
		var instances = root.instances || {};
		var instanceName = Object.keys(instances)[0];
		var instance = instanceName ? instances[instanceName] : {};

		return {
			instance: instance,
			running: !!(instance && instance.running),
			pid: instance && instance.pid ? instance.pid : ''
		};
	},

	buildStatusSection: function(data, statusTarget, logTarget) {
		var initList = data[0] || {};
		var serviceStatus = data[1] || {};
		var botStatus = parseJSON((data[2] || {}).stdout, {});
		var serviceMeta = this.extractServiceRunning(serviceStatus);
		var initMeta = initList['tg-paidmedia'] || {};
		var balance = botStatus.last_balance || {};
		var lastPurchase = botStatus.last_purchase || {};
		var lastException = String(botStatus.last_exception || '').trim();
		var runningBadge = E('span', {
			'class': 'tg-paidmedia-badge ' + (serviceMeta.running ? 'tg-paidmedia-badge-running' : 'tg-paidmedia-badge-stopped')
		}, [ serviceMeta.running ? '\u0417\u0430\u043f\u0443\u0449\u0435\u043d' : '\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d' ]);
		var cards = [
			{ label: '\u0421\u0435\u0440\u0432\u0438\u0441', value: runningBadge },
			{ label: '\u0410\u0432\u0442\u043e\u0437\u0430\u043f\u0443\u0441\u043a', value: boolLabel(!!initMeta.enabled) },
			{ label: 'PID \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u0430', value: String(serviceMeta.pid || '-') },
			{ label: '\u0418\u043c\u044f \u0431\u043e\u0442\u0430', value: String(botStatus.bot_username || '-') },
			{ label: '\u0422\u043e\u0432\u0430\u0440\u043e\u0432 \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435', value: String(botStatus.catalog_items || 0) },
			{ label: '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432', value: String(botStatus.admin_count || 0) },
			{ label: '\u0411\u0430\u043b\u0430\u043d\u0441 Stars', value: String(balance.amount || 0) },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043e\u043f\u0440\u043e\u0441', value: String(botStatus.last_poll_at || '-'), subtle: true },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043e\u0448\u0438\u0431\u043a\u0430', value: String(botStatus.last_error || '-'), subtle: true },
			{
				label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430',
				value: lastPurchase.item_id ? String('#' + lastPurchase.item_id + ' ' + (lastPurchase.item_title || '')) : '-',
				subtle: true
			}
		];
		var actionRow = E('div', { 'class': 'tg-paidmedia-actions' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('start', statusTarget, logTarget);
				})
			}, [ '\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c' ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('restart', statusTarget, logTarget);
				})
			}, [ '\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c' ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-negative',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('stop', statusTarget, logTarget);
				})
			}, [ '\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c' ])
		]);
		var errorBlock = lastException ? E('div', { 'class': 'tg-paidmedia-error' }, [
			E('strong', {}, [ '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0444\u0430\u0442\u0430\u043b\u044c\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0442\u0430\u0440\u0442\u0430' ]),
			E('pre', {}, [ trimLog(lastException, 24) ])
		]) : null;

		return E('div', { 'class': 'tg-paidmedia-section' }, [
			E('h3', {}, [ '\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u0430' ]),
			E('p', { 'class': 'tg-paidmedia-note' }, [ '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u043e\u0431\u0437\u043e\u0440 \u0440\u0430\u0431\u043e\u0442\u044b \u0431\u043e\u0442\u0430, \u0431\u0430\u043b\u0430\u043d\u0441\u0430 Stars \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0445 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u0431\u0435\u0437 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0430 \u0432 \u043b\u043e\u0433\u0438.' ]),
			errorBlock || '',
			E('div', { 'class': 'tg-paidmedia-grid' }, cards.map(function(card) {
				return E('div', { 'class': 'tg-paidmedia-card' }, [
					E('p', { 'class': 'tg-paidmedia-card-label' }, [ card.label ]),
					E('p', {
						'class': 'tg-paidmedia-card-value' + (card.subtle ? ' tg-paidmedia-card-subtle' : '')
					}, [ card.value ])
				]);
			})),
			actionRow
		]);
	},

	updatePanels: function(statusTarget, logTarget, data) {
		dom.content(statusTarget, this.buildStatusSection(data, statusTarget, logTarget));
		logTarget._rawText = trimLog((data[3] || {}).stdout || '', 200) || '\u041b\u043e\u0433\u0438 \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u044b.';
		logTarget.innerHTML = renderLogMarkup(logTarget._rawText);
	},

	toggleLogPanel: function(logSection, toggleButton) {
		var collapsed = logSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\uD83D\uDCC2 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B' : '\uD83D\uDCD5 \u0421\u043A\u0440\u044B\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B' ]);
	},

	copyLog: function(logTarget) {
		var text = String(logTarget._rawText || '').trim();

		if (!text) {
			ui.addNotification(null, E('p', {}, [ '\u0412 \u0436\u0443\u0440\u043d\u0430\u043b\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0447\u0435\u0433\u043e \u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c.' ]), 'warning');
			return Promise.resolve();
		}

		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function() {
				ui.addNotification(null, E('p', {}, [ '\u0416\u0443\u0440\u043d\u0430\u043B \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D \u0432 \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430.' ]), 'info');
			});
		}

		return new Promise(function(resolve, reject) {
			var area = document.createElement('textarea');

			area.style.position = 'absolute';
			area.style.left = '-9999px';
			area.style.top = '-9999px';
			area.value = text;

			document.body.appendChild(area);
			area.focus();
			area.select();

			try {
				document.execCommand('copy');
				document.body.removeChild(area);
				ui.addNotification(null, E('p', {}, [ '\u0416\u0443\u0440\u043d\u0430\u043B \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D \u0432 \u0431\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430.' ]), 'info');
				resolve();
			}
			catch (err) {
				document.body.removeChild(area);
				reject(err);
			}
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	pollPanels: function(statusTarget, logTarget) {
		return this.load().then(function(data) {
			this.updatePanels(statusTarget, logTarget, data);
		}.bind(this));
	},

	handleServiceAction: function(action, statusTarget, logTarget) {
		var actionLabel = {
			start: '\u0437\u0430\u043f\u0443\u0441\u043a\u0430',
			restart: '\u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043a\u0430',
			stop: '\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430'
		}[action] || '\u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435';

		ui.showModal('\u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f', [
			E('p', {}, [ '\u041f\u0440\u0438\u043c\u0435\u043d\u044f\u044e \u043a\u043e\u043c\u0430\u043d\u0434\u0443 \u043a \u0441\u0435\u0440\u0432\u0438\u0441\u0443...' ])
		]);

		return callInitAction('tg-paidmedia', action).then(function() {
			ui.hideModal();
			return delay(900);
		}.bind(this)).then(function() {
			return this.load();
		}.bind(this)).then(function(data) {
			var serviceStatus = data[1] || {};
			var botStatus = parseJSON((data[2] || {}).stdout, {});
			var serviceMeta = this.extractServiceRunning(serviceStatus);
			var failureReason = String(botStatus.last_exception || botStatus.last_error || '').trim();

			this.updatePanels(statusTarget, logTarget, data);

			if (action === 'stop' && serviceMeta.running) {
				throw new Error('\u0421\u0435\u0440\u0432\u0438\u0441 \u043f\u043e\u043a\u0430 \u0435\u0449\u0435 \u043d\u0435 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0441\u044f. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0447\u0435\u0440\u0435\u0437 \u043f\u0430\u0440\u0443 \u0441\u0435\u043a\u0443\u043d\u0434.');
			}

			if (action !== 'stop' && !serviceMeta.running) {
				throw new Error(
					failureReason ||
					('\u0421\u0435\u0440\u0432\u0438\u0441 \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u043b\u0441\u044f \u043f\u043e\u0441\u043b\u0435 ' + actionLabel + '. \u041f\u043e\u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u0436\u0443\u0440\u043d\u0430\u043b \u043d\u0438\u0436\u0435.')
				);
			}
		}.bind(this)).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	render: function(data) {
		var statusTarget = E('div', { 'class': 'tg-paidmedia-section' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0441\u0442\u0430\u0442\u0443\u0441\u0430...' ]);
		var logTarget = E('div', { 'class': 'tg-paidmedia-log' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043b\u043e\u0433\u043e\u0432...' ]);
		var logToggle = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-log-toggle',
			'click': ui.createHandlerFn(this, function() {
				this.toggleLogPanel(logSection, logToggle);
			})
		}, [ '\uD83D\uDCC2 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B' ]);
		var logCopy = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-log-copy',
			'click': ui.createHandlerFn(this, function() {
				return this.copyLog(logTarget);
			})
		}, [ '\uD83D\uDCCB \u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043B\u043E\u0433' ]);
		var logSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-log-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u0416\u0443\u0440\u043d\u0430\u043b \u0441\u043e\u0431\u044b\u0442\u0438\u0439' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C хвост logread, \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C traceback \u0438 \u0431\u044B\u0441\u0442\u0440\u043E \u043E\u0442\u043B\u0438\u0447\u0438\u0442\u044C info, warning \u0438 error \u043F\u043E \u0446\u0432\u0435\u0442\u0430\u043C.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-log-toolbar' }, [
					logToggle,
					logCopy
				])
			]),
			E('div', { 'class': 'tg-paidmedia-log-body' }, [
				logTarget
			])
		]);

		return this.renderForm().then(function(formNode) {
			this.updatePanels(statusTarget, logTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget));

			return E('div', { 'class': 'tg-paidmedia-page' }, [
				this.renderStyles(),
				E('div', { 'class': 'tg-paidmedia-shell' }, [
					E('div', { 'class': 'tg-paidmedia-orb tg-paidmedia-orb-one' }),
					E('div', { 'class': 'tg-paidmedia-orb tg-paidmedia-orb-two' }),
					E('div', { 'class': 'tg-paidmedia-hero' }, [
						E('div', { 'class': 'tg-paidmedia-hero-topline' }, [
							E('div', { 'class': 'tg-paidmedia-pillbar' }, [
								E('span', { 'class': 'tg-paidmedia-pill' }, [ 'Telegram Stars Control' ]),
								E('span', { 'class': 'tg-paidmedia-pill' }, [ '\u041F\u043B\u0430\u0442\u043D\u044B\u0435 \u043F\u043E\u0441\u0442\u044B \u0438 \u0432\u0438\u0442\u0440\u0438\u043D\u0430' ])
							]),
							E('div', { 'class': 'tg-paidmedia-pillbar' }, [
								E('span', { 'class': 'tg-paidmedia-pill' }, [ '\u041F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u0430\u044F LuCI-\u043F\u0430\u043D\u0435\u043B\u044C' ])
							])
						]),
						E('p', { 'class': 'tg-paidmedia-kicker' }, [ '\u0426\u0435\u043D\u0442\u0440 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0432 Telegram' ]),
						E('h2', { 'class': 'tg-paidmedia-title' }, [ '\u041f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f TG Paid Media' ]),
						E('p', { 'class': 'tg-paidmedia-lead' }, [ '\u041E\u0434\u043D\u0438\u043C \u0432\u0437\u0433\u043B\u044F\u0434\u043E\u043C \u0432\u0438\u0434\u043D\u043E \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0431\u043E\u0442\u0430, \u0431\u0430\u043B\u0430\u043D\u0441 Stars, \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u0438 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u0441 \u0437\u0430\u043F\u0443\u0441\u043A\u043E\u043C. \u041D\u0438\u0436\u0435 \u043C\u043E\u0436\u043D\u043E \u0441\u0440\u0430\u0437\u0443 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0435\u0440\u0432\u0438\u0441, \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043B\u043E\u0433 \u0438 \u043F\u043E\u0434\u043A\u0440\u0443\u0442\u0438\u0442\u044C \u0432\u0441\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0431\u0435\u0437 \u0445\u0430\u043E\u0441\u0430.' ])
					]),
					statusTarget,
					logSection,
					E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-form-wrap' }, [ formNode ])
				])
			]);
		}.bind(this));
	}
});
