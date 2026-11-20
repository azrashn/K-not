// Sohbet kutusu: Enter gönderir, Shift+Enter alt satıra geçer. Yazı yöntemi (IME) ile karakter
// birleştirilirken (ör. aksanlı/Çince-Japonca giriş) Enter onay içindir, gönderme değildir.
export function isSubmitKey(e) {
  if (e.key !== 'Enter') return false
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
  if (e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return false
  return true
}
