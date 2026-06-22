/* ============================================================
   FOURTIFIED — app.js
   APIs:
     1. DummyJSON        → https://dummyjson.com  (replaces FakeStore — more reliable)
     2. ExchangeRate-API → https://open.er-api.com/v6/latest/USD (free, no key)
   ============================================================ */

'use strict';

/* ============================================================
   CONFIG
   ============================================================ */
const API_BASE          = 'https://dummyjson.com';
const EXCHANGE_API_BASE = 'https://open.er-api.com/v6/latest';

/* ── DummyJSON category slugs mapped to our three pages ── */
const CATEGORY_MAP = {
  clothing: {
    mens:   ['mens-shirts', 'tops'],
    womens: ['womens-dresses', 'womens-tops'],
    all:    ['mens-shirts', 'tops', 'womens-dresses', 'womens-tops'],
  },
  electronics: ['smartphones', 'laptops', 'tablets', 'mobile-accessories'],
  jewellery:   ['womens-jewellery', 'mens-watches', 'womens-watches'],
};

/* ── Display label map ── */
const CATEGORY_LABELS = {
  'mens-shirts':        "Men's Clothing",
  'tops':               "Men's Clothing",
  'womens-dresses':     "Women's Clothing",
  'womens-tops':        "Women's Clothing",
  'smartphones':        'Electronics',
  'laptops':            'Electronics',
  'tablets':            'Electronics',
  'mobile-accessories': 'Electronics',
  'womens-jewellery':   'Jewellery',
  'mens-watches':       'Jewellery',
  'womens-watches':     'Jewellery',
};

/* ── Supported currencies ── */
const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$',  label: 'USD — US Dollar'         },
  { code: 'MYR', symbol: 'RM', label: 'MYR — Malaysian Ringgit' },
  { code: 'EUR', symbol: '€',  label: 'EUR — Euro'              },
  { code: 'GBP', symbol: '£',  label: 'GBP — British Pound'     },
  { code: 'SGD', symbol: 'S$', label: 'SGD — Singapore Dollar'  },
  { code: 'JPY', symbol: '¥',  label: 'JPY — Japanese Yen'      },
  { code: 'AUD', symbol: 'A$', label: 'AUD — Australian Dollar' },
  { code: 'CNY', symbol: '¥',  label: 'CNY — Chinese Yuan'      },
];

/* ── State ── */
let _activeCurrency = { code: 'USD', symbol: '$', rate: 1 };
let _exchangeRates  = {};
const _cache        = {};

/* ============================================================
   EXCHANGE RATE API
   Endpoint : https://open.er-api.com/v6/latest/USD
   Free · No key · Updates every 24h
   Response : { result:"success", rates:{ MYR:4.71, EUR:0.92 … } }
   ============================================================ */
async function fetchExchangeRates() {
  if (Object.keys(_exchangeRates).length > 0) return _exchangeRates;
  try {
    const res  = await fetch(`${EXCHANGE_API_BASE}/USD`);
    if (!res.ok) throw new Error(`Exchange API ${res.status}`);
    const data = await res.json();
    if (data.result !== 'success') throw new Error('Exchange API non-success');
    _exchangeRates = data.rates;
    console.info('[FOURTIFIED] Exchange rates loaded —', Object.keys(_exchangeRates).length, 'currencies');
    return _exchangeRates;
  } catch (err) {
    console.warn('[FOURTIFIED] Exchange rate fallback used:', err.message);
    _exchangeRates = { USD:1, MYR:4.71, EUR:0.92, GBP:0.79, SGD:1.35, JPY:149.5, AUD:1.53, CNY:7.24 };
    return _exchangeRates;
  }
}

function convertPrice(usdPrice) {
  return usdPrice * _activeCurrency.rate;
}

function formatPrice(usdPrice) {
  const converted = convertPrice(usdPrice);
  const sym       = _activeCurrency.symbol;
  const decimals  = ['JPY', 'CNY'].includes(_activeCurrency.code) ? 0 : 2;
  return `${sym}${converted.toFixed(decimals)}`;
}

