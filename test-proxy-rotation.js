import { ProxyManager } from "./proxy/ProxyManager.js";
import { MultiloginAPI } from "./multilogin/multilogin.js";

// Тестирование системы ротации прокси
async function testProxyRotation() {
  console.log("🧪 Начало тестирования системы ротации прокси\n");

  try {
    // 1. Тест ProxyManager
    console.log("📝 Тест 1: Инициализация ProxyManager");
    const proxyManager = new ProxyManager(1);
    
    console.log("✅ ProxyManager инициализирован");
    console.log("📊 Статистика:", proxyManager.getProxyStats());
    console.log("");

    // 2. Тест получения прокси
    console.log("📝 Тест 2: Получение прокси конфигураций");
    
    const proxy1 = proxyManager.getProxy(1);
    console.log("🔗 Прокси 1:", proxy1);
    
    const proxy2 = proxyManager.forceRotateProxy(1);
    console.log("🔗 Прокси 2 (после ротации):", proxy2);
    
    const randomProxy = proxyManager.getRandomizedProxy();
    console.log("🎲 Случайный прокси:", randomProxy);
    console.log("");

    // 3. Тест MultiloginAPI с прокси
    console.log("📝 Тест 3: Интеграция с MultiloginAPI");
    
    const multiloginAPI = new MultiloginAPI(
      'test@example.com', 
      'testpassword'
    );
    
    const currentProxy = multiloginAPI.getCurrentProxy();
    console.log("🔗 Текущий прокси в MultiloginAPI:", currentProxy);
    
    const rotatedProxy = multiloginAPI.rotateProxy();
    console.log("🔄 Прокси после ротации:", rotatedProxy);
    
    const stats = multiloginAPI.getProxyStats();
    console.log("📊 Статистика MultiloginAPI:", stats);
    console.log("");

    // 4. Тест форматирования прокси
    console.log("📝 Тест 4: Форматирование прокси");
    
    const formattedForML = proxyManager.formatForMultilogin(currentProxy);
    console.log("🔧 Формат для Multilogin:", formattedForML);
    
    const proxyString = proxyManager.formatAsString(currentProxy);
    console.log("📄 Строковый формат:", proxyString);
    console.log("");

    // 5. Симуляция обработки таймаута
    console.log("📝 Тест 5: Симуляция обработки таймаута");
    
    console.log("⏰ Симулируем таймаут загрузки страницы...");
    console.log("🔄 Старый прокси:", multiloginAPI.getCurrentProxy().username);
    
    const newProxy = multiloginAPI.rotateProxy();
    console.log("✅ Новый прокси после ротации:", newProxy.username);
    console.log("");

    console.log("✅ Все тесты пройдены успешно!");
    
  } catch (error) {
    console.error("❌ Ошибка тестирования:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Дополнительный тест симуляции таймаутов
async function simulatePageLoadTimeout() {
  console.log("\n🎭 Симуляция таймаута загрузки страницы");
  
  const maxAttempts = 5;
  let attempt = 0;
  
  const multiloginAPI = new MultiloginAPI('test@example.com', 'test');
  
  while (attempt < maxAttempts) {
    try {
      console.log(`\n🔄 Попытка ${attempt + 1}/${maxAttempts}`);
      console.log(`🔗 Текущий прокси: ${multiloginAPI.getCurrentProxy().username.substring(0, 50)}...`);
      
      // Симуляция случайного таймаута (30% вероятность)
      const willTimeout = Math.random() < 0.3;
      
      if (willTimeout) {
        console.log("⏰ Симуляция таймаута...");
        throw new Error("TimeoutError: Navigation timeout");
      }
      
      console.log("✅ Страница загружена успешно!");
      break;
      
    } catch (error) {
      console.log(`❌ Таймаут на попытке ${attempt + 1}: ${error.message}`);
      
      if (attempt < maxAttempts - 1) {
        console.log("🔄 Ротация прокси...");
        const newProxy = multiloginAPI.rotateProxy();
        console.log(`✅ Новый прокси: ${newProxy.username.substring(0, 50)}...`);
        
        console.log("⏳ Пауза 2 секунды...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      attempt++;
    }
  }
  
  if (attempt >= maxAttempts) {
    console.log(`❌ Не удалось загрузить страницу после ${maxAttempts} попыток`);
  }
}

// Запуск тестов
async function runAllTests() {
  await testProxyRotation();
  await simulatePageLoadTimeout();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { testProxyRotation, simulatePageLoadTimeout };