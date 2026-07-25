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
	return value ? _('Yes') : _('No');
}

return view.extend({
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

		m = new form.Map('tg-paidmedia', _('Telegram Paid Media'));
		m.description = _('Configure the bot token, admins, polling behavior and storage paths.');

		s = m.section(form.TypedSection, 'bot', _('Bot Settings'));
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable service'));
		o.rmempty = false;

		o = s.option(form.Value, 'token', _('Bot token'));
		o.password = true;
		o.rmempty = false;
		o.placeholder = '123456:ABCDEF';

		o = s.option(form.DynamicList, 'admin_ids', _('Admin Telegram user IDs'));
		o.datatype = 'uinteger';
		o.placeholder = '123456789';

		o = s.option(form.Value, 'bot_title', _('Shop title'));
		o.rmempty = false;

		o = s.option(form.Value, 'welcome_text', _('Welcome text'));
		o.rmempty = false;

		o = s.option(form.Value, 'poll_timeout', _('Long poll timeout (seconds)'));
		o.datatype = 'uinteger';
		o.placeholder = '25';
		o.rmempty = false;

		o = s.option(form.Flag, 'drop_pending', _('Drop pending Telegram updates on startup'));
		o.rmempty = false;

		o = s.option(form.Value, 'catalog_path', _('Catalog path'));
		o.rmempty = false;
		o.placeholder = '/etc/tg-paidmedia/catalog.json';

		o = s.option(form.Value, 'data_dir', _('Data directory'));
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia';

		o = s.option(form.Value, 'state_path', _('State file path'));
		o.rmempty = false;
		o.placeholder = '/var/lib/tg-paidmedia/state.json';

		o = s.option(form.Value, 'status_path', _('Status file path'));
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
		var actionRow = E('div', { 'style': 'display:flex; gap:.75rem; flex-wrap:wrap;' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('start', statusTarget, logTarget);
				})
			}, [ _('Start') ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('restart', statusTarget, logTarget);
				})
			}, [ _('Restart') ]),
			E('button', {
				'class': 'btn cbi-button cbi-button-negative',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('stop', statusTarget, logTarget);
				})
			}, [ _('Stop') ])
		]);

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Service Status') ]),
			E('div', { 'class': 'table' }, [
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Enabled') ]),
					E('div', { 'class': 'td' }, [ boolLabel(!!initMeta.enabled) ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Running') ]),
					E('div', { 'class': 'td' }, [ boolLabel(serviceMeta.running) ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('PID') ]),
					E('div', { 'class': 'td' }, [ String(serviceMeta.pid || '-') ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Bot username') ]),
					E('div', { 'class': 'td' }, [ String(botStatus.bot_username || '-') ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Catalog items') ]),
					E('div', { 'class': 'td' }, [ String(botStatus.catalog_items || 0) ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Admins') ]),
					E('div', { 'class': 'td' }, [ String(botStatus.admin_count || 0) ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Stars balance') ]),
					E('div', { 'class': 'td' }, [ String(balance.amount || 0) ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Last poll') ]),
					E('div', { 'class': 'td' }, [ String(botStatus.last_poll_at || '-') ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Last error') ]),
					E('div', { 'class': 'td' }, [ String(botStatus.last_error || '-') ])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Last purchase') ]),
					E('div', { 'class': 'td' }, [
						lastPurchase.item_id ?
							String('#' + lastPurchase.item_id + ' ' + (lastPurchase.item_title || '')) :
							'-'
					])
				])
			]),
			E('div', { 'style': 'margin-top:1rem;' }, [ actionRow ])
		]);
	},

	updatePanels: function(statusTarget, logTarget, data) {
		dom.content(statusTarget, this.buildStatusSection(data, statusTarget, logTarget));
		logTarget.textContent = trimLog((data[3] || {}).stdout || '', 200) || _('No logs yet.');
	},

	pollPanels: function(statusTarget, logTarget) {
		return this.load().then(function(data) {
			this.updatePanels(statusTarget, logTarget, data);
		}.bind(this));
	},

	handleServiceAction: function(action, statusTarget, logTarget) {
		ui.showModal(_('Working'), [
			E('p', {}, [ _('Applying service action...') ])
		]);

		return callInitAction('tg-paidmedia', action).then(function(result) {
			ui.hideModal();

			if (!result || result.result !== true)
				throw new Error(_('Service action failed'));

			return this.pollPanels(statusTarget, logTarget);
		}.bind(this)).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	render: function(data) {
		var statusTarget = E('div', { 'class': 'cbi-section' }, [ _('Loading status...') ]);
		var logTarget = E('pre', {
			'style': 'max-height:24rem; overflow:auto; white-space:pre-wrap;'
		}, [ _('Loading logs...') ]);
		var logSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Logs') ]),
			E('p', {}, [ _('Last 200 tg-paidmedia log lines from logread.') ]),
			logTarget
		]);

		return this.renderForm().then(function(formNode) {
			this.updatePanels(statusTarget, logTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget));

			return E('div', {}, [
				statusTarget,
				logSection,
				formNode
			]);
		}.bind(this));
	}
});
