# CapMonster Cloud - Imperva (Incapsula) API Documentation

## Overview

Решение защиты Imperva (Incapsula) через CapMonster Cloud.
- **Цена**: $2 / 1000 токенов
- **Успешность**: 99%
- **API endpoint**: `https://api.capmonster.cloud`

## WARNING

- Используйте **свои прокси** для этой задачи
- Если прокси использует авторизацию по IP, добавьте в whitelist адрес: **65.21.190.34**
- После решения вы получите **специальные cookies**, которые нужно добавить в браузер
- Параметры **динамические** — меняются при каждой загрузке страницы. Извлекайте их непосредственно перед созданием задачи

## Request Parameters

### Основные (внутри `task`)

| Параметр | Тип | Обязателен | Описание |
|----------|-----|------------|----------|
| `type` | string | Да | `"CustomTask"` |
| `class` | string | Да | `"Imperva"` |
| `websiteURL` | string | Да | Адрес главной страницы, где стоит Incapsula |
| `userAgent` | string | Нет | User-Agent браузера. **Только Windows UA!** Пример: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36` |

### Metadata (внутри `task.metadata`)

| Параметр | Тип | Обязателен | Описание |
|----------|-----|------------|----------|
| `incapsulaScriptUrl` | string | Да | Имя JS файла Incapsula. Пример: `"_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"` |
| `incapsulaCookies` | string | Да | Куки Incapsula со страницы (`visid_incap_*`, `incap_ses_*`). Можно получить через `document.cookie` или заголовок `Set-Cookie`. Формат: `"incap_ses_1166_2930313=br7iX33ZNCtf3HlpEXcuEDzz72cAAAA0suDnBGrq/iA0..."` |
| `reese84UrlEndpoint` | string | Нет | Endpoint куда отправляется reese84 fingerprint. Находится среди запросов и заканчивается на `?d=site.com`. Пример: `"Built-with-the-For-hopence-Hurleysurfecting-the-"` |

### Прокси (внутри `task`)

| Параметр | Тип | Обязателен | Описание |
|----------|-----|------------|----------|
| `proxyType` | string | Да | `"http"`, `"https"`, `"socks4"`, `"socks5"` |
| `proxyAddress` | string | Да | IPv4/IPv6 адрес прокси. Нельзя: transparent прокси, локальные прокси |
| `proxyPort` | integer | Да | Порт прокси |
| `proxyLogin` | string | Да | Логин прокси |
| `proxyPassword` | string | Да | Пароль прокси |

## Create Task Method

**POST** `https://api.capmonster.cloud/createTask`

### Request

```json
{
    "clientKey": "API_KEY",
    "task": {
        "type": "CustomTask",
        "class": "Imperva",
        "websiteURL": "https://example.com",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "metadata": {
            "incapsulaScriptUrl": "_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3",
            "incapsulaCookies": "incap_ses_1166_2930313=br7iX33ZNCtf3HlpEXcuEDzz72cAAAA0suDnBGrq/iA0...",
            "reese84UrlEndpoint": "Built-with-the-For-hopence-Hurleysurfecting-the-"
        },
        "proxyType": "http",
        "proxyAddress": "8.8.8.8",
        "proxyPort": 8080,
        "proxyLogin": "proxyLoginHere",
        "proxyPassword": "proxyPasswordHere"
    }
}
```

### Response

```json
{
    "errorId": 0,
    "taskId": 407533072
}
```

## Get Task Result Method

**POST** `https://api.capmonster.cloud/getTaskResult`

### Request

```json
{
    "clientKey": "API_KEY",
    "taskId": 407533072
}
```

### Response

```json
{
    "errorId": 0,
    "status": "ready",
    "solution": {
        "domains": {
            "https://example.com": {
                "cookies": {
                    "___utmvc": "NMB+nRa4inxXNeXuhPl9w4opzdo...E4OTU2OGEwNzI2ODlkODc4MWIwNmU3MQ==; Max-Age=31..."
                }
            }
        }
    }
}
```

**Результат** — cookies (например `___utmvc`), которые нужно установить в браузере для обхода защиты.

## Access Denied (Error 16)

Ошибка 16 — прокси не соответствует требуемой геолокации. Нужно использовать прокси из правильной страны.

## Как найти параметры для задачи

### Автоматически (через Playwright)

```javascript
import { chromium } from "playwright";

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto("https://www.example.com/");

    // Извлечь src атрибут из iframe с id main-iframe
    const iframeSrc = await page.$eval("#main-iframe", (iframe) =>
        iframe.getAttribute("src")
    );
    console.log("iframe src:", iframeSrc);

    // Получить все cookies
    const cookies = await page.context().cookies();

    // Фильтровать cookies Incapsula (visid_incap_* или incap_ses_*)
    const filteredCookies = cookies.filter(
        (cookie) =>
            cookie.name.startsWith("visid_incap_") ||
            cookie.name.startsWith("incap_ses_")
    );

    filteredCookies.forEach((cookie) => {
        console.log(`${cookie.name}=${cookie.value}`);
    });

    await browser.close();
})();
```

### Где искать параметры в DevTools (Network tab)

1. **incapsulaScriptUrl** — запрос вида `_Incapsula_Resource?SWJIYLWA=...` в Network tab
2. **incapsulaCookies** — cookies `visid_incap_*` и `incap_ses_*` видны в Request Headers > Cookie
3. **reese84UrlEndpoint** — запрос, который заканчивается на `?d=site.com`

## Использование SDK (JavaScript)

```javascript
// https://github.com/ZennoLab/capmonstercloud-client-js
import { CapMonsterCloudClientFactory, ClientOptions, ImpervaRequest } from '@zennolab_com/capmonstercloud-client-js';

const API_KEY = "YOUR_API_KEY";

const cmcClient = CapMonsterCloudClientFactory.Create(
    new ClientOptions({ clientKey: API_KEY })
);

// Проверка баланса
const balance = await cmcClient.getBalance();
console.log("Balance:", balance);

const proxy = {
    proxyType: "http",
    proxyAddress: "123.45.67.89",
    proxyPort: 8080,
    proxyLogin: "username",
    proxyPassword: "password"
};

const impervaRequest = new ImpervaRequest({
    websiteURL: "https://example.com/",
    metadata: {
        incapsulaScriptUrl: "_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3",
        incapsulaCookies: "incap_ses_1166_2930313=br7iX33ZNCtf3HlpEXcuEDzz72cAAAA0suDnBGrq/iA0..."
    },
    proxy,
});

const result = await cmcClient.Solve(impervaRequest);
console.log("Solution:", result.solution);
```

## Применение решения

После получения cookies из `solution.domains[domain].cookies`:
1. Установить полученные cookies в браузере через `page.context().addCookies()`
2. Перезагрузить страницу — Incapsula должна пропустить
