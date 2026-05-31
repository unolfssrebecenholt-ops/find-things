const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  return {
    storage,
    toasts: [],
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
    getSetting(options) {
      options.success({
        subscriptionsSetting: {
          itemSettings: {
            YQ16_zieaD46dXPv_mMrSGIkR6WLLpc9fxMFF1q5jEI: 'accept'
          }
        }
      });
    },
    requestSubscribeMessage() {
      throw new Error('save should use existing subscription setting without prompting');
    }
  };
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

test('container save refreshes accepted subscribe settings before persisting reminder items', async () => {
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
  assert.equal(savedItems.length, 1);
  assert.equal(savedItems[0].subscribeAccepted, true);
  assert.equal(savedItems[0].reminderChannel, 'subscribe');
  assert.equal(savedItems[0].reminderEnabled, true);
  assert.equal(savedItems[0].remindOffsetDays, 0);
});
