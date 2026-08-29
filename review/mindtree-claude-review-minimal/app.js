/* MindTree Minimal: a dependency-free, single-page mind-map editor. */
const STORAGE_KEY = 'mindtree-minimal-v2';
const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;
const H_GAP = 95;
const V_GAP = 24;
const VIEW_PADDING = 72;
const HISTORY_LIMIT = 80;
const $ = (selector) => document.querySelector(selector);

let state = loadState();
let viewport = { x: 100, y: 160, scale: 1 };
let positions = new Map();
let drag = null;
let pan = null;
let past = [];
let future = [];
let statusTimer = null;

function makeId() { return crypto.randomUUID(); }
function now() { return Date.now(); }
function clone(value) { return structuredClone(value); }

function makeNode(id, parentId, topic, timestamp = now()) {
  return { id, parentId, childIds: [], topic, collapsed: false, dx: 0, dy: 0, createdAt: timestamp, updatedAt: timestamp };
}

function exampleMap() {
  const root = makeId(); const product = makeId(); const research = makeId(); const launch = makeId(); const notes = makeId(); const tasks = makeId(); const timestamp = now();
  const nodes = {
    [root]: makeNode(root, null, 'MindTree', timestamp), [product]: makeNode(product, root, '产品体验', timestamp),
    [research]: makeNode(research, root, '用户研究', timestamp), [launch]: makeNode(launch, root, '发布计划', timestamp),
    [notes]: makeNode(notes, product, '快速记录', timestamp), [tasks]: makeNode(tasks, product, '行动事项', timestamp),
  };
  nodes[root].childIds = [product, research, launch]; nodes[product].childIds = [notes, tasks];
  return { title: 'MindTree 产品规划', selectedId: root, nodes, createdAt: timestamp, updatedAt: timestamp };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValidMap(saved)) return normalizeMap(saved);
  } catch { /* A corrupted or unavailable store should never block the editor. */ }
  return exampleMap();
}

function normalizeMap(value) {
  const timestamp = now();
  for (const node of Object.values(value.nodes)) {
    node.dx = Number.isFinite(node.dx) ? node.dx : 0; node.dy = Number.isFinite(node.dy) ? node.dy : 0;
    node.createdAt = Number.isFinite(node.createdAt) ? node.createdAt : timestamp;
    node.updatedAt = Number.isFinite(node.updatedAt) ? node.updatedAt : node.createdAt;
  }
  value.createdAt = Number.isFinite(value.createdAt) ? value.createdAt : timestamp;
  value.updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : value.createdAt;
  return value;
}

function isValidMap(value) {
  if (!value || typeof value.title !== 'string' || !value.nodes || typeof value.nodes !== 'object') return false;
  const nodes = Object.values(value.nodes);
  if (!nodes.length || nodes.filter((node) => node?.parentId === null).length !== 1) return false;
  if (!nodes.every((node) => node && typeof node.id === 'string' && value.nodes[node.id] === node && Array.isArray(node.childIds) && typeof node.topic === 'string')) return false;
  if (!nodes.every((node) => new Set(node.childIds).size === node.childIds.length && node.childIds.every((id) => value.nodes[id]?.parentId === node.id))) return false;
  if (!nodes.every((node) => node.parentId === null || value.nodes[node.parentId]?.childIds.includes(node.id))) return false;
  const seen = new Set();
  (function visit(node) { if (seen.has(node.id)) return; seen.add(node.id); node.childIds.forEach((id) => visit(value.nodes[id])); })(nodes.find((node) => node.parentId === null));
  return seen.size === nodes.length;
}

function rootNode() { return Object.values(state.nodes).find((node) => node.parentId === null); }
function selectedNode() { return state.nodes[state.selectedId] || rootNode(); }
function visibleChildren(node) { return node.collapsed ? [] : node.childIds.map((id) => state.nodes[id]); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }
function touch(...nodes) { const timestamp = now(); nodes.filter(Boolean).forEach((node) => { node.updatedAt = timestamp; }); state.updatedAt = timestamp; }

function setStatus(message, { error = false, persistent = false } = {}) {
  const status = $('#status'); window.clearTimeout(statusTimer); status.textContent = message; status.classList.toggle('error', error);
  if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '本地自动保存已启用'; status.classList.remove('error'); }, 2800);
}

