const DATA_URL = 'data/glossary.json';
let dataPromise = null; // кэш промиса загрузки "БД"


const state = {
  search: '',
  domain: '',
  favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
  viewFavorites: false,
  cache: new Map(), // кэшируем ответы API
};

document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  initTheme();
  attachEvents();

  try {
    await loadDomains();
    await runQuery();
  } catch (e) {
    showError(e);
  }
});

function initTheme() {
  const isDark =
    localStorage.getItem('theme') === 'dark' ||
    (!localStorage.getItem('theme') &&
      matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', isDark);

  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  toggle.checked = isDark;
  moveToggle(isDark);

  toggle.addEventListener('change', (e) => {
    const on = e.target.checked;
    document.documentElement.classList.toggle('dark', on);
    localStorage.setItem('theme', on ? 'dark' : 'light');
    moveToggle(on);
  });

  function moveToggle(on) {
    const c = document.querySelector('.toggle-circle');
    if (c) c.style.transform = on ? 'translateX(1.5rem)' : 'translateX(0)';
  }
}

function attachEvents() {
  const search = document.getElementById('search');
  const domain = document.getElementById('domain');
  const clear = document.getElementById('btn-clear');
  const randomBtn = document.getElementById('btn-random');
  const favViewBtn = document.getElementById('btn-favorites-view');

  updateFavToggleUI();

  search.addEventListener(
    'input',
    debounce(() => {
      state.search = search.value.trim();
      runQuery();
    }, 250)
  );

  domain.addEventListener('change', () => {
    state.domain = domain.value;
    runQuery();
  });

  clear.addEventListener('click', () => {
    state.search = '';
    state.domain = '';
    state.viewFavorites = false;
    search.value = '';
    domain.value = '';
    document.getElementById('spotlight').classList.add('hidden');
    updateFavToggleUI();
    runQuery();
  });

  randomBtn.addEventListener('click', onRandom);

  favViewBtn.addEventListener('click', () => {
    state.viewFavorites = !state.viewFavorites;
    updateFavToggleUI();
    runQuery();
  });
}

function updateFavToggleUI() {
  const btn = document.getElementById('btn-favorites-view');
  const label = btn.querySelector('span');
  const icon = btn.querySelector('i');

  btn.classList.toggle('btn-primary', state.viewFavorites);
  btn.title = state.viewFavorites ? 'Показать все термины' : 'Показать избранное';

  if (label) label.textContent = state.viewFavorites ? 'Все термины' : 'Избранное';
  if (icon) icon.setAttribute('data-lucide', state.viewFavorites ? 'list' : 'star');

  lucide.createIcons();
}

function showError(err) {
  const msg = extractErrorMessage(err);
  console.error('[App Error]', msg, err);
  const bar = document.getElementById('error-bar');
  document.getElementById('error-text').textContent = msg;
  bar.classList.remove('hidden');
}

function extractErrorMessage(err) {
  if (!err) return 'Неизвестная ошибка';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ===== API helpers =====

async function loadData() {
  if (!dataPromise) {
    dataPromise = (async () => {
      const res = await fetch(DATA_URL);
      if (!res.ok) {
        throw new Error(`Не удалось загрузить БД: ${res.status} ${res.statusText}`);
      }
      return res.json();
    })();
  }
  return dataPromise;
}

// Эмуляция API поверх статического JSON
async function apiGet(params = {}) {
  const data = await loadData();
  const items = Array.isArray(data.items) ? data.items : [];
  const q = (params.q || '').trim().toLowerCase();
  const domain = (params.domain || '').trim();

  // 1) Только список доменов
  if (params.domains) {
    const domains = Array.from(
      new Set(
        items
          .map((i) => i.domain)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'ru'));
    return { domains };
  }

  // 2) Фильтрация по домену и поиску
  let rows = items;

  if (domain) {
    rows = rows.filter((item) => item.domain === domain);
  }

  if (q) {
    rows = rows.filter((item) => {
      const fields = [
        item.name || '',
        item.abbr || '',
        item.definition || '',
      ];
      return fields.some((f) => f.toLowerCase().includes(q));
    });
  }

  // 3) Случайный термин
  if (params.random) {
    if (!rows.length) return { item: null };
    const idx = Math.floor(Math.random() * rows.length);
    return { item: rows[idx] };
  }

  // 4) Обычный список терминов
  return { items: rows };
}



async function loadDomains() {
  try {
    const data = await apiGet({ domains: 1 });
    const domains = (data.domains || []).filter(Boolean);
    const select = document.getElementById('domain');

    domains.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      select.appendChild(opt);
    });
  } catch (e) {
    showError(e);
  }
}

