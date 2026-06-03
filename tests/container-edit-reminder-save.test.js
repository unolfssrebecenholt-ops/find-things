const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEMPLATE_ID = 'test-template-id';

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  return {
    storage,
    toasts: [],
    subscribeRequests: [],
    navigatedHome: false,
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
      this.toasts.push(options);
    },
    showLoading() {},
    hideLoading() {},
    chooseMedia() {},
    chooseImage() {},
    cloud: {
      callFunction(options) {
        if (options && options.data && options.data.action === 'config') {
          return Promise.resolve({ result: { expiryTemplateId: TEMPLATE_ID } });
        }
        return Promise.resolve({ result: {} });
      }
    },
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            [TEMPLATE_ID]: 'accept'
          }
        }
      });
    },
    requestSubscribeMessage(options) {
      this.subscribeRequests.push(options);
      options.success({
        [TEMPLATE_ID]: 'accept'
      });
    }
  };
}

function createRejectedWxMock(initialStorage) {
  const wxMock = createWxMock(initialStorage);
  wxMock.getSetting = function getSetting(options) {
    options.success({
      subscriptionsSetting: {
        itemSettings: {
          [TEMPLATE_ID]: 'reject'
        }
      }
    });
  };
  wxMock.requestSubscribeMessage = function requestSubscribeMessage(options) {
    this.subscribeRequests.push(options);
    options.success({
      [TEMPLATE_ID]: 'reject'
    });
  };
  return wxMock;
}

function createOneTimeAcceptedWxMock(initialStorage) {
  const wxMock = createRejectedWxMock(initialStorage);
  wxMock.requestSubscribeMessage = function requestSubscribeMessage(options) {
    this.subscribeRequests.push(options);
    options.success({
      [TEMPLATE_ID]: 'accept'
    });
  };
  return wxMock;
}

function loadEditPage(wxMock) {
  const pagePath = path.join(__dirname, '..', 'miniprogram', 'pages', 'container', 'edit.js');
  const storagePath = path.join(__dirname, '..', 'miniprogram', 'services', 'storage.js');
  const reminderPath = path.join(__dirname, '..', 'miniprogram', 'services', 'expiry-reminder.js');
  const navigationPath = path.join(__dirname, '..', 'miniprogram', 'utils', 'navigation.js');
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition = null;

  delete require.cache[require.resolve(pagePath)];
  delete require.cache[require.resolve(storagePath)];
  delete require.cache[require.resolve(reminderPath)];
  delete require.cache[require.resolve(navigationPath)];

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
    data: Object.assign({}, pageDefinition.data, initialData),
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

test('container save requests a quota before persisting a reminder item', async () => {
  const expiresAt = Date.UTC(2026, 5, 1, 15, 59, 59, 999);
  const wxMock = createWxMock({
    'findThings.containers': [],
    'findThings.items': []
  });
  const page = loadEditPage(wxMock);
  const context = createPageContext(page, {
    name: 'Reminder box',
    locationPath: 'Shelf',
    contentImages: [],
    items: [
      {
        displayName: 'Spray bottle',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp'
      }
    ]
  });

  await withWx(wxMock, () => page.save.call(context));

  const savedItems = wxMock.storage['findThings.items'];
  assert.equal(wxMock.subscribeRequests.length, 1);
  assert.equal(savedItems.length, 1);
  assert.equal(savedItems[0].subscribeAccepted, true);
  assert.equal(savedItems[0].reminderChannel, 'subscribe');
  assert.equal(savedItems[0].reminderEnabled, true);
  assert.equal(savedItems[0].remindOffsetDays, 0);
});

test('container save marks tab sections for refresh after persisting', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [],
    'findThings.items': []
  });
  const page = loadEditPage(wxMock);
  const navigation = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'navigation.js'));
  const context = createPageContext(page, {
    name: 'Fresh box',
    locationPath: 'Shelf',
    contentImages: [{ imageId: 'image_1', fileId: '/tmp/fresh.jpg' }],
    items: [{ displayName: 'Key', confirmed: true }]
  });

  await withWx(wxMock, () => page.save.call(context));

  assert.equal(navigation.consumeSectionRefresh(navigation.HOME_URL), true);
  assert.equal(navigation.consumeSectionRefresh(navigation.CONTAINERS_URL), true);
  assert.equal(navigation.consumeSectionRefresh(navigation.SEARCH_URL), true);
});

test('container save applies one accepted quota to all reminder items in the save action', async () => {
  const expiresAt = Date.UTC(2026, 5, 1, 15, 59, 59, 999);
  const wxMock = createWxMock({
    'findThings.containers': [],
    'findThings.items': []
  });
  const page = loadEditPage(wxMock);
  const context = createPageContext(page, {
    name: 'Reminder box',
    locationPath: 'Shelf',
    contentImages: [],
    items: [
      {
        displayName: 'Milk',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: true,
        reminderChannel: 'subscribe'
      },
      {
        displayName: 'Mask',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: true,
        reminderChannel: 'subscribe'
      }
    ]
  });

  await withWx(wxMock, () => page.save.call(context));

  const savedItems = wxMock.storage['findThings.items'];
  assert.equal(wxMock.subscribeRequests.length, 1);
  assert.equal(savedItems.length, 2);
  assert.equal(savedItems.every((item) => item.subscribeAccepted === true), true);
  assert.equal(savedItems.every((item) => item.reminderChannel === 'subscribe'), true);
});

test('container save applies a one-time accepted quota to every reminder item in the save action', async () => {
  const expiresAt = Date.UTC(2026, 5, 1, 15, 59, 59, 999);
  const wxMock = createOneTimeAcceptedWxMock({
    'findThings.containers': [],
    'findThings.items': []
  });
  const page = loadEditPage(wxMock);
  const context = createPageContext(page, {
    name: 'Reminder box',
    locationPath: 'Shelf',
    contentImages: [],
    items: [
      {
        displayName: 'Milk',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp'
      },
      {
        displayName: 'Mask',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp'
      }
    ]
  });

  await withWx(wxMock, () => page.save.call(context));

  const savedItems = wxMock.storage['findThings.items'];
  assert.equal(wxMock.subscribeRequests.length, 1);
  assert.equal(savedItems.length, 2);
  assert.equal(savedItems.every((item) => item.subscribeAccepted === true), true);
  assert.equal(savedItems.every((item) => item.reminderChannel === 'subscribe'), true);
  assert.equal(savedItems.every((item) => item.reminderEnabled === true), true);
});

test('container save keeps in-app reminders when subscription authorization is rejected', async () => {
  const expiresAt = Date.UTC(2026, 5, 1, 15, 59, 59, 999);
  const wxMock = createRejectedWxMock({
    'findThings.containers': [],
    'findThings.items': []
  });
  const page = loadEditPage(wxMock);
  const context = createPageContext(page, {
    name: 'Reminder box',
    locationPath: 'Shelf',
    contentImages: [],
    items: [
      {
        displayName: 'Milk',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp'
      },
      {
        displayName: 'Mask',
        confirmed: true,
        expiresAt,
        remindAt: expiresAt,
        remindOffsetDays: 0,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp'
      }
    ]
  });

  await withWx(wxMock, () => page.save.call(context));

  const savedItems = wxMock.storage['findThings.items'];
  assert.equal(wxMock.subscribeRequests.length, 1);
  assert.equal(savedItems.length, 2);
  assert.equal(savedItems.every((item) => item.subscribeAccepted === false), true);
  assert.equal(savedItems.every((item) => item.reminderChannel === 'inApp'), true);
  assert.equal(savedItems.every((item) => item.reminderEnabled === true), true);
});