async function switchCurrency(code) {
  const rates    = await fetchExchangeRates();
  const rate     = rates[code] || 1;
  const currInfo = SUPPORTED_CURRENCIES.find(c => c.code === code) || { code, symbol: code, label: code };
  _activeCurrency = { code, symbol: currInfo.symbol, rate };

  const btn = document.getElementById('currency-btn');
  if (btn) btn.querySelector('span') ? btn.querySelector('span').textContent = code : btn.childNodes[0].textContent = code + ' ';

  refreshAllPrices();
  refreshModalPrice();
  refreshSearchPrices();
  const note = document.getElementById('modal-currency-note');
  if (note) note.textContent = code;
  document.getElementById('currency-dropdown')?.classList.remove('open');
  showToast(`Currency switched to ${currInfo.label}`);
}

function refreshAllPrices() {
  document.querySelectorAll('[data-usd-price]').forEach(el => {
    const usd = parseFloat(el.dataset.usdPrice);
    if (!isNaN(usd)) el.textContent = formatPrice(usd);
  });
}
function refreshModalPrice() {
  const modal   = document.getElementById('product-modal');
  if (!modal?.classList.contains('open')) return;
  const priceEl = modal.querySelector('.modal__price-val');
  const usd     = parseFloat(priceEl?.dataset.usdPrice);
  if (!isNaN(usd)) priceEl.textContent = formatPrice(usd);
}
function refreshSearchPrices() {
  document.querySelectorAll('.sri-price[data-usd-price]').forEach(el => {
    const usd = parseFloat(el.dataset.usdPrice);
    if (!isNaN(usd)) el.textContent = formatPrice(usd);
  });
}

/* ============================================================
   DUMMYJSON PRODUCT API LAYER
   Key difference from FakeStore:
     • Response is wrapped: { products: [...], total, skip, limit }
     • Image field is "thumbnail" (+ "images" array)
     • Rating field is "rating" (number, not object)
     • Category is a slug string e.g. "mens-shirts"
   ============================================================ */

/**
 * Normalise a DummyJSON product into our standard shape
 */
function normaliseProduct(raw) {
  return {
    id:          raw.id,
    title:       raw.title,
    price:       raw.price,
    image:       raw.thumbnail || (raw.images?.[0]) || '',
    category:    raw.category,
    description: raw.description,
    rating: {
      rate:  typeof raw.rating === 'number' ? raw.rating : (raw.rating?.rate ?? 0),
      count: raw.reviews?.length ?? raw.stock ?? 0,
    },
    _raw: raw,  // keep original for reference
  };
}

/**
 * Fetch all products across all FOURTIFIED categories.
 * Cached after first call.
 */
async function fetchAllProducts() {
  if (_cache.all) return _cache.all;

  const allSlugs = [
    ...CATEGORY_MAP.clothing.all,
    ...CATEGORY_MAP.electronics,
    ...CATEGORY_MAP.jewellery,
  ];

  // Deduplicate slugs
  const uniqueSlugs = [...new Set(allSlugs)];

  const results = await Promise.allSettled(
    uniqueSlugs.map(slug => fetchBySlug(slug))
  );

  const products = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  _cache.all = products;
  return products;
}

/**
 * Fetch products by a single DummyJSON category slug.
 * Returns normalised products array.
 */
async function fetchBySlug(slug) {
  const key = `slug:${slug}`;
  if (_cache[key]) return _cache[key];

  const res  = await fetch(`${API_BASE}/products/category/${slug}?limit=50`);
  if (!res.ok) throw new Error(`DummyJSON error ${res.status} for ${slug}`);
  const data = await res.json();

  // DummyJSON wraps in { products: [...] }
  const products = (data.products || data).map(normaliseProduct);
  _cache[key] = products;
  return products;
}

/**
 * Fetch products for a page — accepts our page-level category names.
 * @param {'clothing'|'electronics'|'jewellery'} page
 * @param {'all'|'mens'|'womens'} filter  (clothing only)
 */
