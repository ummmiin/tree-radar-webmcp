import { runtimeError } from "./errors.ts";
import type { RuntimePriority, StaticPackageRuntimePolicy } from "./policy.ts";

export type RuntimeTimers = Readonly<{
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
}>;
export type QueueTask<T> = (signal: AbortSignal, attempt: number) => Promise<T>;
type QueuedTask<T> = {
  consumers: Set<Consumer<T>>;
  controller: AbortController;
  execute: QueueTask<T>;
  key: string;
  priority: RuntimePriority;
  started: boolean;
  finished: boolean;
};
type Consumer<T> = {
  cleanup(): void;
  reject(reason: unknown): void;
  resolve(value: T): void;
};

const priorityOrder: Record<RuntimePriority, number> = {
  "active-query": 0,
  viewport: 1,
  preload: 2,
  background: 3,
};

export class FetchQueue {
  #active = 0;
  #deduplicatedConsumers = 0;
  #disposed = false;
  #inFlight = new Map<string, QueuedTask<unknown>>();
  #pending: QueuedTask<unknown>[] = [];
  #policy: StaticPackageRuntimePolicy;
  #random: () => number;
  #retries = 0;
  #requestsAborted = 0;
  #requestsCompleted = 0;
  #requestsStarted = 0;
  #peakActive = 0;
  #pendingListeners = 0;
  #timers: RuntimeTimers;

  constructor(
    policy: StaticPackageRuntimePolicy,
    input: Readonly<{ random?: () => number; timers?: RuntimeTimers }> = {},
  ) {
    this.#policy = policy;
    this.#random = input.random ?? Math.random;
    this.#timers = input.timers ?? { clearTimeout, setTimeout };
  }

  get diagnostics() {
    return Object.freeze({
      active: this.#active,
      deduplicatedConsumers: this.#deduplicatedConsumers,
      peakActive: this.#peakActive,
      pendingListeners: this.#pendingListeners,
      queued: this.#pending.length,
      requestsAborted: this.#requestsAborted,
      requestsCompleted: this.#requestsCompleted,
      requestsStarted: this.#requestsStarted,
      retries: this.#retries,
    });
  }

  enqueue<T>(
    input: Readonly<{
      execute: QueueTask<T>;
      key: string;
      priority: RuntimePriority;
      signal?: AbortSignal | undefined;
    }>,
  ): Promise<T> {
    if (this.#disposed)
      return Promise.reject(
        runtimeError({ code: "loader_disposed", phase: "queue" }),
      );
    const existing = this.#inFlight.get(input.key) as QueuedTask<T> | undefined;
    if (existing) {
      this.#deduplicatedConsumers += 1;
      return this.#attach(existing, input.signal);
    }
    if (this.#pending.length + this.#active >= this.#policy.maxQueuedRequests)
      return Promise.reject(
        runtimeError({ code: "queue_capacity_exceeded", phase: "queue" }),
      );
    const task: QueuedTask<T> = {
      consumers: new Set(),
      controller: new AbortController(),
      execute: input.execute,
      key: input.key,
      priority: input.priority,
      started: false,
      finished: false,
    };
    this.#inFlight.set(input.key, task);
    this.#pending.push(task);
    const promise = this.#attach(task, input.signal);
    this.#drain();
    return promise;
  }

  #attach<T>(task: QueuedTask<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let listenerAttached = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        task.consumers.delete(consumer);
        consumer.cleanup();
        reject(runtimeError({ code: "request_aborted", phase: "queue" }));
        if (task.consumers.size === 0)
          task.controller.abort("all consumers aborted");
      };
      const consumer: Consumer<T> = {
        cleanup: () => {
          if (!listenerAttached) return;
          listenerAttached = false;
          signal?.removeEventListener("abort", abort);
          this.#pendingListeners = Math.max(0, this.#pendingListeners - 1);
        },
        reject,
        resolve,
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      if (signal) {
        signal.addEventListener("abort", abort, { once: true });
        listenerAttached = true;
        this.#pendingListeners += 1;
      }
      task.consumers.add(consumer);
    });
  }

  #drain(): void {
    while (
      !this.#disposed &&
      this.#active < this.#policy.fetchConcurrency &&
      this.#pending.length > 0
    ) {
      this.#pending.sort(
        (left, right) =>
          priorityOrder[left.priority] - priorityOrder[right.priority],
      );
      const task = this.#pending.shift();
      if (!task) return;
      if (task.controller.signal.aborted) {
        this.#finish(
          task,
          undefined,
          runtimeError({ code: "request_aborted", phase: "queue" }),
        );
        continue;
      }
      task.started = true;
      this.#active += 1;
      this.#requestsStarted += 1;
      this.#peakActive = Math.max(this.#peakActive, this.#active);
      void this.#run(task);
    }
  }

  async #run(task: QueuedTask<unknown>): Promise<void> {
    try {
      let attempt = 0;
      for (;;) {
        try {
          const result = await task.execute(task.controller.signal, attempt);
          this.#finish(task, result);
          return;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("retryable" in error) ||
            !(error as { retryable?: boolean }).retryable ||
            attempt >= this.#policy.retryBaseDelaysMs.length ||
            task.controller.signal.aborted
          ) {
            this.#finish(task, undefined, error);
            return;
          }
          const base = this.#policy.retryBaseDelaysMs[attempt];
          attempt += 1;
          this.#retries += 1;
          await this.#delay(
            Math.floor((base ?? 0) * this.#random()),
            task.controller.signal,
          );
        }
      }
    } finally {
      this.#active -= 1;
      this.#drain();
    }
  }

  #delay(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
      };
      const handle = this.#timers.setTimeout(() => {
        finish();
        resolve();
      }, delayMs);
      const abort = () => {
        finish();
        this.#timers.clearTimeout(handle);
        reject(runtimeError({ code: "request_aborted", phase: "queue" }));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  #finish(task: QueuedTask<unknown>, value?: unknown, error?: unknown): void {
    if (task.finished) return;
    task.finished = true;
    this.#inFlight.delete(task.key);
    if (error === undefined) this.#requestsCompleted += 1;
    else if (
      (error as { code?: string } | undefined)?.code === "request_aborted"
    )
      this.#requestsAborted += 1;
    for (const consumer of task.consumers) {
      consumer.cleanup();
      if (error === undefined) consumer.resolve(value);
      else consumer.reject(error);
    }
    task.consumers.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const task of this.#inFlight.values()) {
      task.controller.abort("queue disposed");
      this.#finish(
        task,
        undefined,
        runtimeError({ code: "loader_disposed", phase: "queue" }),
      );
    }
    this.#pending = [];
  }
}
