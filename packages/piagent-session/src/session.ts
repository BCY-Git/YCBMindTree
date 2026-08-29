import type { AgentEvent, Message } from "@ts-piagent/agent";
import { JsonlStore } from "./jsonl-store.js";
import { SessionTree } from "./session-tree.js";
import type { SessionNode } from "./types.js";

/**
 * 会话门面：把“内存里的树”和“磁盘上的日志”绑在一起。
 * 每次 append 都是先写树、再写盘，保证内存与磁盘一致。
 */
export class Session {
  readonly #tree: SessionTree;
  readonly #store: JsonlStore;

  private constructor(tree: SessionTree, store: JsonlStore) {
    this.#tree = tree;
    this.#store = store;
  }

  /** 打开（或恢复）一个会话文件。若文件已存在，自动重放重建会话树。 */
  static open(path: string): Session {
    const store = new JsonlStore(path);
    const nodes = store.loadNodes();
    const tree =
      nodes.length > 0 ? SessionTree.fromNodes(nodes) : new SessionTree();
    return new Session(tree, store);
  }

  get head(): string | null {
    return this.#tree.head;
  }

  /** 追加一条消息：内存 + 磁盘同时更新。 */
  append(message: Message): SessionNode {
    const node = this.#tree.append(message);
    this.#store.appendNode(node);
    return node;
  }

  /** 当前从根到 HEAD 的完整消息链——可直接作为下一轮 runAgent 的输入历史。 */
  history(): Message[] {
    return this.#tree.pathTo();
  }

  /** time-travel：回到历史某节点，之后 append 会从该点分叉。 */
  checkout(nodeId: string): void {
    this.#tree.checkout(nodeId);
  }

  childrenOf(nodeId: string | null): SessionNode[] {
    return this.#tree.childrenOf(nodeId);
  }

  /** 全部节点（只读快照）。供 Web 端渲染整棵会话树。 */
  nodes(): SessionNode[] {
    return this.#tree.nodes();
  }

  /** 当前 HEAD 主链上的节点 id 集合。供前端高亮当前路径。 */
  activePathIds(): Set<string> {
    return this.#tree.activePathIds();
  }

  size(): number {
    return this.#tree.size();
  }

  /**
   * 生成一个可直接传给 runAgent 的 onEvent 回调：
   * 在 user / assistant / tool 三类消息产生时，自动落盘。
   *
   * 这样做的价值：runAgent 那 100 行内核一行都不用改，
   * 持久化完全通过既有的事件钩子挂进来——关注点分离的活教材。
   */
  persistOnEvent(): (event: AgentEvent) => void {
    return (event: AgentEvent): void => {
      switch (event.type) {
        case "agent_start":
          this.append({ role: "user", content: event.input });
          break;
        case "assistant":
          this.append(event.message);
          break;
        case "tool_end":
          this.append(event.result);
          break;
        default:
          break;
      }
    };
  }
}
