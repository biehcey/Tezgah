import type { Clock } from '../saat';

export interface FakeClock extends Clock {
  /** Zamanı ilerletir ve süresi dolan zamanlayıcıları sırayla çalıştırır. */
  advance(ms: number): void;
  /**
   * Zamanı zamanlayıcıları çalıştırmadan ilerletir (dizüstü uykudayken Node zamanlayıcısı
   * işlemez); süresi geçenler sonraki `advance`'ta çalışır.
   */
  jump(ms: number): void;
}

export function createFakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    jump(ms) {
      now += ms;
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}
