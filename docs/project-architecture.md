# Архитектура проекта dtc-node

## Связка модулей

```
app.js (SimpleLoginBot)
  ├── multilogin/multilogin.js (MultiloginAPI)
  │     └── proxy/ProxyManager.js (прокси ротация)
  ├── captcha/solver.js (CaptchaSolver → будет ImpervaBypassSolver)
  │     └── captcha/exceptions.js (классы исключений)
  └── api/TasksAPI.js (очередь задач)
```

## Поток выполнения

```
[TasksAPI] getTask() → задача (license, ref_num, test_centers)
     ↓
[MultiloginAPI] searchProfile() / createProfile() → profileId
     ↓
[MultiloginAPI] startProfile(profileId) → port
     ↓
[Playwright] connectOverCDP(ws://127.0.0.1:{port}) → browser
     ↓
[Browser] goto(login page) → page
     ↓
[Captcha] checkForCaptcha (#main-iframe) → solveCaptcha() → token injection
     ↓
[Login] humanTyping(license, ref_num) → click login → wait response
     ↓
[Captcha] checkForCaptcha (может появиться после login/interstitial/manage)
     ↓
[Navigation] /manage → change test centre → search → select
     ↓
[TasksAPI] successTask() / cancelTask()
     ↓
[Cleanup] close browser → stop profile
```

## Модули

### app.js (~2300 строк)
Класс `SimpleLoginBot` — главный оркестратор:
- `initialize()` — инициализация всех модулей
- `start()` — главный цикл (while isRunning → getTask → processTask)
- `processTask(task)` — полный workflow одной задачи
- `launchBrowser(profileId)` — запуск через Multilogin + CDP
- `navigateToPage(browser)` — навигация на login page
- `checkForCaptcha(page)` / `solveCaptcha(page)` — детекция и решение капчи
- `performLogin(page, loginData)` — human-like ввод + клик
- `performTestCentreSearch(page, task)` — поиск тест-центра
- Human-like поведение: humanTyping (с ошибками), humanClick (smooth mouse), random delays

### multilogin/multilogin.js (MultiloginAPI)
- API: `https://api.multilogin.com` (auth) + `https://launcher.mlx.yt:45001/api` (profiles)
- `apiInit()` — авторизация (email + MD5 password → token)
- `createProfile()` — создание антидетект профиля (mimic browser, fingerprint masking)
- `startProfile()` / `stopProfile()` — запуск/остановка браузера
- `getCurrentProxy()` — текущий прокси (кешируется в `currentProxyConfig`)
- Интегрирован с `ProxyManager`

### proxy/ProxyManager.js
- Источник: `proxy.json` (config-based с сессионными строками)
- Тип: SOCKS5 через `gate.multilogin.com:1080`
- Username содержит: country-gb, region-england, session ID
- `getProxy()` → генерирует новую сессию
- `formatForMultilogin()` → форматирует для Multilogin API
- `forceRotateProxy()` → принудительная ротация

### captcha/solver.js (текущий — сломан)
- Сервис: RuCaptcha → **hCaptcha больше не поддерживается**
- API: `https://api.rucaptcha.com/createTask` + `/getTaskResult`
- Тип: `HCaptchaTaskProxyless` → `ERROR_METHOD_CALL`
- **Замена**: CapMonster Imperva (см. capmonster-imperva.md)

### api/TasksAPI.js
- API: `https://drivesoon.local/api/`
- `getTask()` → `{id, license, ref_num, test_centers, dates_range}`
- `cancelTask(taskId, reason)` — отмена задачи
- `successTask(taskId, date, testCenter)` — успех
- Headers: `X-API-Token`, `worker-name`

## Конфигурация (.env)

| Переменная | Назначение |
|-----------|-----------|
| RUCAPTCHA_API_KEY | API ключ RuCaptcha (устарел) |
| CAPMONSTER_API_KEY | API ключ CapMonster (новый) |
| MULTILOGIN_EMAIL | Email для Multilogin |
| MULTILOGIN_PASSWORD | Пароль Multilogin |
| WORKER_NAME | Имя воркера (dtc-node) |
| TASKS_API_TOKEN | Токен API задач |
| API_DOMAIN | URL API задач |
| BROWSER_PROFILE_NAME | Имя профиля Multilogin для переиспользования |

## Зависимости (package.json)

- `playwright` — основная автоматизация браузера
- `dotenv` — переменные окружения
- `puppeteer` + `puppeteer-extra` + `stealth` — запасной вариант (не используется в app.js)

## Точки вызова капчи в app.js

1. **Строка 118** — после начальной навигации (processTask)
2. **Строка 568** — после interstitial страницы (performLogin)
3. **Строка 593** — после логина на /manage (performLogin)
4. **Строка 1032** — на странице Test centre (performTestCentreSearch)

Все вызовы одинаковые: `checkForCaptcha(page)` → `solveCaptcha(page)`
