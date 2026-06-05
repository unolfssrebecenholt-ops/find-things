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

function createMockWxWithDatabase(initial = {}) {
  const local = {};
  const rows = {
    ft_containers: (initial.ft_containers || []).slice(),
    ft_items: (initial.ft_items || []).slice(),
    ft_reminder_notices: (initial.ft_reminder_notices || []).slice()
  };
  const writes = [];
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
        return Promise.resolve({
          data: (rows[name] || []).slice(skip, skip + limit)
        });
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
            writes.push({ collection: name, id, data: next });
            return Promise.resolve({});
          },
          update({ data }) {
            const index = rows[name].findIndex((record) => record._id === id);
            const next = Object.assign({}, index >= 0 ? rows[name][index] : { _id: id }, data);
            if (index >= 0) {
              rows[name][index] = next;
            } else {
              rows[name].push(next);
            }
            writes.push({ collection: name, id, data: next, update: data });
            return Promise.resolve({});
          }
        };
      }
    };
  }
  return {
    rows,
    writes,
    wx: {
      getStorageSync(key) {
        return local[key];
      },
      setStorageSync(key, value) {
        local[key] = value;
      },
      removeStorageSync(key) {
        delete local[key];
      },
      cloud: {
        database() {
          return { collection };
        }
      }
    }
  };
}

async function withWx(wxMock, fn) {
  const previousWx = global.wx;
  global.wx = wxMock;
  try {
    await fn();
  } finally {
    if (previousWx === undefined) {
      delete global.wx;
    } else {
      global.wx = previousWx;
    }
  }
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

test('normalizes tcb temporary image urls into durable cloud file ids', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const tempUrl = 'https://636c-cloud1-d2g79srh64b6eb263-1436902568.tcb.qcloud.la/find-things/content/inside.jpg?sign=abc&t=1780042287';
  const thumbTempUrl = 'https://636c-cloud1-d2g79srh64b6eb263-1436902568.tcb.qcloud.la/find-things/thumbs/inside.jpg?sign=def&t=1780042287';
  const expectedFileId = 'cloud://cloud1-d2g79srh64b6eb263.636c-cloud1-d2g79srh64b6eb263-1436902568/find-things/content/inside.jpg';
  const expectedThumbFileId = 'cloud://cloud1-d2g79srh64b6eb263.636c-cloud1-d2g79srh64b6eb263-1436902568/find-things/thumbs/inside.jpg';
  const saved = service.saveContainer({
    name: '临时链接箱',
    coverImageFileId: tempUrl,
    contentImages: [
      {
        imageId: 'temp_inside',
        fileId: tempUrl,
        thumbFileId: thumbTempUrl
      }
    ],
    items: [
      { displayName: '白色袋子', confirmed: true, sourceImageFileId: tempUrl }
    ]
  });

  assert.equal(saved.container.coverImageFileId, expectedFileId);
  assert.equal(saved.container.contentImages[0].fileId, expectedFileId);
  assert.equal(saved.container.contentImages[0].thumbFileId, expectedThumbFileId);
  assert.equal(saved.items[0].sourceImageFileId, expectedFileId);
});

test('reads legacy items embedded on container records', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'legacy_embedded_box',
        name: '历史容器',
        contentImageFileId: '/tmp/inside.jpg',
        itemCount: 2,
        updatedAt: 2,
        deletedAt: null,
        items: [
          { displayName: '黄色标签贴', confirmed: true },
          { displayName: '不保存条目', confirmed: false }
        ]
      }
    ],
    'findThings.items': []
  }));

  const items = service.getItemsByContainer('legacy_embedded_box');

  assert.equal(items.length, 1);
  assert.equal(items[0].displayName, '黄色标签贴');
  assert.equal(items[0].containerId, 'legacy_embedded_box');
  assert.equal(items[0].sourceImageFileId, '/tmp/inside.jpg');
  assert.equal(items[0].sourceImageId, service.getContentImages('legacy_embedded_box')[0].imageId);
});