async function fetchForPage(page, filter = 'all') {
  let slugs = [];

  if (page === 'clothing') {
    slugs = CATEGORY_MAP.clothing[filter] || CATEGORY_MAP.clothing.all;
  } else if (page === 'electronics') {
    slugs = CATEGORY_MAP.electronics;
  } else if (page === 'jewellery') {
    slugs = CATEGORY_MAP.jewellery;
  }

  const results = await Promise.allSettled(slugs.map(s => fetchBySlug(s)));
  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
}

/* ============================================================
   HELPERS
   ============================================================ */
function renderStars(rate, max = 5) {
  const full = Math.min(Math.round(rate), max);
  return '★'.repeat(full) + '☆'.repeat(max - full);
}

function cap(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function showToast(msg) {
  let el = document.getElementById('fourtified-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fourtified-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

/* ============================================================
   SKELETON CARDS
   ============================================================ */
function skeletonCard() {
  const card = document.createElement('div');
  card.className = 'product-card product-card--skeleton';
  card.innerHTML = `
    <div class="product-card__img-wrap"></div>
    <div class="product-card__body">
      <div class="sk-cat"></div>
      <div class="sk-title"></div>
      <div class="product-card__footer"><div class="sk-price"></div></div>
    </div>`;
  return card;
}

function showSkeletons(container, count = 8) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) container.appendChild(skeletonCard());
}

/* ============================================================
   PRODUCT CARD
   ============================================================ */
function createProductCard(product) {
  const card    = document.createElement('div');
  card.className = 'product-card fade-up';
  card.dataset.id = product.id;

  const label = CATEGORY_LABELS[product.category] || cap(product.category);
  const stars = renderStars(product.rating?.rate || 0);

  card.innerHTML = `
    <div class="product-card__img-wrap">
      <img src="${product.image}" alt="${product.title}" loading="lazy" />
    </div>
    <div class="product-card__body">
      <p class="product-card__cat">${label}</p>
      <p class="product-card__title">${product.title}</p>
      <div class="product-card__footer">
        <span class="product-card__price" data-usd-price="${product.price}">${formatPrice(product.price)}</span>
        <span class="product-card__rating">
          <span class="star-filled">${stars}</span>&nbsp;${product.rating?.count ?? 0}
        </span>
      </div>
    </div>`;

  card.addEventListener('click', () => openModal(product));
  return card;
}

/* ============================================================
   PRODUCT MODAL
   ============================================================ */
function openModal(product) {
  const overlay = document.getElementById('product-modal');
  if (!overlay) return;

  const label = CATEGORY_LABELS[product.category] || cap(product.category);
  const stars = renderStars(product.rating?.rate || 0);

  overlay.querySelector('.modal__cat').textContent          = label;
  overlay.querySelector('.modal__title').textContent        = product.title;
  overlay.querySelector('.modal__stars').textContent        = stars;
  overlay.querySelector('.modal__review-count').textContent = `${product.rating?.count ?? 0} reviews`;
  overlay.querySelector('.modal__rate').textContent         = (product.rating?.rate ?? 0).toFixed(1);
  overlay.querySelector('.modal__desc').textContent         = product.description;
  overlay.querySelector('.modal__img').src                  = product.image;
  overlay.querySelector('.modal__img').alt                  = product.title;

  const priceEl             = overlay.querySelector('.modal__price-val');
  priceEl.dataset.usdPrice  = product.price;
  priceEl.textContent       = formatPrice(product.price);

  const usdNoteEl = overlay.querySelector('.modal__usd-note');
  if (usdNoteEl) {
    usdNoteEl.textContent = _activeCurrency.code !== 'USD'
      ? `≈ $${Number(product.price).toFixed(2)} USD`
      : '';
  }

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('product-modal');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function injectModal() {
  if (document.getElementById('product-modal')) return;
  const el = document.createElement('div');
  el.id = 'product-modal';
  el.className = 'modal-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal">
      <div class="modal__img-panel">
        <img class="modal__img" src="" alt="" />
        <button class="modal__close" aria-label="Close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal__info">
        <p class="modal__cat"></p>
        <h2 class="modal__title"></h2>
        <div class="modal__rating">
          <span class="modal__stars star-filled"></span>
          <span class="modal__rate"></span>
          <span style="color:var(--border)">·</span>
          <span class="modal__review-count"></span>
        </div>
        <p class="modal__desc"></p>
        <p class="modal__price">
          <span class="modal__price-val" data-usd-price="0"></span>
          <span class="modal__usd-note" style="font-size:13px;color:var(--ink-muted);font-weight:400;margin-left:6px"></span>
        </p>
        <div class="modal__actions">
          <button class="btn btn--primary btn--full" onclick="handleAddToCart()">Add to Cart</button>
          <button class="btn btn--outline btn--full" onclick="closeModal()">Continue Browsing</button>
        </div>
        <p class="modal__note">🔒 Secure checkout · Free returns · Prices in <span id="modal-currency-note">USD</span></p>
      </div>
    </div>`;

  el.addEventListener('click', e => { if (e.target === el) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  document.body.appendChild(el);
}

function handleAddToCart() {
  const title = document.querySelector('.modal__title')?.textContent || 'Product';
  showToast(`"${title.substring(0, 40)}…" added to cart`);
  closeModal();
}

/* ============================================================
   CURRENCY SWITCHER UI
   ============================================================ */
function injectCurrencySwitcher() {
  if (document.getElementById('currency-switcher')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'currency-switcher';
  wrapper.className = 'currency-switcher';
  wrapper.setAttribute('aria-label', 'Currency selector');
  wrapper.innerHTML = `
    <button id="currency-btn" class="currency-btn" aria-haspopup="listbox" aria-expanded="false">
      USD
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div id="currency-dropdown" class="currency-dropdown" role="listbox" aria-label="Select currency">
      <div class="currency-dropdown__header">Select Currency</div>
      <div class="currency-dropdown__loading" id="currency-loading">
        <span class="currency-loading-dot"></span> Loading rates…
      </div>
      <ul class="currency-list" id="currency-list"></ul>
      <div class="currency-dropdown__footer">
        Powered by ExchangeRate-API · Updated daily
      </div>
    </div>`;

  const navRight = document.querySelector('.nav__inner > div');
  if (navRight) navRight.insertBefore(wrapper, navRight.firstChild);

  document.getElementById('currency-btn').addEventListener('click', e => {
    e.stopPropagation();
    const dropdown = document.getElementById('currency-dropdown');
    const isOpen   = dropdown.classList.toggle('open');
    document.getElementById('currency-btn').setAttribute('aria-expanded', isOpen);
    if (isOpen) populateCurrencyList();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#currency-switcher')) {
      document.getElementById('currency-dropdown')?.classList.remove('open');
      document.getElementById('currency-btn')?.setAttribute('aria-expanded', 'false');
    }
  });
}

async function populateCurrencyList() {
  const listEl    = document.getElementById('currency-list');
  const loadingEl = document.getElementById('currency-loading');
  if (!listEl) return;
  if (listEl.children.length > 0) { loadingEl.style.display = 'none'; return; }

  loadingEl.style.display = 'flex';
  const rates = await fetchExchangeRates();
  loadingEl.style.display = 'none';

  SUPPORTED_CURRENCIES.forEach(cur => {
    const rate = rates[cur.code];
    const li   = document.createElement('li');
    li.className = 'currency-item' + (cur.code === _activeCurrency.code ? ' active' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', cur.code === _activeCurrency.code);
    li.innerHTML = `
      <span class="currency-item__code">${cur.code}</span>
      <span class="currency-item__label">${cur.label.split(' — ')[1]}</span>
      <span class="currency-item__rate">1 USD = ${rate ? rate.toFixed(2) : '—'} ${cur.code}</span>`;
    li.addEventListener('click', () => {
      listEl.querySelectorAll('.currency-item').forEach(i => {
        i.classList.remove('active');
        i.setAttribute('aria-selected', 'false');
      });
      li.classList.add('active');
      li.setAttribute('aria-selected', 'true');
      switchCurrency(cur.code);
    });
    listEl.appendChild(li);
  });
}

/* ============================================================
   NAV
   ============================================================ */
function initNav() {
  const nav          = document.querySelector('.nav');
  const hamburger    = document.querySelector('.nav__hamburger');
  const drawer       = document.querySelector('.nav__drawer');
  const searchToggle = document.querySelector('.nav__search-toggle');
  const searchBar    = document.querySelector('.search-bar');

  window.addEventListener('scroll', () => {
    nav?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  hamburger?.addEventListener('click', () => drawer?.classList.toggle('open'));

  searchToggle?.addEventListener('click', () => {
    const isOpen = searchBar?.classList.toggle('open');
    if (isOpen) document.querySelector('.search-bar input')?.focus();
    else closeSearchDropdown();
  });

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__links a, .nav__drawer a').forEach(a => {
    if (a.getAttribute('href') === currentPage ||
       (currentPage === '' && a.getAttribute('href') === 'index.html')) {
      a.classList.add('active');
    }
  });
}

/* ============================================================
   GLOBAL SEARCH
   ============================================================ */
function initGlobalSearch() {
  const input    = document.querySelector('.search-bar input');
  const dropdown = document.getElementById('search-results-dropdown');
  if (!input || !dropdown) return;

  const noResults = document.getElementById('search-no-results');

  const doSearch = debounce(async (query) => {
    if (!query || query.length < 2) { closeSearchDropdown(); return; }
    try {
      // DummyJSON has a native search endpoint — use it for better results
      const res  = await fetch(`${API_BASE}/products/search?q=${encodeURIComponent(query)}&limit=8`);
      const data = await res.json();
      const matches = (data.products || []).map(normaliseProduct);

      dropdown.innerHTML = '';

      if (matches.length === 0) {
        noResults.style.display = 'block';
        dropdown.appendChild(noResults);
        dropdown.classList.add('open');
        return;
      }

      noResults.style.display = 'none';
      matches.forEach(p => {
        const label = CATEGORY_LABELS[p.category] || cap(p.category);
        const item  = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
          <img src="${p.image}" alt="${p.title}" />
          <div class="sri-info">
            <p class="sri-title">${p.title}</p>
            <p class="sri-cat">${label}</p>
          </div>
          <span class="sri-price" data-usd-price="${p.price}">${formatPrice(p.price)}</span>`;
        item.addEventListener('click', () => {
          closeSearchDropdown();
          document.querySelector('.search-bar')?.classList.remove('open');
          openModal(p);
        });
        dropdown.appendChild(item);
      });

      dropdown.classList.add('open');
    } catch (err) {
      console.warn('Search error:', err);
    }
  }, 350);

  input.addEventListener('input', e => doSearch(e.target.value.trim()));

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-bar') && !e.target.closest('#search-results-dropdown')) {
      closeSearchDropdown();
    }
  });
}

