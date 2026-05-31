const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  const modals = [];
  const cloudCalls = [];
  return {
    storage,
    modals,
    cloudCalls,
    subscriptionAccepted: false,
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    showToast() {},
    showModal(options) {
      modals.push(options);
      if (typeof options.success === 'function') {
        options.success({ confirm: true });
      }
    },
    cloud: {
      callFunction(options) {
        cloudCalls.push(options);
        if (typeof options.success === 'function') {
          options.success({ result: { scanned: 0, notices: 0 } });
        }
        return Promise.resolve({ result: { scanned: 0, notices: 0 } });
      }
    },
    getSetting(options) {
      const templateId = 'YQ16_zieaD46dXPv_mMrSGIkR6WLLpc9fxMFF1q5jEI';
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [templateId]: this.subscriptionAccepted ? 'accept' : 'reject'
          }
        }
      });
    }
  };
}

function attachDatabaseMock(wxMock, initialRows = {}) {
  const rows = {
    ft_containers: (initialRows.ft_containers || []).slice(),
    ft_items: (initialRows.ft_items || []).slice(),
    ft_reminder_notices: (initialRows.ft_reminder_notices || []).slice()
  };
  function collection(name, options = {}) {
    const skip = options.skip || 0;
    const limit = options.limit || 100;
    return {
      skip(nextSkip) {
        return collection(name, Object.assign({}, options, { skip: nextSkip }));
      },
      limit(nextLimit) {
        return collection(name, Object.assign({}, options, { limit: nextLimit }));
      },
      get() {
        return Promise.resolve({ data: (rows[name] || []).slice(skip, skip + limit) });
      },
      doc(id) {
        return {
          set({ data }) {
            const next = Object.assign({ _id: id }, data);
            const index = rows[name].findIndex((record) => record._id === id);
            if (index >= 0) {
              rows[name][index] = next;
            } else {
              rows[name].push(next);
            }
            return Promise.resolve({});
          }
        };
      }
    };
  }
  wxMock.cloud.database = () => ({ collection });
  wxMock.dbRows = rows;
  return wxMock;
}

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

function loadHomePage(wxMock) {
  const pagePath = path.join(__dirname, '..', 'miniprogram', 'pages', 'home', 'index.js');
  const storagePath = path.join(__dirname, '..', 'miniprogram', 'services', 'storage.js');
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition = null;

  delete require.cache[require.resolve(pagePath)];
  delete require.cache[require.resolve(storagePath)];

  global.wx = wxMock;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  require(pagePath);
  global.Page = previousPage;
  global.wx = previousWx;

  return pageDefinition;
}

function createPageContext(pageDefinition, initialData) {
  return Object.assign({}, pageDefinition, {
    data: Object.assign({}, initialData),
    loadCalls: 0,
    load() {
      this.loadCalls += 1;
    },
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    }
  });
}

function withWx(wxMock, callback) {
  const previousWx = global.wx;
  global.wx = wxMock;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      global.wx = previousWx;
    });
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

