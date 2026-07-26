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

PAYMENT_FIELD_HELP.yoomoney_enabled = {
	title: 'Включить ЮMoney',
	text: 'Включайте только после заполнения номера кошелька, секрета уведомлений и callback URL. Иначе бот не сможет принять и проверить перевод.'
};
PAYMENT_FIELD_HELP.yoomoney_wallet = {
	title: 'Номер кошелька ЮMoney',
	text: 'Номер кошелька, на который ЮMoney будет зачислять рублевые платежи покупателей.'
};
PAYMENT_FIELD_HELP.yoomoney_notification_secret = {
	title: 'Секрет уведомлений ЮMoney',
	text: 'Секрет из настроек HTTP-уведомлений ЮMoney. Он нужен для проверки подписи sign у входящих webhook.'
};
PAYMENT_FIELD_HELP.yoomoney_callback_url = {
	title: 'Публичный URL webhook ЮMoney',
	text: 'Внешний URL для HTTP-уведомлений ЮMoney. На том же домене бот публикует промежуточную платежную страницу для покупателя.'
};
PAYMENT_FIELD_HELP.yoomoney_success_url = {
	title: 'URL успешного возврата ЮMoney',
	text: 'Необязательная страница, на которую ЮMoney вернет покупателя после оплаты.'
};
PAYMENT_FIELD_HELP.yoomoney_webhook_host = {
	title: 'Хост webhook ЮMoney',
	text: 'Локальный адрес, на котором бот принимает HTTP-уведомления ЮMoney. Обычно оставляют 0.0.0.0.'
};
PAYMENT_FIELD_HELP.yoomoney_webhook_port = {
	title: 'Порт webhook ЮMoney',
	text: 'Локальный порт сервера ЮMoney. Его нужно пробросить наружу или проксировать с публичного домена.'
};
PAYMENT_FIELD_HELP.yoomoney_webhook_path = {
	title: 'Путь webhook ЮMoney',
	text: 'Локальный путь для HTTP-уведомлений ЮMoney. Он должен совпадать с путем в публичном callback URL.'
};
PAYMENT_FIELD_HELP.yoomoney_payment_path = {
	title: 'Путь платежной страницы ЮMoney',
	text: 'Локальный путь промежуточной страницы оплаты. Покупатель открывает ее, затем выбирает оплату кошельком ЮMoney или картой.'
};

PAYMENT_FIELD_HELP.yoomoney_tunnel_enabled = {
	title: '\u0410\u0432\u0442\u043E reverse tunnel \u042eMoney',
	text: '\u0415\u0441\u043B\u0438 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u044D\u0442\u0443 \u043E\u043F\u0446\u0438\u044E, tg-paidmedia \u0441\u0430\u043C \u0431\u0443\u0434\u0435\u0442 \u0434\u0435\u0440\u0436\u0430\u0442\u044C reverse SSH tunnel \u0447\u0435\u0440\u0435\u0437 procd. \u0422\u0435\u0440\u043C\u0438\u043D\u0430\u043B \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u044C.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_host = {
	title: '\u0425\u043E\u0441\u0442 VPS \u0434\u043B\u044F tunnel',
	text: '\u041F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 IP \u0438\u043B\u0438 \u0434\u043E\u043C\u0435\u043D VPS, \u043A\u0443\u0434\u0430 \u0440\u043E\u0443\u0442\u0435\u0440 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u0442 reverse SSH tunnel.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_port = {
	title: 'SSH \u043F\u043E\u0440\u0442 VPS',
	text: '\u041E\u0431\u044B\u0447\u043D\u043E 22. \u041C\u0435\u043D\u044F\u0439\u0442\u0435, \u0435\u0441\u043B\u0438 \u043D\u0430 VPS SSH \u0441\u043B\u0443\u0448\u0430\u0435\u0442 \u043D\u0435 \u043D\u0430 22.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_user = {
	title: 'SSH \u043B\u043E\u0433\u0438\u043D VPS',
	text: '\u041F\u043E\u0434 \u043A\u0430\u043A\u0438\u043C \u043B\u043E\u0433\u0438\u043D\u043E\u043C \u0440\u043E\u0443\u0442\u0435\u0440 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u0442 tunnel \u043D\u0430 VPS.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_remote_port = {
	title: '\u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u043F\u043E\u0440\u0442 tunnel',
	text: '\u042D\u0442\u043E \u043F\u043E\u0440\u0442 \u043D\u0430 VPS, \u043A\u0443\u0434\u0430 nginx \u0438\u043B\u0438 proxy \u0431\u0443\u0434\u0435\u0442 \u043F\u0440\u043E\u043A\u0438\u0434\u044B\u0432\u0430\u0442\u044C webhook \u042eMoney.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_local_host = {
	title: '\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u0445\u043E\u0441\u0442 tunnel',
	text: '\u041E\u0431\u044B\u0447\u043D\u043E 127.0.0.1. \u042D\u0442\u043E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 host \u043D\u0430 \u0440\u043E\u0443\u0442\u0435\u0440\u0435, \u043A\u0443\u0434\u0430 tunnel \u043E\u0442\u0434\u0430\u0451\u0442 webhook.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_local_port = {
	title: '\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u0442 tunnel',
	text: '\u041E\u0431\u044B\u0447\u043D\u043E \u0442\u043E\u0442 \u0436\u0435 \u043F\u043E\u0440\u0442, \u0447\u0442\u043E \u0438 webhook \u042eMoney, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 8100.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_private_key = {
	title: '\u041A\u043B\u044E\u0447 SSH \u0434\u043B\u044F tunnel',
	text: '\u041F\u0443\u0442\u044C \u043A private key \u043D\u0430 \u0440\u043E\u0443\u0442\u0435\u0440\u0435. \u041D\u0443\u0436\u0435\u043D \u0432\u0445\u043E\u0434 \u043D\u0430 VPS \u0431\u0435\u0437 \u043F\u0430\u0440\u043E\u043B\u044F.'
};
PAYMENT_FIELD_HELP.yoomoney_tunnel_accept_hostkey = {
	title: '\u0410\u0432\u0442\u043E-\u043F\u0440\u0438\u0451\u043C host key',
	text: '\u041D\u0443\u0436\u043D\u043E \u0434\u043B\u044F \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0441\u0442\u0430\u0440\u0442\u0430, \u0447\u0442\u043E\u0431\u044B tunnel \u043D\u0435 \u0436\u0434\u0430\u043B \u0440\u0443\u0447\u043D\u043E\u0433\u043E \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F host key.'
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

function splitLogLines(text) {
	return String(text || '').split(/\r?\n/).filter(function(line) {
		return String(line || '').trim().length > 0;
	});
}

function extractSyslogStamp(line) {
	var match = String(line || '').match(/^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4}/);
	return match ? match[0] : '';
}

function parseSyslogStamp(stamp) {
	var match = String(stamp || '').match(/^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/);
	var months, monthIndex;

	if (!match)
		return null;

	months = {
		Jan: 0,
		Feb: 1,
		Mar: 2,
		Apr: 3,
		May: 4,
		Jun: 5,
		Jul: 6,
		Aug: 7,
		Sep: 8,
		Oct: 9,
		Nov: 10,
		Dec: 11
	};
	monthIndex = months[match[1]];

	if (monthIndex == null)
		return null;

	return new Date(
		Number(match[6]),
		monthIndex,
		Number(match[2]),
		Number(match[3]),
		Number(match[4]),
		Number(match[5])
	);
}

function collectStartLines(logText) {
	return splitLogLines(logText).filter(function(line) {
		return /Starting Telegram Paid Media bot/.test(line);
	});
}

function buildRecentStartStats(logText) {
	var startLines = collectStartLines(logText);
	var nowMs = Date.now();
	var oneHourMs = 60 * 60 * 1000;
	var recentStarts = [];

	startLines.forEach(function(line) {
		var stamp = extractSyslogStamp(line);
		var parsed = parseSyslogStamp(stamp);

		if (parsed && (nowMs - parsed.getTime()) <= oneHourMs)
			recentStarts.push(stamp);
	});

	return {
		countLastHour: recentStarts.length,
		recentStarts: recentStarts.slice(-4)
	};
}

function isBotTracebackLine(line) {
	var source = String(line || '');

	return /Traceback|File ".*", line \d+|[A-Za-z]+Error:|Exception:|RuntimeError:|AttributeError:/.test(source);
}

