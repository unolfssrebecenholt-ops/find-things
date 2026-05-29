const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const search = require('../miniprogram/services/search');

function loadSearchResultCard() {
  const componentPath = path.join(__dirname, '..', 'miniprogram', 'components', 'search-result-card', 'index.js');
  const previousComponent = global.Component;
  let definition;

  delete require.cache[require.resolve(componentPath)];
  global.Component = (options) => {
    definition = options;
  };
  require(componentPath);
  global.Component = previousComponent;

  return definition;
}

function buildViewModel(result) {
  const card = loadSearchResultCard();
  let data;
  card.observers.result.call({
    setData(payload) {
      data = payload;
    }
  }, result);
  return data.viewModel;
}

async function buildResolvedViewModel(result) {
  const card = loadSearchResultCard();
  const context = {
    data: {
      result,
      viewModel: card.data.viewModel
    },
    setData(payload) {
      this.data = Object.assign({}, this.data, payload);
    }
  };
  const previousWx = global.wx;
  global.wx = {
    cloud: {
      getTempFileURL(options) {
        const fileList = (options.fileList || []).map((file) => ({
          fileID: file.fileID,
          tempFileURL: `https://display.example.com/${encodeURIComponent(file.fileID)}`
        }));
        options.success({ fileList });
      }
    }
  };
  try {
    card.observers.result.call(context, result);
    await new Promise((resolve) => setImmediate(resolve));
    return context.data.viewModel;
  } finally {
    global.wx = previousWx;
  }
}

test('search result card keeps match summary and shows semantic percent from score', () => {
  const viewModel = buildViewModel({
    semanticScore: 92,
    matchSummary: '语义匹配：蓝色、书',
    reasons: ['名称包含“书”'],
    item: { displayName: '蓝色封面的书' },
    container: { _id: 'container_1' }
  });

  assert.equal(viewModel.semanticPercentText, '语义 92%');
  assert.equal(viewModel.matchSummary, '语义匹配：蓝色、书');
});

test('search result card shows zero semantic percent instead of hiding the badge', () => {
  const viewModel = buildViewModel({
    semanticPercent: 0,
    semanticScore: 0,
    matchSummary: '名称匹配“书”',
    reasons: ['名称匹配“书”'],
    item: { displayName: '书签' },
    container: { _id: 'container_1' }
  });

  assert.equal(viewModel.semanticPercentText, '语义 0%');
  assert.equal(viewModel.matchSummary, '名称匹配“书”');
});

test('search service exposes semantic percent for keyword-only item results', () => {
  const results = search.searchItems('书签字笔', {
    containers: [{
      _id: 'desk_box',
      name: '书签字笔 pen book',
      locationPath: '书房'
    }],
    items: [{
      _id: 'keys',
      containerId: 'desk_box',
      displayName: '备用钥匙',
      confidence: 0.8
    }]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].semanticScore, 0);
  assert.equal(results[0].semanticPercent, 0);
});

test('search result card renders semantic percent as a separate compact badge', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram', 'components', 'search-result-card', 'index.wxml'),
    'utf8'
  );

  assert.match(wxml, /semantic-percent/);
  assert.match(wxml, /viewModel\.semanticPercentText/);
  assert.match(wxml, /match-summary/);
});

test('search result card resolves cloud photo before display', async () => {
  const viewModel = await buildResolvedViewModel({
    semanticScore: 80,
    matchSummary: '图片匹配',
    matchedImageThumbFileId: 'cloud://env/find-things/thumbs/match.jpg',
    item: { displayName: '白色袋子' },
    container: { _id: 'container_1' }
  });

  assert.match(viewModel.photo, /^https:\/\/display\.example\.com\//);
  assert.equal(viewModel.hasPhoto, true);
  assert.equal(viewModel.showPlaceholder, false);
});
