import { copyTextToClipboard, showCopyResult } from './clipboard'

function getShareUrl(): string {
  const pageBase = window.PAGE_BASE || ''
  const pagePath = window.PAGE_PATH === '/about/' ? '/' : window.PAGE_PATH || '/'
  return window.location.origin + pageBase + pagePath
}

function initNativeShare(nativeRow: HTMLElement | null, nativeBtn: HTMLButtonElement | null): void {
  if (!nativeRow || !nativeBtn) return

  if (navigator.share) {
    nativeRow.hidden = false
    nativeBtn.onclick = () => {
      navigator.share({ title: document.title, url: location.href }).catch(() => { /* empty */ })
    }
    return
  }

  nativeRow.hidden = true
  nativeBtn.onclick = null
}

function openShareModal(): void {
  const modal = document.getElementById('share-modal') as HTMLDialogElement | null
  const urlInput = document.getElementById('share-url-input') as HTMLInputElement | null
  const copyBtn = document.getElementById('share-copy-btn') as HTMLButtonElement | null
  const copyLabel = document.getElementById('share-copy-label')
  const nativeRow = document.getElementById('share-native-row')
  const nativeBtn = document.getElementById('share-native-btn') as HTMLButtonElement | null
  if (!modal || !urlInput || !copyBtn || !copyLabel) return

  const i18n = window.__I18N
  const copyUrlText = i18n.base.shareCopyUrl || 'Copy URL'
  const copyOkText = i18n.module.copySuccess || 'Copied!'
  const copyFailText = i18n.module.copyFail || 'Copy failed'

  urlInput.value = getShareUrl()
  copyLabel.textContent = copyUrlText
  copyBtn.classList.remove('btn-success')
  copyBtn.classList.add('btn-outline')
  copyBtn.setAttribute('aria-label', copyUrlText)
  copyBtn.setAttribute('title', copyUrlText)

  initNativeShare(nativeRow, nativeBtn)

  copyBtn.onclick = async () => {
    const ok = await copyTextToClipboard(urlInput.value)
    showCopyResult({
      button: copyBtn,
      ok,
      originalLabel: copyUrlText,
      successLabel: copyOkText,
      failureLabel: copyFailText,
      labelElement: copyLabel,
      successClass: 'btn-success',
      failureClass: 'failed',
      resetClass: 'btn-outline',
      delayMs: 2000,
    })
  }

  modal.showModal()
}

function initShareModal(): void {
  const modal = document.getElementById('share-modal') as HTMLDialogElement | null
  if (!modal) return

  modal.querySelector('.share-dialog-close')?.addEventListener('click', () => modal.close())
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close()
  })
}

window.openShareModal = openShareModal
initShareModal()
