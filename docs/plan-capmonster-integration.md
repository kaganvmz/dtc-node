# План: Интеграция CapMonster Imperva вместо RuCaptcha hCaptcha

## Context

RuCaptcha (и все остальные крупные сервисы) убрали поддержку hCaptcha. Текущий `CaptchaSolver` не работает — возвращает `ERROR_METHOD_CALL`. Нужно переключиться на CapMonster Cloud Imperva, который обходит всю защиту Incapsula целиком, возвращая cookies вместо токена капчи.

**Принципиальное отличие**: старый подход решал hCaptcha → инжектил токен через `onCaptchaFinished()`. Новый подход обходит Incapsula целиком → получает cookies → инжектит cookies в браузер → перезагружает страницу.

## Файлы для изменения

| Файл | Действие |
|------|----------|
| `captcha/solver.js` | Полная перезапись — `ImpervaBypassSolver` на SDK `@zennolab_com/capmonstercloud-client-js` |
| `app.js` | Изменить инициализацию + заменить `checkForCaptcha`/`solveCaptcha` |
| `.env` | Добавить `CAPMONSTER_API_KEY` |
| `package.json` | Добавить зависимость `@zennolab_com/capmonstercloud-client-js` |

Без изменений: `captcha/exceptions.js`, `multilogin/multilogin.js`, `proxy/ProxyManager.js`

## Шаг 1: Установить SDK + добавить ключ

```bash
npm install @zennolab_com/capmonstercloud-client-js
```

В `.env` добавить:
```
CAPMONSTER_API_KEY = 'ключ_от_capmonster'
```

## Шаг 2: `captcha/solver.js` — полная перезапись на SDK

Заменить `CaptchaSolver` на `ImpervaBypassSolver`, используя официальный SDK `@zennolab_com/capmonstercloud-client-js`:

```js
import { CapMonsterCloudClientFactory, ClientOptions, ImpervaRequest }
  from '@zennolab_com/capmonstercloud-client-js';
```

- **SDK методы**: `CapMonsterCloudClientFactory.Create()`, `cmcClient.Solve(impervaRequest)`, `cmcClient.getBalance()`
- **Класс запроса**: `ImpervaRequest` — принимает websiteURL, metadata, proxy
- **Вход**: websiteURL, userAgent, metadata (incapsulaScriptUrl, incapsulaCookies, reese84UrlEndpoint?), proxy (proxyType, proxyAddress, proxyPort, proxyLogin, proxyPassword)
- **Выход**: `result.solution.domains[domain].cookies` — объект с cookies для инъекции
- **Прокси обязателен** — используем тот же SOCKS5 что и браузер
- SDK сам делает createTask + polling getTaskResult — не нужен ручной цикл ожидания
- Переиспользовать существующие exception классы из `captcha/exceptions.js` для обёртки ошибок SDK

## Шаг 3: `app.js` — изменить инициализацию

- Строка 4: импорт `ImpervaBypassSolver` вместо `CaptchaSolver`
- Строка ~54: `new ImpervaBypassSolver(process.env.CAPMONSTER_API_KEY)` — внутри конструктора создаётся SDK клиент через `CapMonsterCloudClientFactory.Create()`

## Шаг 4: `app.js` — заменить `solveCaptcha()` (строки 339-435)

Новый метод `bypassIncapsula(page)`:

### A. Извлечь `incapsulaScriptUrl`
Из DOM: найти `<script src="..._Incapsula_Resource?SWJIYLWA=...">` через `querySelectorAll('script[src]')` + `performance.getEntriesByType('resource')` как fallback.

### B. Извлечь `incapsulaCookies`
Через Playwright: `page.context().cookies()` → фильтр `incap_ses_*` и `visid_incap_*` → склеить в строку `"name=value; name2=value2"`.

### C. Извлечь `reese84UrlEndpoint` (опционально)
Через `performance.getEntriesByType('resource')` — найти URL содержащий характерный путь. Если не найден — не передавать (параметр optional).

### D. Получить прокси
`this.multiloginAPI.getCurrentProxy()` → возвращает `{ host, port, username, password, type: "socks5" }` — тот же прокси что использует браузер (кешируется в `currentProxyConfig`).

### E. Вызвать солвер через SDK
```js
const impervaRequest = new ImpervaRequest({
    websiteURL,
    metadata: { incapsulaScriptUrl, incapsulaCookies, reese84UrlEndpoint },
    ...proxyParams  // proxyType, proxyAddress, proxyPort, proxyLogin, proxyPassword
});
const result = await this.captchaSolver.solve(impervaRequest);
// result.solution.domains["https://driverpracticaltest.dvsa.gov.uk"].cookies
```

### F. Инжектить cookies + reload
```js
// Парсим cookies из solution и конвертируем в формат Playwright
await page.context().addCookies(playwrightCookies);
await page.reload({ waitUntil: 'domcontentloaded' });
```

### G. Проверить что bypass прошёл
Повторно проверить `#main-iframe` — если ещё есть, кинуть ошибку.

## Шаг 5: `app.js` — обновить все 4 точки вызова

`checkForCaptcha` → `checkForIncapsula` (тот же селектор `#main-iframe`, просто переименование)
`solveCaptcha` → `bypassIncapsula`

1. **Строка 118** — после начальной навигации в `processTask()`
2. **Строка 568** — после interstitial страницы в `performLogin()`
3. **Строка 593** — после логина на `/manage` в `performLogin()`
4. **Строка 1032** — на странице Test centre

## Потенциальные проблемы

1. **Cross-origin iframe** — `page.evaluate` может не получить доступ к содержимому iframe. Fallback: искать скрипт в основной странице или через `page.frames()`.
2. **Формат cookies из CapMonster** — ответ `solution.domains[url].cookies` может быть объектом `{ cookieName: "value; params" }`, нужно правильно распарсить для Playwright `addCookies()`.
3. **SOCKS5 прокси** — CapMonster заявляет поддержку socks5, но если не заработает, может потребоваться конвертация в http.

## Проверка

1. Запустить `node app.js`
2. Убедиться что бот:
   - Получает задачу
   - Запускает браузер
   - Детектит Incapsula challenge (`#main-iframe`)
   - Извлекает `incapsulaScriptUrl` и `incapsulaCookies`
   - Отправляет задачу в CapMonster
   - Получает cookies в ответе
   - Инжектит cookies и перезагружает страницу
   - Incapsula пропускает → видна форма логина
