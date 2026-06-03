const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

function loadItemEditor() {
  const componentPath = path.join(__dirname, '..', 'miniprogram', 'components', 'item-editor', 'index.js');
  const previousComponent = global.Component;
  let definition = null;

  delete require.cache[require.resolve(componentPath)];
  global.Component = (componentDefinition) => {
    definition = componentDefinition;
  };
  require(componentPath);
  global.Component = previousComponent;

  return definition;
}

function createComponentContext(definition, items) {
  const events = [];
  const context = {
    data: {
      items,
      contextKey: 'item_1'
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
    events
  };
  Object.assign(context, definition.methods);
  return context;
}

test('item editor exposes expiry date and reminder controls', () => {
  const wxml = readMiniProgramFile('components', 'item-editor', 'index.wxml');
  const wxss = readMiniProgramFile('components', 'item-editor', 'index.wxss');

  assert.match(wxml, /bindchange="toggleExpiry"/);
  assert.match(wxml, /mode="date"/);
  assert.match(wxml, /bindchange="changeExpiryDate"/);
  assert.doesNotMatch(wxml, /bindchange="toggleReminder"/);
  assert.match(wxml, /bindchange="changeReminderOffset"/);
  assert.match(wxss, /\.expiry-panel/);
  assert.match(wxss, /\.expiry-badge/);
});

test('item editor shows removable tags instead of a tag input', () => {
  const wxml = readMiniProgramFile('components', 'item-editor', 'index.wxml');
  const wxss = readMiniProgramFile('components', 'item-editor', 'index.wxss');
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: '透明收纳盒',
    colors: ['蓝色'],
    features: ['透明', '耐热'],
    aliases: ['透明', '盒子'],
    hasTags: true,
    tagList: ['蓝色', '透明', '耐热', '盒子'],
    tagText: '蓝色 透明 耐热 盒子'
  }]);

  assert.doesNotMatch(wxml, /placeholder="颜色、特征、别名"/);
  assert.doesNotMatch(wxml, /bindblur="editTags"/);
  assert.doesNotMatch(wxml, /<button[^>]*class="tag-remove"/);
  assert.match(wxml, /wx:for-index="itemIndex"/);
  assert.match(wxml, /class="tag-remove"[\s\S]*data-index="\{\{itemIndex\}\}"/);
  assert.match(wxml, /class="tag-remove"/);
  assert.match(wxml, /catchtap="removeTag"/);
  assert.match(wxss, /\.tag-remove[\s\S]*position:\s*absolute/);

  definition.methods.removeTag.call(context, {
    currentTarget: { dataset: { index: 0, tag: '透明' } }
  });

  const item = context.events[0].detail.items[0];
  assert.deepEqual(item.colors, ['蓝色']);
  assert.deepEqual(item.features, ['耐热']);
  assert.deepEqual(item.aliases, ['盒子']);
  assert.deepEqual(item.tagList, ['蓝色', '耐热', '盒子']);
  assert.equal(item.tagText, '蓝色 耐热 盒子');
  assert.equal(item.hasTags, true);
  assert.deepEqual(context.data.items[0].tagList, ['蓝色', '耐热', '盒子']);
});

test('item editor hides tag row state after the last tag is removed', () => {
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: '单标签物品',
    colors: [],
    features: ['透明'],
    aliases: [],
    hasTags: true,
    tagList: ['透明'],
    tagText: '透明'
  }]);

  definition.methods.removeTag.call(context, {
    currentTarget: { dataset: { index: 0, tag: '透明' } }
  });

  const item = context.events[0].detail.items[0];
  assert.deepEqual(item.colors, []);
  assert.deepEqual(item.features, []);
  assert.deepEqual(item.aliases, []);
  assert.deepEqual(item.tagList, []);
  assert.equal(item.tagText, '');
  assert.equal(item.hasTags, false);
});

test('item editor emits shared reminder fields when expiry date changes', () => {
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: 'milk',
    expiresAt: 0,
    reminderEnabled: false
  }]);

  definition.methods.changeExpiryDate.call(context, {
    currentTarget: { dataset: { index: 0 } },
    detail: { value: '2026-06-10' }
  });

  assert.equal(context.events.length, 1);
  const item = context.events[0].detail.items[0];
  assert.equal(item.expiresAt, new Date('2026-06-10T23:59:59.999').getTime());
  assert.equal(item.reminderEnabled, true);
  assert.equal(item.remindOffsetDays, 1);
  assert.equal(item.remindAt, item.expiresAt - 24 * 60 * 60 * 1000);
  assert.equal(item.reminderChannel, 'inApp');
  assert.equal(item.subscribeAccepted, false);
  assert.equal(item.expiryDateValue, '2026-06-10');
  assert.equal(item.expiryDateText, '2026-06-10');
});

