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

function createMemoryAdapterWithData(initial) {
  const data = Object.assign({}, initial);
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

test('semantic search does not return context-only object mentions', () => {
  const results = search.searchItems('小熊', {
    containers: [{
      _id: 'container_1',
      name: '玄关抽屉',
      contentImages: [{ imageId: 'image_1', fileId: '/tmp/image.jpg' }]
    }],
    items: [
      {
        _id: 'bear_charm',
        containerId: 'container_1',
        displayName: '黄色小熊挂件',
        category: 'accessory',
        features: ['小熊造型', '挂件'],
        aliases: ['小熊', '小熊挂件'],
        description: '一个黄色挂件，位于画面左侧。',
        sourceImageId: 'image_1',
        confidence: 0.9
      },
      {
        _id: 'mesh_pouch',
        containerId: 'container_1',
        displayName: '黑色网格拉链小包',
        category: 'bag',
        colors: ['黑色'],
        features: ['网格', '拉链'],
        aliases: ['收纳包'],
        description: '黑色网格小包，旁边有小熊挂件。',
        sourceImageId: 'image_1',
        confidence: 0.88
      }
    ]
  });

  assert.deepEqual(results.map((result) => result.item._id), ['bear_charm']);
  assert.match(results[0].matchSummary, /小熊/);
});

test('semantic search recognizes bear charms without mixing in colored context noise', () => {
  const data = {
    containers: [{
      _id: 'container_1',
      name: '玄关抽屉',
      contentImages: [{ imageId: 'image_1', fileId: '/tmp/image.jpg' }]
    }],
    items: [
      {
        _id: 'yellow_bear',
        containerId: 'container_1',
        displayName: '黄色小熊挂件',
        category: 'accessory',
        colors: ['黄色'],
        features: ['小熊造型', '挂件'],
        aliases: ['小熊', '小熊挂件'],
        description: '一个黄色挂件，位于画面左侧。',
        sourceImageId: 'image_1',
        confidence: 0.9
      },
      {
        _id: 'butterbear_tag',
        containerId: 'container_1',
        displayName: 'Butterbear小熊标签挂饰',
        category: 'accessory',
        colors: ['黄色'],
        features: ['标签', '挂饰'],
        aliases: ['Butterbear', '黄油小熊', '小熊挂饰'],
        description: '黄色标签挂饰。',
        sourceImageId: 'image_1',
        confidence: 0.86
      },
      {
        _id: 'black_pouch',
        containerId: 'container_1',
        displayName: '黑色网格拉链小包',
        category: 'bag',
        colors: ['黑色'],
        features: ['网格', '拉链'],
        aliases: ['收纳包'],
        description: '黑色小包，旁边有小熊挂件。',
        sourceImageId: 'image_1',
        confidence: 0.88
      }
    ]
  };

  const bearResults = search.searchItems('小熊', data).map((result) => result.item._id);
  const blackBearResults = search.searchItems('黑色小熊', data).map((result) => result.item._id);

  assert.deepEqual(bearResults, ['yellow_bear', 'butterbear_tag']);
  assert.deepEqual(blackBearResults, []);
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

test('search prefers thumbnail image fields when present', () => {
  const result = search.searchItems('蓝色封面的书', {
    containers: [{
      _id: 'container_1',
      name: '玄关抽屉',
      coverImageFileId: '/tmp/cover.jpg',
      coverThumbFileId: '/tmp/cover-thumb.jpg',
      contentImages: [{
        imageId: 'image_1',
        fileId: '/tmp/content.jpg',
        thumbFileId: '/tmp/content-thumb.jpg'
      }]
    }],
    items: [{
      _id: 'book_1',
      containerId: 'container_1',
      displayName: '蓝色封面的书',
      sourceImageId: 'image_1',
      sourceImageFileId: '/tmp/content.jpg',
      confidence: 0.9
    }]
  })[0];

  assert.equal(result.containerPhoto, '/tmp/cover.jpg');
  assert.equal(result.containerThumb, '/tmp/cover-thumb.jpg');
  assert.equal(result.contentThumb, '/tmp/content-thumb.jpg');
  assert.equal(result.matchedImageThumbFileId, '/tmp/content-thumb.jpg');
});

test('container search matches names locations and contained items', () => {
  const service = storage.createStorageService(createMemoryAdapter());
  service.seedDemoData();

  const locationResults = search.searchContainers('书桌', {
    containers: service.listContainers(),
    items: service.listItems()
  });
  const itemResults = search.searchContainers('卷尺', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.equal(locationResults[0].container.name, '书桌左侧抽屉');
  assert.match(locationResults[0].matchSummary, /名称|位置|物品/);
  assert.equal(itemResults[0].container.name, '客厅工具盒');
  assert.match(itemResults[0].matchSummary, /卷尺/);
});

test('search includes legacy container-embedded inventory items', () => {
  const service = storage.createStorageService(createMemoryAdapterWithData({
    'findThings.containers': [
      {
        _id: 'legacy_embedded_box',
        name: '历史箱子',
        locationPath: '柜子',
        contentImageFileId: '/tmp/legacy.jpg',
        itemCount: 1,
        updatedAt: 1,
        items: [
          { displayName: '黄色标签贴', colors: ['黄色'], confirmed: true }
        ]
      }
    ],
    'findThings.items': []
  }));

  const results = search.searchItems('黄色标签贴', {
    containers: service.listContainers(),
    items: service.listItems()
  });

  assert.equal(results[0].item.displayName, '黄色标签贴');
  assert.equal(results[0].containerName, '历史箱子');
});
