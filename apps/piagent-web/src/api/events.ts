import { API_ROUTES, type AgentEventEnvelope } from "@ts-piagent/protocol";

/**
 * ★ 难点 1：SSE 在浏览器里的封装。
 *
 * 设计目标：把"订阅某会话的事件流"封装成一个纯函数，返回一个"取消订阅"函数。
 * 这样在 React 里用 useEffect(() => subscribeEvents(...), [id]) 就能自然管理
 * 连接的建立与清理——切换会话时先关旧连接、再开新连接，组件卸载时自动关闭。
 *
 * 为什么用原生 EventSource 而不是手搓 fetch 流：
 * - EventSource 是浏览器专为 SSE 设计的 API，自带断线重连、按行分帧、
 *   text/event-stream 解析。手搓 fetch ReadableStream 要自己处理这些，易错。
 *
 * seq 去重：后端每条事件带单调递增 seq。若未来加断线重连，重连可能重发
 * 已收过的事件；这里用 lastSeq 挡掉重复，保证上层 handler 幂等。
 */
export interface SubscribeOptions {
  onEvent: (envelope: AgentEventEnvelope) => void;
  onError?: (err: Event) => void;
}

export function subscribeSessionEvents(
  sessionId: string,
  { onEvent, onError }: SubscribeOptions,
): () => void {
  const url = API_ROUTES.events(sessionId);
  const es = new EventSource(url);

  let lastSeq = -1;

  es.onmessage = (msg: MessageEvent<string>) => {
    try {
      const envelope = JSON.parse(msg.data) as AgentEventEnvelope;
      // 去重：只处理比已处理过的更新的事件
      if (envelope.seq <= lastSeq) return;
      lastSeq = envelope.seq;
      onEvent(envelope);
    } catch {
      // 解析失败的帧忽略，不影响整条流
    }
  };

  es.onerror = (err) => {
    onError?.(err);
    // EventSource 默认会自动重连；这里不主动 close，交给浏览器。
    // 若想彻底停止，调用返回的 unsubscribe。
  };

  // 返回取消订阅函数：useEffect cleanup 里调用
  return () => es.close();
}
