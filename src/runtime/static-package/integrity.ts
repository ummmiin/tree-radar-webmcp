import { runtimeError } from "./errors.ts";

export type WebCryptoLike = Readonly<{
  subtle: Readonly<{
    digest(
      algorithm: AlgorithmIdentifier,
      data: BufferSource,
    ): Promise<ArrayBuffer>;
  }>;
}>;

export function defaultCrypto(): WebCryptoLike | undefined {
  return (globalThis as { crypto?: WebCryptoLike }).crypto;
}

export async function sha256Hex(
  bytes: Uint8Array,
  crypto: WebCryptoLike | undefined,
): Promise<string> {
  if (!crypto?.subtle)
    throw runtimeError({ code: "crypto_unavailable", phase: "loader" });
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export function decodeUtf8(
  bytes: Uint8Array,
  phase: "manifest" | "file",
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw runtimeError({
      code:
        phase === "manifest"
          ? "manifest_decode_failed"
          : "payload_decode_failed",
      phase,
      cause,
    });
  }
}

export function parseJson(text: string, phase: "manifest" | "file"): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw runtimeError({
      code:
        phase === "manifest" ? "manifest_parse_failed" : "payload_parse_failed",
      phase,
      cause,
    });
  }
}

export async function readResponseBytes(
  response: Response,
  limit: number,
  phase: "manifest" | "file",
): Promise<Uint8Array> {
  const tooLarge =
    phase === "manifest" ? "manifest_too_large" : "file_too_large";
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)
      throw runtimeError({ code: tooLarge, phase, diagnostic: { limit } });
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit)
      throw runtimeError({ code: tooLarge, phase, diagnostic: { limit } });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw runtimeError({ code: tooLarge, phase, diagnostic: { limit } });
      }
      chunks.push(result.value);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "StaticPackageRuntimeError")
      throw cause;
    throw runtimeError({
      code:
        phase === "manifest" ? "manifest_fetch_failed" : "file_fetch_failed",
      phase,
      cause,
    });
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function assertJsonMime(
  response: Response,
  phase: "manifest" | "file",
): void {
  const mime = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mime || (mime !== "application/json" && !mime.endsWith("+json")))
    throw runtimeError({
      code:
        phase === "manifest" ? "manifest_mime_invalid" : "file_mime_invalid",
      phase,
    });
}
