const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadNavigation() {
  const navigationPath = path.join(__dirname, '..', 'miniprogram', 'utils', 'navigation.js');
  delete require.cache[require.resolve(navigationPath)];
  return require(navigationPath);
}

function withGlobals(globals, callback) {
  const previousWx = global.wx;
  const previousGetCurrentPages = global.getCurrentPages;
  global.wx = globals.wx;
  global.getCurrentPages = globals.getCurrentPages;
  try {
    return callback();
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousGetCurrentPages;
  }
}

test('switchSection uses switchTab for section pages', () => {
  const calls = [];
  const navigation = loadNavigation();

  withGlobals({
    wx: {
      switchTab(options) {
        calls.push(['switchTab', options]);
      },
      redirectTo() {
        calls.push(['redirectTo']);
      }
    },
    getCurrentPages: () => [{ route: 'pages/home/index' }]
  }, () => {
    navigation.switchSection(navigation.SEARCH_URL);
  });

  assert.deepEqual(calls, [['switchTab', { url: '/pages/search/index' }]]);
  assert.equal(navigation.consumeSectionRefresh(navigation.SEARCH_URL), false);
});

test('switchSection skips routing when already on the target section', () => {
  const calls = [];
  const navigation = loadNavigation();

  withGlobals({
    wx: {
      redirectTo(options) {
        calls.push(options);
      }
    },
    getCurrentPages: () => [{ route: 'pages/search/index' }]
  }, () => {
    navigation.switchSection(navigation.SEARCH_URL);
  });

  assert.deepEqual(calls, []);
});

test('switchSection returns to an existing section without animation', () => {
  const calls = [];
  const navigation = loadNavigation();

  withGlobals({
    wx: {
      switchTab(options) {
        calls.push(['switchTab', options]);
      },
      navigateBack(options) {
        calls.push(['navigateBack', options]);
      },
      redirectTo(options) {
        calls.push(['redirectTo', options]);
      }
    },
    getCurrentPages: () => [
      { route: 'pages/home/index' },
      { route: 'pages/search/index' },
      { route: 'pages/container/detail' }
    ]
  }, () => {
    navigation.switchSection(navigation.HOME_URL);
  });

  assert.deepEqual(calls, [['switchTab', { url: '/pages/home/index' }]]);
  assert.equal(navigation.consumeSectionRefresh(navigation.HOME_URL), true);
  assert.equal(navigation.consumeSectionRefresh(navigation.HOME_URL), false);
});

test('navigateHome switches to the home tab', () => {
  const calls = [];
  const navigation = loadNavigation();

  withGlobals({
    wx: {
      switchTab(options) {
        calls.push(['switchTab', options]);
      },
      navigateBack(options) {
        calls.push(['navigateBack', options]);
      }
    },
    getCurrentPages: () => [
      { route: 'pages/home/index' },
      { route: 'pages/search/index' },
      { route: 'pages/container/detail' }
    ]
  }, () => {
    navigation.navigateHome();
  });

  assert.deepEqual(calls, [['switchTab', { url: '/pages/home/index' }]]);
});

test('switchSection falls back to instant back navigation without switchTab', () => {
  const calls = [];
  const navigation = loadNavigation();

  withGlobals({
    wx: {
      navigateBack(options) {
        calls.push(options);
      }
    },
    getCurrentPages: () => [
      { route: 'pages/home/index' },
      { route: 'pages/container/detail' },
      { route: 'pages/search/index' }
    ]
  }, () => {
    navigation.switchSection(navigation.HOME_URL);
  });

  assert.deepEqual(calls, [{
    delta: 2,
    animationType: 'none',
    animationDuration: 0
  }]);
});

test('syncTabBar updates the custom tab selection', () => {
  const calls = [];
  const navigation = loadNavigation();

  navigation.syncTabBar({
    getTabBar() {
      return {
        setData(patch) {
          calls.push(patch);
        }
      };
    }
  }, navigation.CONTAINERS_URL);

  assert.deepEqual(calls, [{ selected: 2 }]);
});
