import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CheckIcon, ChevronDownIcon, PlusIcon } from '@radix-ui/react-icons'
import type { AiSettings } from './ai-settings'
import { getModelOptions, modelOptionKey, modelServiceLabel } from './model-options'
import './model-selector.css'

export function ModelSelector({ settings, connections, disabled, onSelect, onConfigure }: {
  settings: AiSettings
  connections: AiSettings[]
  disabled: boolean
  onSelect: (settings: AiSettings) => void
  onConfigure: () => void
}) {
  const options = getModelOptions(settings, connections)
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="ai-model-trigger" disabled={disabled} aria-label={`选择模型，当前 ${settings.model || '未配置'}`} title={settings.model}>
        <span className="ai-model-trigger__dot" aria-hidden="true" /><span>{settings.model || '选择模型'}</span><ChevronDownIcon />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="ai-model-menu" side="top" align="end" sideOffset={8} collisionPadding={12} aria-label="选择 AI 模型">
        <DropdownMenu.Label className="ai-model-menu__label">选择模型</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={modelOptionKey(settings)} onValueChange={(key) => {
          const option = options.find((item) => modelOptionKey(item) === key)
          if (option) onSelect(option)
        }}>
          {options.map((option) => <DropdownMenu.RadioItem key={modelOptionKey(option)} value={modelOptionKey(option)} className="ai-model-menu__item">
            <div><strong>{option.model}</strong><small>{modelServiceLabel(option.endpoint)}</small></div>
            <DropdownMenu.ItemIndicator><CheckIcon /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator className="ai-model-menu__separator" />
        <DropdownMenu.Item className="ai-model-menu__item ai-model-menu__configure" onSelect={onConfigure}><PlusIcon />添加 / 管理模型</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
