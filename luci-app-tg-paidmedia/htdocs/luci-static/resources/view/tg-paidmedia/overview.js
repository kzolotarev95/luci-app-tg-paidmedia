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

function boolLabel(value) {
	return value ? 'Да' : 'Нет';
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
		m.description = 'Настройте токен бота, администраторов, параметры long polling и пути хранения данных.';

		s = m.section(form.TypedSection, 'bot', 'Настройки бота');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', 'Включить сервис');
		o.rmempty = false;

		o = s.option(form.Value, 'token', 'Токен бота');
		o.password = true;
		o.rmempty = false;
		o.placeholder = '123456:ABCDEF';

		o = s.option(form.DynamicList, 'admin_ids', 'Telegram ID администраторов');
		o.datatype = 'uinteger';
		o.placeholder = '123456789';

		o = s.option(form.Value, 'bot_title', 'Название магазина');
		o.rmempty = false;

		o = s.option(form.Value, 'welcome_text', 'Приветственный текст');
		o.rmempty = false;

		o = s.option(form.Value, 'poll_timeout', 'Таймаут long polling (секунды)');
		o.datatype = 'uinteger';
		o.placeholder = '25';
		o.rmempty = false;

		o = s.option(form.Flag, 'drop_pending', 'Сбрасывать накопленные обновления Telegram при старте');
		o.rmempty = false;

		o = s.option(form.Value, 'catalog_path', 'Путь к каталогу');
		o.rmempty = false;
		o.placeholder = '/etc/tg-paidmedia/catalog.json';

		o = s.option(form.Value, 'data_dir', 'Каталог данных');
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia';

		o = s.option(form.Value, 'state_path', 'Путь к файлу состояния');
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia/state.json';

		o = s.option(form.Value, 'status_path', 'Путь к файлу статуса');
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
		}, [ serviceMeta.running ? 'Запущен' : 'Остановлен' ]);
		var cards = [
			{ label: 'Сервис', value: runningBadge },
			{ label: 'Автозапуск', value: boolLabel(!!initMeta.enabled) },
			{ label: 'PID процесса', value: String(serviceMeta.pid || '-') },
			{ label: 'Имя бота', value: String(botStatus.bot_username || '-') },
			{ label: 'Товаров в каталоге', value: String(botStatus.catalog_items || 0) },
			{ label: 'Администраторов', value: String(botStatus.admin_count || 0) },
			{ label: 'Баланс Stars', value: String(balance.amount || 0) },
			{ label: 'Последний опрос', value: String(botStatus.last_poll_at || '-'), subtle: true },
			{ label: 'Последняя ошибка', value: String(botStatus.last_error || '-'), subtle: true },
			{
				label: 'Последняя покупка',
				value: lastPurchase.item_id ?
					String('#' + lastPurchase.item_id + ' ' + (lastPurchase.item_title || '')) :
					'-',
				subtle: true
			}
		];
		var actionRow = E('div', { 'class': 'tg-paidmedia-actions' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('start', statusTarget, logTarget);
				})
			}, [ 'Запустить' ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('restart', statusTarget, logTarget);
				})
			}, [ 'Перезапустить' ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-negative',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('stop', statusTarget, logTarget);
				})
			}, [ 'Остановить' ])
		]);

		return E('div', { 'class': 'tg-paidmedia-section' }, [
			E('h3', {}, [ 'Состояние сервиса' ]),
			E('p', { 'class': 'tg-paidmedia-note' }, [ 'Быстрый обзор работы бота, баланса Stars и последних событий без перехода в логи.' ]),
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
		logTarget.textContent = trimLog((data[3] || {}).stdout || '', 200) || 'Логи пока пусты.';
	},

	pollPanels: function(statusTarget, logTarget) {
		return this.load().then(function(data) {
			this.updatePanels(statusTarget, logTarget, data);
		}.bind(this));
	},

	handleServiceAction: function(action, statusTarget, logTarget) {
		ui.showModal('Выполняется', [
			E('p', {}, [ 'Применяю команду к сервису...' ])
		]);

		return callInitAction('tg-paidmedia', action).then(function(result) {
			ui.hideModal();

			if (!result || result.result !== true)
				throw new Error('Не удалось выполнить действие над сервисом');

			return this.pollPanels(statusTarget, logTarget);
		}.bind(this)).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	render: function(data) {
		var statusTarget = E('div', { 'class': 'tg-paidmedia-section' }, [ 'Загрузка статуса...' ]);
		var logTarget = E('pre', { 'class': 'tg-paidmedia-log' }, [ 'Загрузка логов...' ]);
		var logSection = E('div', { 'class': 'tg-paidmedia-section' }, [
			E('h3', {}, [ 'Журнал событий' ]),
			E('p', { 'class': 'tg-paidmedia-note' }, [ 'Показаны последние 200 строк из logread по сервису tg-paidmedia.' ]),
			logTarget
		]);

		return this.renderForm().then(function(formNode) {
			this.updatePanels(statusTarget, logTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget));

			return E('div', { 'class': 'tg-paidmedia-page' }, [
				this.renderStyles(),
				E('div', { 'class': 'tg-paidmedia-hero' }, [
					E('p', { 'class': 'tg-paidmedia-kicker' }, [ 'Управление магазином Telegram Stars' ]),
					E('h2', { 'class': 'tg-paidmedia-title' }, [ 'Панель управления TG Paid Media' ]),
					E('p', { 'class': 'tg-paidmedia-lead' }, [ 'Здесь можно быстро проверить состояние бота, перезапустить сервис и настроить магазин Telegram Stars в более аккуратном и читаемом виде.' ])
				]),
				statusTarget,
				logSection,
				formNode
			]);
		}.bind(this));
	}
});