function save(message = '已自动保存到此浏览器') {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setStatus(message); return true;
  } catch (error) {
    console.error('MindTree save failed', error);
    setStatus('⚠️ 保存失败：请立即导出 JSON 备份；浏览器存储可能不可用或已满。', { error: true, persistent: true });
    return false;
  }
}

function pushHistory(before) { past.push(clone(before)); if (past.length > HISTORY_LIMIT) past.shift(); future = []; updateHistoryControls(); }
function commit(before, message) { pushHistory(before); save(message); render(); }
function undo() {
  if (!past.length) return setStatus('没有可撤销的操作');
  future.push(clone(state)); state = past.pop(); save('已撤销上一步操作'); render();
}
function redo() {
  if (!future.length) return setStatus('没有可重做的操作');
  past.push(clone(state)); state = future.pop(); save('已重做操作'); render();
}
function updateHistoryControls() { $('#undo').disabled = !past.length; $('#redo').disabled = !future.length; }

function layout() {
  const root = rootNode(); const spans = new Map();
  function measure(node) {
    const children = visibleChildren(node);
    const span = children.length ? Math.max(NODE_HEIGHT, children.reduce((sum, child) => sum + measure(child), 0) + V_GAP * (children.length - 1)) : NODE_HEIGHT;
    spans.set(node.id, span); return span;
  }
  function place(node, depth, top) {
    const span = spans.get(node.id); const x = depth * (NODE_WIDTH + H_GAP) + node.dx; const y = top + span / 2 - NODE_HEIGHT / 2 + node.dy;
    positions.set(node.id, { x, y }); let cursor = top;
    visibleChildren(node).forEach((child) => { place(child, depth + 1, cursor); cursor += spans.get(child.id) + V_GAP; });
  }
  positions = new Map(); measure(root); place(root, 0, 0);
}

function bounds() {
  const items = [...positions.values()];
  return {
    minX: Math.min(...items.map((pos) => pos.x)), minY: Math.min(...items.map((pos) => pos.y)),
    maxX: Math.max(...items.map((pos) => pos.x + NODE_WIDTH)), maxY: Math.max(...items.map((pos) => pos.y + NODE_HEIGHT)),
  };
}

function clampViewport() {
  const canvas = $('#canvas'); const box = bounds();
  const mapWidth = (box.maxX - box.minX) * viewport.scale; const mapHeight = (box.maxY - box.minY) * viewport.scale;
  const minX = mapWidth > canvas.clientWidth - VIEW_PADDING * 2 ? canvas.clientWidth - VIEW_PADDING - box.maxX * viewport.scale : VIEW_PADDING - box.minX * viewport.scale;
  const maxX = mapWidth > canvas.clientWidth - VIEW_PADDING * 2 ? VIEW_PADDING - box.minX * viewport.scale : canvas.clientWidth - VIEW_PADDING - box.maxX * viewport.scale;
  const minY = mapHeight > canvas.clientHeight - VIEW_PADDING * 2 ? canvas.clientHeight - VIEW_PADDING - box.maxY * viewport.scale : VIEW_PADDING - box.minY * viewport.scale;
  const maxY = mapHeight > canvas.clientHeight - VIEW_PADDING * 2 ? VIEW_PADDING - box.minY * viewport.scale : canvas.clientHeight - VIEW_PADDING - box.maxY * viewport.scale;
  viewport.x = Math.max(minX, Math.min(maxX, viewport.x)); viewport.y = Math.max(minY, Math.min(maxY, viewport.y));
}

function render() {
  layout(); clampViewport(); $('#map-title').value = state.title; $('#node-count').textContent = `${Object.keys(state.nodes).length} 个节点`;
  renderCanvas(); renderOutline(); renderInspector(); renderSearchResults(); updateHistoryControls();
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element;
}

