(() => {
  'use strict';
  const modes = ['light', 'dark', 'system'];
  const names = {light: 'Светлая', dark: 'Тёмная', system: 'Как на устройстве'};
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { const saved = localStorage.getItem('pcsTheme'); if (modes.includes(saved)) preference = saved; } catch {}
  function apply() {
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#071923' : '#f5f8fa');
    document.querySelectorAll('[data-pcs-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pcsTheme === preference)));
    document.querySelectorAll('[aria-label="Сменить тему"]').forEach(button => button.title = 'Тема: ' + names[preference]);
  }
  function select(mode) {
    if (!modes.includes(mode)) return;
    preference = mode;
    try { localStorage.setItem('pcsTheme', mode); } catch {}
    apply();
  }
  function open() {
    if (typeof window.openSheet !== 'function') return;
    window.openSheet('Оформление', `<div class="pcs-theme-options" role="group" aria-label="Тема интерфейса">${modes.map(mode => `<button type="button" class="btn ghost" data-pcs-theme="${mode}" aria-pressed="${preference === mode}" onclick="pcsThemeController.select('${mode}')">${names[mode]}</button>`).join('')}</div><p class="muted">Системная тема меняется вместе с настройками устройства.</p>`);
  }
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== 'pcsTheme') return;
    preference = modes.includes(event.newValue) ? event.newValue : 'system'; apply();
  });
  window.pcsThemeController = {apply, select, open};
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})();
