const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  return {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    navigateTo() {},
    showToast() {},
    showModal(options) {
      options.success({ confirm: true });
    }
  };
}

function loadContainerListPage(wxMock) {
  const pagePath = path.join(__dirname, '..', 'miniprogram', 'pages', 'container', 'list.js');
  const storagePath = path.join(__dirname, '..', 'miniprogram', 'services', 'storage.js');
  const searchPath = path.join(__dirname, '..', 'miniprogram', 'services', 'search.js');
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition = null;

  delete require.cache[require.resolve(pagePath)];
  delete require.cache[require.resolve(storagePath)];
  delete require.cache[require.resolve(searchPath)];

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
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    }
  });
}

function withWx(wxMock, callback) {
  const previousWx = global.wx;
  global.wx = wxMock;
  try {
    return callback();
  } finally {
    global.wx = previousWx;
  }
}

test('container list search clears stale batch selections', () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      { _id: 'a', name: 'camp box', locationPath: 'balcony', updatedAt: 2 },
      { _id: 'b', name: 'book drawer', locationPath: 'bedroom', updatedAt: 1 }
    ],
    'findThings.items': [
      { _id: 'item-b', containerId: 'b', displayName: 'blue book', confirmed: true }
    ]
  });
  const page = loadContainerListPage(wxMock);
  const context = createPageContext(page, page.data);

  page.load.call(context);
  context.setData({ selectedIds: ['a'], selectedCount: 1, hasSelection: true });
  page.inputQuery.call(context, { detail: { value: 'book' } });

  assert.deepEqual(context.data.selectedIds, []);
  assert.equal(context.data.selectedCount, 0);
  assert.equal(context.data.hasSelection, false);
  assert.deepEqual(context.data.containers.map((container) => container._id), ['b']);
  assert.equal(context.data.containers[0].isSelected, false);
});

test('container list manage mode exposes prototype active and row action states', () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'a',
        name: 'desk drawer',
        locationPath: 'bedroom / desk',
        itemCount: 8,
        contentImages: [{ imageId: 'image_a', fileId: '/tmp/a.jpg', analyzeStatus: 'ready' }],
        updatedAt: 2
      }
    ],
    'findThings.items': []
  });
  const page = loadContainerListPage(wxMock);
  const context = createPageContext(page, page.data);

  page.load.call(context);
  page.toggleManageMode.call(context);

  assert.equal(context.data.manageLabel, '完成');
  assert.equal(context.data.manageButtonClass, 'active');
  assert.equal(context.data.rowModeClass, 'manage-row');
  assert.equal(context.data.showRowMoreActions, false);
  assert.equal(context.data.containers[0].toneClass, 'pine');
  assert.equal(context.data.containers[0].displaySubtitle, 'bedroom / desk');
  assert.equal(context.data.containers[0].itemCountLabel, '8 件物品');
  assert.equal(context.data.containers[0].imageCountLabel, '1 张照片');
  assert.equal(Object.hasOwn(context.data.containers[0], 'progressClass'), false);
  assert.equal(Object.hasOwn(context.data.containers[0], 'progressCopy'), false);
  assert.equal(context.data.showBatchBar, false);

  page.toggleSelect.call(context, { currentTarget: { dataset: { id: 'a' } } });

  assert.equal(context.data.selectedCount, 1);
  assert.equal(context.data.hasSelection, true);
  assert.equal(context.data.showBatchBar, true);
  assert.equal(context.data.containers[0].selectClass, 'selected');
});

test('batch delete only deletes selected containers that remain visible', () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      { _id: 'a', name: 'hidden selected box', locationPath: 'balcony', updatedAt: 2 },
      { _id: 'b', name: 'visible selected box', locationPath: 'bedroom', updatedAt: 1 }
    ],
    'findThings.items': [
      { _id: 'item-a', containerId: 'a', displayName: 'camp lamp', confirmed: true },
      { _id: 'item-b', containerId: 'b', displayName: 'blue book', confirmed: true }
    ]
  });
  const page = loadContainerListPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, {
    containers: [{ _id: 'b' }],
    selectedIds: ['a', 'b'],
    selectedCount: 2,
    hasSelection: true
  }));

  withWx(wxMock, () => {
    page.confirmBatchDelete.call(context);
  });

  const containers = wxMock.getStorageSync('findThings.containers');
  const items = wxMock.getStorageSync('findThings.items');
  assert.equal(containers.find((container) => container._id === 'a').deletedAt || null, null);
  assert.ok(containers.find((container) => container._id === 'b').deletedAt);
  assert.equal(items.find((item) => item._id === 'item-a').deletedAt || null, null);
  assert.ok(items.find((item) => item._id === 'item-b').deletedAt);
});