function renderCanvas() {
  const edges = $('#edges'); const nodes = $('#nodes'); $('#viewport').setAttribute('transform', `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`); edges.replaceChildren(); nodes.replaceChildren();
  for (const node of Object.values(state.nodes)) {
    const from = positions.get(node.id); if (!from || node.parentId === null) continue; const parent = state.nodes[node.parentId]; const to = positions.get(parent.id); if (!to) continue;
    const startX = to.x + NODE_WIDTH; const startY = to.y + NODE_HEIGHT / 2; const endX = from.x; const endY = from.y + NODE_HEIGHT / 2;
    edges.append(svgElement('path', { d: `M ${startX} ${startY} C ${startX + 44} ${startY}, ${endX - 44} ${endY}, ${endX} ${endY}`, class: `edge ${node.id === state.selectedId || parent.id === state.selectedId ? 'selected' : ''}` }));
  }
  for (const node of Object.values(state.nodes)) {
    const pos = positions.get(node.id); if (!pos) continue;
    const group = svgElement('g', { class: `mind-node ${node.parentId === null ? 'root' : ''} ${node.id === state.selectedId ? 'selected' : ''} ${drag?.targetId === node.id ? 'drop-target' : ''}`, transform: `translate(${pos.x} ${pos.y})` }); group.dataset.id = node.id;
    const title = svgElement('title'); title.textContent = node.topic; group.append(title);
    group.append(svgElement('rect', { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 10 }));
    const label = svgElement('text', { x: 13, y: 29 }); label.textContent = truncate(node.topic, 17); group.append(label);
    if (node.childIds.length) {
      group.append(svgElement('circle', { class: 'collapse-dot', cx: NODE_WIDTH, cy: NODE_HEIGHT / 2, r: 10 }));
      const mark = svgElement('text', { class: 'collapse-mark', x: NODE_WIDTH - 4, y: NODE_HEIGHT / 2 + 4 }); mark.textContent = node.collapsed ? '+' : '−'; group.append(mark);
    }
    group.addEventListener('mousedown', onNodePointerDown); group.addEventListener('dblclick', () => renameNode(node.id)); nodes.append(group);
  }
}

function truncate(text, limit) { return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }

function renderOutline() {
  const outline = $('#outline'); outline.replaceChildren();
  function add(node, depth) {
    const item = document.createElement('button'); item.className = `outline-item ${node.id === state.selectedId ? 'selected' : ''}`; item.style.paddingLeft = `${5 + depth * 14}px`;
    item.innerHTML = `<span class="triangle">${node.childIds.length ? (node.collapsed ? '▸' : '▾') : ''}</span><span class="topic">${escapeHtml(node.topic)}</span>`;
    item.addEventListener('click', () => selectAndFocus(node.id)); outline.append(item); visibleChildren(node).forEach((child) => add(child, depth + 1));
  }
  add(rootNode(), 0);
}

function renderSearchResults() {
  const query = $('#search-input').value.trim().toLocaleLowerCase(); const results = $('#search-results'); results.replaceChildren();
  if (!query) return;
  const matches = Object.values(state.nodes).filter((node) => node.topic.toLocaleLowerCase().includes(query)).slice(0, 20);
  if (!matches.length) { results.textContent = '未找到匹配节点'; return; }
  matches.forEach((node) => { const item = document.createElement('button'); item.textContent = node.topic; item.title = node.topic; item.addEventListener('click', () => selectAndFocus(node.id)); results.append(item); });
}

function renderInspector() {
  const node = selectedNode(); const details = $('#node-details'); const kind = node.parentId === null ? '中心主题' : node.childIds.length ? `分支 · ${node.childIds.length} 个子节点` : '叶子节点';
  details.innerHTML = `<label class="detail-label" for="node-topic">主题</label><input id="node-topic" class="detail-input" value="${escapeHtml(node.topic)}" maxlength="80" /><button id="reset-node-position" class="inspector-action">重置此节点位置</button><div class="detail-meta">${kind}<br>创建于 ${new Date(node.createdAt).toLocaleString('zh-CN')}<br>更新于 ${new Date(node.updatedAt).toLocaleString('zh-CN')}</div>`;
  $('#node-topic').addEventListener('change', (event) => updateTopic(node.id, event.target.value));
  $('#node-topic').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.target.blur(); });
  $('#reset-node-position').onclick = () => resetPosition(node.id);
}

function updateTopic(id, topic) {
  const value = topic.trim(); if (!value || value === state.nodes[id].topic) return render();
  const before = clone(state); state.nodes[id].topic = value; touch(state.nodes[id]); pushHistory(before); save('节点名称已保存');
  layout(); clampViewport(); renderCanvas(); renderOutline(); renderSearchResults(); updateHistoryControls();
}
function renameNode(id) { const node = state.nodes[id]; const value = window.prompt('节点名称', node.topic); if (value !== null) updateTopic(id, value); }