async function runQuery() {
  if (state.viewFavorites && state.favorites.size === 0) {
    state.viewFavorites = false;
    updateFavToggleUI();
  }

  const key = JSON.stringify({
    q: state.search,
    d: state.domain,
    fav: state.viewFavorites,
  });

  if (!state.viewFavorites) {
    const cached = state.cache.get(key);
    if (cached) {
      renderResults(cached);
      return;
    }
  }

  let data;
  try {
    data = await apiGet({
      q: state.search || '',
      domain: state.domain || '',
    });
  } catch (e) {
    showError(e);
    data = { items: [] };
  }

  let rows = data.items || [];

  if (state.viewFavorites) {
    const favIds = new Set([...state.favorites]);
    rows = rows.filter((r) => favIds.has(r.id));
  }

  if (!state.viewFavorites) {
    state.cache.set(key, rows);
  }

  renderResults(rows);
}

async function onRandom() {
  try {
    const data = await apiGet({
      random: 1,
      domain: state.domain || '',
    });

    const row = data.item || null;
    showSpotlight(row);
  } catch (e) {
    showError(e);
  }
}

function showSpotlight(row) {
  const box = document.getElementById('spotlight');
  if (!row) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  document.getElementById('spotlight-title').textContent =
    row.name + (row.abbr ? ` (${row.abbr})` : '');
  document.getElementById('spotlight-domain').textContent = row.domain || '—';
  document.getElementById('spotlight-definition').textContent =
    row.definition || '';

  const favBtn = document.getElementById('spotlight-fav');
  favBtn.dataset.id = row.id;
  setFavButtonState(favBtn, state.favorites.has(row.id));
  favBtn.onclick = () => toggleFavorite(row.id, favBtn);

  lucide.createIcons();
}

function renderResults(rows) {
  const grid = document.getElementById('results');
  grid.innerHTML = '';

  document.getElementById('count').textContent = rows.length
    ? `${rows.length} термин(ов)`
    : '';
  document
    .getElementById('empty')
    .classList.toggle('hidden', rows.length !== 0);

  rows.forEach((row) => {
    const card = document.createElement('article');
    card.className = 'card p-4 flex flex-col gap-2';
    card.innerHTML = `
      <div class="flex items-start gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-base title-ellipsis" data-title="${escapeHtml(
              row.name
            )}">
              ${escapeHtml(row.name)}
            </h3>
            ${
              row.abbr
                ? `<span class="chip">${escapeHtml(row.abbr)}</span>`
                : ''
            }
            <span class="chip">${escapeHtml(row.domain || '—')}</span>
          </div>
          <p class="text-sm text-slate-700 dark:text-slate-300">${escapeHtml(
            row.definition || ''
          )}</p>
        </div>
        <button class="btn px-2 py-1 shrink-0 self-start" data-id="${
          row.id
        }" title="В избранное">
          <i data-lucide="star" class="w-4 h-4"></i>
        </button>
      </div>`;

    const favBtn = card.querySelector('button[data-id]');
    setFavButtonState(favBtn, state.favorites.has(row.id));
    favBtn.addEventListener('click', () => toggleFavorite(row.id, favBtn));

    grid.appendChild(card);
  });

  lucide.createIcons();
}

function setFavButtonState(btn, isFav) {
  btn.classList.toggle('btn-primary', isFav);
  btn.title = isFav ? 'Убрать из избранного' : 'В избранное';
}

function toggleFavorite(id, btn) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);

  localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
  if (btn) setFavButtonState(btn, state.favorites.has(id));

  state.cache.clear();
  runQuery();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m])
  );
}
