async function main() {
  const runner = new Runner(config, api, proxyManager, logger, profileId, threadId);

  try {
    await runner.run();
  } catch (err) {
    console.error("Ошибка в run:", err);
  }
}

main();