function isBotLogLine(line) {
	var source = String(line || '');

	return /tg-paidmedia:/.test(source) ||
		(/python3\[/.test(source) && /Traceback|Exception|Error|Fatal startup error/.test(source)) ||
		isBotTracebackLine(source);
}

function filterBotLogText(text, lines) {
	var result = [];
	var tracebackCarry = 0;

	splitLogLines(text).forEach(function(line) {
		if (isBotLogLine(line)) {
			result.push(line);
			tracebackCarry = /Traceback|Fatal startup error|last_exception|Exception|Error/.test(line) ? 12 : Math.max(tracebackCarry - 1, 0);
			return;
		}

		if (tracebackCarry > 0 && isBotTracebackLine(line)) {
			result.push(line);
			tracebackCarry--;
		}
		else if (tracebackCarry > 0) {
			tracebackCarry--;
		}
	});

	return trimLog(result.join('\n'), lines || 200);
}

function firstMeaningfulLine(text) {
	var lines = splitLogLines(text);
	return lines.length ? lines[0] : '';
}

function buildYooMoneyGuideMarkup() {
	return [
		'<details class="tg-paidmedia-inline-guide tg-paidmedia-inline-guide-yellow">',
		'<summary>Открыть / скрыть инструкцию по ЮMoney</summary>',
		'<div class="tg-paidmedia-inline-guide-body">',
		'<p><strong>Быстрые ссылки</strong></p>',
		'<ul class="tg-paidmedia-info-list">',
		'<li><a href="https://yoomoney.ru/document/nastroieki-koshelka" target="_blank" rel="noopener noreferrer">ЮMoney: настройки кошелька</a></li>',
		'<li><a href="https://yoomoney.ru/document/http-uvedomleniya" target="_blank" rel="noopener noreferrer">ЮMoney: HTTP-уведомления</a></li>',
		'<li><a href="https://yoomoney.ru/document/api-dlya-razrabotchikov" target="_blank" rel="noopener noreferrer">ЮMoney: API для разработчиков</a></li>',
		'<li><a href="https://raw.githubusercontent.com/kzolotarev95/luci-app-tg-paidmedia/main/openwrt/install.sh" target="_blank" rel="noopener noreferrer">Установка и обновление TG Paid Media</a></li>',
		'</ul>',
		'<p><strong>1. Что нужно заранее</strong></p>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Кошелек ЮMoney с включенными <a href="https://yoomoney.ru/document/http-uvedomleniya" target="_blank" rel="noopener noreferrer">HTTP-уведомлениями</a>.</li>',
		'<li>Публичный домен, который открывается снаружи, например <code>example.com</code>.</li>',
		'<li>VPS или сервер с публичным IP, если бот стоит дома за роутером.</li>',
		'<li>На роутере уже установлен TG Paid Media.</li>',
		'</ul>',
		'<p><strong>2. Что взять в ЮMoney</strong></p>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Номер кошелька: вида <code>4100...</code>.</li>',
		'<li>Секрет: откройте <a href="https://yoomoney.ru/document/http-uvedomleniya" target="_blank" rel="noopener noreferrer">HTTP-уведомления</a> и нажмите <code>Показать секрет</code>.</li>',
		'<li>URL уведомлений: <code>https://example.com/yoomoney/webhook</code>.</li>',
		'</ul>',
		'<p><strong>3. Что заполнить в LuCI</strong></p>',
		'<ul class="tg-paidmedia-info-list">',
		'<li><code>Включить ЮMoney</code> = включено.</li>',
		'<li><code>Номер кошелька ЮMoney</code> = ваш номер кошелька.</li>',
		'<li><code>Секрет уведомлений ЮMoney</code> = секрет из HTTP-уведомлений.</li>',
		'<li><code>Публичный URL webhook ЮMoney</code> = <code>https://example.com/yoomoney/webhook</code>.</li>',
		'<li><code>Хост</code> = <code>0.0.0.0</code>, <code>Порт</code> = <code>8100</code>, <code>Путь webhook</code> = <code>/yoomoney/webhook</code>, <code>Путь платежной страницы</code> = <code>/yoomoney/pay</code>.</li>',
		'</ul>',
		'<p><strong>4. Как обновить роутер</strong></p>',
		'<pre class="tg-paidmedia-inline-code">wget -qO- "https://raw.githubusercontent.com/kzolotarev95/luci-app-tg-paidmedia/main/openwrt/install.sh?v=$(date +%s)" | sh\n/etc/init.d/tg-paidmedia restart</pre>',
		'<p><strong>5. Как поднять публичный URL через VPS</strong></p>',
		'<p>Если бот работает дома за роутером, удобная схема такая: домен смотрит на VPS, а VPS проксирует запросы в SSH tunnel на роутер.</p>',
		'<p>1. На роутере или через авто-tunnel в LuCI поднимите обратный SSH tunnel:</p>',
		'<pre class="tg-paidmedia-inline-code">ssh -N -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -R 127.0.0.1:18101:127.0.0.1:8100 root@IP_ВАШЕГО_VPS</pre>',
		'<p>2. Если ваш домен обслуживает Caddy, добавьте проксирование <code>/yoomoney/*</code> на VPS:</p>',
		'<pre class="tg-paidmedia-inline-code">grep -R "example.com" -n /etc/caddy\nnano /etc/caddy/Caddyfile</pre>',
		'<pre class="tg-paidmedia-inline-code">example.com {\n    @yoomoney path /yoomoney/*\n    reverse_proxy @yoomoney 127.0.0.1:18101\n}</pre>',
		'<p>3. Проверьте и перезагрузите Caddy:</p>',
		'<pre class="tg-paidmedia-inline-code">caddy validate --config /etc/caddy/Caddyfile\nsystemctl reload caddy</pre>',
		'<p>4. Если вместо Caddy у вас nginx, используйте такой блок:</p>',
		'<pre class="tg-paidmedia-inline-code">server {\n    listen 80;\n    server_name example.com;\n\n    location /yoomoney/ {\n        proxy_pass http://127.0.0.1:18101;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n}</pre>',
		'<pre class="tg-paidmedia-inline-code">nginx -t\nsystemctl reload nginx</pre>',
		'<p>5. Проверьте, что tunnel и публичный URL отвечают с VPS:</p>',
		'<pre class="tg-paidmedia-inline-code">curl -i http://127.0.0.1:18101/yoomoney/pay/24\ncurl -i https://example.com/yoomoney/pay/24</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Оба запроса должны отвечать без <code>404</code> и <code>502</code>.</li>',
		'<li>Если внутренний URL отвечает, а внешний даёт <code>404</code> и в заголовке видно <code>server: Caddy</code>, значит в Caddy не добавлен маршрут <code>/yoomoney/*</code>.</li>',
		'<li>Для ЮMoney лучше указывать именно <code>https://example.com/yoomoney/webhook</code>.</li>',
		'</ul>',
		'<p><strong>6. Как проверить webhook</strong></p>',
		'<pre class="tg-paidmedia-inline-code">/etc/init.d/tg-paidmedia restart\nlogread -f | grep tg-paidmedia</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>В ЮMoney откройте <a href="https://yoomoney.ru/document/http-uvedomleniya" target="_blank" rel="noopener noreferrer">HTTP-уведомления</a> и нажмите <code>Протестировать</code>.</li>',
		'<li>В логе должна появиться строка <code>POST /yoomoney/webhook ... 200</code>.</li>',
		'<li>Если видите <code>signature validation failed</code>, значит секрет в LuCI не совпадает с секретом в ЮMoney.</li>',
		'<li>Если в логах пусто, значит URL не сохранился или VPS/tunnel/proxy не пропускает запрос.</li>',
		'</ul>',
		'<p><strong>7. Как принять первую оплату</strong></p>',
		'<pre class="tg-paidmedia-inline-code">/catalog\n/buyyoomoney 23</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>В боте откройте каталог или используйте команду <code>/buyyoomoney &lt;id&gt;</code>.</li>',
		'<li>Бот пришлет ссылку вида <code>https://example.com/yoomoney/pay/6</code>.</li>',
		'<li>Откройте ссылку, оплатите и дождитесь сообщения с выдачей медиа в чат.</li>',
		'<li>Проверить заказы можно командой <code>/orders</code>.</li>',
		'</ul>',
		'<p><strong>8. Что смотреть при проблемах</strong></p>',
		'<pre class="tg-paidmedia-inline-code">logread -f | grep tg-paidmedia\n/etc/init.d/tg-paidmedia restart</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Нет <code>POST /yoomoney/webhook</code>: проблема с URL, VPS, Caddy/nginx или tunnel.</li>',
		'<li>Есть <code>POST</code>, но заказ висит: проверьте секрет и номер кошелька.</li>',
		'<li>Оплата прошла, но товар не пришел: проверьте <code>/orders</code> и лог бота.</li>',
		'</ul>',
		'</div>',
		'</details>'
	].join('');
}

function buildYooMoneyTunnelGuideMarkup() {
	return [
		'<details class="tg-paidmedia-inline-guide tg-paidmedia-inline-guide-yellow">',
		'<summary>Пошагово: reverse tunnel для ЮMoney через VPS</summary>',
		'<div class="tg-paidmedia-inline-guide-body">',
		'<p><strong>Когда это нужно</strong></p>',
		'<p>Если у роутера нет белого IP, ЮMoney отправляет webhook на VPS, а VPS прокидывает его по SSH reverse tunnel обратно на роутер.</p>',
		'<p><strong>1. Что сделать на роутере</strong></p>',
		'<pre class="tg-paidmedia-inline-code">mkdir -p /root/.ssh\nchmod 700 /root/.ssh\n[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N \"\"\ncat /root/.ssh/id_ed25519.pub</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Команда <code>cat /root/.ssh/id_ed25519.pub</code> покажет публичный ключ роутера.</li>',
		'<li>Нужна вся строка, которая начинается с <code>ssh-ed25519</code>.</li>',
		'</ul>',
		'<p><strong>2. Что сделать на VPS</strong></p>',
		'<pre class="tg-paidmedia-inline-code">mkdir -p /root/.ssh\nchmod 700 /root/.ssh\ntouch /root/.ssh/authorized_keys\nchmod 600 /root/.ssh/authorized_keys\nprintf \'%s\\n\' \'ssh-ed25519 AAAA... КЛЮЧ_С_РОУТЕРА\' >> /root/.ssh/authorized_keys</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>В <code>authorized_keys</code> нужно добавлять именно строку ключа с роутера, а не путь <code>/root/.ssh/id_ed25519.pub</code>.</li>',
		'<li>Если раньше по ошибке добавили путь к файлу, удалите его: <code>sed -i \'\\|/root/.ssh/id_ed25519.pub|d\' /root/.ssh/authorized_keys</code>.</li>',
		'</ul>',
		'<p><strong>3. Проверка SSH с роутера на VPS</strong></p>',
		'<pre class="tg-paidmedia-inline-code">ssh -i /root/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new root@vps.example.com \'echo ok\'</pre>',
		'<p>Если всё настроено правильно, команда вернёт <code>ok</code>.</p>',
		'<p><strong>4. Что заполнить в LuCI</strong></p>',
		'<ul class="tg-paidmedia-info-list">',
		'<li><code>Авто reverse tunnel ЮMoney</code> = включить.</li>',
		'<li><code>Хост VPS для tunnel</code> = <code>vps.example.com</code>.</li>',
		'<li><code>SSH порт VPS</code> = <code>22</code>.</li>',
		'<li><code>SSH логин VPS</code> = <code>root</code>.</li>',
		'<li><code>Удалённый порт tunnel</code> = <code>18101</code>.</li>',
		'<li><code>Локальный хост tunnel</code> = <code>127.0.0.1</code>.</li>',
		'<li><code>Локальный порт tunnel</code> = <code>8100</code>.</li>',
		'<li><code>Ключ SSH для tunnel</code> = <code>/root/.ssh/id_ed25519</code>.</li>',
		'<li><code>Авто-приём host key</code> = включить.</li>',
		'</ul>',
		'<p><strong>5. Если мини-проверка пишет Tunnel: missing host</strong></p>',
		'<pre class="tg-paidmedia-inline-code">uci set tg-paidmedia.main.yoomoney_tunnel_enabled=\'1\'\nuci set tg-paidmedia.main.yoomoney_tunnel_host=\'vps.example.com\'\nuci set tg-paidmedia.main.yoomoney_tunnel_port=\'22\'\nuci set tg-paidmedia.main.yoomoney_tunnel_user=\'root\'\nuci set tg-paidmedia.main.yoomoney_tunnel_remote_port=\'18101\'\nuci set tg-paidmedia.main.yoomoney_tunnel_local_host=\'127.0.0.1\'\nuci set tg-paidmedia.main.yoomoney_tunnel_local_port=\'8100\'\nuci set tg-paidmedia.main.yoomoney_tunnel_private_key=\'/root/.ssh/id_ed25519\'\nuci set tg-paidmedia.main.yoomoney_tunnel_accept_hostkey=\'1\'\nuci commit tg-paidmedia\n/etc/init.d/tg-paidmedia restart</pre>',
		'<p>Так вы принудительно сохраняете поля tunnel в UCI, если LuCI визуально показывает host, но сервис его не видит.</p>',
		'<p><strong>6. Как проверить, что tunnel поднялся</strong></p>',
		'<pre class="tg-paidmedia-inline-code">ss -lntp | grep 18101</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>На VPS должна появиться строка вида <code>127.0.0.1:18101 ... sshd</code>.</li>',
		'<li>Это значит, что reverse tunnel уже слушает на VPS и может принимать запросы от Caddy, nginx или другого proxy.</li>',
		'</ul>',
		'<p><strong>7. Публичный прокси на VPS</strong></p>',
		'<pre class="tg-paidmedia-inline-code">grep -R "example.com" -n /etc/caddy\nnano /etc/caddy/Caddyfile</pre>',
		'<pre class="tg-paidmedia-inline-code">example.com {\n    @yoomoney path /yoomoney/*\n    reverse_proxy @yoomoney 127.0.0.1:18101\n}</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>Если домен обслуживает Caddy, именно он должен проксировать <code>/yoomoney/*</code> на <code>127.0.0.1:18101</code>.</li>',
		'<li>Не используйте <code>handle_path</code>, иначе Caddy срежет <code>/yoomoney</code> и бот будет отвечать <code>Not found</code>.</li>',
		'<li>После правки проверьте: <code>caddy validate --config /etc/caddy/Caddyfile</code> и <code>systemctl reload caddy</code>.</li>',
		'</ul>',
		'<p><strong>8. Проверка webhook</strong></p>',
		'<pre class="tg-paidmedia-inline-code">/etc/init.d/tg-paidmedia restart\nlogread -f | grep tg-paidmedia</pre>',
		'<ul class="tg-paidmedia-info-list">',
		'<li>В кабинете ЮMoney нажмите тест HTTP-уведомления.</li>',
		'<li>В логе должна появиться строка <code>POST /yoomoney/webhook ... 200</code>.</li>',
		'<li>Если видите <code>signature validation failed</code>, значит секрет в LuCI не совпадает с секретом в кабинете ЮMoney.</li>',
		'<li>Если <code>curl -i http://127.0.0.1:18101/yoomoney/pay/24</code> отвечает, а <code>curl -i https://example.com/yoomoney/pay/24</code> даёт <code>404</code>, проблема именно в конфиге Caddy или nginx на VPS.</li>',
		'</ul>',
		'</div>',
		'</details>'
	].join('');
}

function buildRestartInsight(logText, botStatus) {
	var startLines = collectStartLines(logText);
	var lastStartLine = startLines.length ? startLines[startLines.length - 1] : '';
	var lastStartStamp = extractSyslogStamp(lastStartLine) || String(botStatus.last_poll_at || '-');
	var lastError = String(botStatus.last_error || '').trim();
	var lastException = String(botStatus.last_exception || '').trim();
	var summary = '\u041D\u0435 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043E';
	var detail = '';

	if (lastException || lastError) {
		summary = '\u041F\u043E\u0441\u043B\u0435 \u043E\u0448\u0438\u0431\u043A\u0438';
		detail = firstMeaningfulLine(lastError || lastException);
	}
	else if (startLines.length > 1) {
		summary = '\u041F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u0431\u0435\u0437 \u043E\u0448\u0438\u0431\u043A\u0438';
		detail = '\u041F\u043E\u0445\u043E\u0436\u0435 \u043D\u0430 \u0440\u0443\u0447\u043D\u043E\u0439 restart, \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u0438\u043B\u0438 procd.';
	}
	else if (startLines.length === 1) {
		summary = '\u0427\u0438\u0441\u0442\u044B\u0439 \u0441\u0442\u0430\u0440\u0442';
		detail = '\u0412 \u043B\u043E\u0433\u0435 \u043D\u0435 \u0432\u0438\u0434\u043D\u043E \u043F\u0440\u0438\u0437\u043D\u0430\u043A\u043E\u0432 \u043F\u0430\u0434\u0435\u043D\u0438\u044F.';
	}

	return {
		lastStartAt: lastStartStamp || '-',
		summary: detail ? (summary + ': ' + detail) : summary
	};
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function boolLabel(value) {
	return value ? '\u0414\u0430' : '\u041d\u0435\u0442';
}

function formatRubDisplay(value) {
	var amount = Number(value || 0);

	if (!isFinite(amount))
		amount = 0;

	return String(Math.round(amount)) + ' RUB';
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

function parseColorValue(value) {
	var source = String(value || '').trim();
	var hex;

	if (!source || source === 'transparent')
		return null;

	if (source.charAt(0) === '#') {
		hex = source.slice(1);

		if (hex.length === 3) {
			return {
				r: parseInt(hex.charAt(0) + hex.charAt(0), 16),
				g: parseInt(hex.charAt(1) + hex.charAt(1), 16),
				b: parseInt(hex.charAt(2) + hex.charAt(2), 16),
				a: 1
			};
		}

		if (hex.length === 6) {
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
				a: 1
			};
		}
	}

	var match = source.match(/^rgba?\(([^)]+)\)$/i);
	if (!match)
		return null;

	var parts = match[1].split(',').map(function(part) { return part.trim(); });

	return {
		r: parseFloat(parts[0] || '0'),
		g: parseFloat(parts[1] || '0'),
		b: parseFloat(parts[2] || '0'),
		a: parts.length > 3 ? parseFloat(parts[3] || '1') : 1
	};
}

function relativeLuminance(color) {
	function normalize(channel) {
		var value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	}

	if (!color)
		return 1;

	return 0.2126 * normalize(color.r) +
		0.7152 * normalize(color.g) +
		0.0722 * normalize(color.b);
}

function detectDarkTheme() {
	if (typeof window === 'undefined' || typeof document === 'undefined')
		return false;

	var classHints = String(
		(document.documentElement && document.documentElement.className || '') + ' ' +
		(document.body && document.body.className || '') + ' ' +
		(document.documentElement && document.documentElement.getAttribute('data-theme') || '') + ' ' +
		(document.body && document.body.getAttribute('data-theme') || '')
	).toLowerCase();

	if (/(^|\s|[-_])(dark|black|night|midnight|noir|carbon)(\s|$|[-_])/.test(classHints) ||
		/theme-dark|theme-black|mode-dark|prefers-dark|bootstrap-dark|material-dark|argon-dark/.test(classHints))
		return true;

	if (/(^|\s|[-_])(light|white)(\s|$|[-_])/.test(classHints) ||
		/theme-light|mode-light|prefers-light/.test(classHints))
		return false;

	var candidates = [
		document.querySelector('.main'),
		document.querySelector('.main-right'),
		document.querySelector('#maincontent'),
		document.body,
		document.documentElement
	].filter(function(node) { return !!node; });

	for (var i = 0; i < candidates.length; i++) {
		var styles = window.getComputedStyle(candidates[i]);
		var color = parseColorValue(styles.backgroundColor);
		var textColor = parseColorValue(styles.color);

		if (color && color.a > 0.2)
			return relativeLuminance(color) < 0.42;

		if (textColor && relativeLuminance(textColor) > 0.7)
			return true;
	}

	return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function clampColorChannel(value) {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function colorToString(color, alphaOverride) {
	var alpha;

	if (!color)
		return '';

	alpha = typeof alphaOverride === 'number' ? alphaOverride : (typeof color.a === 'number' ? color.a : 1);

	if (alpha >= 0.999)
		return 'rgb(' + clampColorChannel(color.r) + ', ' + clampColorChannel(color.g) + ', ' + clampColorChannel(color.b) + ')';

	return 'rgba(' + clampColorChannel(color.r) + ', ' + clampColorChannel(color.g) + ', ' + clampColorChannel(color.b) + ', ' + Math.max(0, Math.min(1, alpha)) + ')';
}

function mixColors(base, overlay, ratio) {
	var weight = Math.max(0, Math.min(1, ratio));
	var baseAlpha, overlayAlpha;

	if (!base && !overlay)
		return null;

	if (!base)
		return overlay;

	if (!overlay)
		return base;

	baseAlpha = typeof base.a === 'number' ? base.a : 1;
	overlayAlpha = typeof overlay.a === 'number' ? overlay.a : 1;

	return {
		r: (base.r * (1 - weight)) + (overlay.r * weight),
		g: (base.g * (1 - weight)) + (overlay.g * weight),
		b: (base.b * (1 - weight)) + (overlay.b * weight),
		a: (baseAlpha * (1 - weight)) + (overlayAlpha * weight)
	};
}

function shiftColor(color, amount) {
	if (!color)
		return null;

	return mixColors(
		color,
		amount >= 0 ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 },
		Math.min(1, Math.abs(amount))
	);
}

function resolveThemeColor(node, property, fallback) {
	var current = node;
	var styles, color;

	while (current) {
		styles = window.getComputedStyle(current);
		color = parseColorValue(styles.getPropertyValue(property) || styles[property]);

		if (color && color.a > 0.03)
			return color;

		current = current.parentElement;
	}

	return fallback || null;
}

function buildThemeProbe() {
	var wrapper, section, note, link, input, primary, secondary;

	if (typeof document === 'undefined' || !document.body)
		return null;

	wrapper = document.createElement('div');
	wrapper.style.position = 'absolute';
	wrapper.style.left = '-9999px';
	wrapper.style.top = '-9999px';
	wrapper.style.width = '320px';
	wrapper.style.visibility = 'hidden';
	wrapper.style.pointerEvents = 'none';
	wrapper.style.opacity = '0';
	wrapper.style.zIndex = '-1';

	section = document.createElement('div');
	section.className = 'cbi-section';

	note = document.createElement('p');
	note.textContent = 'Theme probe';
	section.appendChild(note);

	link = document.createElement('a');
	link.href = '#';
	link.textContent = 'Theme link';
	section.appendChild(link);

	input = document.createElement('input');
	input.type = 'text';
	input.placeholder = 'Theme input';
	section.appendChild(input);

	primary = document.createElement('button');
	primary.className = 'btn cbi-button cbi-button-action';
	primary.type = 'button';
	primary.textContent = 'Apply';
	section.appendChild(primary);

	secondary = document.createElement('button');
	secondary.className = 'btn cbi-button';
	secondary.type = 'button';
	secondary.textContent = 'Cancel';
	section.appendChild(secondary);

	wrapper.appendChild(section);
	document.body.appendChild(wrapper);

	return {
		wrapper: wrapper,
		section: section,
		note: note,
		link: link,
		input: input,
		primary: primary,
		secondary: secondary
	};
}

function resolveThemePalette() {
	var probe = buildThemeProbe();
	var isDark = detectDarkTheme();
	var pageNode, pageBg, pageText, sectionStyle, noteStyle, linkStyle, inputStyle, primaryStyle, secondaryStyle;
	var surface, surfaceSoft, border, text, textSoft, textMuted, accent, accentSoft, shadow;

	if (!probe)
		return null;

	try {
		pageNode = document.querySelector('.main-right') ||
			document.querySelector('.main') ||
			document.querySelector('#maincontent') ||
			document.body;

		sectionStyle = window.getComputedStyle(probe.section);
		noteStyle = window.getComputedStyle(probe.note);
		linkStyle = window.getComputedStyle(probe.link);
		inputStyle = window.getComputedStyle(probe.input);
		primaryStyle = window.getComputedStyle(probe.primary);
		secondaryStyle = window.getComputedStyle(probe.secondary);

		pageBg = resolveThemeColor(pageNode, 'backgroundColor', parseColorValue('#ffffff'));
		pageText = resolveThemeColor(pageNode, 'color', parseColorValue('#1f2933'));
		surface = parseColorValue(sectionStyle.backgroundColor) || mixColors(pageBg, isDark ? parseColorValue('#ffffff') : parseColorValue('#000000'), isDark ? 0.05 : 0.03);
		border = parseColorValue(sectionStyle.borderColor) || parseColorValue(inputStyle.borderColor) || mixColors(surface, pageText, isDark ? 0.25 : 0.18);
		text = parseColorValue(sectionStyle.color) || parseColorValue(noteStyle.color) || pageText;
		accent = parseColorValue(primaryStyle.backgroundColor) || parseColorValue(linkStyle.color) || parseColorValue('#0b6fdb');
		surfaceSoft = parseColorValue(inputStyle.backgroundColor) || shiftColor(surface, isDark ? 0.04 : -0.03);
		textSoft = parseColorValue(noteStyle.color) || mixColors(text, surface, 0.3);
		textMuted = mixColors(text, surface, 0.48);
		accentSoft = mixColors(surface, accent, isDark ? 0.18 : 0.12);
		shadow = sectionStyle.boxShadow && sectionStyle.boxShadow !== 'none' ? sectionStyle.boxShadow : (isDark ? '0 8px 20px rgba(0, 0, 0, 0.18)' : '0 1px 2px rgba(16, 24, 40, 0.06)');

		return {
			'--tg-surface': colorToString(surface),
			'--tg-surface-soft': colorToString(surfaceSoft),
			'--tg-border': colorToString(border),
			'--tg-border-strong': colorToString(mixColors(border, text, isDark ? 0.16 : 0.22)),
			'--tg-text': colorToString(text),
			'--tg-text-soft': colorToString(textSoft),
			'--tg-text-muted': colorToString(textMuted),
			'--tg-accent': colorToString(accent),
			'--tg-accent-soft': colorToString(accentSoft),
			'--tg-shadow': shadow,
			'--tg-primary-button-bg': colorToString(parseColorValue(primaryStyle.backgroundColor) || accent),
			'--tg-primary-button-border': colorToString(parseColorValue(primaryStyle.borderColor) || accent),
			'--tg-primary-button-text': colorToString(parseColorValue(primaryStyle.color) || parseColorValue('#ffffff')),
			'--tg-secondary-button-bg': colorToString(parseColorValue(secondaryStyle.backgroundColor) || surfaceSoft),
			'--tg-secondary-button-border': colorToString(parseColorValue(secondaryStyle.borderColor) || border),
			'--tg-secondary-button-text': colorToString(parseColorValue(secondaryStyle.color) || text),
			'--tg-help-bg': colorToString(shiftColor(surfaceSoft, isDark ? 0.03 : 0.01)),
			'--tg-help-border': colorToString(border),
			'--tg-help-text': colorToString(textSoft),
			'--tg-tooltip-bg': colorToString(surface),
			'--tg-tooltip-border': colorToString(border),
			'--tg-tooltip-shadow': shadow,
			'--tg-log-bg': colorToString(mixColors(surface, pageBg, isDark ? 0.28 : 0.18)),
			'--tg-input-bg': colorToString(parseColorValue(inputStyle.backgroundColor) || surfaceSoft),
			'--tg-input-border': colorToString(parseColorValue(inputStyle.borderColor) || border),
			'--tg-input-placeholder': colorToString(mixColors(text, surface, 0.58)),
			'--tg-focus-border': colorToString(parseColorValue(inputStyle.borderColor) || accent),
			'--tg-focus-ring': '0 0 0 2px ' + colorToString(accent, isDark ? 0.18 : 0.10),
			'--tg-tab-bg': colorToString(parseColorValue(secondaryStyle.backgroundColor) || surfaceSoft)
		};
	}
	finally {
		document.body.removeChild(probe.wrapper);
	}
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
				--tg-badge-running-bg: #edf7f1;
				--tg-badge-running-border: #c7e7d3;
				--tg-badge-stopped-bg: #fbecec;
				--tg-badge-stopped-border: #efcdcd;
				--tg-primary-button-bg: #0b6fdb;
				--tg-primary-button-border: #0b6fdb;
				--tg-primary-button-text: #ffffff;
				--tg-secondary-button-bg: #ffffff;
				--tg-secondary-button-border: #d4dbe5;
				--tg-secondary-button-text: var(--tg-text);
				--tg-help-bg: #eef2f6;
				--tg-help-border: #bfc9d8;
				--tg-help-text: #445263;
				--tg-tooltip-bg: #ffffff;
				--tg-tooltip-border: #cfd6df;
				--tg-tooltip-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
				--tg-log-bg: #fbfcfd;
				--tg-log-info-bg: #eef8f1;
				--tg-log-info-border: #66a27a;
				--tg-log-info-text: #27533a;
				--tg-log-warn-bg: #fff8eb;
				--tg-log-warn-border: #d39a2c;
				--tg-log-warn-text: #7a5812;
				--tg-log-error-bg: #fdf1f1;
				--tg-log-error-border: #d15555;
				--tg-log-error-text: #7f2727;
				--tg-log-neutral-border: #ced6df;
				--tg-error-panel-bg: #fdf1f1;
				--tg-error-panel-border: #efcdcd;
				--tg-error-panel-title: #8a2d2d;
				--tg-error-panel-text: #6a3030;
				--tg-input-bg: #ffffff;
				--tg-input-border: #cfd6df;
				--tg-input-placeholder: #93a1b2;
				--tg-focus-border: #7aa7dd;
				--tg-focus-ring: 0 0 0 2px rgba(11, 111, 219, 0.08);
				--tg-tab-bg: #eef2f6;
				padding: 8px 0 18px;
				color: var(--tg-text);
				background: transparent;
				font-family: inherit;
				font-size: .82rem;
			}

			.tg-paidmedia-page.is-dark-theme {
				--tg-surface: #1e252f;
				--tg-surface-soft: #252d39;
				--tg-border: #394353;
				--tg-border-strong: #475467;
				--tg-text: #edf2f7;
				--tg-text-soft: #c2ccd8;
				--tg-text-muted: #99a7b8;
				--tg-accent: #6fb2ff;
				--tg-accent-soft: rgba(111, 178, 255, 0.15);
				--tg-success: #7fd5a1;
				--tg-warning: #f1c36a;
				--tg-danger: #ff8a8a;
				--tg-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
				--tg-badge-running-bg: rgba(127, 213, 161, 0.12);
				--tg-badge-running-border: rgba(127, 213, 161, 0.28);
				--tg-badge-stopped-bg: rgba(255, 138, 138, 0.12);
				--tg-badge-stopped-border: rgba(255, 138, 138, 0.24);
				--tg-primary-button-bg: #3b82f6;
				--tg-primary-button-border: #3b82f6;
				--tg-primary-button-text: #f8fbff;
				--tg-secondary-button-bg: #2a3340;
				--tg-secondary-button-border: #435063;
				--tg-secondary-button-text: #edf2f7;
				--tg-help-bg: #2d3746;
				--tg-help-border: #465366;
				--tg-help-text: #d8e1ec;
				--tg-tooltip-bg: #202833;
				--tg-tooltip-border: #3d4858;
				--tg-tooltip-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
				--tg-log-bg: #1a2029;
				--tg-log-info-bg: rgba(127, 213, 161, 0.12);
				--tg-log-info-border: #5bbd83;
				--tg-log-info-text: #b7eccb;
				--tg-log-warn-bg: rgba(241, 195, 106, 0.12);
				--tg-log-warn-border: #d7a54e;
				--tg-log-warn-text: #f7dfab;
				--tg-log-error-bg: rgba(255, 138, 138, 0.12);
				--tg-log-error-border: #e07c7c;
				--tg-log-error-text: #ffc0c0;
				--tg-log-neutral-border: #566273;
				--tg-error-panel-bg: rgba(255, 138, 138, 0.12);
				--tg-error-panel-border: rgba(255, 138, 138, 0.24);
				--tg-error-panel-title: #ffc0c0;
				--tg-error-panel-text: #ffd7d7;
				--tg-input-bg: #161c24;
				--tg-input-border: #435063;
				--tg-input-placeholder: #7d8ca0;
				--tg-focus-border: #6fb2ff;
				--tg-focus-ring: 0 0 0 2px rgba(111, 178, 255, 0.16);
				--tg-tab-bg: #2c3643;
			}

			.tg-paidmedia-shell {
				max-width: 1180px;
				margin: 0 auto;
				padding: 0 12px;
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
				border: 1px solid rgba(232, 190, 74, 0.48);
				border-radius: 8px;
				background: linear-gradient(145deg, rgba(120, 88, 18, 0.28), rgba(255, 220, 126, 0.12));
				box-shadow: inset 0 1px 0 rgba(255, 241, 186, 0.18), 0 0 18px rgba(212, 166, 49, 0.12);
			}

			.tg-paidmedia-logo-mark::before {
				content: "TG";
				color: #f5d76b;
				font-size: 1rem;
				font-weight: 700;
				letter-spacing: .04em;
				text-shadow: 0 0 12px rgba(234, 192, 74, 0.28);
			}

			.tg-paidmedia-logo-wordmark {
				display: flex;
				flex-direction: column;
				gap: .1rem;
			}

			.tg-paidmedia-logo-title {
				margin: 0;
				color: #f4da7e;
				font-size: 1.2rem;
				font-weight: 700;
				line-height: 1.2;
				text-shadow: 0 0 16px rgba(228, 186, 65, 0.14);
			}

			.tg-paidmedia-logo-subtitle {
				margin: 0;
				color: #ccb064;
				font-size: .84rem;
				font-weight: 600;
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
				padding: .78rem .86rem;
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
				gap: .8rem;
				margin-bottom: .82rem;
			}

			.tg-paidmedia-section-subtitle {
				margin: .22rem 0 0;
				color: var(--tg-text-soft);
				font-size: .8rem;
				line-height: 1.42;
			}

			.tg-paidmedia-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
				gap: .5rem;
			}

			.tg-paidmedia-card {
				padding: .58rem .66rem;
				border: 1px solid var(--tg-border);
				border-radius: 8px;
				background: var(--tg-surface-soft);
			}

			.tg-paidmedia-card-label {
				margin: 0 0 .34rem;
				color: var(--tg-text-muted);
				font-size: .66rem;
				font-weight: 600;
				letter-spacing: .02em;
				text-transform: uppercase;
			}

			.tg-paidmedia-card-value {
				margin: 0;
				color: var(--tg-text);
				font-size: .84rem;
				font-weight: 600;
				line-height: 1.28;
				word-break: break-word;
			}

			.tg-paidmedia-card-subtle {
				font-size: .78rem;
				font-weight: 500;
			}

			.tg-paidmedia-badge {
				display: inline-flex;
				align-items: center;
				gap: .45rem;
				padding: .24rem .52rem;
				border-radius: 999px;
				font-size: .74rem;
				font-weight: 600;
				line-height: 1;
			}

			.tg-paidmedia-badge::before {
				content: "";
				width: .4rem;
				height: .4rem;
				border-radius: 50%;
				background: currentColor;
			}

			@keyframes tg-paidmedia-status-pulse {
				0% {
					box-shadow: 0 0 0 0 rgba(127, 213, 161, 0.28);
					transform: scale(1);
				}
				70% {
					box-shadow: 0 0 0 .48rem rgba(127, 213, 161, 0);
					transform: scale(1.08);
				}
				100% {
					box-shadow: 0 0 0 0 rgba(127, 213, 161, 0);
					transform: scale(1);
				}
			}

			@keyframes tg-paidmedia-status-pulse-danger {
				0% {
					box-shadow: 0 0 0 0 rgba(211, 106, 106, 0.26);
					transform: scale(1);
				}
				70% {
					box-shadow: 0 0 0 .48rem rgba(211, 106, 106, 0);
					transform: scale(1.08);
				}
				100% {
					box-shadow: 0 0 0 0 rgba(211, 106, 106, 0);
					transform: scale(1);
				}
			}

			.tg-paidmedia-badge-running {
				color: var(--tg-success);
				background: var(--tg-badge-running-bg);
				border: 1px solid var(--tg-badge-running-border);
			}

			.tg-paidmedia-badge-running::before,
			.tg-paidmedia-top-badge.is-running::before {
				animation: tg-paidmedia-status-pulse 1.8s ease-out infinite;
				transform-origin: center;
			}

			.tg-paidmedia-badge-stopped {
				color: var(--tg-danger);
				background: var(--tg-badge-stopped-bg);
				border: 1px solid var(--tg-badge-stopped-border);
			}

			.tg-paidmedia-badge-pulse-danger::before,
			.tg-paidmedia-top-badge.is-stopped::before {
				animation: tg-paidmedia-status-pulse-danger 1.8s ease-out infinite;
				transform-origin: center;
			}

			.tg-paidmedia-actions {
				display: flex;
				flex-wrap: wrap;
				gap: .48rem;
				margin-top: .72rem;
			}

			.tg-paidmedia-actions .btn {
				min-width: 8.6rem;
				padding: .42rem .64rem;
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-actions .cbi-button-action {
				border-color: var(--tg-primary-button-border);
				background: var(--tg-primary-button-bg);
				color: var(--tg-primary-button-text);
			}

			.tg-paidmedia-actions .cbi-button-negative {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-log-panel {
				overflow: hidden;
			}

			.tg-paidmedia-info-panel {
				overflow: hidden;
			}

			.tg-paidmedia-settings-panel {
				overflow: hidden;
			}

			.tg-paidmedia-payments-panel {
				overflow: visible;
			}

			.tg-paidmedia-log-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
			}

			.tg-paidmedia-info-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
			}

			.tg-paidmedia-settings-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
			}

			.tg-paidmedia-payments-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
			}

			.tg-paidmedia-payments-footer {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
				margin-top: .9rem;
				padding-top: .72rem;
				border-top: 1px solid var(--tg-border);
			}

			.tg-paidmedia-toolbar-btn {
				min-width: 7.9rem;
				padding: .38rem .62rem;
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-log-toggle {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-log-copy {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-info-toggle {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-settings-toggle {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-payments-toggle {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-log-body {
				display: block;
			}

			.tg-paidmedia-info-body {
				display: block;
			}

			.tg-paidmedia-settings-body {
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

			.tg-paidmedia-settings-panel.is-collapsed .tg-paidmedia-settings-body {
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
				border: 1px solid var(--tg-help-border);
				border-radius: 999px;
				background: var(--tg-help-bg);
				color: var(--tg-help-text);
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
				padding: .66rem .74rem;
				border: 1px solid var(--tg-tooltip-border);
				border-radius: 8px;
				background: var(--tg-tooltip-bg);
				color: var(--tg-text-soft);
				font-size: .76rem;
				font-weight: 500;
				line-height: 1.55;
				text-transform: none;
				letter-spacing: normal;
				box-shadow: var(--tg-tooltip-shadow);
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
				max-height: 24rem;
				overflow: auto;
				margin: 0;
				padding: .7rem .78rem;
				border-radius: 8px;
				border: 1px solid var(--tg-border);
				background: var(--tg-log-bg);
				color: var(--tg-text);
				font-family: "Consolas", "Courier New", monospace;
				font-size: .76rem;
				line-height: 1.45;
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
				border-left-color: var(--tg-log-info-border);
				background: var(--tg-log-info-bg);
				color: var(--tg-log-info-text);
			}

			.tg-log-warn {
				border-left-color: var(--tg-log-warn-border);
				background: var(--tg-log-warn-bg);
				color: var(--tg-log-warn-text);
			}

			.tg-log-error {
				border-left-color: var(--tg-log-error-border);
				background: var(--tg-log-error-bg);
				color: var(--tg-log-error-text);
			}

			.tg-log-neutral {
				border-left-color: var(--tg-log-neutral-border);
				color: var(--tg-text);
			}

			.tg-paidmedia-note {
				margin: 0 0 .9rem;
				color: var(--tg-text-soft);
				line-height: 1.5;
			}

			.tg-paidmedia-error {
				margin-bottom: 1rem;
				padding: .72rem .78rem;
				border: 1px solid var(--tg-error-panel-border);
				border-radius: 8px;
				background: var(--tg-error-panel-bg);
			}

			.tg-paidmedia-error strong {
				display: block;
				margin-bottom: .45rem;
				color: var(--tg-error-panel-title);
			}

			.tg-paidmedia-error pre {
				margin: 0;
				color: var(--tg-error-panel-text);
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
				margin-top: .68rem;
				padding: .78rem .82rem;
				border: 1px solid var(--tg-border);
				border-radius: 8px;
				background: var(--tg-surface-soft);
			}

			.tg-paidmedia-page .cbi-section-descr,
			.tg-paidmedia-page .cbi-value-description {
				color: var(--tg-text-soft);
			}

			.tg-paidmedia-inline-guide {
				margin: .2rem 0 .8rem;
				border: 1px solid var(--tg-border);
				border-radius: 8px;
				background: var(--tg-surface);
				overflow: hidden;
			}

			.tg-paidmedia-inline-guide summary {
				cursor: pointer;
				list-style: none;
				padding: .82rem .9rem;
				font-weight: 700;
				user-select: none;
				background: var(--tg-surface-soft);
			}

			.tg-paidmedia-inline-guide summary::-webkit-details-marker {
				display: none;
			}

			.tg-paidmedia-inline-guide-body {
				padding: 0 .9rem .9rem;
			}

			.tg-paidmedia-inline-guide-yellow {
				display: inline-block;
				width: auto;
				max-width: min(100%, 34rem);
				margin-right: auto;
				border-color: #d6ab2f;
				background: var(--tg-surface);
				box-shadow: 0 8px 20px rgba(169, 121, 18, 0.08);
				vertical-align: top;
			}

			.tg-paidmedia-inline-guide-yellow summary {
				background: linear-gradient(135deg, #ffe588 0%, #ffd24d 100%);
				color: #5e4300;
				border-bottom: 1px solid rgba(142, 101, 10, 0.18);
			}

			.tg-paidmedia-inline-guide-yellow .tg-paidmedia-inline-guide-body {
				background: transparent;
			}

			.tg-paidmedia-inline-code {
				margin: .45rem 0 .8rem;
				padding: .75rem .8rem;
				border-radius: 8px;
				background: var(--tg-console-bg);
				color: var(--tg-console-text);
				white-space: pre-wrap;
				word-break: break-word;
				font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				font-size: .87rem;
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
				border: 1px solid var(--tg-input-border);
				border-radius: 5px;
				background: var(--tg-input-bg);
				color: inherit;
				box-shadow: none;
			}

			.tg-paidmedia-page input::placeholder,
			.tg-paidmedia-page textarea::placeholder {
				color: var(--tg-input-placeholder);
			}

			.tg-paidmedia-page input[type="text"]:focus,
			.tg-paidmedia-page input[type="password"]:focus,
			.tg-paidmedia-page input[type="number"]:focus,
			.tg-paidmedia-page textarea:focus,
			.tg-paidmedia-page select:focus {
				border-color: var(--tg-focus-border);
				box-shadow: var(--tg-focus-ring);
			}

			.tg-paidmedia-page .cbi-button,
			.tg-paidmedia-page .btn {
				border-radius: 6px;
				font-weight: 600;
			}

			.tg-paidmedia-page .cbi-button-apply,
			.tg-paidmedia-page .cbi-button-save {
				border-color: var(--tg-primary-button-border);
				background: var(--tg-primary-button-bg);
				color: var(--tg-primary-button-text);
			}

			.tg-paidmedia-page .cbi-button-reset {
				border-color: var(--tg-secondary-button-border);
				background: var(--tg-secondary-button-bg);
				color: var(--tg-secondary-button-text);
			}

			.tg-paidmedia-page .cbi-input-checkbox {
				accent-color: var(--tg-accent);
			}

			.tg-paidmedia-page .cbi-tabmenu li a {
				border-radius: 999px;
				background: var(--tg-tab-bg);
				color: var(--tg-text);
			}

			.tg-paidmedia-page .cbi-tabmenu li.active a,
			.tg-paidmedia-page .cbi-tabmenu li.cbi-tab a {
				background: var(--tg-accent-soft);
				color: var(--tg-accent);
			}

			.tg-paidmedia-page-header {
				display: flex;
				flex-wrap: wrap;
				align-items: flex-start;
				justify-content: space-between;
				gap: .72rem;
				margin: 0 0 .86rem;
			}

			.tg-paidmedia-headline {
				min-width: 0;
			}

			.tg-paidmedia-page-title {
				margin: 0;
				color: #f8e7a4;
				background: linear-gradient(110deg, #7f5c10 0%, #f6d76a 18%, #fff6c4 34%, #c8931e 50%, #fff1a1 66%, #9c6b0a 82%, #f6d76a 100%);
				background-size: 220% auto;
				-webkit-background-clip: text;
				background-clip: text;
				-webkit-text-fill-color: transparent;
				font-size: clamp(1.45rem, 3vw, 1.95rem);
				font-weight: 800;
				line-height: 1.02;
				letter-spacing: -.03em;
				text-shadow: 0 0 18px rgba(234, 191, 71, 0.16);
				animation: tg-paidmedia-gold-flow 4.8s linear infinite;
			}

			.tg-paidmedia-page-subtitle {
				margin: .22rem 0 0;
				color: #c7a74d;
				font-size: .76rem;
				font-weight: 700;
				line-height: 1.36;
				letter-spacing: .02em;
			}

			@keyframes tg-paidmedia-gold-flow {
				0% {
					background-position: 0% 50%;
					filter: drop-shadow(0 0 0 rgba(255, 225, 120, 0));
				}

				50% {
					background-position: 100% 50%;
					filter: drop-shadow(0 0 8px rgba(255, 225, 120, 0.18));
				}

				100% {
					background-position: 0% 50%;
					filter: drop-shadow(0 0 0 rgba(255, 225, 120, 0));
				}
			}

			.tg-paidmedia-page-header-side,
			.tg-paidmedia-header-status {
				display: flex;
				align-items: flex-start;
				justify-content: flex-end;
			}

			.tg-paidmedia-top-badge {
				display: inline-flex;
				align-items: center;
				gap: .5rem;
				padding: .42rem .7rem;
				border-radius: 999px;
				border: 1px solid var(--tg-border);
				background: var(--tg-surface-soft);
				color: var(--tg-text);
				font-size: .74rem;
				font-weight: 700;
				line-height: 1;
				white-space: nowrap;
			}

			.tg-paidmedia-top-badge::before {
				content: "";
				width: .36rem;
				height: .36rem;
				border-radius: 50%;
				background: currentColor;
				box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.04);
			}

			.tg-paidmedia-top-badge.is-running {
				color: #b7f4bf;
				border-color: rgba(124, 192, 109, 0.55);
				background: rgba(80, 132, 68, 0.22);
			}

			.tg-paidmedia-top-badge.is-stopped {
				color: #ffb5b5;
				border-color: rgba(214, 103, 103, 0.45);
				background: rgba(137, 53, 53, 0.22);
			}

			.tg-paidmedia-section,
			.tg-paidmedia-page .cbi-section,
			.tg-paidmedia-page .cbi-section-node {
				border-radius: 14px;
			}

			.tg-paidmedia-section {
				padding: .82rem .88rem .9rem;
			}

			.tg-paidmedia-section-title-strong {
				font-size: .84rem;
				font-weight: 800;
				letter-spacing: -.01em;
			}

			.tg-paidmedia-section-headlined {
				margin-bottom: .72rem;
				padding-bottom: .62rem;
				border-bottom: 1px solid var(--tg-border);
			}

			.tg-paidmedia-status-note {
				margin: .22rem 0 0;
				max-width: 48rem;
			}

			.tg-paidmedia-card {
				min-height: 4.35rem;
				padding: .64rem .68rem .7rem;
				border-radius: 10px;
			}

			.tg-paidmedia-card-label {
				font-size: .64rem;
				letter-spacing: .03em;
			}

			.tg-paidmedia-card-value {
				font-size: .82rem;
				font-weight: 700;
			}

			.tg-paidmedia-actions {
				gap: .46rem;
				margin-top: .72rem;
			}

			.tg-paidmedia-action-btn,
			.tg-paidmedia-btn-open {
				min-width: 8rem;
				padding: .5rem .72rem;
				border-radius: 10px;
				font-size: .76rem;
				font-weight: 700;
				transition: transform .14s ease, border-color .14s ease, background .14s ease;
			}

			.tg-paidmedia-action-btn:hover,
			.tg-paidmedia-btn-open:hover {
				transform: translateY(-1px);
			}

			.tg-paidmedia-btn-start {
				border-color: rgba(111, 184, 128, 0.55);
				background: rgba(74, 120, 84, 0.22);
				color: #d6ffe0;
			}

			.tg-paidmedia-btn-restart {
				border-color: rgba(91, 141, 227, 0.58);
				background: rgba(62, 92, 154, 0.26);
				color: #e0ebff;
			}

			.tg-paidmedia-btn-stop {
				border-color: rgba(201, 111, 111, 0.5);
				background: rgba(125, 58, 58, 0.22);
				color: #ffd8d8;
			}

			.tg-paidmedia-btn-open {
				border-color: rgba(91, 141, 227, 0.58) !important;
				background: rgba(62, 92, 154, 0.26) !important;
				color: #eef4ff !important;
			}

			.tg-paidmedia-callout-panel .tg-paidmedia-section-head,
			.tg-paidmedia-log-panel .tg-paidmedia-section-head,
			.tg-paidmedia-payments-panel .tg-paidmedia-section-head {
				margin-bottom: .68rem;
				padding-bottom: .58rem;
				border-bottom: 1px solid var(--tg-border);
			}

			.tg-paidmedia-callout-panel .tg-paidmedia-section-subtitle,
			.tg-paidmedia-log-panel .tg-paidmedia-section-subtitle,
			.tg-paidmedia-payments-panel .tg-paidmedia-section-subtitle {
				max-width: 48rem;
			}

			.tg-paidmedia-toolbar-btn {
				border-radius: 10px;
				padding: .5rem .72rem;
				font-weight: 700;
			}

			.tg-paidmedia-payments-health-toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: .55rem;
			}

			.tg-paidmedia-page .cbi-map h3,
			.tg-paidmedia-page .cbi-map h4,
			.tg-paidmedia-page .cbi-section h3,
			.tg-paidmedia-page .cbi-section legend {
				font-size: .82rem;
				font-weight: 800;
				letter-spacing: -.01em;
			}

			.tg-paidmedia-page .cbi-section,
			.tg-paidmedia-page .cbi-section-node {
				padding: .78rem .78rem .82rem;
			}

			@media (max-width: 700px) {
				.tg-paidmedia-page-header-side,
				.tg-paidmedia-header-status {
					justify-content: flex-start;
				}

				.tg-paidmedia-top-badge {
					width: 100%;
					justify-content: center;
				}

				.tg-paidmedia-action-btn,
				.tg-paidmedia-btn-open,
				.tg-paidmedia-toolbar-btn {
					width: 100%;
					min-width: 0;
				}

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

		o = s.option(form.FileUpload, 'home_image', '\u0428\u0430\u043f\u043a\u0430 \u0431\u043e\u0442\u0430');
		o.root_directory = '/etc/tg-paidmedia';
		o.enable_download = false;
		o.enable_remove = true;
		o.description = '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 JPG, JPEG, PNG \u0438\u043b\u0438 WEBP. \u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f 1280x720 \u0438\u043b\u0438 1920x1080, \u0434\u043e 10 \u041c\u0411. \u0424\u0430\u0439\u043b \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442\u0441\u044f \u043d\u0430 \u0440\u043e\u0443\u0442\u0435\u0440\u0435 \u0438 \u0431\u043e\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442 \u0435\u0433\u043e \u0432 Telegram \u043a\u0430\u043a \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u0443\u044e \u0448\u0430\u043f\u043a\u0443.';
		o.validate = function(section_id, value) {
			return !value || /\.(jpe?g|png|webp)$/i.test(value) || 'Допустимы только JPG, JPEG, PNG или WEBP.';
		};

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

		o = s.option(form.FileUpload, 'home_image', '\u0428\u0430\u043f\u043a\u0430 \u0431\u043e\u0442\u0430');
		o.root_directory = '/etc/tg-paidmedia';
		o.enable_download = false;
		o.enable_remove = true;
		o.description = '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 JPG, JPEG, PNG \u0438\u043b\u0438 WEBP. \u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f 1280x720 \u0438\u043b\u0438 1920x1080, \u0434\u043e 10 \u041c\u0411. \u0424\u0430\u0439\u043b \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442\u0441\u044f \u043d\u0430 \u0440\u043e\u0443\u0442\u0435\u0440\u0435 \u0438 \u0431\u043e\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442 \u0435\u0433\u043e \u0432 Telegram \u043a\u0430\u043a \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u0443\u044e \u0448\u0430\u043f\u043a\u0443.';
		o.validate = function(section_id, value) {
			return !value || /\.(jpe?g|png|webp)$/i.test(value) || 'Допустимы только JPG, JPEG, PNG или WEBP.';
		};

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

		s = m.section(form.NamedSection, 'main', 'bot', 'ЮMoney');

		o = s.option(form.DummyValue, '_yoomoney_guide', 'Быстрая настройка ЮMoney');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return buildYooMoneyGuideMarkup() + buildYooMoneyTunnelGuideMarkup();
		};

		o = s.option(form.Flag, 'yoomoney_enabled', 'Включить ЮMoney');
		o.rmempty = false;

		o = s.option(form.Value, 'yoomoney_wallet', 'Номер кошелька ЮMoney');
		o.rmempty = true;
		o.placeholder = '41001xxxxxxxxxxxx';

		o = s.option(form.Value, 'yoomoney_notification_secret', 'Секрет уведомлений ЮMoney');
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'yoomoney_callback_url', 'Публичный URL webhook ЮMoney');
		o.rmempty = true;
		o.placeholder = 'https://example.com/yoomoney/webhook';

		o = s.option(form.Value, 'yoomoney_success_url', 'URL успешного возврата ЮMoney');
		o.rmempty = true;

		o = s.option(form.Value, 'yoomoney_webhook_host', 'Хост webhook ЮMoney');
		o.rmempty = true;
		o.placeholder = '0.0.0.0';

		o = s.option(form.Value, 'yoomoney_webhook_port', 'Порт webhook ЮMoney');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '8100';

		o = s.option(form.Value, 'yoomoney_webhook_path', 'Путь webhook ЮMoney');
		o.rmempty = true;
		o.placeholder = '/yoomoney/webhook';

		o = s.option(form.Value, 'yoomoney_payment_path', 'Путь платежной страницы ЮMoney');
		o.rmempty = true;
		o.placeholder = '/yoomoney/pay';

		o = s.option(form.Flag, 'yoomoney_tunnel_enabled', '\u0410\u0432\u0442\u043E reverse tunnel \u042eMoney');
		o.rmempty = false;

		o = s.option(form.Value, 'yoomoney_tunnel_host', '\u0425\u043E\u0441\u0442 VPS \u0434\u043B\u044F tunnel');
		o.rmempty = true;
		o.placeholder = 'vps.example.com';

		o = s.option(form.Value, 'yoomoney_tunnel_port', 'SSH \u043F\u043E\u0440\u0442 VPS');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '22';

		o = s.option(form.Value, 'yoomoney_tunnel_user', 'SSH \u043B\u043E\u0433\u0438\u043D VPS');
		o.rmempty = true;
		o.placeholder = 'root';

		o = s.option(form.Value, 'yoomoney_tunnel_remote_port', '\u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u043F\u043E\u0440\u0442 tunnel');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '18101';

		o = s.option(form.Value, 'yoomoney_tunnel_local_host', '\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u0445\u043E\u0441\u0442 tunnel');
		o.rmempty = true;
		o.placeholder = '127.0.0.1';

		o = s.option(form.Value, 'yoomoney_tunnel_local_port', '\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u0442 tunnel');
		o.datatype = 'port';
		o.rmempty = true;
		o.placeholder = '8100';

		o = s.option(form.Value, 'yoomoney_tunnel_private_key', '\u041A\u043B\u044E\u0447 SSH \u0434\u043B\u044F tunnel');
		o.rmempty = true;
		o.placeholder = '/root/.ssh/id_ed25519';

		o = s.option(form.Flag, 'yoomoney_tunnel_accept_hostkey', '\u0410\u0432\u0442\u043E-\u043F\u0440\u0438\u0451\u043C host key');
		o.rmempty = false;

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

	extractServiceInstance: function(serviceStatus, preferredName) {
		var root = serviceStatus['tg-paidmedia'] || serviceStatus || {};
		var instances = root.instances || {};
		var instanceNames = Object.keys(instances);
		var instanceName = preferredName && instances[preferredName] ? preferredName : null;
		var i;

		if (!instanceName) {
			for (i = 0; i < instanceNames.length; i++) {
				if (instanceNames[i] !== 'yoomoney-tunnel') {
					instanceName = instanceNames[i];
					break;
				}
			}
		}

		if (!instanceName)
			instanceName = instanceNames[0];

		var instance = instanceName ? instances[instanceName] : {};

		return {
			name: instanceName || '',
			instance: instance,
			running: !!(instance && instance.running),
			pid: instance && instance.pid ? instance.pid : ''
		};
	},

	extractServiceRunning: function(serviceStatus) {
		return this.extractServiceInstance(serviceStatus);
	},

	buildStateBadge: function(isOk, okText, badText, extraClass) {
		return E('span', {
			'class': 'tg-paidmedia-badge ' +
				(isOk ? 'tg-paidmedia-badge-running' : 'tg-paidmedia-badge-stopped') +
				(extraClass ? ' ' + extraClass : '')
		}, [ isOk ? okText : badText ]);
	},

	formatYooMoneySecretCheck: function(secretCheck) {
		var reason = String((secretCheck || {}).reason || '').trim();
		var checkedAt = String((secretCheck || {}).checked_at || '').trim();

		if (!checkedAt)
			return '\u0415\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E webhook \u043E\u0442 \u042eMoney';

		return checkedAt + (reason ? ' / ' + reason : '');
	},

	buildYooMoneyHealthSection: function(data, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
		var serviceStatus = data[1] || {};
		var botStatus = parseJSON((data[2] || {}).stdout, {});
		var health = botStatus.yoomoney_health || {};
		var secretCheck = health.last_secret_check || {};
		var serviceMeta = this.extractServiceRunning(serviceStatus);
		var tunnelMeta = this.extractServiceInstance(serviceStatus, 'yoomoney-tunnel');
		var tunnelRuntimeState = String(health.tunnel_runtime_state || '').trim();
		var tunnelRuntimeMessage = String(health.tunnel_runtime_message || '').trim();
		var secretBadge;
		var tunnelBadge;
		var tunnelTargetText;
		var warningsText;
		var cards;

		if (!health.secret_configured)
			secretBadge = this.buildStateBadge(false, '', '\u0421\u0435\u043A\u0440\u0435\u0442 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D');
		else if (secretCheck.ok)
			secretBadge = this.buildStateBadge(true, '\u041F\u0440\u043E\u0448\u0451\u043B', '');
		else if (secretCheck.checked_at)
			secretBadge = this.buildStateBadge(false, '', '\u041E\u0448\u0438\u0431\u043A\u0430 sign');
		else
			secretBadge = this.buildStateBadge(false, '', '\u0416\u0434\u0451\u043C \u0442\u0435\u0441\u0442\u043E\u0432\u044B\u0439 webhook');

		if (!health.tunnel_enabled)
			tunnelBadge = this.buildStateBadge(false, '', '\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D');
		else if (!health.tunnel_configured)
			tunnelBadge = this.buildStateBadge(false, '', '\u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D');
		else if (tunnelRuntimeState === 'active')
			tunnelBadge = this.buildStateBadge(true, '\u0410\u043A\u0442\u0438\u0432\u0435\u043D', '');
		else if (tunnelRuntimeState === 'connecting')
			tunnelBadge = this.buildStateBadge(true, '\u041F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F', '');
		else if (tunnelRuntimeState === 'stale')
			tunnelBadge = this.buildStateBadge(false, '', '\u041D\u0435\u0442 heartbeat');
		else if (tunnelRuntimeState === 'retrying')
			tunnelBadge = this.buildStateBadge(false, '', '\u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u0442\u0441\u044F');
		else if (tunnelRuntimeState === 'stopped')
			tunnelBadge = this.buildStateBadge(false, '', '\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D', 'tg-paidmedia-badge-pulse-danger');
		else if (tunnelMeta.running)
			tunnelBadge = this.buildStateBadge(true, '\u041F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F', '');
		else
			tunnelBadge = this.buildStateBadge(false, '', '\u041D\u0435 \u043F\u043E\u0434\u043D\u044F\u043B\u0441\u044F');

		tunnelTargetText = String(health.tunnel_target || '');
		if (!tunnelTargetText && health.tunnel_enabled && health.tunnel_missing_fields && health.tunnel_missing_fields.length)
			tunnelTargetText = '\u0417\u0430\u043F\u043E\u043B\u043D\u0438: ' + health.tunnel_missing_fields.join(', ');
		if (!tunnelTargetText)
			tunnelTargetText = '-';

		warningsText = health.warnings && health.warnings.length ? health.warnings.join(' | ') : '\u041D\u0435\u0442';
		if (tunnelRuntimeMessage && tunnelRuntimeState && tunnelRuntimeState !== 'active' && warningsText === '\u041D\u0435\u0442')
			warningsText = tunnelRuntimeMessage;

		cards = [
			{
				label: '\u0421\u0435\u0440\u0432\u0438\u0441',
				value: this.buildStateBadge(
					!!serviceMeta.running,
					'\u0417\u0430\u043F\u0443\u0449\u0435\u043D',
					'\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D',
					serviceMeta.running ? '' : 'tg-paidmedia-badge-pulse-danger'
				)
			},
			{
				label: '\u0421\u0435\u043A\u0440\u0435\u0442 \u042eMoney',
				value: secretBadge
			},
			{
				label: 'Webhook \u042eMoney',
				value: this.buildStateBadge(!!health.webhook_listening, '\u0421\u043B\u0443\u0448\u0430\u0435\u0442', '\u041D\u0435 \u0441\u043B\u0443\u0448\u0430\u0435\u0442')
			},
			{
				label: 'HTTPS callback',
				value: this.buildStateBadge(!!health.callback_https, '\u041E\u041A', '\u041F\u0440\u043E\u0432\u0435\u0440\u044C URL')
			},
			{
				label: 'Reverse tunnel',
				value: tunnelBadge
			},
			{
				label: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 sign',
				value: this.formatYooMoneySecretCheck(secretCheck),
				subtle: true
			},
			{
				label: 'Tunnel target',
				value: tunnelTargetText,
				subtle: true
			},
			{
				label: 'Webhook bind',
				value: String(health.webhook_bind || '-'),
				subtle: true
			},
			{
				label: '\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u044F',
				value: warningsText,
				subtle: true
			}
		];

		return E('div', { 'class': 'tg-paidmedia-payments-health' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u041C\u0438\u043D\u0438-\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u042eMoney' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u0421\u044E\u0434\u0430 \u0441\u0440\u0430\u0437\u0443 \u043F\u0430\u0434\u0430\u0435\u0442 \u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u0435\u043A\u0440\u0435\u0442\u0430, webhook, reverse tunnel \u0438 \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u0431\u0435\u0437 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430 \u0432\u0441\u0435\u0433\u043E logread.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-payments-health-toolbar' }, [
					E('button', {
						'class': 'btn cbi-button tg-paidmedia-toolbar-btn ' + (health.tunnel_enabled ? 'cbi-button-negative' : 'cbi-button-action'),
						'click': ui.createHandlerFn(this, function() {
							return this.handleYooMoneyTunnelToggle(!health.tunnel_enabled, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget);
						})
					}, [ health.tunnel_enabled ? '\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C Reverse tunnel' : '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C Reverse tunnel' ])
				])
			]),
			E('div', { 'class': 'tg-paidmedia-grid' }, cards.map(function(card) {
				return E('div', { 'class': 'tg-paidmedia-card' }, [
					E('p', { 'class': 'tg-paidmedia-card-label' }, [ card.label ]),
					E('p', {
						'class': 'tg-paidmedia-card-value' + (card.subtle ? ' tg-paidmedia-card-subtle' : '')
					}, [ card.value ])
				]);
			}))
		]);
	},

	buildHeaderStatus: function(data) {
		var serviceStatus = data[1] || {};
		var serviceMeta = this.extractServiceRunning(serviceStatus);

		return E('span', {
			'class': 'tg-paidmedia-top-badge ' + (serviceMeta.running ? 'is-running' : 'is-stopped')
		}, [ serviceMeta.running ? '\u0420\u0430\u0431\u043e\u0442\u0430\u0435\u0442' : '\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d' ]);
	},

	buildStatusSection: function(data, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
		var initList = data[0] || {};
		var serviceStatus = data[1] || {};
		var botStatus = parseJSON((data[2] || {}).stdout, {});
		var filteredLogText = filterBotLogText((data[3] || {}).stdout || '', 200);
		var serviceMeta = this.extractServiceRunning(serviceStatus);
		var initMeta = initList['tg-paidmedia'] || {};
		var lastPurchase = botStatus.last_purchase || {};
		var lastPlategaEvent = botStatus.last_platega_event || {};
		var lastYoomoneyEvent = botStatus.last_yoomoney_event || {};
		var stats = botStatus.stats || {};
		var lastException = String(botStatus.last_exception || '').trim();
		var restartInsight = buildRestartInsight(filteredLogText, botStatus);
		var startStats = buildRecentStartStats(filteredLogText);
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
			{ label: '\u0411\u0430\u043b\u0430\u043d\u0441 RUB', value: formatRubDisplay(stats.total_rub_revenue || 0) },
			{ label: '\u041f\u043e\u043a\u0443\u043f\u043e\u043a Stars', value: String(stats.stars_purchases || 0) },
			{ label: '\u0417\u0430\u043a\u0430\u0437\u043e\u0432 \u0421\u0411\u041f', value: String(stats.sbp_orders_created || 0) },
			{ label: '\u0412\u044b\u0434\u0430\u043d\u043e \u0421\u0411\u041f', value: String(stats.sbp_orders_paid || 0) },
			{ label: '\u0417\u0430\u043a\u0430\u0437\u043e\u0432 \u042eMoney', value: String(stats.yoomoney_orders_created || 0) },
			{ label: '\u0412\u044b\u0434\u0430\u043d\u043e \u042eMoney', value: String(stats.yoomoney_orders_paid || 0) },
			{ label: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0441\u0442\u0430\u0440\u0442', value: restartInsight.lastStartAt || '-', subtle: true },
			{ label: '\u0420\u0435\u0441\u0442\u0430\u0440\u0442\u043E\u0432 \u0437\u0430 \u0447\u0430\u0441', value: String(startStats.countLastHour || 0) },
			{ label: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u0442\u0430\u0440\u0442\u044B', value: startStats.recentStarts.length ? startStats.recentStarts.join(' | ') : '-', subtle: true },
			{ label: '\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0440\u0435\u0441\u0442\u0430\u0440\u0442\u0430', value: restartInsight.summary || '-', subtle: true },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u043e\u043f\u0440\u043e\u0441', value: String(botStatus.last_poll_at || '-'), subtle: true },
			{ label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043e\u0448\u0438\u0431\u043a\u0430', value: String(botStatus.last_error || '-'), subtle: true },
			{
				label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0430',
				value: lastPurchase.item_id ? String('#' + lastPurchase.item_id + ' ' + (lastPurchase.item_title || '')) : '-',
				subtle: true
			},
			{
				label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u0441\u043e\u0431\u044b\u0442\u0438\u0435 \u0421\u0411\u041f',
				value: lastPlategaEvent.status ? String(lastPlategaEvent.status + ' / ' + (lastPlategaEvent.transaction_id || '-')) : '-',
				subtle: true
			},
			{
				label: '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u0441\u043e\u0431\u044b\u0442\u0438\u0435 \u042eMoney',
				value: lastYoomoneyEvent.status ? String(lastYoomoneyEvent.status + ' / ' + (lastYoomoneyEvent.operation_id || '-')) : '-',
				subtle: true
			}
		];
		var actionRow = E('div', { 'class': 'tg-paidmedia-actions' }, [
			E('button', {
				'class': 'btn cbi-button tg-paidmedia-action-btn tg-paidmedia-btn-start',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('start', statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget);
				})
			}, [ '\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c' ]),
			E('button', {
				'class': 'btn cbi-button tg-paidmedia-action-btn tg-paidmedia-btn-restart',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('restart', statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget);
				})
			}, [ '\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c' ]),
			E('button', {
				'class': 'btn cbi-button tg-paidmedia-action-btn tg-paidmedia-btn-stop',
				'click': ui.createHandlerFn(this, function() {
					return this.handleServiceAction('stop', statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget);
				})
			}, [ '\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c' ])
		]);
		var errorBlock = lastException ? E('div', { 'class': 'tg-paidmedia-error' }, [
			E('strong', {}, [ '\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0444\u0430\u0442\u0430\u043b\u044c\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0441\u0442\u0430\u0440\u0442\u0430' ]),
			E('pre', {}, [ trimLog(lastException, 24) ])
		]) : null;

		return E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-status-panel' }, [
			E('div', { 'class': 'tg-paidmedia-section-head tg-paidmedia-section-headlined' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title tg-paidmedia-section-title-strong' }, [ '\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u0430' ]),
					E('p', { 'class': 'tg-paidmedia-note tg-paidmedia-status-note' }, [ '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u043e\u0431\u0437\u043e\u0440 \u0440\u0430\u0431\u043e\u0442\u044b \u0431\u043e\u0442\u0430, \u0440\u0443\u0431\u043b\u0451\u0432\u044b\u0445 \u043f\u0440\u043e\u0434\u0430\u0436, Stars \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0445 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u0431\u0435\u0437 \u043f\u0435\u0440\u0435\u0445\u043e\u0434\u0430 \u0432 \u043b\u043e\u0433\u0438.' ])
				])
			]),
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

	updatePanels: function(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data) {
		var filteredLogText;
		var shouldStickToBottom;

		dom.content(statusTarget, this.buildStatusSection(data, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget));
		if (headerStatusTarget)
			dom.content(headerStatusTarget, [ this.buildHeaderStatus(data) ]);
		if (paymentsHealthTarget)
			dom.content(paymentsHealthTarget, [ this.buildYooMoneyHealthSection(data, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) ]);

		filteredLogText = filterBotLogText((data[3] || {}).stdout || '', 200);
		shouldStickToBottom = this.shouldAutoScrollLog(logTarget);
		logTarget._rawText = filteredLogText || '\u041B\u043E\u0433\u0438 tg-paidmedia \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u044B.';
		logTarget.innerHTML = renderLogMarkup(logTarget._rawText);
		if (shouldStickToBottom)
			this.scrollLogToBottom(logTarget);
	},

	scrollLogToBottom: function(logTarget) {
		if (!logTarget)
			return;

		logTarget.scrollTop = logTarget.scrollHeight;
	},

	shouldAutoScrollLog: function(logTarget) {
		var threshold;

		if (!logTarget || !logTarget._initialized) {
			if (logTarget)
				logTarget._initialized = true;
			return true;
		}

		threshold = 48;
		return (logTarget.scrollHeight - logTarget.scrollTop - logTarget.clientHeight) <= threshold;
	},

	toggleLogPanel: function(logSection, toggleButton, logTarget) {
		var collapsed = logSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\uD83D\uDCC2 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B' : '\uD83D\uDCD5 \u0421\u043A\u0440\u044B\u0442\u044C \u0436\u0443\u0440\u043D\u0430\u043B' ]);

		if (!collapsed)
			window.requestAnimationFrame(this.scrollLogToBottom.bind(this, logTarget));
	},

	toggleInfoPanel: function(infoSection, toggleButton) {
		var collapsed = infoSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\uD83D\uDCD6 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' : '\uD83D\uDCD6 \u0421\u043A\u0440\u044B\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' ]);
	},

	toggleSettingsPanel: function(settingsSection, toggleButton) {
		var collapsed = settingsSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\u2699\uFE0F \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438' : '\u2699\uFE0F \u0421\u043A\u0440\u044B\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438' ]);
	},

	togglePaymentsPanel: function(paymentsSection, toggleButton) {
		var collapsed = paymentsSection.classList.toggle('is-collapsed');
		dom.content(toggleButton, [ collapsed ? '\uD83D\uDCB3 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043c\u044B' : '\uD83D\uDCB3 \u0421\u043A\u0440\u044B\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043c\u044B' ]);
	},

	applyThemeClass: function(root) {
		var palette, keys, i;

		if (!root || !root.classList)
			return root;

		root.classList.toggle('is-dark-theme', detectDarkTheme());

		palette = resolveThemePalette();
		keys = palette ? Object.keys(palette) : [];

		for (i = 0; i < keys.length; i++)
			root.style.setProperty(keys[i], palette[keys[i]]);

		return root;
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

	clearLogs: function(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
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
			this.updatePanels(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data);
			ui.addNotification(null, E('p', {}, [ '\u0416\u0443\u0440\u043d\u0430\u043b \u043e\u0447\u0438\u0449\u0435\u043d. \u0422\u0435\u043f\u0435\u0440\u044c \u0432 \u0431\u043B\u043E\u043A\u0435 \u0432\u0438\u0434\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0432\u0435\u0436\u0438\u0439 \u0445\u0432\u043E\u0441\u0442 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043A\u0430 logd.' ]), 'info');
		}.bind(this)).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	pollPanels: function(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
		return this.load().then(function(data) {
			this.updatePanels(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data);
		}.bind(this));
	},

	handleServiceAction: function(action, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
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

			this.updatePanels(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data);

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

	handleYooMoneyTunnelToggle: function(enable, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget) {
		var nextValue = enable ? '1' : '0';
		var progressText = enable
			? '\u0412\u043A\u043B\u044E\u0447\u0430\u044E reverse tunnel \u042EMoney \u0438 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0441\u0435\u0440\u0432\u0438\u0441...'
			: '\u041E\u0442\u043A\u043B\u044E\u0447\u0430\u044E reverse tunnel \u042EMoney \u0438 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0441\u0435\u0440\u0432\u0438\u0441...';

		ui.showModal('\u0412\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F', [
			E('p', {}, [ progressText ])
		]);

		return fs.exec('/sbin/uci', [ 'set', 'tg-paidmedia.main.yoomoney_tunnel_enabled=' + nextValue ]).then(function(result) {
			if (result.code !== 0)
				throw new Error(result.stderr || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C reverse tunnel \u0432 UCI.');

			return fs.exec('/sbin/uci', [ 'commit', 'tg-paidmedia' ]);
		}).then(function(result) {
			if (result.code !== 0)
				throw new Error(result.stderr || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043A\u043E\u043D\u0444\u0438\u0433 tg-paidmedia.');

			return callInitAction('tg-paidmedia', 'restart');
		}).then(function() {
			ui.hideModal();
			return delay(1200);
		}.bind(this)).then(function() {
			return this.load();
		}.bind(this)).then(function(data) {
			var serviceStatus = data[1] || {};
			var botStatus = parseJSON((data[2] || {}).stdout, {});
			var health = botStatus.yoomoney_health || {};
			var tunnelMeta = this.extractServiceInstance(serviceStatus, 'yoomoney-tunnel');

			this.updatePanels(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data);

			if (enable && !health.tunnel_enabled)
				throw new Error('\u0424\u043B\u0430\u0433 reverse tunnel \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u043B\u0441\u044F. \u041F\u0440\u043E\u0432\u0435\u0440\u044C \u043A\u043E\u043D\u0444\u0438\u0433 \u0438 \u043E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.');

			if (!enable && (health.tunnel_enabled || tunnelMeta.running))
				throw new Error('\u0422\u0443\u043D\u043D\u0435\u043B\u044C \u043F\u043E\u043A\u0430 \u0435\u0449\u0451 \u043D\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0441\u044F. \u041E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434.');

			ui.addNotification(null, E('p', {}, [
				enable
					? 'Reverse tunnel \u042EMoney \u0432\u043A\u043B\u044E\u0447\u0451\u043D. \u0421\u0435\u0440\u0432\u0438\u0441 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0449\u0435\u043D.'
					: 'Reverse tunnel \u042EMoney \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D. \u0421\u0435\u0440\u0432\u0438\u0441 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0449\u0435\u043D.'
			]), 'info');
		}.bind(this)).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
		});
	},

	render: function(data) {
		var headerStatusTarget = E('div', { 'class': 'tg-paidmedia-header-status' }, [ '\u041f\u0440\u043E\u0432\u0435\u0440\u043A\u0430...' ]);
		var statusTarget = E('div', { 'class': 'tg-paidmedia-status-host' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0441\u0442\u0430\u0442\u0443\u0441\u0430...' ]);
		var logTarget = E('div', { 'class': 'tg-paidmedia-log' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043b\u043e\u0433\u043e\u0432...' ]);
		var infoToggle = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-info-toggle tg-paidmedia-btn-open',
			'click': ui.createHandlerFn(this, function() {
				this.toggleInfoPanel(infoSection, infoToggle);
			})
		}, [ '\uD83D\uDCD6 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E' ]);
		var infoSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-info-panel tg-paidmedia-callout-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title tg-paidmedia-section-title-strong' }, [ '\u0412\u044B\u0432\u043E\u0434 \u0437\u0432\u0435\u0437\u0434' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041A\u0440\u0430\u0442\u043A\u0430\u044F \u0438\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F \u043F\u043E Telegram Stars, Fragment \u0438 \u043F\u0440\u0438\u0447\u0438\u043D\u0430\u043C, \u043F\u043E\u0447\u0435\u043C\u0443 reward \u043C\u043E\u0436\u0435\u0442 \u043D\u0435 \u043F\u043E\u044F\u0432\u0438\u0442\u044C\u0441\u044F \u0441\u0440\u0430\u0437\u0443.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-info-toolbar' }, [
					infoToggle
				])
			]),
			E('div', { 'class': 'tg-paidmedia-info-body' }, [
				this.buildWithdrawalInfoSection()
			])
		]);
		var settingsToggle = E('button', {
			'class': 'btn cbi-button tg-paidmedia-toolbar-btn tg-paidmedia-settings-toggle',
			'click': ui.createHandlerFn(this, function() {
				this.toggleSettingsPanel(settingsSection, settingsToggle);
			})
		}, [ '\u2699\uFE0F \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438' ]);
		var settingsBody = E('div', { 'class': 'tg-paidmedia-settings-body' });
		var settingsSection = E('div', { 'class': 'tg-paidmedia-section tg-paidmedia-form-wrap tg-paidmedia-settings-panel is-collapsed' }, [
			E('div', { 'class': 'tg-paidmedia-section-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'tg-paidmedia-section-title' }, [ '\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0431\u043E\u0442\u0430' ]),
					E('p', { 'class': 'tg-paidmedia-section-subtitle' }, [ '\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u043E\u043A\u0435\u043D, \u0430\u0434\u043C\u0438\u043D\u043E\u0432, \u043F\u0443\u0442\u0438, \u0434\u0440\u0443\u0433\u0438\u0435 \u0431\u0430\u0437\u043E\u0432\u044B\u0435 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0431\u043E\u0442\u0430 \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0448\u0430\u043f\u043A\u0443 \u0433\u043B\u0430\u0432\u043D\u043E\u0433\u043E \u044D\u043A\u0440\u0430\u043D\u0430.' ])
				]),
				E('div', { 'class': 'tg-paidmedia-settings-toolbar' }, [
					settingsToggle
				])
			]),
			settingsBody
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
				this.toggleLogPanel(logSection, logToggle, logTarget);
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
				return this.clearLogs(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget);
			})
		}, [ '\uD83E\uDDF9 \u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043B\u043E\u0433\u0438' ]);
		var paymentsHealthTarget = E('div', { 'class': 'tg-paidmedia-payments-health-host' }, [ '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u042eMoney...' ]);
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
				])
			]),
			paymentsBody,
			E('div', { 'class': 'tg-paidmedia-payments-footer' }, [
				paymentsToggle
			])
		]);

		return Promise.all([
			this.renderBotForm(),
			this.renderPaymentsForm()
		]).then(function(renderedForms) {
			var botFormNode = renderedForms[0];
			var paymentsFormNode = renderedForms[1];

			this.updatePanels(statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget, data);
			poll.add(L.bind(this.pollPanels, this, statusTarget, logTarget, headerStatusTarget, paymentsHealthTarget));
			dom.content(settingsBody, [ botFormNode ]);
			dom.content(paymentsBody, [ paymentsFormNode, paymentsHealthTarget ]);
			this.decoratePaymentTooltips(paymentsBody);

			var pageNode = E('div', { 'class': 'tg-paidmedia-page' }, [
				this.renderStyles(),
				E('div', { 'class': 'tg-paidmedia-shell' }, [
					E('div', { 'class': 'tg-paidmedia-page-header' }, [
						E('div', { 'class': 'tg-paidmedia-headline tg-paidmedia-logo' }, [
							E('div', { 'class': 'tg-paidmedia-logo-mark' }),
							E('div', { 'class': 'tg-paidmedia-logo-wordmark' }, [
								E('h1', { 'class': 'tg-paidmedia-page-title tg-paidmedia-logo-title' }, [ 'TG Paid Media' ]),
								E('p', { 'class': 'tg-paidmedia-page-subtitle tg-paidmedia-logo-subtitle' }, [ 'LuCI-\u043F\u0430\u043D\u0435\u043B\u044C Telegram Stars, СБП \u0438 ЮMoney' ])
							])
						]),
						E('div', { 'class': 'tg-paidmedia-page-header-side' }, [
							headerStatusTarget
						])
					]),
					infoSection,
					statusTarget,
					logSection,
					settingsSection,
					paymentsSection
				])
			]);

			return this.applyThemeClass(pageNode);
		}.bind(this));
	}
});
