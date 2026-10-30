/* 在首帧渲染前应用深色主题，避免闪白/闪色。放在 <head> 中同步执行。 */
(function () {
  try {
    var saved = localStorage.getItem('setutime_dark_mode');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'true' || (saved === null && prefersDark)) {
      document.documentElement.classList.add('dark-theme');
      var meta = document.getElementById('meta-theme-color');
      if (meta) meta.setAttribute('content', '#111827');
    }
  } catch (error) {
    /* localStorage 不可用时忽略，保持默认浅色主题 */
  }
})();