test('item editor requests subscribe authorization when expiry date changes', async () => {
  const reminder = require('../miniprogram/services/expiry-reminder');
  const originalRequest = reminder.requestSubscribeAuthorization;
  const calls = [];
  reminder.requestSubscribeAuthorization = (wxAdapter) => {
    calls.push(wxAdapter);
    return Promise.resolve({ accepted: true });
  };
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: 'milk',
    expiresAt: 0,
    reminderEnabled: false
  }]);
  const previousWx = global.wx;
  global.wx = {
    requestSubscribeMessage() {}
  };

  try {
    await definition.methods.changeExpiryDate.call(context, {
      currentTarget: { dataset: { index: 0 } },
      detail: { value: '2026-06-10' }
    });
  } finally {
    global.wx = previousWx;
    reminder.requestSubscribeAuthorization = originalRequest;
  }

  const item = context.events.at(-1).detail.items[0];
  assert.equal(calls.length, 1);
  assert.equal(item.reminderEnabled, true);
  assert.equal(item.subscribeAccepted, true);
  assert.equal(item.reminderChannel, 'subscribe');
});

test('item editor primes subscribe template config when attached', async () => {
  const reminder = require('../miniprogram/services/expiry-reminder');
  const originalResolve = reminder.resolveExpiryTemplateId;
  const calls = [];
  reminder.resolveExpiryTemplateId = (wxAdapter) => {
    calls.push(wxAdapter);
    return Promise.resolve('template-id');
  };
  const definition = loadItemEditor();
  const previousWx = global.wx;
  global.wx = {
    cloud: {
      callFunction() {}
    }
  };

  try {
    definition.lifetimes.attached();
    await Promise.resolve();
  } finally {
    global.wx = previousWx;
    reminder.resolveExpiryTemplateId = originalResolve;
  }

  assert.equal(calls.length, 1);
});

test('item editor single expiry toggle enables reminder and requests authorization once', async () => {
  const reminder = require('../miniprogram/services/expiry-reminder');
  const originalRequest = reminder.requestSubscribeAuthorization;
  const calls = [];
  reminder.requestSubscribeAuthorization = (wxAdapter) => {
    calls.push(wxAdapter);
    return Promise.resolve({ accepted: true });
  };
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: 'milk',
    expiresAt: 0,
    reminderEnabled: false
  }]);
  const previousWx = global.wx;
  global.wx = {
    requestSubscribeMessage() {}
  };

  try {
    await definition.methods.toggleExpiry.call(context, {
      currentTarget: { dataset: { index: 0 } },
      detail: { value: true }
    });
  } finally {
    global.wx = previousWx;
    reminder.requestSubscribeAuthorization = originalRequest;
  }

  const item = context.events.at(-1).detail.items[0];
  assert.equal(calls.length, 1);
  assert.equal(item.reminderEnabled, true);
  assert.equal(item.expiresAt > 0, true);
  assert.equal(item.subscribeAccepted, true);
  assert.equal(item.reminderChannel, 'subscribe');
});

test('capture review item view models include expiry date display text', () => {
  const js = readMiniProgramFile('pages', 'capture', 'review.js');

  assert.match(js, /function formatExpiryDateValue/);
  assert.match(js, /expiryDateValue/);
  assert.match(js, /expiryDateText/);
});

test('item editor preserves in-app fallback fields when subscribe authorization is unavailable', async () => {
  const definition = loadItemEditor();
  const context = createComponentContext(definition, [{
    displayName: 'milk',
    expiresAt: new Date('2026-06-10T23:59:59.999').getTime(),
    reminderEnabled: false,
    remindOffsetDays: 1
  }]);

  const previousWx = global.wx;
  global.wx = {};
  try {
    await definition.methods.toggleReminder.call(context, {
      currentTarget: { dataset: { index: 0 } },
      detail: { value: true }
    });
  } finally {
    global.wx = previousWx;
  }

  const item = context.events.at(-1).detail.items[0];
  assert.equal(item.reminderEnabled, true);
  assert.equal(item.subscribeAccepted, false);
  assert.equal(item.reminderChannel, 'inApp');
  assert.equal(item.remindAt, item.expiresAt - 24 * 60 * 60 * 1000);
});

test('container detail renders and strips expiry view fields', () => {
  const js = readMiniProgramFile('pages', 'container', 'detail.js');
  const wxml = readMiniProgramFile('pages', 'container', 'detail.wxml');
  const wxss = readMiniProgramFile('pages', 'container', 'detail.wxss');

  assert.match(js, /expiryLabel/);
  assert.match(js, /expiryState/);
  assert.match(js, /hasExpiry/);
  assert.match(js, /isExpired/);
  assert.match(js, /isExpiring/);
  assert.match(js, /'expiryLabel'/);
  assert.match(js, /'expiryState'/);
  assert.match(js, /'hasExpiry'/);
  assert.match(wxml, /wx:if="\{\{item\.hasExpiry\}\}"/);
  assert.match(wxml, /\{\{item\.expiryLabel\}\}/);
  assert.match(wxss, /\.expiry-badge/);
  assert.match(wxss, /\.expiry-badge\.expired/);
  assert.match(wxss, /\.expiry-badge\.expiring/);
});
