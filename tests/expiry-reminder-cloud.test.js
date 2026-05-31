const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

function loadExpiryReminderFunction(options = {}) {
  const modulePath = path.join(__dirname, '..', 'cloudfunctions', 'ftExpiryReminder', 'index.js');
  const originalLoad = Module._load;
  delete require.cache[require.resolve(modulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return options.cloud || createMockCloud(options);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createMockCloud(options = {}) {
  const collections = options.collections || {};
  const collectionPages = options.collectionPages || {};
  const updates = options.updates || [];
  const sets = options.sets || [];
  const sends = options.sends || [];
  const pageCalls = options.pageCalls || [];
  function createQuery(name, skipValue = 0, limitValue = 100) {
    return {
      skip(nextSkip) {
        return createQuery(name, nextSkip, limitValue);
      },
      limit(nextLimit) {
        return createQuery(name, skipValue, nextLimit);
      },
      get() {
        pageCalls.push({ name, skip: skipValue, limit: limitValue });
        if (collectionPages[name]) {
          const page = collectionPages[name][skipValue] || [];
          return Promise.resolve({ data: page });
        }
        return Promise.resolve({ data: Object.values(collections[name] || {}) });
      }
    };
  }
  return {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init(config) {
      options.initConfig = config;
    },
    database() {
      return {
        collection(name) {
          if (!collections[name]) collections[name] = {};
          return {
            get: createQuery(name).get,
            skip: createQuery(name).skip,
            limit: createQuery(name).limit,
            doc(id) {
              return {
                set({ data }) {
                  if (options.rejectDocumentIdInData && data && Object.prototype.hasOwnProperty.call(data, '_id')) {
                    return Promise.reject(new Error('document.set:fail -501007 invalid parameters. 不能更新 _id 的值'));
                  }
                  const next = Object.assign({ _id: id }, data);
                  sets.push({ collection: name, id, data: next });
                  collections[name][id] = next;
                  return Promise.resolve({});
                },
                update({ data }) {
                  updates.push({ collection: name, id, data });
                  collections[name][id] = Object.assign({}, collections[name][id] || {}, data);
                  return Promise.resolve({});
                }
              };
            }
          };
        }
      };
    },
    openapi: {
      subscribeMessage: {
        send(payload) {
          sends.push(payload);
          if (options.sendError) {
            return Promise.reject(options.sendError);
          }
          return Promise.resolve(options.sendResult || {});
        }
      }
    }
  };
}

test('cloud function loads with default collection names when miniprogram config is unavailable', () => {
  const modulePath = path.join(__dirname, '..', 'cloudfunctions', 'ftExpiryReminder', 'index.js');
  const configPath = path.join(__dirname, '..', 'miniprogram', 'config', 'cloud.js');
  const originalLoad = Module._load;
  delete require.cache[require.resolve(modulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return createMockCloud();
    if (request === '../../miniprogram/config/cloud') {
      throw new Error('missing config in deployed function package');
    }
    if (path.normalize(request) === path.normalize(configPath)) {
      throw new Error('missing config in deployed function package');
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const expiryReminder = require(modulePath);
    assert.equal(typeof expiryReminder.main, 'function');
  } finally {
    Module._load = originalLoad;
  }
});

test('cloud function declares subscribe message OpenAPI permission', () => {
  const configPath = path.join(__dirname, '..', 'cloudfunctions', 'ftExpiryReminder', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.ok(config.permissions);
  assert.ok(Array.isArray(config.permissions.openapi));
  assert.ok(config.permissions.openapi.includes('subscribeMessage.send'));
});

test('cloud function timer runs every minute for reminder testing', () => {
  const configPath = path.join(__dirname, '..', 'cloudfunctions', 'ftExpiryReminder', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const trigger = config.triggers.find((item) => item.name === 'dailyExpiryReminder');

  assert.equal(trigger.type, 'timer');
  assert.equal(trigger.config, '0 */1 * * * * *');
});

test('main returns a diagnostic function version for deployment verification', async () => {
  const expiryReminder = loadExpiryReminderFunction({
    collections: {
      ft_containers: {},
      ft_items: {},
      ft_reminder_notices: {}
    }
  });

  const result = await expiryReminder.main({ now: 1780243920000 }, {});

  assert.equal(result.version, 'ftExpiryReminder-2026-06-01-debug-v3');
});

test('selectDueReminderItems selects due reminders regardless subscription and skips read notices', () => {
  const { selectDueReminderItems } = loadExpiryReminderFunction();
  const now = Date.UTC(2026, 4, 31, 9);
  const items = [
    { _id: 'due', containerId: 'active', reminderEnabled: true, subscribeAccepted: true, remindAt: now - 1, remindedAt: 0 },
    { _id: 'future', containerId: 'active', reminderEnabled: true, subscribeAccepted: true, remindAt: now + 1, remindedAt: 0 },
    { _id: 'disabled', containerId: 'active', reminderEnabled: false, subscribeAccepted: true, remindAt: now - 1, remindedAt: 0 },
    { _id: 'rejected', containerId: 'active', reminderEnabled: true, subscribeAccepted: false, remindAt: now - 1, remindedAt: 0 },
    { _id: 'sent', containerId: 'active', reminderEnabled: true, subscribeAccepted: true, remindAt: now - 1, remindedAt: now - 2 },
    { _id: 'read', containerId: 'active', reminderEnabled: true, subscribeAccepted: true, remindAt: now - 1, remindedAt: 0 },
    { _id: 'legacyRead', containerId: 'active', reminderEnabled: true, subscribeAccepted: false, remindAt: now - 1, inAppReadAt: now - 3 },
    { _id: 'itemDeleted', containerId: 'active', deleted: true, reminderEnabled: true, subscribeAccepted: true, remindAt: now - 1, remindedAt: 0 },
    { _id: 'parentDeleted', containerId: 'deleted', reminderEnabled: true, subscribeAccepted: true, remindAt: now - 1, remindedAt: 0 }
  ];
  const containers = [
    { _id: 'active' },
    { _id: 'deleted', deleted: true }
  ];

  assert.deepEqual(
    selectDueReminderItems(items, containers, now, [
      { _id: `expiry_read_${now - 1}`, itemId: 'read', remindAt: now - 1, status: 'read' }
    ]).map((item) => item._id),
    ['due', 'rejected', 'sent']
  );
});

test('selectDueReminderItems supports container id aliases', () => {
  const { selectDueReminderItems } = loadExpiryReminderFunction();
  const now = 1000;
  const items = [
    { _id: 'containerId', containerId: 'a', reminderEnabled: true, subscribeAccepted: true, remindAt: now, remindedAt: 0 },
    { _id: 'parentId', parentId: 'b', reminderEnabled: true, subscribeAccepted: true, remindAt: now, remindedAt: 0 }
  ];

  assert.deepEqual(
    selectDueReminderItems(items, [{ _id: 'a' }, { id: 'b' }], now).map((item) => item._id),
    ['containerId', 'parentId']
  );
});

test('applySendSuccess marks the item reminded and clears previous error', () => {
  const { applySendSuccess } = loadExpiryReminderFunction();

  assert.deepEqual(
    applySendSuccess({ _id: 'item', lastReminderError: 'old', subscribeAccepted: true }, 1234),
    { remindedAt: 1234, lastReminderError: '' }
  );
});

test('applySendFailure downgrades to in-app fallback without marking it read', () => {
  const { applySendFailure } = loadExpiryReminderFunction();

  assert.deepEqual(
    applySendFailure({ _id: 'item', inAppReadAt: 555 }, 'send failed'),
    {
      subscribeAccepted: false,
      reminderChannel: 'inApp',
      lastReminderError: 'send failed'
    }
  );
});

test('main reports remaining days by Beijing calendar date', async () => {
  const now = Date.UTC(2026, 4, 31, 12);
  const updates = [];
  const sends = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active', name: 'Pantry' }
    },
    ft_items: {
      today: {
        _id: 'today',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        expiresAt: Date.UTC(2026, 4, 31, 15, 59, 59, 999),
        containerName: 'Fridge',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now - 1,
        remindedAt: 0
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, updates, sends });

  await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(sends[0].data.time16.value, '2026-05-31');
  assert.equal(sends[0].data.number2.value, '0');
});

test('main sends subscribe messages and stores success updates', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const sets = [];
  const sends = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active', name: 'Pantry' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        expiresAt: now + 86400000,
        containerName: 'Fridge',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now - 1,
        remindedAt: 0
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, updates, sets, sends });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.scanned, 1);
  assert.equal(result.notices, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].touser, 'user-openid');
  assert.equal(sends[0].templateId, 'template-id');
  assert.deepEqual(sends[0].data, {
    thing5: { value: 'Milk' },
    time16: { value: '2026-06-01' },
    thing10: { value: 'Fridge' },
    thing3: { value: '请及时处理' },
    number2: { value: '1' }
  });
  assert.deepEqual(updates, [
    {
      collection: 'ft_items',
      id: 'milk',
      data: { remindedAt: now, lastReminderError: '' }
    }
  ]);
  const notice = collections.ft_reminder_notices[`expiry_milk_${now - 1}`];
  assert.equal(notice.status, 'pending');
  assert.equal(notice.pushStatus, 'sent');
  assert.equal(notice.channel, 'subscribe');
  assert.equal(notice.sentAt, now);
  assert.match(notice.message, /Milk/);
});

test('main creates in-app notice records for rejected subscriptions without pushing', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const sets = [];
  const sends = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active', name: 'Pantry', locationPath: 'Kitchen' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        expiresAt: now - 1,
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindAt: now - 1,
        remindedAt: 0
      }
    },
    ft_reminder_notices: {}
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, updates, sets, sends });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.scanned, 1);
  assert.equal(result.notices, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(sends.length, 0);
  assert.deepEqual(updates, []);
  const notice = collections.ft_reminder_notices[`expiry_milk_${now - 1}`];
  assert.equal(notice._openid, 'user-openid');
  assert.equal(notice.type, 'expiry');
  assert.equal(notice.itemId, 'milk');
  assert.equal(notice.containerId, 'active');
  assert.equal(notice.status, 'pending');
  assert.equal(notice.pushStatus, 'none');
  assert.equal(notice.channel, 'inApp');
  assert.equal(notice.message, 'Milk 已过期，请及时处理。');
});

