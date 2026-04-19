export function startTypingKeepAlive(sendTick, options = {}) {
  if (typeof sendTick !== "function") {
    return async () => {};
  }

  const intervalMs = Math.max(200, Number(options.intervalMs) || 4000);
  const initialDelayMs = Math.max(0, Number(options.initialDelayMs) || 0);
  let stopped = false;
  let timer = null;
  let inFlightPromise = null;
  let activeAbortController = null;

  const scheduleNext = (delayMs) => {
    if (stopped) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const tick = () => {
    if (stopped || inFlightPromise) {
      return inFlightPromise;
    }

    const abortController =
      typeof AbortController === "function" ? new AbortController() : null;
    activeAbortController = abortController;

    const promise = (async () => {
      try {
        await sendTick(abortController ? { signal: abortController.signal } : {});
      } catch {
        // Typing indicators are best-effort only.
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        if (inFlightPromise === promise) {
          inFlightPromise = null;
        }
        if (!stopped) {
          scheduleNext(intervalMs);
        }
      }
    })();

    inFlightPromise = promise;
    return promise;
  };

  if (initialDelayMs > 0) {
    scheduleNext(initialDelayMs);
  } else {
    void tick();
  }

  return async () => {
    if (stopped) {
      if (inFlightPromise) {
        try {
          await inFlightPromise;
        } catch {
          // Ignore typing cleanup failures.
        }
      }
      return;
    }

    stopped = true;
    clearTimeout(timer);

    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {
        // Ignore abort failures.
      }
    }

    if (inFlightPromise) {
      try {
        await inFlightPromise;
      } catch {
        // Ignore typing cleanup failures.
      }
    }
  };
}
