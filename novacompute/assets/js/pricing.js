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

  let currentFilter = 'all';

  const isFree = (m) => m.input === 0 && m.output === 0;

  function render(filter) {
    const rows = window.NOVA_MODELS.filter((m) =>
      filter === 'all' ? true :
      filter === 'free' ? isFree(m) :
      filter === 'paid' ? !isFree(m) :
      m.category === filter
    );
    tbody.innerHTML = window.renderModelRowsGrouped
      ? window.renderModelRowsGrouped(rows)
      : rows.map(window.renderModelRow).join('');
  }

  const applySourceNote = () => {
    const note = document.getElementById('pricing-note');
    if (!note) return;
    note.textContent = window.NOVA_MODELS_SOURCE === 'live'
      ? 'Prices are per 1M tokens on the standard tier. Failed requests (5xx from our side) are never billed. · synced live from backend · Free tier + TTS subscription included'
      : 'Prices are per 1M tokens on the standard tier. Failed requests (5xx from our side) are never billed. · backend offline — cached catalogue · Free tier + TTS subscription included';
  };

  filterWrap.querySelectorAll('.filter-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      filterWrap.querySelectorAll('.filter-tab').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render(currentFilter);
    });
  });

  render(currentFilter);
  applySourceNote();

  /* Swap in the live catalogue from GET /v1/models (fallback stays if offline) */
  if (window.fetchModels) {
    window.fetchModels().then(() => {
      render(currentFilter);
      applySourceNote();
    });
  }
})();