function addChild() {
  const before = clone(state); const parent = selectedNode(); const node = makeNode(makeId(), parent.id, '新主题'); const didExpand = parent.collapsed;
  state.nodes[node.id] = node; parent.childIds.push(node.id); parent.collapsed = false; state.selectedId = node.id; touch(parent, node); commit(before, didExpand ? '已添加子节点并展开分支' : '已添加子节点'); focusNodeInput();
}
function addSibling() {
  const node = selectedNode(); if (!node.parentId) return addChild();
  const before = clone(state); const parent = state.nodes[node.parentId]; const sibling = makeNode(makeId(), parent.id, '新主题');
  state.nodes[sibling.id] = sibling; parent.childIds.splice(parent.childIds.indexOf(node.id) + 1, 0, sibling.id); state.selectedId = sibling.id; touch(parent, sibling); commit(before, '已添加同级节点'); focusNodeInput();
}
function focusNodeInput() { $('#node-topic')?.focus(); $('#node-topic')?.select(); }

function deleteSelected() {
  const node = selectedNode(); if (!node.parentId) return setStatus('中心主题不能删除');
  if (!window.confirm(`删除「${node.topic}」及其全部子节点？可按 Ctrl/⌘+Z 撤销。`)) return;
  const before = clone(state); const parent = state.nodes[node.parentId]; parent.childIds = parent.childIds.filter((id) => id !== node.id);
  (function remove(current) { current.childIds.forEach((id) => remove(state.nodes[id])); delete state.nodes[current.id]; })(node);
  state.selectedId = parent.id; touch(parent); commit(before, '节点已删除；可按 Ctrl/⌘+Z 撤销'); centerNode(parent.id);
}
function toggleCollapse() {
  const node = selectedNode(); if (!node.childIds.length) return setStatus('该节点没有可折叠的子节点');
  const before = clone(state); node.collapsed = !node.collapsed; touch(node); commit(before, node.collapsed ? '分支已折叠' : '分支已展开');
}
function resetPosition(id) {
  const node = state.nodes[id]; if (!node.dx && !node.dy) return setStatus('该节点已处于自动布局位置');
  const before = clone(state); node.dx = 0; node.dy = 0; touch(node); commit(before, '节点位置已重置'); fitView();
}
function resetAllPositions() {
  if (!Object.values(state.nodes).some((node) => node.dx || node.dy)) return setStatus('所有节点已处于自动布局位置');
  const before = clone(state); Object.values(state.nodes).forEach((node) => { node.dx = 0; node.dy = 0; }); touch(...Object.values(state.nodes)); commit(before, '已恢复全部自动布局'); fitView();
}

