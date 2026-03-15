// 开发客户端脚本，用于自动刷新页面
;(() => {
  const es = new EventSource('/__dev/sse')
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      console.log('[Dev Client] Received message:', msg)
      if (msg.type === 'reload') location.reload()
      // TODO: 这里暂时借用 issues-banner 来显示构建状态，后续可以改成更合适的 UI
      if (msg.type === 'building')
        document.getElementById('__issues-banner').textContent = 'building...'
      if (msg.type === 'build-error')
        document.getElementById('__issues-banner').textContent = 'build error!'
    } catch {}
  }
  es.onerror = () => {
    // 尝试重连
    setTimeout(() => {
      location.reload()
    }, 2000)
  }
})()
