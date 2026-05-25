const test = require('node:test');
const assert = require('node:assert/strict');

const normalize = require('../miniprogram/utils/normalize');
const scoring = require('../miniprogram/utils/scoring');
const search = require('../miniprogram/services/search');
const storage = require('../miniprogram/services/storage');

function createMemoryAdapter() {
  const data = {};
  return {
    getStorageSync(key) {
      return data[key];
    },
    setStorageSync(key, value) {
      data[key] = value;
    }
  };
}

test('normalizes broad book queries into searchable keywords', () => {
  assert.deepEqual(normalize.normalizeQuery('帮我找一本书'), ['书', 'book']);
  assert.deepEqual(normalize.normalizeQuery('黑色签字笔'), ['黑色', '签字笔', 'pen']);
  assert.deepEqual(normalize.normalizeQuery('蓝色发卡'), ['蓝色', '发卡', 'accessory']);
});

test('scores display name matches higher than description matches', () => {
  const item = {
    displayName: '黑色笔',
    category: 'pen',
    colors: ['黑色'],
    aliases: ['签字笔'],
    description: '抽屉中间的一支笔'
  };
  const container = { name: '书桌抽屉', locationPath: '卧室' };

  const result = scoring.scoreItem(['黑色', '签字笔', 'pen'], item, container);

  assert.ok(result.score >= 90);
  assert.ok(result.reasons.some((reason) => reason.includes('名称')));
  assert.ok(result.reasons.some((reason) => reason.includes('颜色')));
});

test('search returns multiple book candidates grouped with container photos', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const results = search.searchItems('找一本书', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.ok(results.length >= 2);
  assert.ok(results.every((result) => result.containerName));
  assert.ok(results.every((result) => Array.isArray(result.reasons) && result.reasons.length));
});

test('semantic search ranks a blue covered book above a generic book', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const results = search.searchItems('蓝色封面的书', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.equal(results[0].item.displayName, '蓝色封面的书');
  assert.ok(results[0].semanticScore > 0);
  assert.equal(results[0].matchType, 'hybrid');
  assert.match(results[0].matchSummary, /蓝色|书/);
});

test('semantic search returns multiple books for broad book intent', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const results = search.searchItems('找一本书', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.ok(results.filter((result) => result.item.category === 'book').length >= 2);
});

test('semantic search finds a black signing pen without unexplained noise', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const results = search.searchItems('黑色签字笔', {
    containers: service.listContainers(),
    items: service.listItems()
  });
  const result = results[0];

  assert.equal(result.item.displayName, '黑色笔');
  assert.ok(result.semanticScore > 0);
  assert.ok(results.every((item) => item.reasons.length || item.matchSummary));
  assert.ok(results.every((item) => item.item.displayName === '黑色笔'));
});

test('semantic search filters unexplained low-score noise for unrelated color-object queries', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const redKeyResults = search.searchItems('红色钥匙', {
    containers: service.listContainers(),
    items: service.listItems()
  });
  const whiteCupResults = search.searchItems('白色杯子', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.deepEqual(redKeyResults, []);
  assert.deepEqual(whiteCupResults, []);
});

test('search result includes matched source image ids and file ids', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const result = search.searchItems('蓝色封面的书', {
    containers: service.listContainers(),
    items: service.listItems()
  })[0];

  assert.ok(result.matchedImageId);
  assert.ok(result.matchedImageFileId);
  assert.equal(result.matchedImageId, result.item.sourceImageId);
  assert.equal(result.matchedImageFileId, result.item.sourceImageFileId);
});
