const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_ID = 'test-template-id';

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  const modals = [];
  const cloudCalls = [];
  const toasts = [];
  return {
    storage,
    modals,
    cloudCalls,
    toasts,
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
    showToast(options) {
      toasts.push(options);
    },
    showModal(options) {
      modals.push(options);
      if (typeof options.success === 'function') {
        options.success({ confirm: true });
      }
    },
    cloud: {
      callFunction(options) {
        cloudCalls.push(options);
        if (options && options.data && options.data.action === 'config') {
          const configResult = { result: { expiryTemplateId: TEMPLATE_ID } };
          if (typeof options.success === 'function') {
            options.success(configResult);
          }
          return Promise.resolve(configResult);
        }
        if (typeof options.success === 'function') {
          options.success({ result: { scanned: 0, notices: 0 } });
        }
        return Promise.resolve({ result: { scanned: 0, notices: 0 } });
      }
    },
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: this.subscriptionAccepted ? 'accept' : 'reject'
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
  assert.match(wxml, /showExpiryReminderPanel/);
  assert.match(wxml, /expiryReminderDetails/);
  assert.match(wxml, /expiry-reminder-detail-photo/);
  assert.match(wxml, /expiry-detail-location/);
  assert.match(wxml, /expiry-detail-date/);
  assert.match(wxml, /expiry-detail-days/);
  assert.match(wxml, /小懒盯到 \{\{expiryReminderCount\}\} 件快到期/);
  assert.match(wxml, /看看/);
  assert.match(wxml, /xiaolan-sloth\.svg/);
  assert.doesNotMatch(wxml, /到期公示/);
  assert.doesNotMatch(wxml, /知道了/);

  assert.match(cssBlock(wxss, '.expiry-reminder-entry'), /grid-template-columns:\s*72rpx\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(cssBlock(wxss, '.expiry-reminder-entry'), /border-radius:\s*28rpx/);
  assert.match(cssBlock(wxss, '.expiry-reminder-mascot'), /width:\s*72rpx/);
  assert.match(cssBlock(wxss, '.expiry-reminder-sheet'), /z-index:\s*60/);
  assert.match(cssBlock(wxss, '.expiry-reminder-panel'), /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(cssBlock(wxss, '.expiry-reminder-panel'), /max-height:\s*78vh/);
  assert.match(cssBlock(wxss, '.expiry-reminder-detail'), /grid-template-columns:\s*112rpx\s+minmax\(0,\s*1fr\)/);
  assert.match(cssBlock(wxss, '.expiry-reminder-action-bar'), /padding:\s*14rpx\s+0\s+22rpx/);
  assert.match(cssBlock(wxss, '.expiry-reminder-done'), /justify-content:\s*center/);
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

test('home expiry reminder panel marks shown reminders read after confirm', async () => {
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
    expiryReminderDetails: [{ _id: 'notice_due_item', displayName: 'Milk', containerText: 'Fridge', expiryDateText: '2026-06-10', remainingDaysText: '还有 9 天', imagePath: '/tmp/milk.jpg' }],
    expiryReminderCount: 1,
    expiryReminderPreview: 'Milk 已过期，请及时处理。',
    showExpiryReminderEntry: true
  }));

  await withWx(wxMock, () => page.openExpiryReminders.call(context));
  assert.equal(context.data.showExpiryReminderPanel, true);
  assert.equal(wxMock.modals.length, 0);

  await withWx(wxMock, () => page.confirmExpiryReminderDetails.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wxMock.storage['findThings.reminderNotices'][0].status, 'read');
  assert.equal(wxMock.storage['findThings.items'][0].inAppReadAt > 0, true);
  assert.deepEqual(wxMock.toasts.at(-1), { title: '小懒先帮你收起啦', icon: 'none' });
  assert.equal(context.data.expiryReminderCount, 0);
  assert.equal(context.data.showExpiryReminderEntry, false);
  assert.equal(context.data.showExpiryReminderPanel, false);
  assert.equal(context.loadCalls, 1);
});