test('home page derives and renders an in-app expiry reminder entry', () => {
  const js = readMiniProgramFile('pages', 'home', 'index.js');
  const wxml = readMiniProgramFile('pages', 'home', 'index.wxml');
  const wxss = readMiniProgramFile('pages', 'home', 'index.wxss');

  assert.match(js, /listPendingReminderNotices/);
  assert.match(js, /ftExpiryReminder/);
  assert.match(js, /expiryReminderCount/);
  assert.match(js, /showExpiryReminderEntry/);
  assert.match(js, /expiryReminderNotices/);
  assert.match(js, /markReminderNoticeRead/);

  assert.match(wxml, /expiry-reminder-entry/);
  assert.match(wxml, /showExpiryReminderEntry/);
  assert.match(wxml, /expiryReminderCount/);
  assert.match(wxml, /expiryReminderPreview/);
  assert.match(wxml, /openExpiryReminders/);

  assert.match(cssBlock(wxss, '.expiry-reminder-entry'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(cssBlock(wxss, '.expiry-reminder-entry'), /border-radius:\s*28rpx/);
});

test('home page triggers the expiry reminder cloud function before reading notices', async () => {
  const wxMock = attachDatabaseMock(createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: 'Box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [],
    'findThings.reminderNotices': []
  }), {
    ft_containers: [
      {
        _id: 'box',
        name: 'Box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [],
    ft_reminder_notices: []
  });
  const page = loadHomePage(wxMock);
  const context = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
    ensureRecentThumbnails() {}
  });

  await withWx(wxMock, () => page.load.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(wxMock.cloudCalls.some((call) => call.name === 'ftExpiryReminder'));
});

test('home expiry reminder modal marks shown reminders read after confirm', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [],
    'findThings.items': [
      {
        _id: 'due_item',
        displayName: 'Milk',
        expiresAt: Date.UTC(2026, 5, 10),
        reminderEnabled: true,
        remindAt: Date.UTC(2026, 5, 8),
        inAppReadAt: 0
      }
    ],
    'findThings.reminderNotices': [
      {
        _id: 'notice_due_item',
        itemId: 'due_item',
        displayName: 'Milk',
        message: 'Milk 已过期，请及时处理。',
        status: 'pending',
        createdAt: 2
      }
    ]
  });
  const page = loadHomePage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, {
    expiryReminderNotices: [{ _id: 'notice_due_item', itemId: 'due_item', displayName: 'Milk', message: 'Milk 已过期，请及时处理。' }],
    expiryReminderCount: 1,
    expiryReminderPreview: 'Milk 已过期，请及时处理。',
    showExpiryReminderEntry: true
  }));

  await withWx(wxMock, () => page.openExpiryReminders.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wxMock.modals.length, 1);
  assert.equal(wxMock.storage['findThings.reminderNotices'][0].status, 'read');
  assert.equal(wxMock.storage['findThings.items'][0].inAppReadAt > 0, true);
  assert.equal(context.data.expiryReminderCount, 0);
  assert.equal(context.data.showExpiryReminderEntry, false);
  assert.equal(context.loadCalls, 1);
});

test('home page upgrades future in-app reminders after user later accepts subscription', async () => {
  const now = Date.now();
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: 'Box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'future_item',
        containerId: 'box',
        displayName: 'Future milk',
        expiresAt: now + 3 * 24 * 60 * 60 * 1000,
        remindAt: now + 2 * 24 * 60 * 60 * 1000,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindedAt: 0,
        deletedAt: null
      }
    ]
  });
  wxMock.subscriptionAccepted = true;
  const page = loadHomePage(wxMock);
  const context = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
    ensureRecentThumbnails() {}
  });

  await withWx(wxMock, () => page.load.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wxMock.storage['findThings.items'][0].subscribeAccepted, true);
  assert.equal(wxMock.storage['findThings.items'][0].reminderChannel, 'subscribe');
});

test('home page upgrades already due in-app reminders after user later accepts subscription', async () => {
  const now = Date.now();
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: 'Box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'due_item',
        containerId: 'box',
        displayName: 'Due milk',
        expiresAt: now - 24 * 60 * 60 * 1000,
        remindAt: now - 24 * 60 * 60 * 1000,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindedAt: 0,
        inAppReadAt: 0,
        deletedAt: null
      }
    ]
  });
  wxMock.subscriptionAccepted = true;
  const page = loadHomePage(wxMock);
  const context = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
    ensureRecentThumbnails() {}
  });

  await withWx(wxMock, () => page.load.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wxMock.storage['findThings.items'][0].subscribeAccepted, true);
  assert.equal(wxMock.storage['findThings.items'][0].reminderChannel, 'subscribe');
});

test('home page shows pending reminder notices from the notice table', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: 'Box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'expired_item',
        containerId: 'box',
        displayName: 'Expired spray',
        expiresAt: new Date('2026-05-31T23:59:59.999+08:00').getTime(),
        remindAt: new Date('2026-05-31T23:59:59.999+08:00').getTime(),
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindedAt: 0,
        inAppReadAt: 0,
        deletedAt: null
      }
    ],
    'findThings.reminderNotices': [
      {
        _id: 'notice_expired_item',
        itemId: 'expired_item',
        displayName: 'Expired spray',
        message: 'Expired spray 已过期，请及时处理。',
        status: 'pending',
        pushStatus: 'none',
        createdAt: 2
      }
    ]
  });
  const page = loadHomePage(wxMock);
  const context = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
    ensureRecentThumbnails() {}
  });
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-06-01T00:12:00+08:00').getTime();

  try {
    await withWx(wxMock, () => page.load.call(context));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(context.data.showExpiryReminderEntry, true);
  assert.equal(context.data.expiryReminderCount, 1);
  assert.equal(context.data.expiryReminderNotices[0]._id, 'notice_expired_item');
  assert.equal(context.data.expiryReminderPreview, 'Expired spray 已过期，请及时处理。');
});