function closeSearchDropdown() {
  document.getElementById('search-results-dropdown')?.classList.remove('open');
}

/* ============================================================
   HOMEPAGE
   ============================================================ */
async function initHomepage() {
  const catGrid      = document.getElementById('cat-grid');
  const featuredGrid = document.getElementById('featured-grid');
  if (!catGrid && !featuredGrid) return;

  try {
    if (featuredGrid) showSkeletons(featuredGrid, 8);

    const all = await fetchAllProducts();

    // Category counts
    if (catGrid) {
      const clothingCount    = CATEGORY_MAP.clothing.all.reduce((n, s) => n + (_cache[`slug:${s}`]?.length || 0), 0);
      const electronicsCount = CATEGORY_MAP.electronics.reduce((n, s) => n + (_cache[`slug:${s}`]?.length || 0), 0);
      const jewelleryCount   = CATEGORY_MAP.jewellery.reduce((n, s) => n + (_cache[`slug:${s}`]?.length || 0), 0);

      const counts = {
        "men's clothing": clothingCount || all.filter(p => CATEGORY_MAP.clothing.all.includes(p.category)).length,
        electronics:       electronicsCount || all.filter(p => CATEGORY_MAP.electronics.includes(p.category)).length,
        jewelery:          jewelleryCount || all.filter(p => CATEGORY_MAP.jewellery.includes(p.category)).length,
      };

      catGrid.querySelectorAll('[data-cat]').forEach(card => {
        const countEl = card.querySelector('.cat-card__count');
        if (countEl && counts[card.dataset.cat] !== undefined) {
          countEl.textContent = `${counts[card.dataset.cat]} products`;
        }
      });
    }

    // Featured grid — show first 8
    if (featuredGrid) {
      featuredGrid.innerHTML = '';
      all.slice(0, 8).forEach((p, i) => {
        const card = createProductCard(p);
        card.style.animationDelay = `${i * 0.06}s`;
        featuredGrid.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Homepage error:', err);
    if (featuredGrid) {
      featuredGrid.innerHTML = '<p style="color:var(--ink-muted);padding:24px 0">Unable to load products. Please try again.</p>';
    }
  }
}

/* ============================================================
   LISTING PAGES  (clothing / electronics / jewellery)
   ============================================================ */
async function initListingPage(pageName) {
  const grid       = document.getElementById('products-grid');
  const countEl    = document.getElementById('product-count');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const sortSel    = document.querySelector('.filter-sort');
  if (!grid) return;

  let allProducts  = [];
  let activeFilter = 'all';
  let activeSort   = 'default';

  showSkeletons(grid, 8);

  // Initial load — fetch everything for this page
  try {
    allProducts = await fetchForPage(pageName, 'all');
  } catch (err) {
    console.error('Listing page error:', err);
    grid.innerHTML = '<p style="color:var(--ink-muted);padding:24px 0">Could not load products. Please check your connection.</p>';
    return;
  }

  function render() {
    let products = allProducts;

    // Filter (clothing only)
    if (pageName === 'clothing' && activeFilter !== 'all') {
      const slugs = CATEGORY_MAP.clothing[activeFilter] || [];
      products = allProducts.filter(p => slugs.includes(p.category));
    }

    // Sort
    if (activeSort === 'price-asc')  products = [...products].sort((a,b) => a.price - b.price);
    if (activeSort === 'price-desc') products = [...products].sort((a,b) => b.price - a.price);
    if (activeSort === 'rating')     products = [...products].sort((a,b) => (b.rating?.rate||0) - (a.rating?.rate||0));
    if (activeSort === 'popular')    products = [...products].sort((a,b) => (b.rating?.count||0) - (a.rating?.count||0));

    grid.innerHTML = '';
    products.forEach((p, i) => {
      const card = createProductCard(p);
      card.style.animationDelay = `${i * 0.04}s`;
      grid.appendChild(card);
    });

    if (countEl) countEl.innerHTML = `Showing <strong>${products.length}</strong> products`;
  }

  // Filter tab clicks (clothing only)
  filterTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter || 'all';
      render();
    });
  });

  // Sort
  sortSel?.addEventListener('change', e => { activeSort = e.target.value; render(); });

  render();
}

/* ============================================================
   PAGE INIT ROUTER
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  injectModal();
  initNav();
  injectCurrencySwitcher();
  initGlobalSearch();

  // Pre-fetch exchange rates silently
  fetchExchangeRates();

  const page = window.location.pathname.split('/').pop() || 'index.html';

  if (page === 'index.html' || page === '')   initHomepage();
  if (page === 'clothing.html')               initListingPage('clothing');
  if (page === 'electronics.html')            initListingPage('electronics');
  if (page === 'jewellery.html')              initListingPage('jewellery');
});