test('home expiry reminder panel lists all due item details after tapping see', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [],
    'findThings.items': [],
    'findThings.reminderNotices': [
      { _id: 'notice_milk', displayName: '牛奶', status: 'pending' },
      { _id: 'notice_vitamin', displayName: '维生素', status: 'pending' },
      { _id: 'notice_mask', displayName: '面膜', status: 'pending' },
      { _id: 'notice_spray', displayName: '喷雾', status: 'pending' },
      { _id: 'notice_tea', displayName: '茶包', status: 'pending' }
    ]
  });
  const page = loadHomePage(wxMock);
  const notices = [
    { _id: 'notice_milk', displayName: '牛奶', imagePath: '/tmp/milk.jpg', containerName: '冰箱', expiresAt: new Date('2026-06-03T23:59:59+08:00').getTime() },
    { _id: 'notice_vitamin', displayName: '维生素', imagePath: '/tmp/vitamin.jpg', containerLocation: '卧室抽屉', containerName: '药盒', expiresAt: new Date('2026-06-04T23:59:59+08:00').getTime() },
    { _id: 'notice_mask', displayName: '面膜', imagePath: '/tmp/mask.jpg', containerName: '浴室柜', expiresAt: new Date('2026-06-05T23:59:59+08:00').getTime() },
    { _id: 'notice_spray', displayName: '喷雾', imagePath: '/tmp/spray.jpg', containerName: '玄关柜', expiresAt: new Date('2026-06-06T23:59:59+08:00').getTime() },
    { _id: 'notice_tea', displayName: '茶包', imagePath: '/tmp/tea.jpg', containerName: '厨房储物盒', expiresAt: new Date('2026-06-07T23:59:59+08:00').getTime() }
  ];
  const context = createPageContext(page, Object.assign({}, page.data, {
    expiryReminderNotices: notices,
    expiryReminderDetails: [],
    expiryReminderCount: notices.length,
    expiryReminderPreview: '牛奶、维生素、面膜要到期啦，另外还有 2 件也快到期啦。',
    showExpiryReminderEntry: true
  }));
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-06-01T10:00:00+08:00').getTime();

  try {
    await withWx(wxMock, () => page.openExpiryReminders.call(context));
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(context.data.showExpiryReminderPanel, true);
  assert.equal(context.data.expiryReminderDetails.length, 5);
  assert.deepEqual(context.data.expiryReminderDetails.map((item) => item.displayName), ['牛奶', '维生素', '面膜', '喷雾', '茶包']);
  assert.deepEqual(context.data.expiryReminderDetails.map((item) => item.imagePath), ['/tmp/milk.jpg', '/tmp/vitamin.jpg', '/tmp/mask.jpg', '/tmp/spray.jpg', '/tmp/tea.jpg']);
  assert.equal(context.data.expiryReminderDetails[1].containerText, '卧室抽屉 / 药盒');
  assert.equal(context.data.expiryReminderDetails[0].expiryDateText, '2026-06-03');
  assert.equal(context.data.expiryReminderDetails[0].remainingDaysText, '还有 2 天');
});

