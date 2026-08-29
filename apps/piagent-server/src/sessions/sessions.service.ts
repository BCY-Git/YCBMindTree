import { runAgent } from "@ts-piagent/agent";
import type { AgentEvent, Model } from "@ts-piagent/agent";
import { Session } from "@ts-piagent/session";
import type {
  AgentEventEnvelope,
  SessionNodeDto,
  SessionSummary,
  SessionTreeDto,
} from "@ts-piagent/protocol";
import { AgentFactory } from "../agent/agent.factory.js";
import { ScriptedModel } from "../agent/scripted-model.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 极简事件发射器（替代 rxjs Subject）。
 * 只需要"订阅 / 推送 / 取消订阅"三件事，不值得为它引入 rxjs。
 */
class EventEmitter<T> {
  #listeners = new Set<(value: T) => void>();
  subscribe(fn: (value: T) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  emit(value: T): void {
    for (const fn of this.#listeners) fn(value);
  }
}

interface SessionRuntime {
  id: string;
  session: Session;
  title: string;
  createdAt: number;
  updatedAt: number;
  events: EventEmitter<AgentEventEnvelope>;
  seq: number;
}

const SESSION_DIR = join(process.cwd(), ".sessions");

/**
 * SessionsService：Web 后端核心。框架无关的纯类。
 * 把 session 持久化 + runAgent + 事件流缝在一起。
 *
 * 核心设计（onEvent 一鱼两吃）：runAgent 的每个事件同时
 * (a) 交给 session 落盘，(b) 包上 seq 推给订阅者（SSE）。
 */
export class SessionsService {
  #runtimes = new Map<string, SessionRuntime>();
  #agentFactory = new AgentFactory();

  constructor() {
    mkdirSync(SESSION_DIR, { recursive: true });
  }

  createSession(): { id: string } {
    const id = randomUUID();
    const now = Date.now();
    const session = Session.open(join(SESSION_DIR, `${id}.jsonl`));
    this.#runtimes.set(id, {
      id,
      session,
      title: "新会话",
      createdAt: now,
      updatedAt: now,
      events: new EventEmitter<AgentEventEnvelope>(),
      seq: 0,
    });
    return { id };
  }

  listSessions(): SessionSummary[] {
    return [...this.#runtimes.values()]
      .map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        messageCount: r.session.size(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getTree(id: string): SessionTreeDto {
    const rt = this.#mustGet(id);
    const head = rt.session.head;
    const activePathIds = rt.session.activePathIds();
    const nodes: SessionNodeDto[] = rt.session.nodes().map((node) => ({
      id: node.id,
      parentId: node.parentId,
      role: node.message.role,
      content: this.#contentOf(node.message),
      createdAt: node.createdAt,
      onActivePath: activePathIds.has(node.id),
    }));
    return { sessionId: id, head, nodes };
  }

  sendMessage(id: string, content: string): { runId: string } {
    const rt = this.#mustGet(id);
    const runId = randomUUID();

    if (rt.session.size() === 0) rt.title = content.slice(0, 30);

    const model: Model = this.#agentFactory.createModel() ?? new ScriptedModel();
    const tools = this.#agentFactory.createTools();
    const persist = rt.session.persistOnEvent();

    const onEvent = (event: AgentEvent): void => {
      persist(event);
      rt.seq += 1;
      rt.events.emit({ seq: rt.seq, event });
      rt.updatedAt = Date.now();
    };

    void runAgent(content, {
      model,
      tools,
      systemPrompt: "你是一个简洁的中文助手。需要时调用工具，并基于工具结果回答。",
      onEvent,
    }).catch((err) => {
      rt.seq += 1;
      rt.events.emit({
        seq: rt.seq,
        event: {
          type: "agent_end",
          result: { output: `运行出错：${String(err)}`, messages: [], turns: 0 },
        },
      });
    });

    return { runId };
  }

  checkout(id: string, nodeId: string): { head: string } {
    const rt = this.#mustGet(id);
    rt.session.checkout(nodeId);
    rt.updatedAt = Date.now();
    return { head: rt.session.head ?? nodeId };
  }

  /** 订阅某会话事件流，返回取消订阅函数。SSE 处理器用。 */
  subscribe(id: string, fn: (e: AgentEventEnvelope) => void): () => void {
    return this.#mustGet(id).events.subscribe(fn);
  }

  has(id: string): boolean {
    return this.#runtimes.has(id);
  }

  #mustGet(id: string): SessionRuntime {
    const rt = this.#runtimes.get(id);
    if (!rt) throw new Error(`SESSION_NOT_FOUND:${id}`);
    return rt;
  }

  #contentOf(message: { content?: unknown }): string {
    return String(message.content ?? "");
  }
}
