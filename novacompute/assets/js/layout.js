/* ============================================================
   NovaCompute — Shared layout: sticky header + global footer.
   Any page opts in by including:
     <div id="site-header"></div>   (top of <body>)
     <div id="site-footer"></div>   (bottom of <body>)
   and loading this script. Pure static markup, no backend.
   ============================================================ */

(function () {
  'use strict';

  const currentPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isHome = currentPage === '' || currentPage === 'index.html';
  const homePrefix = isHome ? '' : 'index.html';

  /* Brand mark — 4-point "nova" star. Unique gradient id per usage. */
  function logoSvg(idSuffix, size) {
    return `
      <svg viewBox="0 0 24 24" class="${size || 'h-7 w-7'}" aria-hidden="true">
        <defs>
          <linearGradient id="nova-g-${idSuffix}" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stop-color="#a78bfa"></stop>
            <stop offset="0.55" stop-color="#6366f1"></stop>
            <stop offset="1" stop-color="#22d3ee"></stop>
          </linearGradient>
        </defs>
        <path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9-7.9-2.6 7.9-2.6L12 1.5z" fill="url(#nova-g-${idSuffix})"></path>
      </svg>`;
  }

  /* ---------------- Header ---------------- */
  const headerRoot = document.getElementById('site-header');
  if (headerRoot) {
    const NAV = [
      { label: 'Features', href: `${homePrefix}#features` },
      { label: 'Models', href: `${homePrefix}#models` },
      { label: 'Pricing', href: 'pricing.html', page: 'pricing.html' },
      { label: 'Docs', href: 'docs.html', page: 'docs.html' },
    ];

    headerRoot.innerHTML = `
    <header class="nav-shell sticky top-0 z-50 border-b border-white/[0.06] bg-night/70 backdrop-blur-xl">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="index.html" class="group flex items-center gap-2.5" aria-label="NovaCompute — home">
          ${logoSvg('hd')}
          <span class="font-display text-lg font-semibold tracking-tight text-white">
            Nova<span class="text-gradient">Compute</span>
          </span>
        </a>

        <nav class="hidden items-center gap-1 md:flex" aria-label="Primary">
          ${NAV.map((l) => `
            <a href="${l.href}"
               class="rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${l.page === currentPage ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}">
              ${l.label}
            </a>`).join('')}
        </nav>

        <div class="hidden items-center gap-3 md:flex">
          <a href="login.html" class="btn-ghost rounded-lg px-4 py-2 text-sm font-medium text-slate-200">Sign In</a>
          <a href="register.html" class="btn-primary rounded-lg px-4 py-2 text-sm font-semibold text-white">Get Started</a>
        </div>

        <button id="nav-toggle" type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 md:hidden"
                aria-label="Toggle navigation" aria-expanded="false" aria-controls="mobile-menu">
          <svg id="icon-open" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
          <svg id="icon-close" class="hidden h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>

      <div id="mobile-menu" class="hidden border-t border-white/[0.06] md:hidden">
        <nav class="flex flex-col gap-1 px-6 py-4" aria-label="Mobile">
          ${NAV.map((l) => `
            <a href="${l.href}"
               class="rounded-lg px-3 py-2.5 text-sm font-medium ${l.page === currentPage ? 'bg-white/[0.06] text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}">
              ${l.label}
            </a>`).join('')}
          <div class="mt-3 flex gap-3 border-t border-white/[0.06] pt-4">
            <a href="login.html" class="btn-ghost flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-medium text-slate-200">Sign In</a>
            <a href="register.html" class="btn-primary flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-white">Get Started</a>
          </div>
        </nav>
      </div>
    </header>`;

    /* position:sticky only sticks within its parent — unwrap the <header>
       so it becomes a direct child of <body> and stays pinned on scroll */
    const headerEl = headerRoot.querySelector('header');
    headerRoot.replaceWith(headerEl);

    /* Mobile menu toggle */
    const toggle = document.getElementById('nav-toggle');
    const menu = document.getElementById('mobile-menu');
    const iconOpen = document.getElementById('icon-open');
    const iconClose = document.getElementById('icon-close');
    toggle.addEventListener('click', () => {
      const isOpen = !menu.classList.toggle('hidden');
      iconOpen.classList.toggle('hidden', isOpen);
      iconClose.classList.toggle('hidden', !isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    /* Shadow the bar once the page is scrolled */
    const shell = headerEl;
    const onScroll = () => shell.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- Footer ---------------- */
  const footerRoot = document.getElementById('site-footer');
  if (footerRoot) {
    const COLUMNS = [
      {
        title: 'Product',
        links: [
          { label: 'Models', href: 'index.html#models' },
          { label: 'Playground', href: 'playground.html' },
          { label: 'Pricing', href: 'pricing.html' },
          { label: 'API Docs', href: 'docs.html' },
          { label: 'Dashboard', href: 'dashboard.html' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'About', href: '#' },
          { label: 'Blog', href: '#' },
          { label: 'Careers', href: '#' },
          { label: 'Contact', href: '#' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { label: 'Privacy Policy', href: '#' },
          { label: 'Terms of Service', href: '#' },
          { label: 'Security', href: '#' },
          { label: 'DPA', href: '#' },
        ],
      },
    ];

    const SOCIALS = [
      { name: 'GitHub', d: 'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z' },
      { name: 'X', d: 'M18.9 2H22l-6.77 7.74L23.2 22h-6.23l-4.88-6.38L6.5 22H3.35l7.24-8.28L2.4 2h6.39l4.41 5.83L18.9 2zm-1.1 18.1h1.72L7.05 3.8H5.2l12.6 16.3z' },
      { name: 'Discord', d: 'M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28h-.05A19.74 19.74 0 0 0 3.64 4.4 20.26 20.26 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.04 3.03c.46-.62.87-1.28 1.22-1.97-.67-.25-1.31-.56-1.92-.92.16-.12.32-.24.47-.36a14.2 14.2 0 0 0 12.16 0c.15.13.31.25.47.36-.61.36-1.25.67-1.92.92.35.7.76 1.35 1.22 1.97a19.84 19.84 0 0 0 6.04-3.03 20.24 20.24 0 0 0-3.56-13.69zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.33-.95 2.42-2.16 2.42z' },
      { name: 'LinkedIn', d: 'M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z' },
    ];

    footerRoot.innerHTML = `
    <footer class="relative overflow-hidden border-t border-white/[0.06] bg-night-900/40">
      <div class="orb left-1/2 top-[-140px] h-[260px] w-[560px] -translate-x-1/2" style="background:rgba(124,58,237,.12)"></div>

      <div class="relative mx-auto max-w-7xl px-6 py-16">
        <div class="grid gap-12 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <a href="index.html" class="flex items-center gap-2.5">
              ${logoSvg('ft')}
              <span class="font-display text-lg font-semibold tracking-tight text-white">Nova<span class="text-gradient">Compute</span></span>
            </a>
            <p class="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              One API key for 50+ frontier models — routed for speed and reliability, billed per token.
            </p>
            <div class="mt-6 flex gap-2.5">
              ${SOCIALS.map((s) => `
                <a href="#" aria-label="${s.name}"
                   class="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:text-white">
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${s.d}"></path></svg>
                </a>`).join('')}
            </div>
            <a href="#" class="mt-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3.5 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-400/[0.12]">
              <span class="relative flex h-2 w-2">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
                <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
              </span>
              All systems operational
            </a>
          </div>

          ${COLUMNS.map((col) => `
            <div>
              <h3 class="text-sm font-semibold text-white">${col.title}</h3>
              <ul class="mt-5 space-y-3">
                ${col.links.map((l) => `
                  <li><a href="${l.href}" class="text-sm text-slate-400 transition-colors hover:text-white">${l.label}</a></li>
                `).join('')}
              </ul>
            </div>`).join('')}
        </div>

        <div class="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row">
          <p class="text-sm text-slate-500">© 2026 NovaCompute, Inc. All rights reserved.</p>
          <p class="text-xs text-slate-600">SOC 2 Type II · GDPR ready · 99.9% uptime SLA</p>
        </div>
      </div>
    </footer>`;
  }
})();
