/* ============================================================
   NovaCompute — Pricing page.
   Reuses the shared catalogue (models-data.js) and renders
   the full price table with filter tabs.
   ============================================================ */

(function () {
  'use strict';

  const tbody = document.getElementById('pricing-tbody');
  const filterWrap = document.getElementById('pricing-filters');
  if (!tbody || !filterWrap || !window.renderModelRow) return;

  function render(filter) {
    const rows = window.NOVA_MODELS.filter((m) =>
      filter === 'all' ? true :
      filter === 'free' ? m.input === 0 && m.output === 0 :
      m.category === filter
    );
    tbody.innerHTML = rows.map(window.renderModelRow).join('');
  }

  filterWrap.querySelectorAll('.filter-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterWrap.querySelectorAll('.filter-tab').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render(btn.dataset.filter);
    });
  });

  render('all');
})();