function isDescendant(candidateId, ancestorId) {
  if (candidateId === ancestorId) return true;
  return state.nodes[ancestorId].childIds.some((id) => isDescendant(candidateId, id));
}
function reparent(nodeId, newParentId) {
  const node = state.nodes[nodeId]; const oldParent = state.nodes[node.parentId]; const newParent = state.nodes[newParentId];
  if (!oldParent || !newParent || newParent.id === oldParent.id || isDescendant(newParent.id, node.id)) return false;
  oldParent.childIds = oldParent.childIds.filter((id) => id !== node.id); newParent.childIds.push(node.id); newParent.collapsed = false; node.parentId = newParent.id; node.dx = 0; node.dy = 0; touch(oldParent, newParent, node); return true;
}
function pointToMap(clientX, clientY) {
  const rect = $('#mindmap').getBoundingClientRect(); return { x: (clientX - rect.left - viewport.x) / viewport.scale, y: (clientY - rect.top - viewport.y) / viewport.scale };
}
function dropTargetFor(nodeId, clientX, clientY) {
  const point = pointToMap(clientX, clientY);
  return Object.values(state.nodes).find((candidate) => {
    const pos = positions.get(candidate.id);
    return pos && candidate.id !== nodeId && !isDescendant(candidate.id, nodeId) && point.x >= pos.x && point.x <= pos.x + NODE_WIDTH && point.y >= pos.y && point.y <= pos.y + NODE_HEIGHT;
  })?.id ?? null;
}
function onNodePointerDown(event) {
  if (event.button !== 0) return;
  const id = event.currentTarget.dataset.id; state.selectedId = id; const node = state.nodes[id]; const toggle = event.target.classList.contains('collapse-dot') || event.target.classList.contains('collapse-mark');
  $('#canvas').focus({ preventScroll: true }); if (toggle) return toggleCollapse();
  drag = { id, startX: event.clientX, startY: event.clientY, dx: node.dx, dy: node.dy, before: clone(state), moved: false, targetId: null }; event.stopPropagation(); render();
}
function onPointerMove(event) {
  if (drag) {
    const node = state.nodes[drag.id]; const dx = (event.clientX - drag.startX) / viewport.scale; const dy = (event.clientY - drag.startY) / viewport.scale;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3; node.dx = Math.round(drag.dx + dx); node.dy = Math.round(drag.dy + dy); layout(); drag.targetId = drag.moved ? dropTargetFor(drag.id, event.clientX, event.clientY) : null; renderCanvas(); return;
  }
  if (pan) { viewport.x = pan.x + event.clientX - pan.startX; viewport.y = pan.y + event.clientY - pan.startY; clampViewport(); renderCanvas(); }
}
function onPointerUp() {
  if (drag?.moved) {
    const completedDrag = drag; drag = null;
    const didReparent = completedDrag.targetId && reparent(completedDrag.id, completedDrag.targetId);
    if (didReparent) commit(completedDrag.before, '已移动为目标节点的子节点'); else { touch(state.nodes[completedDrag.id]); commit(completedDrag.before, '节点位置已保存'); }
  }
  drag = null; pan = null; $('#canvas').classList.remove('panning');
}
function onCanvasMouseDown(event) {
  if (event.button !== 0 || event.target.closest('.mind-node')) return;
  $('#canvas').focus({ preventScroll: true }); pan = { startX: event.clientX, startY: event.clientY, x: viewport.x, y: viewport.y }; $('#canvas').classList.add('panning');
}
function zoom(amount, anchor) {
  const old = viewport.scale; const next = Math.max(.35, Math.min(2.5, old * amount)); if (next === old) return;
  if (anchor) { const rect = $('#mindmap').getBoundingClientRect(); const x = anchor.clientX - rect.left; const y = anchor.clientY - rect.top; viewport.x = x - ((x - viewport.x) / old) * next; viewport.y = y - ((y - viewport.y) / old) * next; }
  viewport.scale = next; clampViewport(); renderCanvas();
}
function fitView() {
  layout(); const box = bounds(); const canvas = $('#canvas'); const width = Math.max(1, box.maxX - box.minX); const height = Math.max(1, box.maxY - box.minY);
  const scale = Math.max(.35, Math.min(2.5, (canvas.clientWidth - VIEW_PADDING * 2) / width, (canvas.clientHeight - VIEW_PADDING * 2) / height));
  viewport = { scale, x: canvas.clientWidth / 2 - ((box.minX + box.maxX) / 2) * scale, y: canvas.clientHeight / 2 - ((box.minY + box.maxY) / 2) * scale }; clampViewport(); renderCanvas(); setStatus('已适应当前可见导图');
}
function centerNode(id) {
  layout(); const pos = positions.get(id); const canvas = $('#canvas'); if (!pos) return fitView();
  viewport.x = canvas.clientWidth / 2 - (pos.x + NODE_WIDTH / 2) * viewport.scale; viewport.y = canvas.clientHeight / 2 - (pos.y + NODE_HEIGHT / 2) * viewport.scale; clampViewport(); renderCanvas();
}
function selectAndFocus(id) {
  const before = clone(state); let changed = false; let current = state.nodes[id];
  while (current.parentId) { current = state.nodes[current.parentId]; if (current.collapsed) { current.collapsed = false; touch(current); changed = true; } }
  state.selectedId = id; if (changed) { pushHistory(before); save('已展开路径并定位节点'); } render(); centerNode(id); $('#canvas').focus({ preventScroll: true });
}

