type CopyFeedbackOptions = {
  button: HTMLElement | null
  ok: boolean
  originalLabel: string
  successLabel?: string
  failureLabel?: string
  labelElement?: HTMLElement | null
  successClass?: string
  failureClass?: string
  resetClass?: string
  delayMs?: number
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  let ok = false
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = false
    }
  }

  if (!ok) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
  }

  return ok
}

export function showCopyResult({
  button,
  ok,
  originalLabel,
  successLabel,
  failureLabel,
  labelElement,
  successClass = 'copied',
  failureClass = 'failed',
  resetClass,
  delayMs = 1400,
}: CopyFeedbackOptions): void {
  if (!button) return

  const succ = successLabel || window.__I18N.module.copySuccess || 'Copied!'
  const fail = failureLabel || window.__I18N.module.copyFail || 'Copy failed'
  const activeClass = ok ? successClass : failureClass
  const inactiveClass = ok ? failureClass : successClass
  const activeLabel = ok ? succ : fail

  button.classList.remove(inactiveClass)
  if (resetClass) button.classList.remove(resetClass)
  button.classList.add(activeClass)
  button.setAttribute('aria-label', activeLabel)
  button.setAttribute('title', activeLabel)
  if (labelElement) labelElement.textContent = activeLabel

  setTimeout(() => {
    button.classList.remove(activeClass)
    if (resetClass) button.classList.add(resetClass)
    button.setAttribute('aria-label', originalLabel)
    button.setAttribute('title', originalLabel)
    if (labelElement) labelElement.textContent = originalLabel
  }, delayMs)
}
