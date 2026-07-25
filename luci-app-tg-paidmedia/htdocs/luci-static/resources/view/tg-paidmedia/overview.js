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
				--tg-accent: #1c7c54;
				--tg-accent-soft: #ebf7f0;
				--tg-accent-strong: #0f5132;
				--tg-warm: #f5c451;
				--tg-danger: #b42318;
				--tg-danger-soft: #fff0f0;
				--tg-card: linear-gradient(180deg, #ffffff 0%, #f8fbf8 100%);
				--tg-card-border: rgba(28, 124, 84, 0.14);
				--tg-muted: #5b6b63;
				--tg-shadow: 0 16px 40px rgba(19, 46, 31, 0.08);
				font-family: "Trebuchet MS", "Segoe UI Variable Text", "Segoe UI", sans-serif;
			}

			.tg-paidmedia-hero {
				margin-bottom: 1rem;
				padding: 1.25rem 1.4rem;
				border: 1px solid var(--tg-card-border);
				border-radius: 20px;
				background:
					radial-gradient(circle at top right, rgba(245, 196, 81, 0.24), transparent 34%),
					linear-gradient(135deg, #f6fbf7 0%, #ffffff 55%, #eef7f0 100%);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-kicker {
				margin: 0 0 .35rem;
				color: var(--tg-accent);
				font-size: .78rem;
				font-weight: 700;
				letter-spacing: .08em;
				text-transform: uppercase;
			}

			.tg-paidmedia-title {
				margin: 0;
				color: #163020;
				font-size: 1.7rem;
				font-weight: 700;
				line-height: 1.2;
			}

			.tg-paidmedia-lead {
				max-width: 56rem;
				margin: .6rem 0 0;
				color: var(--tg-muted);
				font-size: .98rem;
				line-height: 1.6;
			}

			.tg-paidmedia-section {
				margin-bottom: 1rem;
				padding: 1.2rem;
				border: 1px solid var(--tg-card-border);
				border-radius: 20px;
				background: var(--tg-card);
				box-shadow: var(--tg-shadow);
			}

			.tg-paidmedia-section h3 {
				margin: 0 0 1rem;
				color: #163020;
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
				border: 1px solid rgba(28, 124, 84, 0.12);
				border-radius: 18px;
				background:
					linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 250, 245, 0.96));
			}

			.tg-paidmedia-card-label {
				margin: 0 0 .45rem;
				color: var(--tg-muted);
				font-size: .8rem;
				font-weight: 700;
				letter-spacing: .03em;
				text-transform: uppercase;
			}

			.tg-paidmedia-card-value {
				margin: 0;
				color: #173323;
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
				box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.6);
			}

			.tg-paidmedia-badge-running {
				color: var(--tg-accent-strong);
				background: var(--tg-accent-soft);
			}

			.tg-paidmedia-badge-stopped {
				color: var(--tg-danger);
				background: var(--tg-danger-soft);
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
				border-radius: 14px;
				font-weight: 700;
				letter-spacing: .01em;
				box-shadow: none;
			}

			.tg-paidmedia-actions .cbi-button-action {
				border-color: rgba(28, 124, 84, 0.22);
				background: linear-gradient(180deg, #1f8a5b 0%, #196c48 100%);
				color: #fff;
			}

			.tg-paidmedia-actions .cbi-button-negative {
				border-color: rgba(180, 35, 24, 0.18);
				background: linear-gradient(180deg, #d64545 0%, #b42318 100%);
				color: #fff;
			}

			.tg-paidmedia-log {
				max-height: 24rem;
				overflow: auto;
				margin: 0;
				padding: 1rem;
				border-radius: 16px;
				background: #18231d;
				color: #ebfff2;
				font-family: "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
				font-size: .86rem;
				line-height: 1.55;
				white-space: pre-wrap;
			}

			.tg-paidmedia-note {
				margin: -.2rem 0 1rem;
				color: var(--tg-muted);
				line-height: 1.55;
			}

			@media (max-width: 700px) {
				.tg-paidmedia-hero,
				.tg-paidmedia-section {
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
			fs.exec('/etc/init.d/tg-paidmedia', [ 'status' ]).catch(function() {
				return { code: 1, stdout: '{}', stderr: '' };
			}),
			fs.exec('/bin/cat', [ '/var/run/tg-paidmedia/status.json' ]).catch(function() {
				return { code: 1, stdout: '{}', stderr: '' };
			}),
			fs.exec('/sbin/logread', [ '-e', 'tg-paidmedia' ]).catch(function() {
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
		var root = serviceStatus['tg-paidmedia'] || {};
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
		var serviceStatus = parseJSON((data[1] || {}).stdout, {});
		var botStatus = parseJSON((data[2] || {}).stdout, {});
		var serviceMeta = this.extractServiceRunning(serviceStatus);
		var initMeta = initList['tg-paidmedia'] || {};
		var balance = botStatus.last_balance || {};
		var lastPurchase = botStatus.last_purchase || {};
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

		return E('div', { 'class': 'tg-paidmedia-section' }, [
			E('h3', {}, [ '\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u0430' ]),
			E('p', { 'class': 'tg-paidmedia-note' }, [ '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u043e\u0431\u0437\u043e\u0440 \u0440\u0430\u0431\u043e\u0442\u044b \u0431\u043e\u0442\u0430, \u0431\u0430\u043b\u0430\u043d\u0441\u0430 Stars \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0445 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u0431\u0435\u0437 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0430 \u0432 \u043b\u043e\u0433\u0438.' ]),
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
			var serviceStatus = parseJSON((data[1] || {}).stdout, {});
			var botStatus = parseJSON((data[2] || {}).stdout, {});
			var serviceMeta = this.extractServiceRunning(serviceStatus);

			this.updatePanels(statusTarget, logTarget, data);

			if (action === 'stop' && serviceMeta.running) {
				throw new Error('\u0421\u0435\u0440\u0432\u0438\u0441 \u043f\u043e\u043a\u0430 \u0435\u0449\u0435 \u043d\u0435 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0441\u044f. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0447\u0435\u0440\u0435\u0437 \u043f\u0430\u0440\u0443 \u0441\u0435\u043a\u0443\u043d\u0434.');
			}

			if (action !== 'stop' && !serviceMeta.running) {
				throw new Error(
					(botStatus.last_error && String(botStatus.last_error).trim()) ||
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
			E('p', { 'class': 'tg-paidmedia-note' }, [ '\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u044b \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 200 \u0441\u0442\u0440\u043e\u043a \u0438\u0437 logread \u043f\u043e \u0441\u0435\u0440\u0432\u0438\u0441\u0443 tg-paidmedia.' ]),
			logTarget
		]);

		return this.renderForm().then(function(formNode) {
			this.updatePanels(statusTarget, logTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget));

			return E('div', { 'class': 'tg-paidmedia-page' }, [
				this.renderStyles(),
				E('div', { 'class': 'tg-paidmedia-hero' }, [
					E('p', { 'class': 'tg-paidmedia-kicker' }, [ '\u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u043e\u043c Telegram Stars' ]),
					E('h2', { 'class': 'tg-paidmedia-title' }, [ '\u041f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f TG Paid Media' ]),
					E('p', { 'class': 'tg-paidmedia-lead' }, [ '\u0417\u0434\u0435\u0441\u044c \u043c\u043e\u0436\u043d\u043e \u0431\u044b\u0441\u0442\u0440\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0431\u043e\u0442\u0430, \u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0435\u0440\u0432\u0438\u0441 \u0438 \u043d\u0430\u0441\u0442\u0440\u043e\u0438\u0442\u044c \u043c\u0430\u0433\u0430\u0437\u0438\u043d Telegram Stars \u0432 \u0431\u043e\u043b\u0435\u0435 \u0430\u043a\u043a\u0443\u0440\u0430\u0442\u043d\u043e\u043c \u0438 \u0447\u0438\u0442\u0430\u0435\u043c\u043e\u043c \u0432\u0438\u0434\u0435.' ])
				]),
				statusTarget,
				logSection,
				formNode
			]);
		}.bind(this));
	}
});