test('reads legacy items embedded on content images', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'legacy_image_items_box',
        name: '按照片存的历史容器',
        itemCount: 2,
        updatedAt: 2,
        deletedAt: null,
        contentImages: [
          {
            imageId: 'inside_photo',
            fileId: '/tmp/inside-photo.jpg',
            label: '箱内照片',
            itemCount: 2,
            result: {
              items: [
                { itemName: '茶百道贴纸', confirmed: true },
                { objectName: '黑色位置小物', confirmed: true }
              ]
            }
          }
        ]
      }
    ],
    'findThings.items': []
  }));

  const items = service.getItemsByContainer('legacy_image_items_box');

  assert.deepEqual(items.map((item) => item.displayName), ['茶百道贴纸', '黑色位置小物']);
  assert.equal(items[0].sourceImageId, 'inside_photo');
  assert.equal(items[0].sourceImageFileId, '/tmp/inside-photo.jpg');
  assert.equal(items[0].sourceImageLabel, '箱内照片');
});

test('reads legacy stored items with alternate container and name fields', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'alternate_fields_box',
        name: '旧字段箱子',
        contentImages: [
          { image_id: 'old_inside', imageFileId: '/tmp/old-inside.jpg', label: '旧照片' }
        ],
        itemCount: 2,
        updatedAt: 2,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'old_item_1',
        boxId: 'alternate_fields_box',
        itemName: '旧字段钥匙',
        image_id: 'old_inside',
        confirmed: true
      },
      {
        _id: 'old_item_2',
        container_id: 'alternate_fields_box',
        object_name: '旧字段卡片',
        imageFileId: '/tmp/old-inside.jpg',
        confirmed: true
      }
    ]
  }));

  const items = service.getItemsByContainer('alternate_fields_box');

  assert.deepEqual(items.map((item) => item.displayName), ['旧字段钥匙', '旧字段卡片']);
  assert.equal(items[0].containerId, 'alternate_fields_box');
  assert.equal(service.getContentImages('alternate_fields_box')[0].imageId, 'old_inside');
});

test('stores prototype-ready image metadata and item location text', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '书桌左侧抽屉',
    contentImages: [
      {
        imageId: 'drawer_left',
        fileId: '/tmp/drawer-left.jpg',
        label: '照片 1',
        orientation: 'landscape',
        width: 1600,
        height: 900,
        analyzeStatus: 'ready',
        analyzedAt: 100
      }
    ],
    items: [
      {
        displayName: '蓝色绘画本',
        sourceImageId: 'drawer_left',
        relativePosition: '右上',
        confirmed: true
      }
    ]
  });

  assert.equal(saved.container.contentImages[0].orientation, 'landscape');
  assert.equal(saved.container.contentImages[0].width, 1600);
  assert.equal(saved.container.contentImages[0].height, 900);
  assert.equal(saved.container.contentImages[0].analyzeStatus, 'ready');
  assert.equal(saved.items[0].sourceImageIndex, 0);
  assert.equal(saved.items[0].sourceImageLabel, '照片 1');
  assert.equal(saved.items[0].locationText, '照片 1 · 右上');
});

test('saveContainer preserves and normalizes reminder fields', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const expiresAt = Date.UTC(2026, 5, 10, 15, 59, 59, 999);

  const saved = service.saveContainer({
    name: 'Expiry box',
    items: [
      {
        displayName: 'Milk',
        confirmed: true,
        expiresAt,
        reminderEnabled: true,
        remindOffsetDays: 2,
        subscribeAccepted: true
      },
      {
        displayName: 'Legacy item',
        confirmed: true
      }
    ]
  });
  const items = service.listItems();
  const reminderItem = items.find((item) => item._id === saved.items[0]._id);
  const legacyItem = items.find((item) => item._id === saved.items[1]._id);

  assert.equal(reminderItem.expiresAt, expiresAt);
  assert.equal(reminderItem.reminderEnabled, true);
  assert.equal(reminderItem.remindOffsetDays, 2);
  assert.equal(reminderItem.remindAt, expiresAt - 2 * 24 * 60 * 60 * 1000);
  assert.equal(reminderItem.reminderChannel, 'subscribe');
  assert.equal(reminderItem.subscribeAccepted, true);
  assert.equal(legacyItem.expiresAt, 0);
  assert.equal(legacyItem.reminderEnabled, false);
  assert.equal(legacyItem.remindAt, 0);
  assert.equal(legacyItem.reminderChannel, 'inApp');
});

