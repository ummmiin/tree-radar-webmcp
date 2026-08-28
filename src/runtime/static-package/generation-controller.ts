import { runtimeError } from "./errors.ts";
import type { LoadGenerationIdentity } from "./identity.ts";

export class GenerationController {
  #active: LoadGenerationIdentity | undefined;
  #created = 0;
  #controller: AbortController | undefined;
  #disposed = false;
  #sequence = 0;
  #superseded = 0;
  get diagnostics() {
    return Object.freeze({
      generationsCreated: this.#created,
      generationsSuperseded: this.#superseded,
    });
  }
  begin(
    identity: Omit<LoadGenerationIdentity, "sequence">,
  ): LoadGenerationIdentity {
    if (this.#disposed)
      throw runtimeError({ code: "loader_disposed", phase: "generation" });
    if (this.#controller) {
      this.#superseded += 1;
      this.#controller.abort("generation superseded");
    }
    const generation = Object.freeze({
      ...identity,
      sequence: ++this.#sequence,
    });
    this.#active = generation;
    this.#created += 1;
    this.#controller = new AbortController();
    return generation;
  }
  signal(generation: LoadGenerationIdentity): AbortSignal {
    if (!this.isActive(generation) || !this.#controller)
      throw runtimeError({
        code: "generation_superseded",
        phase: "generation",
      });
    return this.#controller.signal;
  }
  isActive(generation: LoadGenerationIdentity): boolean {
    return !this.#disposed && this.#active?.sequence === generation.sequence;
  }
  cancel(sequence: number): void {
    if (this.#active?.sequence === sequence)
      this.#controller?.abort("generation cancelled");
  }
  dispose(): void {
    this.#disposed = true;
    this.#controller?.abort("loader disposed");
    this.#active = undefined;
  }
}
