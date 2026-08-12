// 将历史默认间距平滑迁移到更紧凑的默认值。
// 仅通过应用自身的受控滑杆派发更新，因此会正常写入当前浏览器的数据存储；
// 用户已手动配置过的间距不会满足旧默认值条件，不会被改动。
(() => {
  const legacy = ['96', '22']
  const compact = ['80', '16']
  const deadline = Date.now() + 8000
  let applied = false
  let openedInspector = false
  let selectedMapTab = false
  let readyAt = 0

  const setValue = (input, value) => {
    const previous = input.value
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    // React 会缓存控件值；把缓存暂时恢复到旧值，才能使真实 input 事件被识别为变更。
    input._valueTracker?.setValue(previous)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const migrate = () => {
    if (applied) return true
    if (!document.querySelector('.react-flow')) return false
    if (!readyAt) {
      readyAt = Date.now() + 360
      return false
    }
    if (Date.now() < readyAt) return false
    const inputs = Array.from(document.querySelectorAll('.layout-controls input[type="range"]'))
    if (inputs.length < 2) {
      if (!openedInspector) {
        const inspectorButton = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '打开节点属性')
        inspectorButton?.click()
        openedInspector = Boolean(inspectorButton)
      } else if (!selectedMapTab) {
        const mapTab = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '图谱')
        mapTab?.click()
        selectedMapTab = Boolean(mapTab)
      }
      return false
    }
    if (inputs[0].value !== legacy[0] || inputs[1].value !== legacy[1]) return true
    setValue(inputs[0], compact[0])
    setValue(inputs[1], compact[1])
    applied = true
    if (openedInspector) window.setTimeout(() => {
      Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '打开节点属性')?.click()
    }, 0)
    return true
  }

  const observer = new MutationObserver(() => { if (migrate()) observer.disconnect() })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  const timer = window.setInterval(() => {
    if (migrate() || Date.now() >= deadline) {
      window.clearInterval(timer)
      observer.disconnect()
    }
  }, 160)
})()