test('saveContainer clears reminder delivery state when reminder settings change', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const firstExpiry = Date.UTC(2026, 5, 10, 15, 59, 59, 999);
  const secondExpiry = Date.UTC(2026, 5, 12, 15, 59, 59, 999);
  const saved = service.saveContainer({
    name: 'Expiry state box',
    items: [
      {
        _id: 'expiry_state_item',
        displayName: 'Yogurt',
        confirmed: true,
        expiresAt: firstExpiry,
        reminderEnabled: true,
        remindOffsetDays: 1,
        remindedAt: 100,
        inAppReadAt: 90,
        lastReminderError: 'old'
      }
    ]
  });

  const updated = service.saveContainer(Object.assign({}, saved.container, {
    items: [
      Object.assign({}, saved.items[0], {
        expiresAt: secondExpiry,
        remindedAt: 100,
        inAppReadAt: 90,
        lastReminderError: 'old'
      })
    ]
  }));

  assert.equal(updated.items[0].remindedAt, 0);
  assert.equal(updated.items[0].inAppReadAt, 0);
  assert.equal(updated.items[0].lastReminderError, '');
  assert.equal(updated.items[0].remindAt, secondExpiry - 24 * 60 * 60 * 1000);
});

test('replaceItemsForImage preserves and normalizes reminder fields', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: 'Image expiry box',
    contentImages: [
      { imageId: 'img_front', fileId: '/tmp/front.jpg', label: 'Front' }
    ],
    items: []
  });
  const expiresAt = Date.UTC(2026, 5, 10, 15, 59, 59, 999);

  const updated = service.replaceItemsForImage(saved.container._id, 'img_front', [
    {
      displayName: 'Cheese',
      confirmed: true,
      expiresAt,
      reminderEnabled: true,
      remindOffsetDays: 3,
      subscribeAccepted: false
    }
  ]);

  assert.equal(updated.items[0].expiresAt, expiresAt);
  assert.equal(updated.items[0].reminderEnabled, true);
  assert.equal(updated.items[0].remindOffsetDays, 3);
  assert.equal(updated.items[0].remindAt, expiresAt - 3 * 24 * 60 * 60 * 1000);
  assert.equal(updated.items[0].reminderChannel, 'inApp');
  assert.equal(updated.items[0].subscribeAccepted, false);
});

test('marks in-app reminders read without changing expiry settings', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const expiresAt = Date.UTC(2026, 5, 10, 15, 59, 59, 999);
  const saved = service.saveContainer({
    name: 'Read reminder box',
    items: [
      {
        _id: 'read_reminder_item',
        displayName: 'Milk',
        confirmed: true,
        expiresAt,
        reminderEnabled: true,
        remindOffsetDays: 1,
        subscribeAccepted: false
      }
    ]
  });

  const result = service.markItemReminderRead(saved.items[0]._id, 12345);

  assert.equal(result.item._id, 'read_reminder_item');
  assert.equal(result.item.inAppReadAt, 12345);
  assert.equal(result.item.expiresAt, expiresAt);
  assert.equal(result.item.reminderEnabled, true);
  assert.equal(service.listItems()[0].inAppReadAt, 12345);
});

test('lists pending reminder notices and hides read notices', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.reminderNotices': [
      {
        _id: 'notice_pending',
        itemId: 'milk',
        displayName: 'Milk',
        message: 'Milk 已过期，请及时处理。',
        status: 'pending',
        createdAt: 2
      },
      {
        _id: 'notice_read',
        itemId: 'tea',
        displayName: 'Tea',
        message: 'Tea 已过期，请及时处理。',
        status: 'read',
        createdAt: 3
      }
    ]
  }));

  const notices = service.listPendingReminderNotices();

  assert.deepEqual(notices.map((notice) => notice._id), ['notice_pending']);
  assert.equal(notices[0].message, 'Milk 已过期，请及时处理。');
});