function filename() { return state.title.trim().replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'mindtree'; }
function download(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
function exportMap() { download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `${filename()}.json`); setStatus('已导出 JSON 备份文件'); }
function exportSvg() {
  layout(); const box = bounds(); const padding = 30; const width = box.maxX - box.minX + padding * 2; const height = box.maxY - box.minY + padding * 2;
  const visual = '<style>.edge{fill:none;stroke:#aabbb7;stroke-width:2}.edge.selected{stroke:#137b73}.mind-node rect{fill:#fff;stroke:#d3ddda;stroke-width:1.5}.mind-node.root rect{fill:#137b73;stroke:#137b73}.mind-node.selected rect{stroke:#e38e2d;stroke-width:3}.mind-node text{fill:#1c2937;font:600 14px system-ui,sans-serif}.mind-node.root text{fill:#fff;font-size:16px}.collapse-dot{fill:#fff;stroke:#137b73;stroke-width:1.5}.collapse-mark{fill:#137b73;font:13px system-ui,sans-serif}</style>';
  const content = $('#edges').outerHTML + $('#nodes').outerHTML; const output = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.minX - padding} ${box.minY - padding} ${width} ${height}">${visual}${content}</svg>`;
  download(new Blob([output], { type: 'image/svg+xml;charset=utf-8' }), `${filename()}.svg`); setStatus('已导出 SVG 图片');
}
function importMap(file) {
  if (!file) return; const reader = new FileReader(); reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result); if (!isValidMap(parsed)) throw new Error('invalid');
      if (!window.confirm('导入将替换当前导图；当前内容可通过 Ctrl/⌘+Z 恢复。是否继续？')) return;
      const before = clone(state); state = normalizeMap(parsed); state.selectedId = state.selectedId in state.nodes ? state.selectedId : rootNode().id; commit(before, '已导入导图；可按 Ctrl/⌘+Z 恢复原内容'); fitView();
    } catch { setStatus('无法识别该 JSON 导图文件；当前导图未被修改', { error: true }); }
  }; reader.readAsText(file); $('#import-map').value = '';
}
function newMap() {
  if (!window.confirm('用新的示例导图替换当前内容？当前内容可通过 Ctrl/⌘+Z 恢复。')) return;
  const before = clone(state); state = exampleMap(); commit(before, '已创建新的示例导图；可撤销'); fitView();
}
function reloadExternalChange() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (!isValidMap(saved)) throw new Error('invalid');
    past.push(clone(state)); state = normalizeMap(saved); future = []; $('#external-change').hidden = true; render(); fitView(); setStatus('已载入另一标签页的最新修改');
  } catch { setStatus('无法载入另一标签页的数据', { error: true }); }
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  $('#external-change').hidden = false; setStatus('检测到另一个标签页修改了这份导图。', { error: true, persistent: true });
});

$('#add-child').onclick = addChild; $('#add-sibling').onclick = addSibling; $('#collapse').onclick = toggleCollapse; $('#delete-node').onclick = deleteSelected; $('#undo').onclick = undo; $('#redo').onclick = redo;
$('#zoom-in').onclick = () => zoom(1.2); $('#zoom-out').onclick = () => zoom(1 / 1.2); $('#fit-view').onclick = fitView; $('#reset-all-positions').onclick = resetAllPositions;
$('#new-map').onclick = newMap; $('#export-map').onclick = exportMap; $('#export-svg').onclick = exportSvg; $('#import-map').onchange = (event) => importMap(event.target.files[0]); $('#reload-external').onclick = reloadExternalChange; $('#ignore-external').onclick = () => { $('#external-change').hidden = true; setStatus('已保留当前标签页内容'); };
$('#search-input').addEventListener('input', renderSearchResults);
$('#map-title').onchange = (event) => { const title = event.target.value.trim() || '未命名导图'; if (title === state.title) return; const before = clone(state); state.title = title; state.updatedAt = now(); commit(before, '导图名称已保存'); };
$('#canvas').addEventListener('mousedown', onCanvasMouseDown); $('#canvas').addEventListener('wheel', (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event); }, { passive: false });
window.addEventListener('mousemove', onPointerMove); window.addEventListener('mouseup', onPointerUp); window.addEventListener('resize', () => fitView());
window.addEventListener('keydown', (event) => {
  const editable = event.target.matches('input, textarea'); const modifier = event.metaKey || event.ctrlKey;
  if (modifier && !editable && event.key.toLowerCase() === 'z') { event.preventDefault(); return event.shiftKey ? redo() : undo(); }
  if (editable || document.activeElement !== $('#canvas')) return;
  if (event.key === 'Tab') { event.preventDefault(); addChild(); } else if (event.key === 'Enter') { event.preventDefault(); addSibling(); } else if (event.key === ' ') { event.preventDefault(); toggleCollapse(); } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); } else if (event.key === '?') { $('#shortcuts').hidden = !$('#shortcuts').hidden; }
});

fitView(); render();
