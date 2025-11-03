const api = {
  normalizeLink(raw) {
    if (!raw) return '';
    const v = String(raw).trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return `https://${v}`;
  },
  async listWishlists() {
    const res = await fetch('/api/wishlists');
    return res.json();
  },
  // Trash API
  async listTrash() {
    const res = await fetch('/api/trash');
    return res.json();
  },
  async restoreFromTrash(file) {
    const res = await fetch(`/api/trash/${encodeURIComponent(file)}/restore`, { method: 'POST' });
    return res.json();
  },
  async removeFromTrash(file) {
    const res = await fetch(`/api/trash/${encodeURIComponent(file)}` , { method: 'DELETE' });
    return res.json();
  },
  async deleteWishlist(id) {
    const res = await fetch(`/api/wishlists/${id}`, { method: 'DELETE' });
    return res.json();
  },
  async createWishlist(title = 'Новый вишлист') {
    const res = await fetch('/api/wishlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, items: [] }) });
    return res.json();
  },
  async getWishlist(id) {
    const res = await fetch(`/api/wishlists/${id}`);
    if (res.status === 404) return null;
    return res.json();
  },
  async saveTitle(id, title) {
    const res = await fetch(`/api/wishlists/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    return res.json();
  },
  async addItem(id, text) {
    const res = await fetch(`/api/wishlists/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return res.json();
  },
  async addItemWithLink(id, text, link) {
    const res = await fetch(`/api/wishlists/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, link: this.normalizeLink(link) }) });
    return res.json();
  },
  async updateItem(id, itemId, payload) {
    const body = { ...payload };
    if (Object.prototype.hasOwnProperty.call(body, 'link')) {
      body.link = this.normalizeLink(body.link);
    }
    const res = await fetch(`/api/wishlists/${id}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  },
  async listVersions(id) {
    const res = await fetch(`/api/wishlists/${id}/versions`);
    return res.json();
  },
  async restoreVersion(id, file) {
    const res = await fetch(`/api/wishlists/${id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
    return res.json();
  }
};

const ui = {
  state: { currentId: null, currentData: null, lists: [], lastRefresh: 0 },
  els: {},
  init() {
    this.els = {
      newListBtn: document.getElementById('newListBtn'),
      refreshBtn: document.getElementById('refreshBtn'),
      searchInput: document.getElementById('searchInput'),
      lists: document.getElementById('lists'),
      listTitle: document.getElementById('listTitle'),
      saveTitleBtn: document.getElementById('saveTitleBtn'),
      versionsSelect: document.getElementById('versionsSelect'),
      restoreBtn: document.getElementById('restoreBtn'),
      deleteListBtn: document.getElementById('deleteListBtn'),
      trashBtn: document.getElementById('trashBtn'),
      newItemInput: document.getElementById('newItemInput'),
      newItemLink: document.getElementById('newItemLink'),
      addItemBtn: document.getElementById('addItemBtn'),
      items: document.getElementById('items'),
      modalBackdrop: document.getElementById('modalBackdrop'),
      modal: document.getElementById('modal'),
      modalTitle: document.getElementById('modalTitle'),
      modalBody: document.getElementById('modalBody'),
      modalCancel: document.getElementById('modalCancel'),
      modalOk: document.getElementById('modalOk')
    };
    this.bind();
    this.refreshLists();
    setInterval(() => this.autoRefresh(), 5000);
  },
  bind() {
    this.els.newListBtn.addEventListener('click', async () => {
      const title = await this.promptDialog('Создать новый список', 'Название списка', 'Новый вишлист');
      if (title === null) return;
      const wl = await api.createWishlist(title || 'Новый вишлист');
      await this.refreshLists();
      this.openWishlist(wl.id);
    });
    this.els.refreshBtn.addEventListener('click', () => this.refresh());
    this.els.searchInput.addEventListener('input', () => this.renderLists());
    this.els.saveTitleBtn.addEventListener('click', async () => {
      const title = this.els.listTitle.value.trim();
      if (!title) return;
      if (!this.state.currentId) {
        const wl = await api.createWishlist(title);
        this.state.currentId = wl.id;
        await this.refreshLists();
        await this.openWishlist(wl.id);
      } else {
        await api.saveTitle(this.state.currentId, title);
        await this.refresh();
      }
    });
    this.els.addItemBtn.addEventListener('click', async () => {
      if (!this.state.currentId) return;
      const text = this.els.newItemInput.value.trim();
      if (!text) return;
      const link = (this.els.newItemLink.value || '').trim();
      if (link) await api.addItemWithLink(this.state.currentId, text, link);
      else await api.addItem(this.state.currentId, text);
      this.els.newItemInput.value = '';
      this.els.newItemLink.value = '';
      await this.refresh();
    });
    this.els.restoreBtn.addEventListener('click', async () => {
      if (!this.state.currentId) return;
      const file = this.els.versionsSelect.value;
      if (!file) return;
      const ok = await this.confirmDialog('Восстановить версию', 'Восстановить выбранную версию? Текущая будет сохранена как копия.');
      if (!ok) return;
      await api.restoreVersion(this.state.currentId, file);
      await this.refresh();
    });

    this.els.deleteListBtn.addEventListener('click', async () => {
      if (!this.state.currentId) return;
      const ok = await this.confirmDialog('Удаление списка', 'Переместить текущий список в корзину?');
      if (!ok) return;
      await api.deleteWishlist(this.state.currentId);
      this.state.currentId = null;
      this.state.currentData = null;
      this.els.listTitle.value = '';
      this.els.items.innerHTML = '';
      await this.refreshLists();
    });

    this.els.trashBtn.addEventListener('click', async () => {
      const items = await api.listTrash();
      const body = document.createElement('div');
      if (!items.length) {
        body.innerHTML = '<p class="text-sm text-slate-600 dark:text-slate-300">Корзина пуста</p>';
      } else {
        const list = document.createElement('div');
        list.className = 'space-y-2';
        items.forEach(t => {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between gap-2 p-2 rounded-md border border-slate-300/80 dark:border-slate-600';
          row.innerHTML = `<div class="min-w-0"><div class="font-medium truncate">${escapeHtml(t.title || t.file)}</div><div class="text-xs text-slate-500">${new Date(t.deletedAt).toLocaleString()}</div></div>`;
          const actions = document.createElement('div');
          actions.className = 'flex gap-2';
          const restoreBtn = document.createElement('button');
          restoreBtn.className = 'px-2 py-1.5 rounded-md border border-slate-300/80 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm';
          restoreBtn.textContent = 'Восстановить';
          restoreBtn.onclick = async () => { await api.restoreFromTrash(t.file); await ui.refreshLists(); ui.closeModal(); };
          const removeBtn = document.createElement('button');
          removeBtn.className = 'px-2 py-1.5 rounded-md border border-red-300/80 text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-900/30 text-sm';
          removeBtn.textContent = 'Удалить навсегда';
          removeBtn.onclick = async () => {
            const ok = await ui.confirmDialog('Удалить навсегда', 'Это действие необратимо. Удалить?');
            if (!ok) return;
            await api.removeFromTrash(t.file);
            const newItems = await api.listTrash();
            ui.renderTrashModal(newItems);
            await ui.refreshLists();
          };
          actions.appendChild(restoreBtn);
          actions.appendChild(removeBtn);
          row.appendChild(actions);
          list.appendChild(row);
        });
        body.appendChild(list);
      }
      this.openModal('Корзина', body);
    });
  },
  async refreshLists() {
    this.state.lists = await api.listWishlists();
    this.renderLists();
  },
  renderLists() {
    const q = this.els.searchInput.value?.toLowerCase() || '';
    const filtered = this.state.lists.filter(l => (l.title || l.id).toLowerCase().includes(q));
    this.els.lists.innerHTML = '';
    filtered.forEach(l => {
      const btn = document.createElement('button');
      btn.className = `w-full text-left px-3 py-2 rounded-lg border border-slate-300/80 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition ${this.state.currentId===l.id?'ring-2 ring-brand':''}`;
      btn.innerHTML = `<div class="font-medium">${escapeHtml(l.title || l.id)}</div><div class="text-xs text-slate-500">${l.updatedAt?new Date(l.updatedAt).toLocaleString():'—'}</div>`;
      btn.addEventListener('click', () => this.openWishlist(l.id));
      this.els.lists.appendChild(btn);
    });
  },
  async openWishlist(id) {
    this.state.currentId = id;
    await this.refresh();
  },
  async refresh() {
    if (!this.state.currentId) return;
    const data = await api.getWishlist(this.state.currentId);
    if (!data) return;
    this.state.currentData = data;
    this.state.lastRefresh = Date.now();
    this.els.listTitle.value = data.title || '';
    await this.loadVersions();
    this.renderItems();
    await this.refreshLists();
  },
  async autoRefresh() {
    if (!this.state.currentId) return;
    await this.refresh();
  },
  async loadVersions() {
    const versions = await api.listVersions(this.state.currentId);
    this.els.versionsSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = versions.length ? 'Выберите версию' : 'Нет копий';
    this.els.versionsSelect.appendChild(placeholder);
    versions.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.file;
      opt.textContent = new Date(v.mtime).toLocaleString();
      this.els.versionsSelect.appendChild(opt);
    });
  },
  renderItems() {
    const ul = this.els.items;
    ul.innerHTML = '';
    const items = this.state.currentData.items || [];
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'p-3 rounded-lg border border-slate-300/80 dark:border-slate-600 flex gap-2 items-center';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.text || '';
      input.className = 'flex-1 bg-transparent border-b border-transparent focus:border-brand focus:outline-none';
      input.addEventListener('change', async () => {
        await api.updateItem(this.state.currentId, item.id, { text: input.value });
        await this.refresh();
      });

      // Кнопка ссылки (открыть если есть, либо добавить)
      const linkBtn = document.createElement('button');
      linkBtn.className = 'px-2 py-1.5 rounded-md border border-slate-300/80 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm';
      linkBtn.textContent = item.link ? 'Открыть ссылку' : 'Добавить ссылку';
      linkBtn.addEventListener('click', async () => {
        if (item.link) {
          const url = api.normalizeLink(item.link);
          window.open(url, '_blank', 'noopener');
        } else {
          const v = await ui.promptDialog('Добавить ссылку', 'URL (опционально http/https)', '');
          if (v === null) return;
          const link = (v || '').trim();
          if (!link) return;
          await api.updateItem(this.state.currentId, item.id, { link });
          await this.refresh();
        }
      });

      // Кнопка изменить ссылку (только если ссылка уже есть)
      let editLinkBtn = null;
      if (item.link) {
        editLinkBtn = document.createElement('button');
        editLinkBtn.className = 'px-2 py-1.5 rounded-md border border-slate-300/80 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm';
        editLinkBtn.textContent = 'Изменить ссылку';
        editLinkBtn.addEventListener('click', async () => {
          const v = await ui.promptDialog('Изменить ссылку', 'URL (оставьте пустым чтобы удалить)', item.link || '');
          if (v === null) return;
          const link = (v || '').trim();
          await api.updateItem(this.state.currentId, item.id, { link });
          await this.refresh();
        });
      }

      const badge = document.createElement('span');
      const taken = item.status === 'taken';
      badge.className = `text-xs px-2 py-1 rounded-full ${taken?'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200':'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'}`;
      badge.textContent = taken ? (item.takenBy ? `Занят: ${item.takenBy}` : 'Занят') : 'Свободен';

      const actionBtn = document.createElement('button');
      actionBtn.className = `px-3 py-1.5 rounded-md border ${taken?'border-slate-300/80 bg-slate-100 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600':'border-transparent bg-brand text-white hover:bg-brand-600'} transition`;
      actionBtn.textContent = taken ? 'Освободить' : 'Взять';
      actionBtn.addEventListener('click', async () => {
        if (taken) await api.updateItem(this.state.currentId, item.id, { action: 'release' });
        else await api.updateItem(this.state.currentId, item.id, { action: 'take' });
        await this.refresh();
      });

      li.appendChild(input);
      li.appendChild(linkBtn);
      if (editLinkBtn) li.appendChild(editLinkBtn);
      li.appendChild(badge);
      li.appendChild(actionBtn);
      ul.appendChild(li);
    });
  }
};

function escapeHtml(str) {
  return (str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

window.addEventListener('DOMContentLoaded', () => ui.init());

// Простой UI модальный confirm
ui.confirmDialog = function(title, text) {
  return new Promise((resolve) => {
    this.els.modalTitle.textContent = title || '';
    this.els.modalBody.innerHTML = `<p class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(text || '')}</p>`;
    const cleanup = () => {
      this.els.modalBackdrop.classList.add('hidden');
      this.els.modalBackdrop.classList.remove('flex');
      this.els.modalOk.onclick = null;
      this.els.modalCancel.onclick = null;
    };
    this.els.modalOk.onclick = () => { cleanup(); resolve(true); };
    this.els.modalCancel.onclick = () => { cleanup(); resolve(false); };
    this.els.modalBackdrop.classList.remove('hidden');
    this.els.modalBackdrop.classList.add('flex');
  });
};

// Простой UI модальный prompt
ui.promptDialog = function(title, placeholder, defaultValue) {
  return new Promise((resolve) => {
    this.els.modalTitle.textContent = title || '';
    this.els.modalBody.innerHTML = `
      <label class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(placeholder || '')}</label>
      <input id="modalInput" type="text" class="w-full mt-1 px-3 py-2 rounded-md bg-white/70 dark:bg-slate-800/60 border border-slate-300/80 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-brand" />
    `;
    const input = this.els.modalBody.querySelector('#modalInput');
    input.value = defaultValue || '';
    const cleanup = () => {
      this.els.modalBackdrop.classList.add('hidden');
      this.els.modalBackdrop.classList.remove('flex');
      this.els.modalOk.onclick = null;
      this.els.modalCancel.onclick = null;
    };
    this.els.modalOk.onclick = () => { const v = input.value.trim(); cleanup(); resolve(v); };
    this.els.modalCancel.onclick = () => { cleanup(); resolve(null); };
    this.els.modalBackdrop.classList.remove('hidden');
    this.els.modalBackdrop.classList.add('flex');
    setTimeout(() => input.focus(), 0);
  });
};

ui.openModal = function(title, contentNode) {
  this.els.modalTitle.textContent = title || '';
  this.els.modalBody.innerHTML = '';
  if (contentNode) this.els.modalBody.appendChild(contentNode);
  this.els.modalOk.onclick = () => { this.closeModal(); };
  this.els.modalCancel.onclick = () => { this.closeModal(); };
  this.els.modalBackdrop.classList.remove('hidden');
  this.els.modalBackdrop.classList.add('flex');
};

ui.renderTrashModal = function(items) {
  const body = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'space-y-2';
  items.forEach(t => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 p-2 rounded-md border border-slate-300/80 dark:border-slate-600';
    row.innerHTML = `<div class="min-w-0"><div class=\"font-medium truncate\">${escapeHtml(t.title || t.file)}</div><div class=\"text-xs text-slate-500\">${new Date(t.deletedAt).toLocaleString()}</div></div>`;
    list.appendChild(row);
  });
  body.appendChild(list);
  this.openModal('Корзина', body);
};

ui.closeModal = function() {
  this.els.modalBackdrop.classList.add('hidden');
  this.els.modalBackdrop.classList.remove('flex');
  this.els.modalOk.onclick = null;
  this.els.modalCancel.onclick = null;
};


