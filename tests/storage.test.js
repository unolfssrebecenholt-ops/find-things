const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../miniprogram/services/storage');

function createMemoryAdapter(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    getStorageSync(key) {
      return data[key];
    },
    setStorageSync(key, value) {
      data[key] = value;
    },
    removeStorageSync(key) {
      delete data[key];
    }
  };
}

test('saves a container and confirmed items with shared ids', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '书桌左侧抽屉',
    locationPath: '卧室 / 书桌',
    coverImageFileId: '/tmp/cover.jpg',
    contentImageFileId: '/tmp/content.jpg',
    items: [
      { tempId: '1', displayName: '黑色笔', confirmed: true, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 } },
      { tempId: '2', displayName: '误识别', confirmed: false }
    ]
  });

  assert.equal(saved.container.itemCount, 1);
  assert.equal(saved.items[0].containerId, saved.container._id);
  assert.equal(saved.container.contentImageFileId, '/tmp/content.jpg');
  assert.equal(saved.container.contentImages[0].fileId, '/tmp/content.jpg');
  assert.equal(saved.items[0].sourceImageId, saved.container.contentImages[0].imageId);
  assert.equal(saved.items[0].sourceImageFileId, '/tmp/content.jpg');
  assert.equal(service.listContainers()[0].name, '书桌左侧抽屉');
  assert.equal(service.listItems().length, 1);
});

test('normalizes multiple content image inputs and keeps legacy first image field', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '客厅收纳箱',
    contentImageFileIds: ['/tmp/a.jpg', '/tmp/b.jpg'],
    items: [
      { displayName: '蓝色封面的书', confirmed: true, sourceImageFileId: '/tmp/b.jpg' }
    ]
  });

  assert.equal(saved.container.contentImages.length, 2);
  assert.equal(saved.container.contentImageFileId, '/tmp/a.jpg');
  assert.equal(saved.container.contentImages[0].label, '箱内照片 1');
  assert.equal(saved.container.contentImages[1].sortOrder, 1);
  assert.equal(saved.items[0].sourceImageId, saved.container.contentImages[1].imageId);
  assert.equal(saved.items[0].sourceImageFileId, '/tmp/b.jpg');
});

test('adds content images up to the free limit and reports upgrade prompt after that', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: 'V1 多图箱子',
    contentImageFileId: '/tmp/one.jpg'
  });

  const second = service.addContentImage(saved.container._id, { fileId: '/tmp/two.jpg', label: '右侧' });

  assert.equal(storage.FREE_CONTENT_IMAGE_LIMIT, 2);
  assert.equal(second.contentImages.length, 2);
  assert.throws(
    () => service.addContentImage(saved.container._id, { fileId: '/tmp/three.jpg' }),
    /免费版最多支持 2 张箱内照片/
  );
});

test('replaces only items from one source image and updates image and container counts', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '双照片箱子',
    contentImages: [
      { imageId: 'img_front', fileId: '/tmp/front.jpg', label: '正面' },
      { imageId: 'img_back', fileId: '/tmp/back.jpg', label: '背面' }
    ],
    items: [
      { displayName: '蓝色书', sourceImageId: 'img_front', confirmed: true },
      { displayName: '黑色签字笔', sourceImageId: 'img_back', confirmed: true }
    ]
  });

  const updated = service.replaceItemsForImage(saved.container._id, 'img_front', [
    { displayName: '蓝色封面的书', confirmed: true },
    { displayName: '普通书', confirmed: true }
  ]);

  assert.equal(updated.container.itemCount, 3);
  assert.deepEqual(
    service.getItemsByContainer(saved.container._id).map((item) => item.displayName).sort(),
    ['普通书', '蓝色封面的书', '黑色签字笔'].sort()
  );
  assert.equal(service.getContentImages(saved.container._id).find((image) => image.imageId === 'img_front').itemCount, 2);
  assert.equal(service.getContentImages(saved.container._id).find((image) => image.imageId === 'img_back').itemCount, 1);
});

