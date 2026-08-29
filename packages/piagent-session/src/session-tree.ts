import type { Message } from "@ts-piagent/agent";
import type { SessionNode } from "./types.js";

const newId = (): string => crypto.randomUUID();

/**
 * 会话树的纯内存表示，不关心持久化。
 *
 * 之所以把“树结构”和“落盘”彻底分开：树只负责逻辑（父子关系、分支、
 * 取一条从根到某节点的路径），落盘由 SessionStore 负责。这样树本身
 * 可单元测试、可复用，换任何存储后端都不用改这里。
 */
export class SessionTree {
  readonly #nodes = new Map<string, SessionNode>();
  /** 当前“工作头”——新消息默认挂在它下面。类似 git 的 HEAD。 */
  #head: string | null = null;

  /** 从已有节点数组重建（崩溃恢复时使用）。 */
  static fromNodes(nodes: readonly SessionNode[]): SessionTree {
    const tree = new SessionTree();
    // 按创建时间排序，保证父节点先于子节点插入。
    const ordered = [...nodes].sort((a, b) => a.createdAt - b.createdAt);
    for (const node of ordered) {
      tree.#nodes.set(node.id, node);
    }
    // 恢复后把 HEAD 指向时间上最后写入的叶子节点。
    tree.#head = ordered.at(-1)?.id ?? null;
    return tree;
  }

  get head(): string | null {
    return this.#head;
  }

  size(): number {
    return this.#nodes.size;
  }

  getNode(id: string): SessionNode | undefined {
    return this.#nodes.get(id);
  }

  /**
   * 在 HEAD 之后追加一条消息，并把 HEAD 前移到新节点。
   * 返回新建的节点，调用方负责把它写盘。
   */
  append(message: Message): SessionNode {
    const node: SessionNode = {
      id: newId(),
      parentId: this.#head,
      message,
      createdAt: Date.now(),
    };
    this.#nodes.set(node.id, node);
    this.#head = node.id;
    return node;
  }

  /**
   * time-travel：把 HEAD 移到历史上的某个节点。
   * 之后再 append 就会从该点分叉出一条新链，原来的分支不受影响。
   */
  checkout(nodeId: string): void {
    if (!this.#nodes.has(nodeId)) {
      throw new Error(`checkout 失败：节点不存在 ${nodeId}`);
    }
    this.#head = nodeId;
  }

  /**
   * 取从根到指定节点（默认 HEAD）的消息链——这就是喂给模型的 messages。
   * 沿 parentId 上溯再反转，O(链长)。
   */
  pathTo(nodeId: string | null = this.#head): Message[] {
    const path: Message[] = [];
    let cursor = nodeId;
    const guard = new Set<string>();
    while (cursor) {
      if (guard.has(cursor)) throw new Error("检测到环，会话树已损坏");
      guard.add(cursor);
      const node = this.#nodes.get(cursor);
      if (!node) break;
      path.push(node.message);
      cursor = node.parentId;
    }
    return path.reverse();
  }

  /** 列出某节点的直接子节点，用于展示“这里有几条分支”。 */
  childrenOf(nodeId: string | null): SessionNode[] {
    const children: SessionNode[] = [];
    for (const node of this.#nodes.values()) {
      if (node.parentId === nodeId) children.push(node);
    }
    return children.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 返回全部节点（只读快照，按创建时间排序）。
   * 供 Web 端渲染整棵会话树使用。
   */
  nodes(): SessionNode[] {
    return [...this.#nodes.values()].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  }

  /**
   * 返回当前 HEAD 所在主链上的节点 id 集合。
   * 前端据此高亮"当前路径"，把它和其它历史分支区分开。
   */
  activePathIds(nodeId: string | null = this.#head): Set<string> {
    const ids = new Set<string>();
    let cursor = nodeId;
    while (cursor) {
      const node = this.#nodes.get(cursor);
      if (!node) break;
      ids.add(node.id);
      cursor = node.parentId;
    }
    return ids;
  }
}
