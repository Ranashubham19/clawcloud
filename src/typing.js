export function startTypingKeepAlive(sendTick, options = {}) {
  if (typeof sendTick !== "function") {
    return () => {};
  }

  const intervalMs = Math.max(200, Number(options.intervalMs) || 4000);
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      await sendTick();
    } catch {
      // Typing indicators are best-effort only.
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };
}
