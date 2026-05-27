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
