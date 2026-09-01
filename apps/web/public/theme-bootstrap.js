try {
  const theme = localStorage.getItem('nexuskb-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // 无法使用本地存储时回退为 CSS 的系统偏好。
}