test('markReminderNoticeRead marks the notice read and updates the related item read timestamp', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.reminderNotices': [
      {
        _id: 'notice_pending',
        itemId: 'milk',
        status: 'pending',
        createdAt: 2
      }
    ],
    'findThings.items': [
      {
        _id: 'milk',
        containerId: 'box',
        displayName: 'Milk',
        reminderEnabled: true,
        inAppReadAt: 0,
        deletedAt: null
      }
    ]
  }));

  const result = service.markReminderNoticeRead('notice_pending', 12345);

  assert.equal(result.notice.status, 'read');
  assert.equal(result.notice.readAt, 12345);
  assert.equal(service.listPendingReminderNotices().length, 0);
  assert.equal(service.listItems()[0].inAppReadAt, 12345);
});

test('dismissReminderNotices hides matching pending notices from reminder counts', () => {
  const adapter = createMemoryAdapter({
    'findThings.reminderNotices': [
      {
        _id: 'notice_milk',
        itemId: 'milk',
        containerId: 'box',
        displayName: 'Milk',
        status: 'pending',
        createdAt: 3
      },
      {
        _id: 'notice_tea',
        itemId: 'tea',
        containerId: 'box',
        displayName: 'Tea',
        status: 'pending',
        createdAt: 2
      }
    ]
  });
  const service = storage.createStorageService(adapter);

  const result = service.dismissReminderNotices({
    itemIds: ['milk'],
    reason: 'item_deleted'
  }, 12345);

  assert.equal(result.dismissedCount, 1);
  assert.deepEqual(service.listPendingReminderNotices().map((notice) => notice._id), ['notice_tea']);
  const storedNotices = adapter.getStorageSync('findThings.reminderNotices');
  assert.equal(storedNotices.find((notice) => notice._id === 'notice_milk').status, 'dismissed');
  assert.equal(storedNotices.find((notice) => notice._id === 'notice_milk').dismissedReason, 'item_deleted');
});

test('deleteItem deletes one item and dismisses only its reminder notice', () => {
  const adapter = createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'box',
        name: '冰箱',
        contentImages: [{ imageId: 'inside', fileId: '/tmp/inside.jpg', itemCount: 2 }],
        itemCount: 2,
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
        sourceImageId: 'inside',
        confirmed: true,
        deletedAt: null
      },
      {
        _id: 'tea',
        containerId: 'box',
        displayName: '茶包',
        sourceImageId: 'inside',
        confirmed: true,
        deletedAt: null
      }
    ],
    'findThings.reminderNotices': [
      { _id: 'notice_milk', itemId: 'milk', containerId: 'box', status: 'pending', createdAt: 3 },
      { _id: 'notice_tea', itemId: 'tea', containerId: 'box', status: 'pending', createdAt: 2 }
    ]
  });
  const service = storage.createStorageService(adapter);

  const result = service.deleteItem('milk');

  assert.equal(result.item._id, 'milk');
  assert.equal(result.dismissedReminderCount, 1);
  assert.deepEqual(service.getItemsByContainer('box').map((item) => item._id), ['tea']);
  assert.equal(service.getContainer('box').itemCount, 1);
  assert.equal(service.getContentImages('box')[0].itemCount, 1);
  assert.deepEqual(service.listPendingReminderNotices().map((notice) => notice._id), ['notice_tea']);
});

test('deleteItem suppresses legacy embedded items instead of rehydrating them', () => {
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'legacy_box',
        name: '旧箱子',
        itemCount: 2,
        updatedAt: 1,
        deletedAt: null,
        items: [
          { displayName: '旧牛奶', confirmed: true },
          { displayName: '旧茶包', confirmed: true }
        ]
      }
    ],
    'findThings.items': []
  }));
  const originalItems = service.getItemsByContainer('legacy_box');

  service.deleteItem(originalItems[0]._id);

  assert.deepEqual(service.getItemsByContainer('legacy_box').map((item) => item.displayName), ['旧茶包']);
  assert.equal(service.getContainer('legacy_box').itemCount, 1);

  service.deleteItem(service.getItemsByContainer('legacy_box')[0]._id);
  service.saveContainer({ name: '其它箱子', items: [] });

  assert.deepEqual(service.getItemsByContainer('legacy_box'), []);
  assert.equal(service.getContainer('legacy_box').itemCount, 0);
});

