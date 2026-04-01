# Задачи: Интеграция CapMonster Imperva

Каждая задача — отдельный этап. Следующая задача начинается только после завершения предыдущей.

---

## Задача 1: Установка SDK и настройка окружения

**Описание**: Установить npm пакет CapMonster SDK и добавить API ключ в конфигурацию.

**Действия**:
- `npm install @zennolab_com/capmonstercloud-client-js`
- Добавить `CAPMONSTER_API_KEY` в `.env`

**Definition of Done**:
- [ ] Пакет `@zennolab_com/capmonstercloud-client-js` установлен и есть в `package.json`
- [ ] Переменная `CAPMONSTER_API_KEY` добавлена в `.env` с валидным ключом
- [ ] `npm install` выполняется без ошибок

---

## Задача 2: Перезапись `captcha/solver.js` — класс `ImpervaBypassSolver`

**Описание**: Заменить старый `CaptchaSolver` (RuCaptcha hCaptcha) на новый `ImpervaBypassSolver` использующий SDK CapMonster.

**Действия**:
- Импортировать `CapMonsterCloudClientFactory`, `ClientOptions`, `ImpervaRequest` из SDK
- Создать класс `ImpervaBypassSolver` с конструктором принимающим API ключ
- В конструкторе создать SDK клиент через `CapMonsterCloudClientFactory.Create()`
- Реализовать метод `solve(websiteURL, userAgent, metadata, proxy)`:
  - Создать `ImpervaRequest` с параметрами
  - Вызвать `cmcClient.Solve(impervaRequest)`
  - Вернуть `result.solution`
- Обернуть ошибки SDK в существующие exception классы из `captcha/exceptions.js`
- Добавить метод `getBalance()` для проверки баланса

**Definition of Done**:
- [ ] Файл `captcha/solver.js` содержит класс `ImpervaBypassSolver`
- [ ] Класс экспортируется и может быть импортирован в `app.js`
- [ ] Метод `solve()` принимает websiteURL, userAgent, metadata, proxy и возвращает solution
- [ ] Ошибки SDK обёрнуты в `CaptchaSolverException` / `CaptchaSolverTimeoutException`
- [ ] Старый `CaptchaSolver` код удалён

---

## Задача 3: Обновление инициализации в `app.js`

**Описание**: Заменить импорт и инициализацию старого CaptchaSolver на новый ImpervaBypassSolver.

**Действия**:
- Строка 4: заменить импорт `CaptchaSolver` на `ImpervaBypassSolver`
- Строка ~54: заменить `new CaptchaSolver(process.env.RUCAPTCHA_API_KEY)` на `new ImpervaBypassSolver(process.env.CAPMONSTER_API_KEY)`
- Убедиться что `this.captchaSolver` доступен во всех методах

**Definition of Done**:
- [ ] Импорт в `app.js` указывает на `ImpervaBypassSolver`
- [ ] Конструктор использует `CAPMONSTER_API_KEY` из `.env`
- [ ] Бот стартует без ошибок импорта: `node app.js` запускается до главного цикла

---

## Задача 4: Новый метод `bypassIncapsula(page)` в `app.js`

**Описание**: Заменить метод `solveCaptcha(page)` (строки 339-435) на `bypassIncapsula(page)` который извлекает параметры Incapsula и вызывает CapMonster.

**Действия**:
- **4A. Извлечь `incapsulaScriptUrl`**: через `page.evaluate()` найти `<script src="..._Incapsula_Resource?SWJIYLWA=...">` в DOM, fallback через `performance.getEntriesByType('resource')`
- **4B. Извлечь `incapsulaCookies`**: через `page.context().cookies()` отфильтровать `incap_ses_*` и `visid_incap_*`, склеить в строку
- **4C. Извлечь `reese84UrlEndpoint`** (опционально): через `performance.getEntriesByType('resource')` найти характерный URL
- **4D. Получить прокси**: `this.multiloginAPI.getCurrentProxy()` → маппинг в формат CapMonster (proxyType, proxyAddress, proxyPort, proxyLogin, proxyPassword)
- **4E. Получить userAgent**: `await page.evaluate(() => navigator.userAgent)`
- **4F. Вызвать солвер**: `this.captchaSolver.solve(websiteURL, userAgent, metadata, proxy)`
- **4G. Инжектить cookies**: распарсить `solution.domains[domain].cookies` → `page.context().addCookies()`
- **4H. Reload**: `page.reload({ waitUntil: 'domcontentloaded' })`
- **4I. Проверить**: повторно `checkForIncapsula(page)` → если ещё есть, кинуть ошибку