test('main writes notices without sending _id in document data', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const sets = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active', name: 'Pantry' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: false,
        reminderChannel: 'inApp',
        remindAt: now,
        remindedAt: 0
      }
    },
    ft_reminder_notices: {}
  };
  const expiryReminder = loadExpiryReminderFunction({
    collections,
    sets,
    rejectDocumentIdInData: true
  });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.notices, 1);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, `expiry_milk_${now}`);
  assert.equal(sets[0].data._id, `expiry_milk_${now}`);
});

test('main skips read notice records and never pushes them again', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const sends = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now,
        remindedAt: 0
      }
    },
    ft_reminder_notices: {
      [`expiry_milk_${now}`]: {
        _id: `expiry_milk_${now}`,
        itemId: 'milk',
        remindAt: now,
        status: 'read',
        pushStatus: 'none',
        readAt: now - 1
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, updates, sends });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.scanned, 0);
  assert.equal(result.sent, 0);
  assert.equal(sends.length, 0);
  assert.deepEqual(updates, []);
});

test('main does not rewrite existing in-app pending notices every minute', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const sets = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: false,
        remindAt: now,
        remindedAt: 0
      }
    },
    ft_reminder_notices: {
      [`expiry_milk_${now}`]: {
        _id: `expiry_milk_${now}`,
        itemId: 'milk',
        remindAt: now,
        status: 'pending',
        pushStatus: 'none',
        channel: 'inApp',
        createdAt: now - 1000
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, sets });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.scanned, 1);
  assert.equal(result.notices, 0);
  assert.equal(sets.length, 0);
});

