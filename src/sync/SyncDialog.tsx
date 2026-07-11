import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { PairingInvite, RemoteDocument, SyncConfig } from './sync-client'

type SyncDialogProps = {
  open: boolean
  config: SyncConfig
  remoteVersion: number | null
  status: string | null
  remotePreview: RemoteDocument | null
  conflict: RemoteDocument | null
  busy: boolean
  onClose: () => void
  onSaveConfig: (config: SyncConfig) => void
  onPush: (config: SyncConfig) => void
  onCheckPull: (config: SyncConfig) => void
  onConfirmPull: () => void
  onCreatePairing: (config: SyncConfig) => Promise<PairingInvite>
  onRedeemPairing: (invite: PairingInvite) => Promise<SyncConfig>
}

type BarcodeDetectorLike = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> }
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike

function parseInvite(value: string): PairingInvite {
  const parsed = JSON.parse(value) as Partial<PairingInvite>
  if (parsed.type !== 'mindtree-pairing-v1' || typeof parsed.serverUrl !== 'string' || typeof parsed.pairingId !== 'string' || typeof parsed.secret !== 'string' || typeof parsed.expiresAt !== 'number') {
    throw new Error('不是有效的 MindTree 配对二维码')
  }
  if (parsed.expiresAt <= Date.now()) throw new Error('配对二维码已过期，请在原设备重新生成')
  return parsed as PairingInvite
}

export function SyncDialog({ open, config, remoteVersion, status, remotePreview, conflict, busy, onClose, onSaveConfig, onPush, onCheckPull, onConfirmPull, onCreatePairing, onRedeemPairing }: SyncDialogProps) {
  const [draft, setDraft] = useState(config)
  const [invite, setInvite] = useState<PairingInvite | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [pairingStatus, setPairingStatus] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => setDraft(config), [config, open])
  useEffect(() => {
    if (!invite) { setQrUrl(null); return }
    QRCode.toDataURL(JSON.stringify(invite), { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(setQrUrl).catch(() => setPairingStatus('二维码生成失败，请重试。'))
  }, [invite])

  const redeem = useCallback(async (raw: string) => {
    try {
      setPairingBusy(true)
      const nextInvite = parseInvite(raw)
      setDraft(await onRedeemPairing(nextInvite))
      setPairingStatus('配对成功，服务地址和 Token 已保存到此浏览器。')
      setScannerOpen(false)
    } catch (error) {
      setPairingStatus(error instanceof Error ? error.message : '扫码配对失败')
    } finally {
      setPairingBusy(false)
    }
  }, [onRedeemPairing])

  useEffect(() => {
    if (!scannerOpen) return
    let stream: MediaStream | null = null
    let timer: number | null = null
    let active = true
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setPairingStatus('当前浏览器不支持直接扫码；可用系统扫码工具识别二维码后，将内容粘贴到下方。')
      return
    }
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        if (!active || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new Detector({ formats: ['qr_code'] })
        timer = window.setInterval(() => {
          const video = videoRef.current
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
          void detector.detect(video).then((codes) => {
            const raw = codes[0]?.rawValue
            if (raw && active) void redeem(raw)
          }).catch(() => undefined)
        }, 420)
      } catch {
        setPairingStatus('无法打开摄像头。请允许相机权限，或改用粘贴配对码。')
      }
    })()
    return () => {
      active = false
      if (timer !== null) window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [redeem, scannerOpen])

  if (!open) return null
  const save = () => onSaveConfig({ serverUrl: draft.serverUrl.trim(), token: draft.token.trim() })
  const ready = Boolean(draft.serverUrl.trim() && draft.token.trim())
  const preview = conflict ?? remotePreview

  const createPairing = async () => {
    try {
      setPairingBusy(true)
      setPairingStatus(null)
      setInvite(await onCreatePairing({ serverUrl: draft.serverUrl.trim(), token: draft.token.trim() }))
      setPairingStatus('请用新设备扫码。二维码 5 分钟内有效，且只能使用一次。')
    } catch (error) {
      setPairingStatus(error instanceof Error ? error.message : '创建配对二维码失败')
    } finally {
      setPairingBusy(false)
    }
  }

  return (
    <div className="sync-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <header><div><p className="eyebrow">云端同步</p><h2 id="sync-title">手动、安全地同步</h2></div><button className="sync-dialog__close" onClick={onClose} aria-label="关闭同步设置">×</button></header>
        <p className="sync-dialog__intro">默认连接你的 MindTree 同步服务；只需填写 Token。上传与拉取均需手动触发，版本冲突时不会覆盖本地内容。</p>
        <label>同步服务地址
          <input value={draft.serverUrl} onChange={(event) => setDraft((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="https://sync.example.com" autoComplete="url" />
        </label>
        <label>同步 Token
          <input value={draft.token} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder="仅保存在此浏览器" type="password" autoComplete="off" />
        </label>
        <div className="sync-dialog__actions">
          <button className="subtle-button" onClick={save}>保存连接设置</button>
          <span>{remoteVersion === null ? '此导图尚未同步' : `云端版本 v${remoteVersion}`}</span>
        </div>
        <div className="sync-dialog__transfer-actions">
          <button disabled={!ready || busy} onClick={() => onPush(draft)}>{busy ? '同步中…' : '上传本地版本'}</button>
          <button className="sync-dialog__secondary" disabled={!ready || busy} onClick={() => onCheckPull(draft)}>检查云端版本</button>
        </div>
        <div className="sync-dialog__pairing-actions">
          <button className="sync-dialog__secondary" disabled={!ready || pairingBusy} onClick={() => void createPairing()}>生成配对二维码</button>
          <button className="sync-dialog__secondary" disabled={pairingBusy} onClick={() => setScannerOpen((current) => !current)}>{scannerOpen ? '关闭扫码' : '扫码导入'}</button>
        </div>
        {invite && qrUrl && <div className="sync-dialog__pairing-card"><img src={qrUrl} alt="MindTree 一次性设备配对二维码" /><p>仅用于新设备配对；有效期至 {new Date(invite.expiresAt).toLocaleTimeString()}。</p></div>}
        {scannerOpen && <div className="sync-dialog__scanner"><video ref={videoRef} muted playsInline aria-label="扫描 MindTree 配对二维码" /><textarea value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder="摄像头不可用时，在此粘贴扫码结果" /><button className="sync-dialog__secondary" disabled={!pasteValue.trim() || pairingBusy} onClick={() => void redeem(pasteValue)}>导入配对码</button></div>}
        {(status || pairingStatus) && <p className="sync-dialog__status" role="status">{pairingStatus ?? status}</p>}
        {preview && <div className={`sync-dialog__preview ${conflict ? 'is-conflict' : ''}`}>
          <strong>{conflict ? '检测到版本冲突' : '发现云端版本'}</strong>
          <p>云端 v{preview.version} · {preview.payload.title} · {Object.keys(preview.payload.nodes).length} 个节点</p>
          <small>{conflict ? '本地内容尚未被修改。拉取前会自动创建一份本地备份。' : '确认后将拉取云端内容，并先创建本地备份。'}</small>
          <button disabled={busy} onClick={onConfirmPull}>确认拉取云端版本</button>
        </div>}
      </section>
    </div>
  )
}
