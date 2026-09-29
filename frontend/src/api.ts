import type {
  Direction,
  FontSessionPayload,
  SampleInfo,
  ShapeResult,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") message = body.detail;
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export async function listSamples(signal?: AbortSignal): Promise<SampleInfo[]> {
  const body = await asJson<{ samples: SampleInfo[] }>(
    await fetch("/api/samples", { signal })
  );
  return body.samples;
}

export async function uploadFont(
  file: File,
  signal?: AbortSignal
): Promise<FontSessionPayload> {
  const form = new FormData();
  form.append("file", file);
  return asJson<FontSessionPayload>(
    await fetch("/api/fonts", { method: "POST", body: form, signal })
  );
}

export async function loadSample(
  key: string,
  signal?: AbortSignal
): Promise<FontSessionPayload> {
  return asJson<FontSessionPayload>(
    await fetch(`/api/samples/${encodeURIComponent(key)}/load`, {
      method: "POST",
      signal,
    })
  );
}

export interface ShapeParams {
  text: string;
  direction: Direction;
  features: Record<string, boolean>;
  script?: string;
  language?: string;
}

export async function shape(
  sessionId: string,
  params: ShapeParams,
  signal?: AbortSignal
): Promise<ShapeResult> {
  return asJson<ShapeResult>(
    await fetch(`/api/fonts/${sessionId}/shape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    })
  );
}
