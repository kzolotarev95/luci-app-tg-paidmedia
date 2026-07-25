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

return view.extend({
	renderStyles: function() {
		return E('style', {}, [ `
			.tg-paidmedia-page {
				--tg-bg-top: #672b96;
				--tg-bg-middle: #3d1f5f;
				--tg-bg-bottom: #181226;
				--tg-surface: rgba(23, 15, 41, 0.82);
				--tg-surface-strong: rgba(15, 9, 29, 0.9);
				--tg-border: rgba(156, 126, 218, 0.24);
				--tg-border-strong: rgba(117, 208, 255, 0.34);
				--tg-text: #f6f0ff;
				--tg-text-soft: #d2c3ed;
				--tg-text-muted: #b09ed2;
				--tg-accent: #7bd7ff;
				--tg-accent-strong: #8f78ff;
				--tg-success: #4fe17d;
				--tg-danger: #ff7d9e;
				--tg-shadow: 0 32px 90px rgba(7, 4, 16, 0.4);
				position: relative;
				overflow: hidden;
				padding: 18px 0 34px;
				color: var(--tg-text);
				font-family: "Trebuchet MS", "Segoe UI Variable Display", "Segoe UI", sans-serif;
				background:
					radial-gradient(circle at top left, rgba(205, 119, 255, 0.24), transparent 24%),
					radial-gradient(circle at top right, rgba(84, 180, 255, 0.22), transparent 20%),
					linear-gradient(180deg, var(--tg-bg-top) 0%, var(--tg-bg-middle) 34%, #271a3f 66%, var(--tg-bg-bottom) 100%);
			}

			.tg-paidmedia-shell {
				position: relative;
				z-index: 1;
				max-width: 1180px;
				margin: 0 auto;
				padding: 0 14px;
			}

			.tg-paidmedia-orb {
				position: absolute;
				border-radius: 999px;
				filter: blur(10px);
				opacity: 0.78;
				pointer-events: none;
			}

			.tg-paidmedia-orb-one {
				top: 14px;
				right: 8%;
				width: 220px;
				height: 220px;
				background: radial-gradient(circle, rgba(114, 209, 255, 0.24), rgba(114, 209, 255, 0.02) 68%);
			}

			.tg-paidmedia-orb-two {
				left: 2%;
				bottom: 34px;
				width: 290px;
				height: 290px;
				background: radial-gradient(circle, rgba(211, 104, 255, 0.18), rgba(211, 104, 255, 0.02) 70%);
			}

			.tg-paidmedia-hero {
				position: relative;
				margin-bottom: 1rem;
				padding: 1.35rem 1.45rem 1.5rem;
				border: 1px solid var(--tg-border-strong);
				border-radius: 26px;
				background:
					radial-gradient(circle at top right, rgba(123, 215, 255, 0.24), transparent 28%),
					radial-gradient(circle at bottom left, rgba(197, 112, 255, 0.15), transparent 30%),
					linear-gradient(180deg, rgba(32, 21, 56, 0.92), rgba(18, 12, 35, 0.84));
				backdrop-filter: blur(22px);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-hero-topline {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: .8rem;
				margin-bottom: 1rem;
			}

			.tg-paidmedia-pillbar {
				display: flex;
				flex-wrap: wrap;
				gap: .65rem;
			}

			.tg-paidmedia-pill {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-height: 38px;
				padding: .34rem 1rem;
				border: 1px solid rgba(123, 215, 255, 0.26);
				border-radius: 999px;
				background: linear-gradient(180deg, rgba(91, 67, 136, 0.56), rgba(67, 45, 102, 0.5));
				color: var(--tg-text);
				font-size: .84rem;
				font-weight: 700;
				letter-spacing: .02em;
			}

			.tg-paidmedia-kicker {
				margin: 0 0 .35rem;
				color: #95e4ff;
				font-size: .78rem;
				font-weight: 700;
				letter-spacing: .08em;
				text-transform: uppercase;
			}

			.tg-paidmedia-title {
				margin: 0;
				color: var(--tg-text);
				font-size: 1.88rem;
				font-weight: 700;
				line-height: 1.2;
				text-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
			}

			.tg-paidmedia-lead {
				max-width: 56rem;
				margin: .6rem 0 0;
				color: var(--tg-text-soft);
				font-size: .98rem;
				line-height: 1.6;
			}

			.tg-paidmedia-section {
				margin-bottom: 1rem;
				padding: 1.2rem 1.2rem 1.25rem;
				border: 1px solid var(--tg-border);
				border-radius: 24px;
				background: linear-gradient(180deg, rgba(27, 18, 49, 0.86), rgba(15, 10, 28, 0.9));
				backdrop-filter: blur(20px);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-section h3 {
				margin: 0 0 1rem;
				color: var(--tg-text);
				font-size: 1.15rem;
				font-weight: 700;
			}

			.tg-paidmedia-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
				gap: .9rem;
			}

			.tg-paidmedia-card {
				padding: 1rem;
				border: 1px solid rgba(161, 131, 226, 0.22);
				border-radius: 20px;
				background: linear-gradient(180deg, rgba(57, 41, 92, 0.66), rgba(31, 21, 54, 0.68));
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
				font-size: 1.2rem;
				font-weight: 700;
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
				background: rgba(79, 225, 125, 0.12);
			}

			.tg-paidmedia-badge-stopped {
				color: var(--tg-danger);
				background: rgba(255, 125, 158, 0.12);
			}

			.tg-paidmedia-actions {
				display: flex;
				flex-wrap: wrap;
				gap: .75rem;
				margin-top: 1rem;
			}

			.tg-paidmedia-actions .btn {
				min-width: 11rem;
				padding: .72rem 1rem;
				border-radius: 16px;
				font-weight: 700;
				letter-spacing: .01em;
				box-shadow: none;
			}

			.tg-paidmedia-actions .cbi-button-action {
				border-color: rgba(114, 209, 255, 0.32);
				background: linear-gradient(180deg, #3a82c9 0%, #2c5caf 100%);
				color: #fff;
			}

			.tg-paidmedia-actions .cbi-button-negative {
				border-color: rgba(255, 125, 158, 0.22);
				background: linear-gradient(180deg, rgba(125, 53, 84, 0.74), rgba(93, 39, 65, 0.78));
				color: #ffe2ea;
			}

			.tg-paidmedia-log {
				max-height: 24rem;
				overflow: auto;
				margin: 0;
				padding: 1rem;
				border-radius: 16px;
				border: 1px solid rgba(152, 124, 212, 0.2);
				background: rgba(10, 7, 20, 0.92);
				color: #f5ebff;
				font-family: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
				font-size: .86rem;
				line-height: 1.55;
				white-space: pre-wrap;
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
				border-radius: 16px;
				background: linear-gradient(180deg, rgba(90, 31, 54, 0.78), rgba(63, 23, 42, 0.84));
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
				padding-top: 1.35rem;
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
				border-radius: 22px;
				background: linear-gradient(180deg, rgba(29, 20, 52, 0.82), rgba(14, 10, 28, 0.88));
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
				border: 1px solid rgba(144, 114, 210, 0.34);
				border-radius: 14px;
				background: rgba(11, 8, 24, 0.88);
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
				border-color: rgba(114, 209, 255, 0.6);
				box-shadow: 0 0 0 3px rgba(114, 209, 255, 0.12);
			}

			.tg-paidmedia-page .cbi-button,
			.tg-paidmedia-page .btn {
				border-radius: 14px;
				font-weight: 700;
				border-color: rgba(144, 114, 210, 0.32);
				background: linear-gradient(180deg, rgba(84, 59, 126, 0.88), rgba(55, 38, 86, 0.92));
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-button-apply,
			.tg-paidmedia-page .cbi-button-save {
				border-color: rgba(114, 209, 255, 0.34);
				background: linear-gradient(180deg, #3784c8 0%, #2e5dac 100%);
				color: #fff;
			}

			.tg-paidmedia-page .cbi-button-reset {
				border-color: rgba(255, 178, 87, 0.24);
				background: linear-gradient(180deg, rgba(127, 78, 30, 0.76), rgba(86, 54, 24, 0.8));
			}

			.tg-paidmedia-page .cbi-input-checkbox {
				accent-color: #7cd6ff;
			}

			.tg-paidmedia-page .cbi-tabmenu li a {
				border-radius: 999px;
				background: rgba(56, 39, 87, 0.72);
			}

			.tg-paidmedia-page .cbi-tabmenu li.active a,
			.tg-paidmedia-page .cbi-tabmenu li.cbi-tab a {
				background: linear-gradient(180deg, rgba(114, 209, 255, 0.22), rgba(93, 120, 255, 0.18));
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
					border-radius: 16px;
				}

				.tg-paidmedia-title {
					font-size: 1.4rem;
				}

				.tg-paidmedia-actions .btn {
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
		logTarget.textContent = trimLog((data[3] || {}).stdout || '', 200) || '\u041b\u043e\u0433\u0438 \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u044b.';
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
		var logTarget = E('pre', { 'class': 'tg-paidmedia-log' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043b\u043e\u0433\u043e\u0432...' ]);
		var logSection = E('div', { 'class': 'tg-paidmedia-section' }, [
			E('h3', {}, [ '\u0416\u0443\u0440\u043d\u0430\u043b \u0441\u043e\u0431\u044b\u0442\u0438\u0439' ]),
			E('p', { 'class': 'tg-paidmedia-note' }, [ '\u041f\u043e\u043a\u0430\u0437\u0430\u043d \u043e\u0431\u0449\u0438\u0439 \u0445\u0432\u043e\u0441\u0442 \u0438\u0437 200 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0445 \u0441\u0442\u0440\u043e\u043a logread, \u0447\u0442\u043e\u0431\u044b \u0431\u044b\u043b\u0438 \u0432\u0438\u0434\u043d\u044b \u0438 traceback Python, \u0438 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f procd.' ]),
			logTarget
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
								E('span', { 'class': 'tg-paidmedia-pill' }, [ 'TG Paid Media Control' ]),
								E('span', { 'class': 'tg-paidmedia-pill' }, [ 'Telegram Stars Store' ])
							]),
							E('div', { 'class': 'tg-paidmedia-pillbar' }, [
								E('span', { 'class': 'tg-paidmedia-pill' }, [ 'Glass LuCI UI' ])
							])
						]),
						E('p', { 'class': 'tg-paidmedia-kicker' }, [ '\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u043e\u043c Telegram Stars' ]),
						E('h2', { 'class': 'tg-paidmedia-title' }, [ '\u041f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f TG Paid Media' ]),
						E('p', { 'class': 'tg-paidmedia-lead' }, [ '\u0417\u0434\u0435\u0441\u044c \u043c\u043e\u0436\u043d\u043e \u0431\u044b\u0441\u0442\u0440\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0431\u043e\u0442\u0430, \u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0435\u0440\u0432\u0438\u0441, \u0443\u0432\u0438\u0434\u0435\u0442\u044c \u043f\u0430\u0434\u0435\u043d\u0438\u044f \u0432 \u043b\u043e\u0433\u0430\u0445 \u0438 \u043d\u0430\u0441\u0442\u0440\u043e\u0438\u0442\u044c \u0432\u0438\u0442\u0440\u0438\u043d\u0443 \u0432 \u0431\u043e\u043b\u0435\u0435 \u043a\u0440\u0430\u0441\u0438\u0432\u043e\u043c, \u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u043c \u0438 \u0447\u0438\u0442\u0430\u0435\u043c\u043e\u043c \u0432\u0438\u0434\u0435.' ])
					]),
					statusTarget,
					logSection,
					E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-form-wrap' }, [ formNode ])
				])
			]);
		}.bind(this));
	}
});
