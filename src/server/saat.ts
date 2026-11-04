/** Zamanlayıcılar; testlerde sahte saatle değiştirilir. */
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Gerçek saat; zamanlayıcılar süreci açık tutmaz. */
export const systemClock: Clock = {
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};
