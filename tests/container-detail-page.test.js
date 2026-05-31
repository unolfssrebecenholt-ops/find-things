const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function createWxMock(initialStorage) {
  const storage = Object.assign({}, initialStorage);
  const toasts = [];
  const tempFileURLCalls = [];
  return {
    toasts,
    tempFileURLCalls,
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
    showToast(options) {
      toasts.push(options);
    },
    showModal(options) {
      options.success({ confirm: true });
    },
    cloud: {
      getTempFileURL(options) {
        tempFileURLCalls.push(options.fileList);
        const fileList = (options.fileList || []).map((file) => ({
          fileID: file.fileID,
          tempFileURL: `https://display.example.com/${encodeURIComponent(file.fileID)}`
        }));
        options.success({ fileList });
      }
    }
  };
}

function loadContainerDetailPage(wxMock) {
  const pagePath = path.join(__dirname, '..', 'miniprogram', 'pages', 'container', 'detail.js');
  const storagePath = path.join(__dirname, '..', 'miniprogram', 'services', 'storage.js');
  const imagePreviewPath = path.join(__dirname, '..', 'miniprogram', 'utils', 'image-preview.js');
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition = null;

  delete require.cache[require.resolve(pagePath)];
  delete require.cache[require.resolve(storagePath)];
  delete require.cache[require.resolve(imagePreviewPath)];

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
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      global.wx = previousWx;
    });
}

test('container detail expands inventory items and persists edits', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'box_1',
        name: '日用品收纳',
        locationPath: '浴室',
        contentImages: [
          { imageId: 'inside_1', fileId: '/tmp/inside.jpg', label: '照片 1', sortOrder: 0 }
        ],
        updatedAt: 2
      }
    ],
    'findThings.items': [
      {
        _id: 'item_1',
        containerId: 'box_1',
        displayName: '黑色小物',
        sourceImageId: 'inside_1',
        sourceImageFileId: '/tmp/inside.jpg',
        features: ['塑料'],
        confirmed: true
      }
    ]
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'box_1' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));
  page.toggleItemExpanded.call(context, { currentTarget: { dataset: { key: 'item_1' } } });

  assert.equal(context.data.items[0].isExpanded, true);

  await withWx(wxMock, () => page.handleExpandedItemChange.call(context, {
    detail: {
      contextKey: 'item_1',
      items: [
        Object.assign({}, context.data.items[0].editorItems[0], {
          displayName: '黑色位置磁吸小物',
          category: '配件',
          features: ['磁吸'],
          aliases: ['位置标记']
        })
      ]
    }
  }));
  await context.inventorySaveChain;

  const storedItems = wxMock.getStorageSync('findThings.items');
  assert.equal(storedItems.length, 1);
  assert.equal(storedItems[0].displayName, '黑色位置磁吸小物');
  assert.equal(storedItems[0].category, '配件');
  assert.deepEqual(storedItems[0].features, ['磁吸']);
  assert.equal(context.data.inventoryStatusText, '已保存修改');
  assert.equal(context.data.items[0].isExpanded, true);
});

test('container detail shows legacy items embedded on the container', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'legacy_box',
        name: '历史收纳箱',
        contentImageFileId: '/tmp/legacy-inside.jpg',
        itemCount: 5,
        updatedAt: 2,
        items: [
          { displayName: '透明收纳袋', features: ['透明'], confirmed: true },
          { displayName: '蓝色卡片', features: ['蓝色'], confirmed: true }
        ]
      }
    ],
    'findThings.items': []
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'legacy_box' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));

  assert.equal(context.data.hasItems, true);
  assert.equal(context.data.showItemsEmpty, false);
  assert.deepEqual(context.data.items.map((item) => item.displayName), ['透明收纳袋', '蓝色卡片']);
  assert.equal(context.data.contentImages[0].itemCount, 2);
});