test('home expiry reminder panel backfills legacy notice images and container text', async () => {
  const now = new Date('2026-06-01T10:00:00+08:00').getTime();
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: '冰箱上层',
        locationPath: '厨房',
        contentImages: [
          {
            imageId: 'image_milk',
            fileId: 'cloud://env/find-things/content/milk.jpg',
            thumbFileId: 'cloud://env/find-things/thumbs/milk.jpg'
          }
        ],
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'milk',
        containerId: 'box',
        displayName: '牛奶',
        sourceImageId: 'image_milk',
        sourceImageFileId: 'cloud://env/find-things/content/milk.jpg',
        expiresAt: new Date('2026-06-03T23:59:59+08:00').getTime(),
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindAt: now - 1,
        remindedAt: 0,
        deletedAt: null
      }
    ],
    'findThings.reminderNotices': [
      {
        _id: `expiry_milk_${now - 1}`,
        itemId: 'milk',
        containerId: 'box',
        displayName: '牛奶',
        status: 'pending',
        remindAt: now - 1,
        expiresAt: new Date('2026-06-03T23:59:59+08:00').getTime()
      }
    ]
  });
  wxMock.cloud.getTempFileURL = ({ fileList, success }) => {
    success({
      fileList: fileList.map((file) => ({
        fileID: file.fileID,
        tempFileURL: `https://display.example.com/${file.fileID.split('/').pop()}`
      }))
    });
  };
  const page = loadHomePage(wxMock);
  const context = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
    ensureRecentThumbnails() {}
  });
  const originalDateNow = Date.now;
  Date.now = () => now;

  try {
    await withWx(wxMock, () => page.load.call(context));
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(context.data.expiryReminderDetails.length, 1);
  assert.equal(context.data.expiryReminderDetails[0].imagePath, 'https://display.example.com/milk.jpg');
  assert.equal(context.data.expiryReminderDetails[0].hasImage, true);
  assert.equal(context.data.expiryReminderDetails[0].showImagePlaceholder, false);
  assert.equal(context.data.expiryReminderDetails[0].containerText, '厨房 / 冰箱上层');
});

test('home page does not upgrade future reminders from subscription settings alone', async () => {
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

  assert.equal(wxMock.storage['findThings.items'][0].subscribeAccepted, false);
  assert.equal(wxMock.storage['findThings.items'][0].reminderChannel, 'inApp');
});

test('home page does not upgrade already due reminders from subscription settings alone', async () => {
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

  assert.equal(wxMock.storage['findThings.items'][0].subscribeAccepted, false);
  assert.equal(wxMock.storage['findThings.items'][0].reminderChannel, 'inApp');
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
  assert.equal(context.data.expiryReminderPreview, 'Expired spray要到期啦。');
});

test('home page derives in-app reminders from due items when notice table is empty', async () => {
  const now = new Date('2026-06-01T00:12:00+08:00').getTime();
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box',
        name: '药品盒',
        locationPath: '客厅',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'expired_milk',
        containerId: 'box',
        displayName: '牛奶',
        expiresAt: now - 24 * 60 * 60 * 1000,
        remindAt: now - 24 * 60 * 60 * 1000,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: true,
        reminderChannel: 'subscribe',
        remindedAt: now - 1,
        inAppReadAt: 0,
        deletedAt: null
      },
      {
        _id: 'expired_mask',
        containerId: 'box',
        displayName: '面膜',
        expiresAt: now - 2 * 24 * 60 * 60 * 1000,
        remindAt: now - 2 * 24 * 60 * 60 * 1000,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindedAt: 0,
        inAppReadAt: 0,
        deletedAt: null
      }
    ],
    'findThings.reminderNotices': []
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
  Date.now = () => now;

  try {
    await withWx(wxMock, () => page.load.call(context));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(context.data.showExpiryReminderEntry, true);
  assert.equal(context.data.expiryReminderCount, 2);
  assert.equal(context.data.expiryReminderNotices.every((notice) => notice.derived === true), true);
  assert.deepEqual(context.data.expiryReminderNotices.map((notice) => notice.displayName).sort(), ['牛奶', '面膜'].sort());
  assert.equal(context.data.expiryReminderDetails.length, 2);
});

test('home page marks derived in-app reminders read by item id', async () => {
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
    'findThings.reminderNotices': []
  });
  const page = loadHomePage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, {
    expiryReminderNotices: [{
      _id: 'derived_expiry_due_item_1780876800000',
      derived: true,
      itemId: 'due_item',
      displayName: 'Milk',
      status: 'pending'
    }],
    expiryReminderDetails: [],
    expiryReminderCount: 1,
    expiryReminderPreview: 'Milk要到期啦。',
    showExpiryReminderEntry: true
  }));

  await withWx(wxMock, () => page.confirmExpiryReminderDetails.call(context));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wxMock.storage['findThings.items'][0].inAppReadAt > 0, true);
  assert.equal(context.data.showExpiryReminderEntry, false);
});
