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

var PAYMENT_FIELD_HELP = {
	platega_enabled: {
		title: 'Включить Platega / СБП',
		text: 'Включайте только после того, как заполнены merchant ID и secret key из кабинета Platega. Иначе бот не сможет создать счет или проверить оплату.'
	},
	platega_base_url: {
		title: 'Базовый URL Platega',
		text: 'Обычно оставляют стандартный адрес https://app.platega.io. Меняйте только если Platega выдала вам другой базовый URL для API или тестового контура.'
	},
	platega_merchant_id: {
		title: 'ID мерчанта Platega',
		text: 'Берется в кабинете Platega: магазин, мерчант или раздел API/интеграция. Это идентификатор вашего магазина в системе.'
	},
	platega_secret_key: {
		title: 'Секретный ключ Platega',
		text: 'Берется в кабинете Platega в разделе API, security или интеграция. Это секрет для запросов и проверки webhook, не показывайте его другим.'
	},
	platega_callback_url: {
		title: 'URL callback для Platega',
		text: 'Это публичный внешний URL, на который Platega будет отправлять webhook после оплаты. Его вы указываете в кабинете Platega, а внутри он должен вести на ваш host, port и path.'
	},
	platega_success_url: {
		title: 'URL успешного редиректа',
		text: 'Это ваш адрес, куда покупателя нужно вернуть после успешной оплаты. Обычно это страница спасибо, инструкция или витрина.'
	},
	platega_fail_url: {
		title: 'URL редиректа при ошибке',
		text: 'Это ваш адрес, куда покупатель попадет при отмене или ошибке оплаты. Обычно делают страницу с повторной попыткой или пояснением.'
	},
	platega_redirect_url: {
		title: 'URL редиректа по умолчанию',
		text: 'Запасной адрес, если Platega использует общий redirect. Если не уверены, можно дать ту же ссылку, что и для успешного редиректа.'
	},
	platega_webhook_host: {
		title: 'Хост прослушивания webhook',
		text: 'Это локальный адрес, на котором бот слушает входящие webhook. Обычно оставляют 0.0.0.0, чтобы сервис принимал запросы на всех интерфейсах роутера.'
	},
	platega_webhook_port: {
		title: 'Порт прослушивания webhook',
		text: 'Это локальный порт, который слушает бот. Его нужно пробросить наружу на роутере или reverse proxy, если callback URL смотрит из интернета на это устройство.'
	},
	platega_webhook_path: {
		title: 'Путь webhook',
		text: 'Это локальный URL-путь webhook. Его нужно добавить в конец публичного callback URL, который вы прописываете в кабинете Platega.'
	},
	platega_status_poll_interval: {
		title: 'Интервал опроса статуса СБП (секунды)',
		text: 'Это внутренняя настройка бота, а не данные из Platega. Показывает, как часто бот будет перепроверять статус платежа, если webhook еще не пришел.'
	},
	platega_status_timeout: {
		title: 'Таймаут ожидания статуса СБП (секунды)',
		text: 'Это внутренняя настройка бота. Она определяет, сколько максимум ждать подтверждения оплаты перед остановкой опроса.'
	},
	platega_http_timeout: {
		title: 'HTTP-таймаут Platega (секунды)',
		text: 'Это внутренняя настройка бота. Она задает, сколько ждать ответа от API Platega на один запрос до ошибки по таймауту.'
	}
};

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
				--tg-surface: #ffffff;
				--tg-surface-soft: #f7f8fa;
				--tg-border: #d8dde6;
				--tg-border-strong: #c6d4e7;
				--tg-text: #1f2933;
				--tg-text-soft: #566373;
				--tg-text-muted: #6b7785;
				--tg-accent: #0b6fdb;
				--tg-accent-soft: #e8f1fb;
				--tg-success: #2f855a;
				--tg-warning: #b7791f;
				--tg-danger: #c53030;
				--tg-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
				padding: 16px 0 28px;
				color: var(--tg-text);
				background: transparent;
				font-family: inherit;
			}

			.tg-paidmedia-shell {
				max-width: 1180px;
				margin: 0 auto;
				padding: 0 16px;
			}

			.tg-paidmedia-orb {
				display: none;
			}

			.tg-paidmedia-hero {
				margin-bottom: 1rem;
				padding: 1rem 1.1rem;
				border: 1px solid var(--tg-border);
				border-radius: 10px;
				display: flex;
				align-items: center;
				background: var(--tg-surface);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-logo {
				display: inline-flex;
				align-items: center;
				gap: .85rem;
			}

			.tg-paidmedia-logo-mark {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 3rem;
				height: 3rem;
				border: 1px solid var(--tg-border-strong);
				border-radius: 8px;
				background: var(--tg-accent-soft);
			}

			.tg-paidmedia-logo-mark::before {
				content: "TG";
				color: var(--tg-accent);
				font-size: 1rem;
				font-weight: 700;
				letter-spacing: .04em;
			}

			.tg-paidmedia-logo-wordmark {
				display: flex;
				flex-direction: column;
				gap: .1rem;
			}

			.tg-paidmedia-logo-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.2rem;
				font-weight: 600;
				line-height: 1.2;
			}

			.tg-paidmedia-logo-subtitle {
				margin: 0;
				color: var(--tg-text-soft);
				font-size: .84rem;
				font-weight: 500;
				letter-spacing: .04em;
				text-transform: uppercase;
			}

			.tg-paidmedia-kicker {
				margin: 0 0 .2rem;
				color: var(--tg-text-muted);
				font-size: .76rem;
				font-weight: 600;
				letter-spacing: .04em;
				text-transform: uppercase;
			}

			.tg-paidmedia-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.35rem;
				font-weight: 600;
				line-height: 1.2;
			}

			.tg-paidmedia-lead {
				max-width: 48rem;
				margin: .35rem 0 0;
				color: var(--tg-text-soft);
				font-size: .92rem;
				line-height: 1.6;
			}

			.tg-paidmedia-section {
				margin-bottom: 1rem;
				padding: 1rem 1.1rem;
				border: 1px solid var(--tg-border);
				border-radius: 10px;
				background: var(--tg-surface);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-section h3,
			.tg-paidmedia-section-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1rem;
				font-weight: 600;
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
				margin: .3rem 0 0;
				color: var(--tg-text-soft);
				font-size: .88rem;
				line-height: 1.5;
			}

			.tg-paidmedia-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: .75rem;
			}

			.tg-paidmedia-card {
				padding: .85rem .9rem;
				border: 1px solid var(--tg-border);
				border-radius: 8px;
				background: var(--tg-surface-soft);
			}

			.tg-paidmedia-card-label {
				margin: 0 0 .45rem;
				color: var(--tg-text-muted);
				font-size: .76rem;
				font-weight: 600;
				letter-spacing: .02em;
				text-transform: uppercase;
			}

			.tg-paidmedia-card-value {
				margin: 0;
				color: var(--tg-text);
				font-size: 1rem;
				font-weight: 600;
				line-height: 1.35;
				word-break: break-word;
			}

			.tg-paidmedia-card-subtle {
				font-size: .92rem;
				font-weight: 500;
			}

			.tg-paidmedia-badge {
				display: inline-flex;
				align-items: center;
				gap: .45rem;
				padding: .3rem .65rem;
				border-radius: 999px;
				font-size: .84rem;
				font-weight: 600;
				line-height: 1;
			}

			.tg-paidmedia-badge::before {
				content: "";
				width: .48rem;
				height: .48rem;
				border-radius: 50%;
				background: currentColor;
			}

			.tg-paidmedia-badge-running {
				color: var(--tg-success);
				background: #edf7f1;
				border: 1px solid #c7e7d3;
			}

			.tg-paidmedia-badge-stopped {
				color: var(--tg-danger);
				background: #fbecec;
				border: 1px solid #efcdcd;
			}

			.tg-paidmedia-actions {
				display: flex;
				flex-wrap: wrap;
				gap: .65rem;
				margin-top: 1rem;
			}

			.tg-paidmedia-actions .btn {
				min-width: 10rem;
				padding: .55rem .9rem;
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-actions .cbi-button-action {
				border-color: #0b6fdb;
				background: #0b6fdb;
				color: #fff;
			}

			.tg-paidmedia-actions .cbi-button-negative {
				border-color: #d7dce3;
				background: #f5f6f7;
				color: var(--tg-text);
			}

			.tg-paidmedia-log-panel {
				overflow: hidden;
			}

			.tg-paidmedia-info-panel {
				overflow: hidden;
			}

			.tg-paidmedia-payments-panel {
				overflow: visible;
			}

			.tg-paidmedia-log-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .75rem;
			}

			.tg-paidmedia-info-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .75rem;
			}

			.tg-paidmedia-payments-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .75rem;
			}

			.tg-paidmedia-toolbar-btn {
				min-width: 9rem;
				padding: .5rem .85rem;
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-log-toggle {
				border-color: #d4dbe5;
				background: #ffffff;
				color: var(--tg-text);
			}

			.tg-paidmedia-log-copy {
				border-color: #d4dbe5;
				background: #ffffff;
				color: var(--tg-text);
			}

			.tg-paidmedia-info-toggle {
				border-color: #d4dbe5;
				background: #ffffff;
				color: var(--tg-text);
			}

			.tg-paidmedia-payments-toggle {
				border-color: #d4dbe5;
				background: #ffffff;
				color: var(--tg-text);
			}

			.tg-paidmedia-log-body {
				display: block;
			}

			.tg-paidmedia-info-body {
				display: block;
			}

			.tg-paidmedia-payments-body {
				display: block;
				overflow: visible;
			}

			.tg-paidmedia-log-panel.is-collapsed .tg-paidmedia-log-body {
				display: none;
			}

			.tg-paidmedia-info-panel.is-collapsed .tg-paidmedia-info-body {
				display: none;
			}

			.tg-paidmedia-payments-panel.is-collapsed .tg-paidmedia-payments-body {
				display: none;
			}

			.tg-paidmedia-info-text {
				color: var(--tg-text-soft);
				line-height: 1.68;
			}

			.tg-paidmedia-info-list {
				margin: .4rem 0 0;
				padding-left: 1.15rem;
				color: var(--tg-text-soft);
				line-height: 1.6;
			}

			.tg-paidmedia-info-list li + li {
				margin-top: .4rem;
			}

			.tg-paidmedia-info-steps {
				margin-top: 1rem;
			}

			.tg-paidmedia-info-links {
				display: flex;
				flex-wrap: wrap;
				gap: .65rem .9rem;
				margin-top: .8rem;
			}

			.tg-paidmedia-info-links a {
				color: var(--tg-accent);
				font-weight: 600;
				text-decoration: none;
			}

			.tg-paidmedia-info-links a:hover {
				text-decoration: underline;
			}

			.tg-paidmedia-help-title {
				display: inline-flex;
				align-items: center;
				gap: .45rem;
				flex-wrap: wrap;
			}

			.tg-paidmedia-help {
				position: relative;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 1.2rem;
				height: 1.2rem;
				border: 1px solid #bfc9d8;
				border-radius: 999px;
				background: #eef2f6;
				color: #445263;
				font-size: .72rem;
				font-weight: 700;
				line-height: 1;
				cursor: help;
			}

			.tg-paidmedia-help-bubble {
				position: absolute;
				top: 50%;
				left: calc(100% + .65rem);
				width: min(24rem, calc(100vw - 6rem));
				padding: .8rem .9rem;
				border: 1px solid #cfd6df;
				border-radius: 8px;
				background: #ffffff;
				color: var(--tg-text-soft);
				font-size: .84rem;
				font-weight: 500;
				line-height: 1.55;
				text-transform: none;
				letter-spacing: normal;
				box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
				transform: translateY(-50%) translateX(-6px);
				opacity: 0;
				visibility: hidden;
				pointer-events: none;
				transition: opacity .16s ease, transform .16s ease, visibility .16s ease;
				z-index: 30;
			}

			.tg-paidmedia-help:hover .tg-paidmedia-help-bubble,
			.tg-paidmedia-help:focus .tg-paidmedia-help-bubble,
			.tg-paidmedia-help:focus-visible .tg-paidmedia-help-bubble {
				opacity: 1;
				visibility: visible;
				transform: translateY(-50%) translateX(0);
			}

			.tg-paidmedia-log {
				max-height: 28rem;
				overflow: auto;
				margin: 0;
				padding: .9rem 1rem;
				border-radius: 8px;
				border: 1px solid var(--tg-border);
				background: #fbfcfd;
				color: var(--tg-text);
				font-family: "Consolas", "Courier New", monospace;
				font-size: .85rem;
				line-height: 1.55;
				white-space: pre-wrap;
				word-break: break-word;
				user-select: text;
				cursor: text;
			}

			.tg-log-line {
				display: block;
				padding: .14rem .48rem;
				border-left: 3px solid transparent;
				border-radius: 4px;
			}

			.tg-log-info {
				border-left-color: #66a27a;
				background: #eef8f1;
				color: #27533a;
			}

			.tg-log-warn {
				border-left-color: #d39a2c;
				background: #fff8eb;
				color: #7a5812;
			}

			.tg-log-error {
				border-left-color: #d15555;
				background: #fdf1f1;
				color: #7f2727;
			}

			.tg-log-neutral {
				border-left-color: #ced6df;
				color: var(--tg-text);
			}

			.tg-paidmedia-note {
				margin: 0 0 .9rem;
				color: var(--tg-text-soft);
				line-height: 1.5;
			}

			.tg-paidmedia-error {
				margin-bottom: 1rem;
				padding: .9rem 1rem;
				border: 1px solid #efcdcd;
				border-radius: 8px;
				background: #fdf1f1;
			}

			.tg-paidmedia-error strong {
				display: block;
				margin-bottom: .45rem;
				color: #8a2d2d;
			}

			.tg-paidmedia-error pre {
				margin: 0;
				color: #6a3030;
				font-family: "Consolas", "Courier New", monospace;
				font-size: .82rem;
				line-height: 1.55;
				white-space: pre-wrap;
				word-break: break-word;
			}

			.tg-paidmedia-form-wrap {
				padding-top: .1rem;
			}

			.tg-paidmedia-page .cbi-map {
				margin: 0;
				border: none;
				box-shadow: none;
				background: transparent;
			}

			.tg-paidmedia-page .cbi-map h3,
			.tg-paidmedia-page .cbi-map h4,
			.tg-paidmedia-page .cbi-section h3,
			.tg-paidmedia-page .cbi-section legend,
			.tg-paidmedia-page .cbi-tabmenu li a {
				color: inherit;
			}

			.tg-paidmedia-page .cbi-section,
			.tg-paidmedia-page .cbi-section-node {
				margin-top: .85rem;
				padding: .95rem 1rem;
				border: 1px solid var(--tg-border);
				border-radius: 8px;
				background: var(--tg-surface-soft);
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
				border: 1px solid #cfd6df;
				border-radius: 6px;
				background: #ffffff;
				color: inherit;
				box-shadow: none;
			}

			.tg-paidmedia-page input::placeholder,
			.tg-paidmedia-page textarea::placeholder {
				color: #93a1b2;
			}

			.tg-paidmedia-page input[type="text"]:focus,
			.tg-paidmedia-page input[type="password"]:focus,
			.tg-paidmedia-page input[type="number"]:focus,
			.tg-paidmedia-page textarea:focus,
			.tg-paidmedia-page select:focus {
				border-color: #7aa7dd;
				box-shadow: 0 0 0 2px rgba(11, 111, 219, 0.08);
			}

			.tg-paidmedia-page .cbi-button,
			.tg-paidmedia-page .btn {
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-page .cbi-button-apply,
			.tg-paidmedia-page .cbi-button-save {
				border-color: #0b6fdb;
				background: #0b6fdb;
				color: #ffffff;
			}

			.tg-paidmedia-page .cbi-button-reset {
				border-color: #d4dbe5;
				background: #ffffff;
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-input-checkbox {
				accent-color: var(--tg-accent);
			}

			.tg-paidmedia-page .cbi-tabmenu li a {
				border-radius: 999px;
				background: #eef2f6;
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-tabmenu li.active a,
			.tg-paidmedia-page .cbi-tabmenu li.cbi-tab a {
				background: var(--tg-accent-soft);
				color: var(--tg-accent);
			}

			@media (max-width: 700px) {
				.tg-paidmedia-shell {
					padding: 0 10px;
				}

				.tg-paidmedia-hero,
				.tg-paidmedia-section,
				.tg-paidmedia-page .cbi-section,
				.tg-paidmedia-page .cbi-section-node {
					padding: .9rem;
					border-radius: 8px;
				}

				.tg-paidmedia-title {
					font-size: 1.1rem;
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

				.tg-paidmedia-help-bubble {
					top: calc(100% + .6rem);
					left: 50%;
					width: min(18rem, calc(100vw - 3rem));
					transform: translateX(-50%) translateY(-6px);
				}

				.tg-paidmedia-help:hover .tg-paidmedia-help-bubble,
				.tg-paidmedia-help:focus .tg-paidmedia-help-bubble,
				.tg-paidmedia-help:focus-visible .tg-paidmedia-help-bubble {
					transform: translateX(-50%) translateY(0);
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

		s = m.section(form.NamedSection, 'main', 'bot', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0431\u043e\u0442\u0430');

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

		s = m.section(form.NamedSection, 'main', 'bot', '\u041f\u043b\u0430\u0442\u0435\u0436\u043d\u044b\u0435 \u0441\u0438\u0441\u0442\u0435\u043c\u044b');

		o = s.option(form.Flag, 'platega_enabled', 'Включить Platega / СБП');
		o.rmempty = false;

		o = s.option(form.Value, 'platega_base_url', 'Базовый URL Platega');
		o.rmempty = true;
		o.placeholder = 'https://app.platega.io';

		o = s.option(form.Value, 'platega_merchant_id', 'ID мерчанта Platega');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_secret_key', 'Секретный ключ Platega');
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'platega_callback_url', 'URL callback для Platega');
		o.rmempty = true;
		o.placeholder = 'https://example.com/platega/webhook';

		o = s.option(form.Value, 'platega_success_url', 'URL успешного редиректа');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_fail_url', 'URL редиректа при ошибке');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_redirect_url', 'URL редиректа по умолчанию');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_webhook_host', 'Хост прослушивания webhook');
		o.rmempty = true;
		o.placeholder = '0.0.0.0';

		o = s.option(form.Value, 'platega_webhook_port', 'Порт прослушивания webhook');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '8099';

		o = s.option(form.Value, 'platega_webhook_path', 'Путь webhook');
		o.rmempty = true;
		o.placeholder = '/platega/webhook';

		o = s.option(form.Value, 'platega_status_poll_interval', 'Интервал опроса статуса СБП (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '20';

		o = s.option(form.Value, 'platega_status_timeout', 'Таймаут ожидания статуса СБП (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '900';

		o = s.option(form.Value, 'platega_http_timeout', 'HTTP-таймаут Platega (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '25';

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

	renderBotForm: function() {
		var m, s, o;

		m = new form.Map('tg-paidmedia');

		s = m.section(form.NamedSection, 'main', 'bot', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0431\u043e\u0442\u0430');

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

	renderPaymentsForm: function() {
		var m, s, o;

		m = new form.Map('tg-paidmedia');

		s = m.section(form.NamedSection, 'main', 'bot', 'Platega / \u0421\u0411\u041f');

		o = s.option(form.Flag, 'platega_enabled', 'Включить Platega / СБП');
		o.rmempty = false;

		o = s.option(form.Value, 'platega_base_url', 'Базовый URL Platega');
		o.rmempty = true;
		o.placeholder = 'https://app.platega.io';

		o = s.option(form.Value, 'platega_merchant_id', 'ID мерчанта Platega');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_secret_key', 'Секретный ключ Platega');
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'platega_callback_url', 'URL callback для Platega');
		o.rmempty = true;
		o.placeholder = 'https://example.com/platega/webhook';

		o = s.option(form.Value, 'platega_success_url', 'URL успешного редиректа');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_fail_url', 'URL редиректа при ошибке');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_redirect_url', 'URL редиректа по умолчанию');
		o.rmempty = true;

		o = s.option(form.Value, 'platega_webhook_host', 'Хост прослушивания webhook');
		o.rmempty = true;
		o.placeholder = '0.0.0.0';

		o = s.option(form.Value, 'platega_webhook_port', 'Порт прослушивания webhook');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '8099';

		o = s.option(form.Value, 'platega_webhook_path', 'Путь webhook');
		o.rmempty = true;
		o.placeholder = '/platega/webhook';

		o = s.option(form.Value, 'platega_status_poll_interval', 'Интервал опроса статуса СБП (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '20';

		o = s.option(form.Value, 'platega_status_timeout', 'Таймаут ожидания статуса СБП (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '900';

		o = s.option(form.Value, 'platega_http_timeout', 'HTTP-таймаут Platega (секунды)');
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.placeholder = '25';

		return m.render();
	},

	findClosestValueNode: function(node) {
		while (node) {
			if (node.classList && node.classList.contains('cbi-value'))
				return node;

			node = node.parentNode;
		}

		return null;
	},

	findPaymentValueNode: function(root, fieldName, titleText) {
		var selectors = [
			'.cbi-value[data-name="' + fieldName + '"]',
			'.cbi-value[data-option="' + fieldName + '"]',
			'.cbi-value[data-field="' + fieldName + '"]',
			'[name="' + fieldName + '"]',
			'[name$=".' + fieldName + '"]',
			'[id="' + fieldName + '"]',
			'[id$="' + fieldName + '"]'
		];
		var i, node, titles;

		for (i = 0; i < selectors.length; i++) {
			try {
				node = root.querySelector(selectors[i]);
			}
			catch (err) {
				node = null;
			}

			if (node)
				return this.findClosestValueNode(node) || node;
		}

		titles = root.querySelectorAll('.cbi-value-title');
		for (i = 0; i < titles.length; i++) {
			if (String(titles[i].textContent || '').trim() === String(titleText || '').trim())
				return this.findClosestValueNode(titles[i]);
		}

		return null;
	},

	createPaymentHelpNode: function(text) {
		var badge = document.createElement('span');
		var bubble = document.createElement('span');

		badge.className = 'tg-paidmedia-help';
		badge.tabIndex = 0;
		badge.setAttribute('role', 'button');
		badge.setAttribute('aria-label', text);
		badge.appendChild(document.createTextNode('?'));

		bubble.className = 'tg-paidmedia-help-bubble';
		bubble.textContent = text;
		badge.appendChild(bubble);

		return badge;
	},

	decoratePaymentTooltips: function(root) {
		var self = this;

		Object.keys(PAYMENT_FIELD_HELP).forEach(function(fieldName) {
			var meta = PAYMENT_FIELD_HELP[fieldName] || {};
			var valueNode = self.findPaymentValueNode(root, fieldName, meta.title);
			var titleNode;

			if (!valueNode)
				return;

			titleNode = valueNode.querySelector('.cbi-value-title');
			if (!titleNode || titleNode.querySelector('.tg-paidmedia-help'))
				return;

			titleNode.classList.add('tg-paidmedia-help-title');
			titleNode.appendChild(self.createPaymentHelpNode(meta.text || ''));
		});
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
		var lastPlategaEvent = botStatus.last_platega_event || {};
		var stats = botStatus.stats || {};
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
			{ label: 'Stars purchases', value: String(stats.stars_purchases || 0) },
			{ label: 'SBP orders', value: String(stats.sbp_orders_created || 0) },
			{ label: 'SBP delivered', value: String(stats.sbp_orders_paid || 0) },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043e\u043f\u0440\u043e\u0441', value: String(botStatus.last_poll_at || '-'), subtle: true },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043e\u0448\u0438\u0431\u043a\u0430', value: String(botStatus.last_error || '-'), subtle: true },
			{
				label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430',
				value: lastPurchase.item_id ? String('#' + lastPurchase.item_id + ' ' + (lastPurchase.item_title || '')) : '-',
				subtle: true
			},
			{
				label: 'Last SBP event',
				value: lastPlategaEvent.status ? String(lastPlategaEvent.status + ' / ' + (lastPlategaEvent.transaction_id || '-')) : '-',
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

	toggleInfoPanel: function(infoSection, toggleButton) {
		var collapsed = infoSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\u2B50 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' : '\u2B50 \u0421\u043A\u0440\u044B\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' ]);
	},

	togglePaymentsPanel: function(paymentsSection, toggleButton) {
		var collapsed = paymentsSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\uD83D\uDCB3 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043c\u044B' : '\uD83D\uDCB3 \u0421\u043A\u0440\u044B\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043c\u044B' ]);
	},

	buildWithdrawalInfoSection: function() {
		return E('div', { 'class': 'tg-paidmedia-info-text' }, [
			E('p', {}, [ '1. Личные Stars на аккаунте Telegram вывести на свой баланс нельзя. В официальных Terms сказано, что Stars в personal balance нельзя withdraw или transfer.' ]),
			E('p', {}, [ '2. Stars, которые заработал бот, лежат не в личном балансе, а в отдельном балансе бота. Их можно использовать на Telegram Ads или принять как reward через Fragment.' ]),
			E('p', {}, [ 'Для ботов Telegram прямо пишет:' ]),
			E('ul', { 'class': 'tg-paidmedia-info-list' }, [
				E('li', {}, [ 'заработанные Stars видны в балансе, доступном с аккаунта-владельца бота;' ]),
				E('li', {}, [ 'rewards обрабатываются через Fragment;' ]),
				E('li', {}, [ 'Stars могут стать доступны для rewards не сразу, а до 21 дня после получения.' ])
			]),
			E('div', { 'class': 'tg-paidmedia-info-steps' }, [
				E('p', {}, [ 'Если по-простому, то схема такая:' ]),
				E('ol', { 'class': 'tg-paidmedia-info-list' }, [
					E('li', {}, [ 'продажи пришли в баланс бота;' ]),
					E('li', {}, [ 'ждёшь до 21 дня, пока сумма станет доступной;' ]),
					E('li', {}, [ 'заходишь с аккаунта-владельца бота в официальный Telegram client;' ]),
					E('li', {}, [ 'открываешь страницу баланса/дохода бота;' ]),
					E('li', {}, [ 'выбираешь Accept rewards / вывод через Fragment;' ]),
					E('li', {}, [ 'дальше уже в Fragment указываешь кошелёк/получение reward.' ])
				])
			]),
			E('div', { 'class': 'tg-paidmedia-info-steps' }, [
				E('p', {}, [ 'Если кнопки вывода нет, обычно причина одна из этих:' ]),
				E('ul', { 'class': 'tg-paidmedia-info-list' }, [
					E('li', {}, [ 'Stars ещё младше 21 дня;' ]),
					E('li', {}, [ 'ты открыт не с аккаунта-владельца бота;' ]),
					E('li', {}, [ 'Fragment недоступен для региона или аккаунта;' ]),
					E('li', {}, [ 'открыт не официальный клиент Telegram.' ])
				])
			]),
			E('div', { 'class': 'tg-paidmedia-info-steps' }, [
				E('p', {}, [ 'Источники:' ]),
				E('div', { 'class': 'tg-paidmedia-info-links' }, [
					E('a', {
						'href': 'https://telegram.org/tos/stars',
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, [ 'Telegram Stars Terms' ]),
					E('a', {
						'href': 'https://core.telegram.org/bots/payments-stars',
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, [ 'Bot Payments for Stars' ]),
					E('a', {
						'href': 'https://telegram.org/tos/bot-developers?setln=ko',
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, [ 'Bot Developer Terms' ]),
					E('a', {
						'href': 'https://core.telegram.org/api/stars',
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, [ 'Telegram Stars API' ]),
					E('a', {
						'href': 'https://fragment.com/',
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, [ 'Fragment' ])
				])
			])
		]);
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

	clearLogs: function(statusTarget, logTarget) {
		ui.showModal('\u041e\u0447\u0438\u0441\u0442\u043a\u0430 \u0436\u0443\u0440\u043d\u0430', [
			E('p', {}, [ '\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043a\u0430\u044e \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 log-\u0434\u0435\u043c\u043e\u043d, \u0447\u0442\u043e\u0431\u044b \u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0438\u0439 ring buffer...' ])
		]);

		return fs.exec('/etc/init.d/log', [ 'restart' ]).then(function(result) {
			if (result.code !== 0)
				throw new Error(result.stderr || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0436\u0443\u0440\u043d\u0430\u043b.');

			return delay(1200);
		}).then(function() {
			return this.load();
		}.bind(this)).then(function(data) {
			ui.hideModal();
			this.updatePanels(statusTarget, logTarget, data);
			ui.addNotification(null, E('p', {}, [ '\u0416\u0443\u0440\u043d\u0430\u043b \u043e\u0447\u0438\u0449\u0435\u043d. \u0422\u0435\u043f\u0435\u0440\u044c \u0432 \u0431\u043B\u043E\u043A\u0435 \u0432\u0438\u0434\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u0435\u0436\u0438\u0439 \u0445\u0432\u043E\u0441\u0442 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043A\u0430 logd.' ]), 'info');
		}.bind(this)).catch(function(err) {
			ui.hideModal();
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
		var infoToggle = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-info-toggle',
			'click': ui.createHandlerFn(this, function() {
				this.toggleInfoPanel(infoSection, infoToggle);
			})
		}, [ '\u2B50 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' ]);
		var infoSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-info-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u0412\u044B\u0432\u043E\u0434 \u0437\u0432\u0435\u0437\u0434' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C, \u043A\u0430\u043A Telegram Stars \u0432\u044B\u0432\u043E\u0434\u044F\u0442\u0441\u044F \u0443 \u0431\u043E\u0442\u0430 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u043A\u043D\u043E\u043F\u043A\u0430 reward \u043C\u043E\u0436\u0435\u0442 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C\u0441\u044F.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-info-toolbar' }, [
					infoToggle
				])
			]),
			E('div', { 'class': 'tg-paidmedia-info-body' }, [
				this.buildWithdrawalInfoSection()
			])
		]);
		var paymentsToggle = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-payments-toggle',
			'click': ui.createHandlerFn(this, function() {
				this.togglePaymentsPanel(paymentsSection, paymentsToggle);
			})
		}, [ '\uD83D\uDCB3 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043c\u044B' ]);
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
		var logClear = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-log-clear',
			'click': ui.createHandlerFn(this, function() {
				return this.clearLogs(statusTarget, logTarget);
			})
		}, [ '\uD83E\uDDF9 \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043B\u043E\u0433\u0438' ]);
		var logSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-log-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u0416\u0443\u0440\u043d\u0430\u043b \u0441\u043e\u0431\u044b\u0442\u0438\u0439' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C хвост logread, \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C traceback \u0438 \u0431\u044B\u0441\u0442\u0440\u043E \u043E\u0442\u043B\u0438\u0447\u0438\u0442\u044C info, warning \u0438 error \u043F\u043E \u0446\u0432\u0435\u0442\u0430\u043C.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-log-toolbar' }, [
					logToggle,
					logCopy,
					logClear
				])
			]),
			E('div', { 'class': 'tg-paidmedia-log-body' }, [
				logTarget
			])
		]);
		var paymentsBody = E('div', { 'class': 'tg-paidmedia-payments-body' });
		var paymentsSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-payments-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u041F\u043B\u0430\u0442\u0435\u0436\u043D\u044B\u0435 \u0441\u0438\u0441\u0442\u0435\u043C\u044B' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C Platega \u0438 \u043F\u043E\u0437\u0436\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0434\u0440\u0443\u0433\u0438\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u044B \u043E\u043F\u043B\u0430\u0442\u044B.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-payments-toolbar' }, [
					paymentsToggle
				])
			]),
			paymentsBody
		]);

		return Promise.all([
			this.renderBotForm(),
			this.renderPaymentsForm()
		]).then(function(renderedForms) {
			var botFormNode = renderedForms[0];
			var paymentsFormNode = renderedForms[1];

			this.updatePanels(statusTarget, logTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget));
			dom.content(paymentsBody, [ paymentsFormNode ]);
			this.decoratePaymentTooltips(paymentsBody);

			return E('div', { 'class': 'tg-paidmedia-page' }, [
				this.renderStyles(),
				E('div', { 'class': 'tg-paidmedia-shell' }, [
					E('div', { 'class': 'tg-paidmedia-hero' }, [
						E('div', { 'class': 'tg-paidmedia-logo' }, [
							E('div', { 'class': 'tg-paidmedia-logo-mark' }),
							E('div', { 'class': 'tg-paidmedia-logo-wordmark' }, [
								E('p', { 'class': 'tg-paidmedia-logo-title' }, [ 'TG Paid Media' ]),
								E('p', { 'class': 'tg-paidmedia-logo-subtitle' }, [ 'Telegram Stars' ])
							])
						])
					]),
					statusTarget,
					infoSection,
					logSection,
					E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-form-wrap' }, [ botFormNode ]),
					paymentsSection
				])
			]);
		}.bind(this));
	}
});
