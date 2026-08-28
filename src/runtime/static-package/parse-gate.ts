import { runtimeError } from "./errors.ts";

type PendingParse<T> = {
  reject(reason: unknown): void;
  resolve(value: T): void;
  run(): Promise<T>;
};

/** Bounded, observable parse admission; parsing remains in the browser realm. */
export class ParseGate {
  #active = 0;
  #disposed = false;
  #peak = 0;
  #pending: PendingParse<unknown>[] = [];
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  get diagnostics() {
    return Object.freeze({
      activeParses: this.#active,
      peakConcurrentParses: this.#peak,
      queuedParses: this.#pending.length,
    });
  }

  run<T>(run: () => Promise<T>): Promise<T> {
    if (this.#disposed)
      return Promise.reject(
        runtimeError({ code: "loader_disposed", phase: "loader" }),
      );
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({ reject, resolve, run });
      this.#drain();
    });
  }

  #drain(): void {
    while (
      !this.#disposed &&
      this.#active < this.#limit &&
      this.#pending.length
    ) {
      const pending = this.#pending.shift();
      if (!pending) return;
      this.#active += 1;
      this.#peak = Math.max(this.#peak, this.#active);
      void pending
        .run()
        .then(
          (value) => {
            pending.resolve(value);
          },
          (reason: unknown) => {
            pending.reject(reason);
          },
        )
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending)
      pending.reject(
        runtimeError({ code: "loader_disposed", phase: "loader" }),
      );
    this.#pending = [];
  }
}
