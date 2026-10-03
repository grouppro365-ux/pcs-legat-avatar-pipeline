(() => {
  'use strict';
  // Supplied original. Never reconstruct, crop, filter or recolor this asset.
  const LOGO = './assets/pcs-original-logo.png';
  const BRAND = 'Premium Concierge Service Thailand';
  function apply() {
    const title = 'PCS — ' + BRAND;
    if (document.title !== title) document.title = title;
    document.querySelectorAll('.logo,.pcs-ap-logo,.pcs25-script,.in25-brand,.cal25-brand,.pcs-system-brand').forEach(element => {
      let img = element.querySelector('img[data-pcs-original-logo]');
      if (!img) {
        img = document.createElement('img');
        img.dataset.pcsOriginalLogo = '';
        img.src = LOGO;
        img.alt = 'PCS PREMIUM Concierge Service';
        img.decoding = 'async';
        element.replaceChildren(img);
      }
    });
    const login = document.querySelector('.pcs-login-welcome') || document.querySelector('.loginbox');
    if (login && !login.querySelector('.pcs-original-brand')) {
      const brand = document.createElement('div');
      brand.className = 'pcs-original-brand';
      const img = document.createElement('img');
      img.src = LOGO; img.alt = 'PCS PREMIUM Concierge Service';
      brand.append(img); login.prepend(brand);
    }
    document.querySelectorAll('.brand,.loginbox .title').forEach(element => {
      if (element.textContent !== BRAND) element.textContent = BRAND;
    });
    document.querySelectorAll('.loginbox .eyebrow').forEach(element => {
      if (element.textContent !== 'Рабочая панель PCS') element.textContent = 'Рабочая панель PCS';
    });
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener('DOMContentLoaded', apply);
  window.pcsBrand26 = apply;
})();
