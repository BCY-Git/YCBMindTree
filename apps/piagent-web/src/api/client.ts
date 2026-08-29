import type { ApiError } from "@ts-piagent/protocol";

/**
 * 极简 fetch 封装。所有请求走相对路径 /api，
 * 由 Vite dev 代理转发到 Hono（见 vite.config.ts），生产环境同源部署。
 */
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // 后端错误约定：{ error: { code, message } }
    const body = (await res.json().catch(() => null)) as ApiError | null;
    const message = body?.error?.message ?? `请求失败：${res.status}`;
    throw new Error(message);
  }

  // 204 无内容
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
