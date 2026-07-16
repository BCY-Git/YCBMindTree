/**
 * 画布语义缩放只决定信息密度，不参与节点布局。
 * 阈值成对出现：进入更精简层级要比离开它更深，避免触控板在边界附近抖动。
 */
export type SemanticZoomLevel = 'overview' | 'structure' | 'workspace'

const OVERVIEW_ENTER_ZOOM = 0.52
const OVERVIEW_LEAVE_ZOOM = 0.6
const WORKSPACE_LEAVE_ZOOM = 0.82
const WORKSPACE_ENTER_ZOOM = 0.9
const INITIAL_OVERVIEW_ZOOM = 0.55
const INITIAL_WORKSPACE_ZOOM = 0.86

export const SEMANTIC_ZOOM_STORAGE_KEY = 'mindtree.semantic-zoom-enabled'

export const semanticZoomLevelLabel: Record<SemanticZoomLevel, string> = {
  overview: '概览',
  structure: '结构',
  workspace: '工作',
}

export function resolveSemanticZoomLevel(
  previous: SemanticZoomLevel | null,
  zoom: number,
  enabled: boolean,
): SemanticZoomLevel {
  if (!enabled) return 'workspace'

  if (previous === null) {
    if (zoom < INITIAL_OVERVIEW_ZOOM) return 'overview'
    if (zoom < INITIAL_WORKSPACE_ZOOM) return 'structure'
    return 'workspace'
  }

  if (previous === 'overview') {
    if (zoom >= WORKSPACE_ENTER_ZOOM) return 'workspace'
    return zoom >= OVERVIEW_LEAVE_ZOOM ? 'structure' : 'overview'
  }

  if (previous === 'workspace') {
    if (zoom < OVERVIEW_ENTER_ZOOM) return 'overview'
    return zoom < WORKSPACE_LEAVE_ZOOM ? 'structure' : 'workspace'
  }

  if (zoom < OVERVIEW_ENTER_ZOOM) return 'overview'
  if (zoom >= WORKSPACE_ENTER_ZOOM) return 'workspace'
  return 'structure'
}

export function loadSemanticZoomEnabled(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  return storage.getItem(SEMANTIC_ZOOM_STORAGE_KEY) !== 'false'
}

export function saveSemanticZoomEnabled(enabled: boolean, storage: Pick<Storage, 'setItem'> = window.localStorage) {
  storage.setItem(SEMANTIC_ZOOM_STORAGE_KEY, String(enabled))
}