test('keeps thumbnail file ids alongside durable container image paths', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: '封面箱子',
    coverImageFileId: '/tmp/cover.jpg',
    coverThumbFileId: '/tmp/cover-thumb.jpg',
    contentImages: [
      {
        imageId: 'thumb_image',
        fileId: '/tmp/content.jpg',
        thumbFileId: '/tmp/content-thumb.jpg'
      }
    ]
  });

  assert.equal(saved.container.coverThumbFileId, '/tmp/cover-thumb.jpg');
  assert.equal(saved.container.contentImages[0].thumbFileId, '/tmp/content-thumb.jpg');
  assert.equal(saved.container.contentThumbFileId, '/tmp/content-thumb.jpg');
});

test('adds content images up to the configured limit and reports a neutral prompt after that', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const saved = service.saveContainer({
    name: 'V1 多图箱子',
    contentImageFileId: '/tmp/one.jpg'
  });

  let updated = saved.container;
  for (const fileId of ['/tmp/two.jpg', '/tmp/three.jpg', '/tmp/four.jpg', '/tmp/five.jpg']) {
    updated = service.addContentImage(saved.container._id, {
      fileId,
      label: '补充照片',
      analyzeStatus: 'ready',
      analyzedAt: 200
    });
  }

  assert.equal(storage.CONTENT_IMAGE_LIMIT, 5);
  assert.equal(updated.contentImages.length, 5);
  assert.equal(updated.contentImages[1].analyzeStatus, 'ready');
  assert.equal(updated.contentImages[1].analyzedAt, 200);
  assert.throws(
    () => service.addContentImage(saved.container._id, {
      fileId: '/tmp/six.jpg',
      label: '右侧',
      analyzeStatus: 'ready',
      analyzedAt: 200
    }),
    /最多可保存 5 张箱内照片/
  );
});

test('limits user containers to five while allowing existing updates', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const first = service.saveContainer({ name: '箱子 1' });
  service.saveContainer({ name: '箱子 2' });
  service.saveContainer({ name: '箱子 3' });
  service.saveContainer({ name: '箱子 4' });
  service.saveContainer({ name: '箱子 5' });

  assert.equal(storage.CONTAINER_LIMIT, 5);
  assert.throws(
    () => service.saveContainer({ name: '箱子 6' }),
    /最多可保存 5 个箱子/
  );

  service.saveContainer(Object.assign({}, first.container, { name: '箱子 1 更新' }));
  assert.equal(service.getContainer(first.container._id).name, '箱子 1 更新');
});

test('async storage loads from and writes to cloud database collections', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'existing_box',
        name: '已有箱子',
        itemCount: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: []
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const loaded = await service.listUserContainersAsync();
    assert.deepEqual(loaded.map((container) => container.name), ['已有箱子']);

    const saved = await service.saveContainerAsync({
      name: '数据库箱子',
      contentImageFileId: '/tmp/db.jpg',
      items: [{ displayName: '钥匙', confirmed: true }]
    });

    assert.ok(mock.rows.ft_containers.some((container) => container._id === saved.container._id));
    assert.ok(mock.rows.ft_items.some((item) => item.containerId === saved.container._id));
    assert.ok(mock.writes.some((write) => write.collection === 'ft_containers'));
    assert.ok(mock.writes.some((write) => write.collection === 'ft_items'));
  });
});

test('async delete does not write cloud database system fields back to documents', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'existing_box',
        _openid: 'owner_openid',
        name: '已有箱子',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [
      {
        _id: 'existing_item',
        _openid: 'owner_openid',
        containerId: 'existing_box',
        displayName: '旧物品',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ]
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    await service.deleteContainerAsync('existing_box');

    const writtenContainer = mock.writes.find((write) => write.collection === 'ft_containers');
    const writtenItem = mock.writes.find((write) => write.collection === 'ft_items');
    assert.ok(writtenContainer);
    assert.ok(writtenItem);
    assert.equal(writtenContainer.data._openid, undefined);
    assert.equal(writtenItem.data._openid, undefined);
  });
});