test('container detail shows legacy items embedded on content images', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'legacy_image_items_box',
        name: '照片历史箱',
        itemCount: 5,
        updatedAt: 2,
        contentImages: [
          {
            imageId: 'inside_photo',
            fileId: '/tmp/inside-photo.jpg',
            label: '箱内照片',
            itemCount: 5,
            analysis: {
              items: [
                { itemName: '75%乙醇消毒湿巾', confirmed: true },
                { objectName: '黑色位置小物', confirmed: true }
              ]
            }
          }
        ]
      }
    ],
    'findThings.items': []
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'legacy_image_items_box' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));

  assert.equal(context.data.hasItems, true);
  assert.deepEqual(context.data.items.map((item) => item.displayName), ['75%乙醇消毒湿巾', '黑色位置小物']);
  assert.equal(context.data.contentImages[0].itemCount, 2);
});

test('container detail offers photo recovery when only historical count remains', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'count_only_box',
        name: '只有计数的箱',
        contentImageFileId: '/tmp/count-only.jpg',
        itemCount: 5,
        updatedAt: 2
      }
    ],
    'findThings.items': []
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'count_only_box' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));

  assert.equal(context.data.showItemsEmpty, false);
  assert.equal(context.data.showRecoverInventory, true);
  assert.equal(context.data.canRecoverInventory, true);
  assert.match(context.data.missingInventoryText, /5 件物品/);
});

test('container detail explains count-only history even without a photo', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'count_only_no_photo_box',
        name: '只有计数没有照片',
        itemCount: 3,
        updatedAt: 2
      }
    ],
    'findThings.items': []
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'count_only_no_photo_box' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));

  assert.equal(context.data.showItemsEmpty, false);
  assert.equal(context.data.showRecoverInventory, true);
  assert.equal(context.data.canRecoverInventory, false);
  assert.match(context.data.missingInventoryText, /3 件物品/);
});

test('container detail resolves cloud image ids to display urls without replacing stored ids', async () => {
  const wxMock = createWxMock({
    'findThings.containers': [
      {
        _id: 'cloud_photo_box',
        name: '云照片箱',
        coverImageFileId: 'cloud://env/find-things/covers/front.jpg',
        coverThumbFileId: 'cloud://env/find-things/thumbs/front.jpg',
        contentImages: [
          {
            imageId: 'inside_cloud',
            fileId: 'cloud://env/find-things/content/inside.jpg',
            thumbFileId: 'cloud://env/find-things/thumbs/inside.jpg',
            label: '箱内照片',
            sortOrder: 0
          }
        ],
        updatedAt: 2
      }
    ],
    'findThings.items': [
      {
        _id: 'cloud_item_1',
        containerId: 'cloud_photo_box',
        displayName: '白色线材',
        sourceImageId: 'inside_cloud',
        sourceImageFileId: 'cloud://env/find-things/content/inside.jpg',
        confirmed: true
      }
    ]
  });
  const page = loadContainerDetailPage(wxMock);
  const context = createPageContext(page, Object.assign({}, page.data, { id: 'cloud_photo_box' }));

  await withWx(wxMock, () => page.renderContainer.call(context, wxMock.getStorageSync('findThings.containers')[0]));

  assert.equal(context.data.container.coverDisplayFileId, undefined);
  assert.equal(context.data.container.coverImageFileId, 'cloud://env/find-things/covers/front.jpg');
  assert.equal(context.data.container.coverThumbFileId, 'cloud://env/find-things/thumbs/front.jpg');
  assert.match(context.data.contentImages[0].displayFileId, /^https:\/\/display\.example\.com\//);
  assert.match(context.data.contentImages[0].displayThumbFileId, /^https:\/\/display\.example\.com\//);
  assert.match(context.data.contentImages[0].displaySrc, /^https:\/\/display\.example\.com\//);
  assert.equal(context.data.contentImages[0].fileId, 'cloud://env/find-things/content/inside.jpg');

  await withWx(wxMock, () => page.addManualItem.call(context));
  await context.inventorySaveChain;

  const storedContainer = wxMock.getStorageSync('findThings.containers')[0];
  assert.equal(storedContainer.coverImageFileId, 'cloud://env/find-things/covers/front.jpg');
  assert.equal(storedContainer.contentImages[0].fileId, 'cloud://env/find-things/content/inside.jpg');
  assert.equal(storedContainer.contentImages[0].displayFileId, undefined);
  assert.equal(storedContainer.contentImages[0].displayThumbFileId, undefined);
  assert.equal(storedContainer.contentImages[0].displaySrc, undefined);
});