**Definition of Done**:
- [ ] Метод `bypassIncapsula(page)` реализован и заменяет `solveCaptcha(page)`
- [ ] Все 3 параметра Incapsula корректно извлекаются из страницы (логируются в консоль)
- [ ] Прокси маппится из формата ProxyManager в формат CapMonster
- [ ] Cookies из ответа CapMonster инжектятся в браузер
- [ ] Страница перезагружается после инъекции cookies
- [ ] После reload проверяется отсутствие `#main-iframe`

---

## Задача 5: Переименовать `checkForCaptcha` → `checkForIncapsula`

**Описание**: Переименовать метод детекции для ясности. Логика та же (`#main-iframe`).

**Действия**:
- Переименовать метод `checkForCaptcha(page)` → `checkForIncapsula(page)` (строка 328)
- Обновить логи: "Iframe с капчей" → "Incapsula challenge"

**Definition of Done**:
- [ ] Метод переименован
- [ ] Логи обновлены
- [ ] Нет ссылок на старое имя `checkForCaptcha` в коде

---

## Задача 6: Обновить все 4 точки вызова в `app.js`

**Описание**: Заменить `checkForCaptcha`/`solveCaptcha` на `checkForIncapsula`/`bypassIncapsula` во всех местах вызова.

**Действия**:
- **Строка 118** (`processTask`) — после начальной навигации
- **Строка 568** (`performLogin`) — после interstitial страницы
- **Строка 593** (`performLogin`) — после логина на `/manage`
- **Строка 1032** (`performTestCentreSearch`) — на странице Test centre

**Definition of Done**:
- [ ] Все 4 точки вызова обновлены на `checkForIncapsula` / `bypassIncapsula`
- [ ] Grep по `checkForCaptcha` и `solveCaptcha` в `app.js` не даёт результатов
- [ ] Логика try/catch вокруг вызовов сохранена

---

## Задача 7: Интеграционное тестирование

**Описание**: Запустить бота и проверить полный flow с CapMonster Imperva.

**Действия**:
- Запустить `node app.js`
- Дождаться получения задачи
- Наблюдать за логами на каждом этапе

**Definition of Done**:
- [ ] Бот запускается без ошибок
- [ ] Задача получена из API
- [ ] Браузер запущен через Multilogin
- [ ] Incapsula challenge детектится (`#main-iframe`)
- [ ] `incapsulaScriptUrl` извлечён и залогирован
- [ ] `incapsulaCookies` извлечены и залогированы
- [ ] Задача отправлена в CapMonster (taskId получен)
- [ ] Cookies получены от CapMonster
- [ ] Cookies инжектированы в браузер
- [ ] Страница перезагружена
- [ ] `#main-iframe` больше не появляется → форма логина доступна
- [ ] Логин выполнен успешно

---

## Задача 8: Обработка edge cases

**Описание**: Добавить обработку нестандартных ситуаций.

**Действия**:
- Cross-origin iframe: если `page.evaluate` не может получить доступ к iframe, искать скрипт через `page.frames()` или `performance` API
- Если `incapsulaScriptUrl` не найден: логировать HTML страницы и кинуть понятную ошибку
- Если cookies из CapMonster пустые: retry или кинуть ошибку
- Если после reload Incapsula всё ещё блокирует: retry с новым прокси (ротация)
- Error 16 (Access denied — wrong geolocation): логировать и предложить сменить прокси

**Definition of Done**:
- [ ] Все edge cases имеют обработку с понятными логами
- [ ] Бот не падает на неожиданных ответах от CapMonster
- [ ] Retry логика работает при неудачном bypass