test('async storage migrates existing local cache when database is empty', async () => {
  const mock = createMockWxWithDatabase();
  mock.wx.setStorageSync('findThings.containers', [
    {
      _id: 'local_box',
      name: '本地旧箱子',
      itemCount: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null
    }
  ]);
  mock.wx.setStorageSync('findThings.items', [
    {
      _id: 'local_item',
      containerId: 'local_box',
      displayName: '旧物品',
      confirmed: true,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null
    }
  ]);

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const loaded = await service.listUserContainersAsync();

    assert.deepEqual(loaded.map((container) => container.name), ['本地旧箱子']);
    assert.ok(mock.rows.ft_containers.some((container) => container._id === 'local_box'));
    assert.ok(mock.rows.ft_items.some((item) => item._id === 'local_item'));
  });
});

test('async storage keeps local items when cloud has only the container row', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'cloud_box',
        name: '云端箱子',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: []
  });
  mock.wx.setStorageSync('findThings.containers', [
    {
      _id: 'cloud_box',
      name: '云端箱子',
      itemCount: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null
    }
  ]);
  mock.wx.setStorageSync('findThings.items', [
    {
      _id: 'local_item_for_cloud_box',
      containerId: 'cloud_box',
      displayName: '本地清单物品',
      confirmed: true,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null
    }
  ]);

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const items = await service.getItemsByContainerAsync('cloud_box');

    assert.deepEqual(items.map((item) => item.displayName), ['本地清单物品']);
    assert.ok(mock.rows.ft_items.some((item) => item._id === 'local_item_for_cloud_box'));
  });
});

test('async storage reads cloud items with legacy foreign key fields', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'cloud_legacy_box',
        name: '云端旧字段箱',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [
      {
        _id: 'cloud_legacy_item',
        box_id: 'cloud_legacy_box',
        label: '云端旧字段物品',
        confirmed: true,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ]
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const items = await service.getItemsByContainerAsync('cloud_legacy_box');

    assert.deepEqual(items.map((item) => item.displayName), ['云端旧字段物品']);
    assert.equal(items[0].containerId, 'cloud_legacy_box');
  });
});

test('async storage does not persist subscription upgrades without a fresh request', async () => {
  const now = Date.UTC(2026, 5, 9);
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'cloud_reminder_box',
        name: 'Cloud reminder box',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [
      {
        _id: 'cloud_future_item',
        containerId: 'cloud_reminder_box',
        displayName: 'Cloud future milk',
        expiresAt: Date.UTC(2026, 5, 12),
        remindAt: Date.UTC(2026, 5, 11),
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        lastReminderError: 'user refused',
        remindedAt: 0,
        deletedAt: null
      }
    ]
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const result = await service.upgradeFutureReminderSubscriptionsAsync(now);

    assert.deepEqual(result.updatedIds, []);
    const writtenItem = mock.writes.find((write) => write.collection === 'ft_items' && write.id === 'cloud_future_item');
    assert.equal(writtenItem, undefined);
  });
});

test('async storage loads reminder notices and persists read acknowledgements', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'cloud_reminder_box',
        name: 'Cloud reminder box',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [
      {
        _id: 'cloud_notice_item',
        containerId: 'cloud_reminder_box',
        displayName: 'Cloud milk',
        reminderEnabled: true,
        inAppReadAt: 0,
        deletedAt: null
      }
    ],
    ft_reminder_notices: [
      {
        _id: 'cloud_notice',
        itemId: 'cloud_notice_item',
        containerId: 'cloud_reminder_box',
        displayName: 'Cloud milk',
        message: 'Cloud milk 已过期，请及时处理。',
        status: 'pending',
        pushStatus: 'none',
        createdAt: 2
      }
    ]
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const notices = await service.listPendingReminderNoticesAsync();
    assert.deepEqual(notices.map((notice) => notice._id), ['cloud_notice']);

    await service.markReminderNoticeReadAsync('cloud_notice', 12345);

    const writtenNotice = mock.writes.find((write) => write.collection === 'ft_reminder_notices' && write.id === 'cloud_notice');
    const writtenItem = mock.writes.find((write) => write.collection === 'ft_items' && write.id === 'cloud_notice_item');
    assert.ok(writtenNotice);
    assert.equal(writtenNotice.data.status, 'read');
    assert.equal(writtenNotice.data.readAt, 12345);
    assert.ok(writtenItem);
    assert.equal(writtenItem.data.inAppReadAt, 12345);
  });
});