test('replaces legacy single-image containers using a stable derived image id', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'legacy_container',
        name: 'Legacy box',
        contentImageFileId: '/tmp/legacy-content.jpg',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'legacy_item',
        containerId: 'legacy_container',
        displayName: '旧识别结果',
        sourceImageFileId: '/tmp/legacy-content.jpg',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ]
  }));

  const image = service.getContentImages('legacy_container')[0];
  const secondRead = service.getContentImages('legacy_container')[0];

  assert.equal(image.imageId, secondRead.imageId);

  const updated = service.replaceItemsForImage('legacy_container', image.imageId, [
    { displayName: '新识别结果', confirmed: true }
  ]);

  assert.equal(updated.container.itemCount, 1);
  assert.deepEqual(service.getItemsByContainer('legacy_container').map((item) => item.displayName), ['新识别结果']);
  assert.equal(service.getItemsByContainer('legacy_container')[0].sourceImageId, image.imageId);
  assert.equal(service.getItemsByContainer('legacy_container')[0].sourceImageFileId, '/tmp/legacy-content.jpg');
});

test('replaceItemsForImage removes legacy items that only match the source image file id', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'mixed_container',
        name: 'Mixed box',
        contentImages: [{ imageId: 'stable_image', fileId: '/tmp/stable.jpg', label: '箱内照片 1', sortOrder: 0, createdAt: 1, itemCount: 1 }],
        contentImageFileId: '/tmp/stable.jpg',
        itemCount: 2,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'legacy_file_only',
        containerId: 'mixed_container',
        displayName: '旧文件来源物品',
        sourceImageFileId: '/tmp/stable.jpg',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      },
      {
        _id: 'other_file',
        containerId: 'mixed_container',
        displayName: '其他照片物品',
        sourceImageFileId: '/tmp/other.jpg',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ]
  }));

  service.replaceItemsForImage('mixed_container', 'stable_image', [
    { displayName: '新文件来源物品', confirmed: true }
  ]);

  assert.deepEqual(
    service.getItemsByContainer('mixed_container').map((item) => item.displayName).sort(),
    ['其他照片物品', '新文件来源物品'].sort()
  );
});

test('deletes a container and its items', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '卧室 3 号箱',
    items: [{ displayName: '蓝色发卡', confirmed: true }]
  });

  service.deleteContainer(saved.container._id);

  assert.equal(service.getContainer(saved.container._id), null);
  assert.deepEqual(service.listItems(), []);
});

test('seeds demo data when storage is empty', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const seeded = service.seedDemoData();

  assert.ok(seeded.containers.length >= 1);
  assert.ok(seeded.containers.some((container) => container.contentImages.length >= 2));
  assert.ok(seeded.items.some((item) => item.displayName === '蓝色发卡'));
  assert.ok(new Set(seeded.items.map((item) => item.sourceImageId)).size >= 2);
  assert.equal(service.listContainers().length, seeded.containers.length);
});

test('seeded demo data fills the home album grid with warm prototype containers', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const names = service.listContainers().slice(0, 4).map((container) => container.name);

  assert.equal(names.length, 4);
  assert.deepEqual(names, [
    '书桌左侧抽屉',
    '卧室 3 号箱',
    '客厅工具盒',
    '露营装备袋'
  ]);
});

test('seeded demo data upgrades older one-container demo caches without touching real data', () => {
  const previousDemo = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'old_demo',
        name: '书桌左侧抽屉',
        contentImages: [{ imageId: 'demo_inside_left', fileId: '/assets/mock-container-content-left.jpg' }],
        contentImageFileId: '/assets/mock-container-content-left.jpg',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'old_demo_item',
        containerId: 'old_demo',
        displayName: '黑色笔',
        sourceImageId: 'demo_inside_left',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ]
  }));
  previousDemo.seedDemoData();
  assert.equal(previousDemo.listContainers().length, 4);
  assert.deepEqual(previousDemo.listContainers().slice(0, 4).map((container) => container.name), [
    '书桌左侧抽屉',
    '卧室 3 号箱',
    '客厅工具盒',
    '露营装备袋'
  ]);

  const realData = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'real_box',
        name: '我的真实箱子',
        itemCount: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': []
  }));
  realData.seedDemoData();
  assert.deepEqual(realData.listContainers().map((container) => container.name), ['我的真实箱子']);
});