test('main treats missing openid as NO_OPENID failure and in-app fallback', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const sends = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now,
        remindedAt: 0
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({ collections, updates, sends });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(sends.length, 0);
  assert.deepEqual(updates[0], {
    collection: 'ft_items',
    id: 'milk',
    data: {
      subscribeAccepted: false,
      reminderChannel: 'inApp',
      lastReminderError: 'NO_OPENID'
    }
  });
});

test('main downgrades subscribe send errors to in-app fallback', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const collections = {
    ft_containers: {
      active: { _id: 'active' }
    },
    ft_items: {
      milk: {
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now,
        remindedAt: 0
      }
    }
  };
  const expiryReminder = loadExpiryReminderFunction({
    collections,
    updates,
    sendError: new Error('subscribe unavailable')
  });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(updates[0], {
    collection: 'ft_items',
    id: 'milk',
    data: {
      subscribeAccepted: false,
      reminderChannel: 'inApp',
      lastReminderError: 'subscribe unavailable'
    }
  });
});

test('main scans all collection pages before sending reminders', async () => {
  const now = Date.UTC(2026, 4, 31, 9);
  const updates = [];
  const sends = [];
  const pageCalls = [];
  const filler = Array.from({ length: 100 }, (_, index) => ({
    _id: `filler_${index}`,
    containerId: 'active',
    reminderEnabled: false
  }));
  const collectionPages = {
    ft_containers: {
      0: [{ _id: 'active' }]
    },
    ft_items: {
      0: filler,
      100: [{
        _id: 'milk',
        _openid: 'user-openid',
        containerId: 'active',
        displayName: 'Milk',
        reminderEnabled: true,
        subscribeAccepted: true,
        remindAt: now,
        remindedAt: 0
      }]
    }
  };
  const expiryReminder = loadExpiryReminderFunction({
    collectionPages,
    updates,
    sends,
    pageCalls
  });

  const result = await expiryReminder.main({ now, templateId: 'template-id' }, {});

  assert.equal(result.sent, 1);
  assert.equal(updates[0].id, 'milk');
  assert.ok(pageCalls.some((call) => call.name === 'ft_items' && call.skip === 100));
});