test('async deleteContainer persists dismissed reminder notices to cloud', async () => {
  const mock = createMockWxWithDatabase({
    ft_containers: [
      {
        _id: 'cloud_delete_box',
        name: 'Cloud delete box',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    ft_items: [
      {
        _id: 'cloud_delete_item',
        containerId: 'cloud_delete_box',
        displayName: 'Cloud milk',
        confirmed: true,
        deletedAt: null
      }
    ],
    ft_reminder_notices: [
      {
        _id: 'cloud_delete_notice',
        itemId: 'cloud_delete_item',
        containerId: 'cloud_delete_box',
        displayName: 'Cloud milk',
        status: 'pending',
        pushStatus: 'none',
        createdAt: 2
      }
    ]
  });

  await withWx(mock.wx, async () => {
    const service = storage.createStorageService();
    const result = await service.deleteContainerAsync('cloud_delete_box');

    assert.equal(result.dismissedReminderCount, 1);
    const writtenNotice = mock.writes.find((write) => (
      write.collection === 'ft_reminder_notices' && write.id === 'cloud_delete_notice'
    ));
    assert.ok(writtenNotice);
    assert.equal(writtenNotice.data.status, 'dismissed');
    assert.equal(writtenNotice.data.dismissedReason, 'container_deleted');
  });
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

test('does not upgrade in-app reminders to subscription without a fresh request', () => {
  const now = Date.UTC(2026, 5, 9);
  const service = storage.createStorageService(createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'reminder_box',
        name: 'Reminder box',
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      {
        _id: 'future_item',
        containerId: 'reminder_box',
        displayName: 'Future milk',
        expiresAt: Date.UTC(2026, 5, 12),
        remindAt: Date.UTC(2026, 5, 11),
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        lastReminderError: 'user refused',
        remindedAt: 0,
        deletedAt: null
      },
      {
        _id: 'due_item',
        containerId: 'reminder_box',
        displayName: 'Due milk',
        expiresAt: Date.UTC(2026, 5, 10),
        remindAt: Date.UTC(2026, 5, 8),
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindedAt: 0,
        deletedAt: null
      }
    ]
  }));

  const result = service.upgradeFutureReminderSubscriptions(now);
  const items = service.listItems();

  assert.deepEqual(result.updatedIds, []);
  assert.equal(items.find((item) => item._id === 'future_item').subscribeAccepted, false);
  assert.equal(items.find((item) => item._id === 'future_item').reminderChannel, 'inApp');
  assert.equal(items.find((item) => item._id === 'future_item').lastReminderError, 'user refused');
  assert.equal(items.find((item) => item._id === 'due_item').subscribeAccepted, false);
  assert.equal(items.find((item) => item._id === 'due_item').reminderChannel, 'inApp');
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

test('deleting a container dismisses reminders by container id and legacy item id', () => {
  const adapter = createMemoryAdapter({
    'findThings.containers': [
      {
        _id: 'box',
        name: '冰箱',
        itemCount: 2,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      },
      {
        _id: 'other_box',
        name: '茶柜',
        itemCount: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null
      }
    ],
    'findThings.items': [
      { _id: 'milk', containerId: 'box', displayName: '牛奶', confirmed: true, deletedAt: null },
      { _id: 'mask', containerId: 'box', displayName: '面膜', confirmed: true, deletedAt: null },
      { _id: 'tea', containerId: 'other_box', displayName: '茶包', confirmed: true, deletedAt: null }
    ],
    'findThings.reminderNotices': [
      { _id: 'notice_milk', itemId: 'milk', containerId: 'box', status: 'pending', createdAt: 4 },
      { _id: 'notice_mask_legacy', itemId: 'mask', status: 'pending', createdAt: 3 },
      { _id: 'notice_tea', itemId: 'tea', containerId: 'other_box', status: 'pending', createdAt: 2 }
    ]
  });
  const service = storage.createStorageService(adapter);

  const result = service.deleteContainer('box');

  assert.equal(result.dismissedReminderCount, 2);
  assert.deepEqual(service.listPendingReminderNotices().map((notice) => notice._id), ['notice_tea']);
  const storedNotices = adapter.getStorageSync('findThings.reminderNotices');
  assert.equal(storedNotices.find((notice) => notice._id === 'notice_milk').status, 'dismissed');
  assert.equal(storedNotices.find((notice) => notice._id === 'notice_mask_legacy').status, 'dismissed');
});

test('batch deletes selected containers and their items', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  const first = service.saveContainer({
    name: '书桌左侧抽屉',
    items: [{ displayName: '蓝色绘画本', confirmed: true }]
  });
  const second = service.saveContainer({
    name: '客厅工具盒',
    items: [{ displayName: '卷尺', confirmed: true }]
  });
  const third = service.saveContainer({
    name: '卧室 3 号箱',
    items: [{ displayName: '围巾', confirmed: true }]
  });

  const result = service.deleteContainers([first.container._id, second.container._id]);

  assert.equal(result.deletedCount, 2);
  assert.deepEqual(service.listContainers().map((container) => container._id), [third.container._id]);
  assert.deepEqual(service.listItems().map((item) => item.displayName), ['围巾']);
});

test('batch delete dismisses reminder notices for all selected containers', () => {
  const adapter = createMemoryAdapter({
    'findThings.containers': [
      { _id: 'box_a', name: 'A', itemCount: 1, deletedAt: null },
      { _id: 'box_b', name: 'B', itemCount: 1, deletedAt: null },
      { _id: 'box_c', name: 'C', itemCount: 1, deletedAt: null }
    ],
    'findThings.items': [
      { _id: 'a_item', containerId: 'box_a', displayName: 'A item', confirmed: true, deletedAt: null },
      { _id: 'b_item', containerId: 'box_b', displayName: 'B item', confirmed: true, deletedAt: null },
      { _id: 'c_item', containerId: 'box_c', displayName: 'C item', confirmed: true, deletedAt: null }
    ],
    'findThings.reminderNotices': [
      { _id: 'notice_a', itemId: 'a_item', containerId: 'box_a', status: 'pending', createdAt: 3 },
      { _id: 'notice_b', itemId: 'b_item', containerId: 'box_b', status: 'pending', createdAt: 2 },
      { _id: 'notice_c', itemId: 'c_item', containerId: 'box_c', status: 'pending', createdAt: 1 }
    ]
  });
  const service = storage.createStorageService(adapter);

  const result = service.deleteContainers(['box_a', 'box_b']);

  assert.equal(result.dismissedReminderCount, 2);
  assert.deepEqual(service.listPendingReminderNotices().map((notice) => notice._id), ['notice_c']);
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

test('seeded demo data fills the prototype container list with sample containers', () => {
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

test('user-facing lists can exclude seeded demo data', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  assert.equal(service.listContainers().length, 4);
  assert.deepEqual(service.listUserContainers(), []);
  assert.deepEqual(service.listUserItems(), []);

  const saved = service.saveContainer({
    name: '我的真实箱子',
    contentImageFileId: '/tmp/real.jpg',
    items: [{ displayName: '钥匙串', confirmed: true }]
  });

  assert.deepEqual(service.listUserContainers().map((container) => container._id), [saved.container._id]);
  assert.deepEqual(service.listUserItems().map((item) => item.displayName), ['钥匙串']);
});

test('removeDemoData clears historical demo records but keeps real containers', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();
  service.saveContainer({
    name: '真实抽屉',
    contentImageFileId: '/tmp/real-drawer.jpg',
    items: [{ displayName: '纸巾', confirmed: true }]
  });

  service.removeDemoData();

  assert.deepEqual(service.listContainers().map((container) => container.name), ['真实抽屉']);
  assert.deepEqual(service.listItems().map((item) => item.displayName), ['纸巾']);
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
