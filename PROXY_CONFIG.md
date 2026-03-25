# Конфигурация прокси для системы ротации

## Основные файлы

- `proxy.json` - основная конфигурация прокси
- `proxies.txt` - список прокси для ротации (при source=file)
- `proxy-file-config.json` - пример конфигурации для работы с файлом прокси

## Режимы работы

### 1. Config Mode (proxy_source: "config")
Генерирует динамические сессии на основе шаблона:
```json
{
    "proxy_source": "config",
    "host": "gate.multilogin.com",
    "port": 1080,
    "type": "socks5",
    "username": "template-{session_string}-{session_num}",
    "password": "password"
}
```

### 2. File Mode (proxy_source: "file") 
Ротирует прокси из списка в файле:
```json
{
    "proxy_source": "file",
    "proxy_file": "./proxies.txt",
    "proxy_change_by_url": true
}
```

## Формат файла proxies.txt

Поддерживаемые форматы:
```
protocol://username:password@host:port
protocol://username:password@host:port;change_ip_url
host:port:username:password
socks5://user:pass@proxy.com:1080
socks5://user:pass@proxy.com:1080;http://change-ip.com/rotate
```

## Функции ротации

1. **getProxy()** - получить текущий прокси
2. **forceRotateProxy()** - принудительная ротация
3. **getRandomizedProxy()** - случайный прокси
4. **validateProxy()** - проверка работоспособности
5. **changeIpByUrl()** - смена IP через URL

## Обработка таймаутов

При таймауте page.goto():
1. Остановка профиля
2. Ротация прокси
3. Обновление профиля с новым прокси  
4. Перезапуск браузера
5. Повтор навигации

Максимум попыток: CONFIG.PROXY.MAX_ROTATION_ATTEMPTS (по умолчанию 5)

## Переменные окружения

- `PROXY_CONFIG_PATH` - путь к файлу конфигурации прокси
- `PROXY_FILE_PATH` - путь к файлу списка прокси

## Логирование

Все операции с прокси логируются с префиксами:
- 🔄 - ротация прокси  
- 🎲 - случайный прокси
- 🔧 - обновление профиля
- ⚠️ - таймауты и ошибки