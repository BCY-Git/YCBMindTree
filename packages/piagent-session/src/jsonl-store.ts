import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionNode, SessionRecord } from "./types.js";

/**
 * 基于 JSONL 的 append-only 会话存储。
 *
 * 为什么是 JSONL 追加写，而不是每次把整个会话 JSON.stringify 后覆盖？
 * 1. 崩溃安全：全量覆盖在写到一半时崩溃，整个文件可能损坏，全部历史丢失。
 *    追加写每次只在文件尾部原子地加一行，崩溃最多让最后一行不完整，
 *    前面所有行都完好——恢复时把损坏的最后一行丢掉即可。
 * 2. 成本：会话越长，全量覆盖的写放大越严重（每加一条消息重写整个文件，
 *    O(n²) 的累计 IO）。追加写每条消息只写自身，累计 O(n)。
 * 3. 可审计：一行一事件，天然是一份可回放的操作日志。
 *
 * 权衡：读取时需要重放整个文件来重建状态。对话历史通常不长，可接受；
 * 真要优化可周期性做 snapshot + 增量日志，但那是后续梯队的事。
 */
export class JsonlStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** 追加一个节点。这里用同步写以保证“写完才返回”，避免并发交错。 */
  appendNode(node: SessionNode): void {
    const record: SessionRecord = { v: 1, node };
    appendFileSync(this.#path, `${JSON.stringify(record)}\n`, "utf8");
  }

  /**
   * 崩溃恢复：读回所有完好的节点。
   *
   * 关键点在于对“最后一行不完整”的容忍：如果进程恰好在写一行的中途挂掉，
   * 文件末尾会残留半行非法 JSON。我们逐行解析，遇到无法解析的行：
   * - 若它是最后一行 → 视为崩溃残留，安全跳过。
   * - 若它在中间 → 说明文件被外部损坏，抛错让上层知晓，不静默吞掉。
   */
  loadNodes(): SessionNode[] {
    if (!existsSync(this.#path)) return [];
    const raw = readFileSync(this.#path, "utf8");
    const lines = raw.split("\n");
    const nodes: SessionNode[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined || line.trim() === "") continue;
      try {
        const record = JSON.parse(line) as SessionRecord;
        nodes.push(record.node);
      } catch (error) {
        const isLastNonEmpty = lines.slice(i + 1).every((l) => l.trim() === "");
        if (isLastNonEmpty) break; // 崩溃残留的半行，丢弃
        throw new Error(`会话文件第 ${i + 1} 行损坏：${String(error)}`);
      }
    }
    return nodes;
  }
}
