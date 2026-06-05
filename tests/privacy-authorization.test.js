const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMiniProgramFile(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'miniprogram', ...segments), 'utf8');
}

test('privacy authorization helper requests WeChat privacy authorization before private APIs', async () => {
  const privacy = require('../miniprogram/utils/privacy');
  const calls = [];
  const wxAdapter = {
    requirePrivacyAuthorize(options) {
      calls.push(options);
      options.success();
    }
  };

  const result = await privacy.ensurePrivacyAuthorized(wxAdapter);

  assert.equal(result.authorized, true);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].success, 'function');
  assert.equal(typeof calls[0].fail, 'function');
});

test('privacy authorization helper blocks private APIs when user rejects privacy authorization', async () => {
  const privacy = require('../miniprogram/utils/privacy');
  const wxAdapter = {
    requirePrivacyAuthorize(options) {
      options.fail({ errMsg: 'requirePrivacyAuthorize:fail auth deny' });
    }
  };

  const result = await privacy.ensurePrivacyAuthorized(wxAdapter);

  assert.equal(result.authorized, false);
  assert.match(result.errMsg, /auth deny/);
});

test('privacy authorization helper shows a page prompt when WeChat needs privacy authorization', async () => {
  delete require.cache[require.resolve('../miniprogram/utils/privacy')];
  const privacy = require('../miniprogram/utils/privacy');
  let listener = null;
  let requireOptions = null;
  const pageContext = {
    data: {},
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    }
  };
  const wxAdapter = {
    onNeedPrivacyAuthorization(callback) {
      listener = callback;
    },
    requirePrivacyAuthorize(options) {
      requireOptions = options;
      listener((result) => {
        if (result.event === 'agree') options.success(result);
        if (result.event === 'disagree') options.fail({ errMsg: 'requirePrivacyAuthorize:fail disagree' });
      }, { referrer: 'wx.chooseMedia' });
    },
    getPrivacySetting(options) {
      options.success({
        needAuthorization: true,
        privacyContractName: '《搁哪儿用户隐私保护指引》'
      });
    }
  };

  const pending = privacy.ensurePrivacyAuthorized(wxAdapter, pageContext);

  assert.equal(typeof requireOptions.success, 'function');
  assert.equal(pageContext.data.privacyPromptVisible, true);
  assert.equal(pageContext.data.privacyContractName, '《搁哪儿用户隐私保护指引》');

  privacy.resolvePendingAuthorization({ event: 'agree', buttonId: 'privacy-agree-btn' });
  const result = await pending;

  assert.equal(result.authorized, true);
  assert.equal(pageContext.data.privacyPromptVisible, false);
});

test('all camera and album picker flows guard private APIs with privacy authorization', () => {
  const files = [
    ['pages/capture/index.js', readMiniProgramFile('pages', 'capture', 'index.js')],
    ['pages/capture/review.js', readMiniProgramFile('pages', 'capture', 'review.js')],
    ['pages/container/detail.js', readMiniProgramFile('pages', 'container', 'detail.js')],
    ['pages/container/edit.js', readMiniProgramFile('pages', 'container', 'edit.js')]
  ];

  for (const [relativePath, source] of files) {
    assert.match(
      source,
      /require\(['"](?:\.\.\/){2}utils\/privacy['"]\)/,
      `${relativePath} should import the privacy helper`
    );

    const openPickerIndex = source.indexOf('const openPicker = () => {');
    assert.notEqual(openPickerIndex, -1, `${relativePath} should keep picker calls behind openPicker`);

    const authorizeIndex = source.indexOf('privacy.guardPrivateAction(wx, this, openPicker)');
    const chooseMediaIndex = source.indexOf('wx.chooseMedia', openPickerIndex);
    const chooseImageIndex = source.indexOf('wx.chooseImage', openPickerIndex);
    const sourceWithoutGuard = source.replace(/privacy\.guardPrivateAction\(wx,\s*this,\s*openPicker\)/g, '');

    assert.notEqual(authorizeIndex, -1, `${relativePath} should request privacy authorization before opening picker`);
    assert.notEqual(chooseMediaIndex, -1, `${relativePath} should still support wx.chooseMedia`);
    assert.notEqual(chooseImageIndex, -1, `${relativePath} should still support wx.chooseImage`);
    assert.doesNotMatch(sourceWithoutGuard, /openPicker\(\)/, `${relativePath} should not call openPicker directly outside privacy guard`);
  }
});

test('picker pages render the privacy authorization component', () => {
  const appJson = JSON.parse(readMiniProgramFile('app.json'));
  assert.equal(
    appJson.usingComponents && appJson.usingComponents['privacy-authorization'],
    '/components/privacy-authorization/index'
  );

  const wxmlFiles = [
    ['pages/capture/index.wxml', readMiniProgramFile('pages', 'capture', 'index.wxml')],
    ['pages/capture/review.wxml', readMiniProgramFile('pages', 'capture', 'review.wxml')],
    ['pages/container/detail.wxml', readMiniProgramFile('pages', 'container', 'detail.wxml')],
    ['pages/container/edit.wxml', readMiniProgramFile('pages', 'container', 'edit.wxml')]
  ];

  for (const [relativePath, source] of wxmlFiles) {
    assert.match(source, /<privacy-authorization[\s\S]*visible="\{\{privacyPromptVisible\}\}"/, `${relativePath} should mount privacy authorization UI`);
    assert.match(source, /contract-name="\{\{privacyContractName\}\}"/, `${relativePath} should pass the platform privacy contract name`);
  }
});

test('privacy authorization component uses WeChat privacy agreement button', () => {
  const componentWxml = readMiniProgramFile('components', 'privacy-authorization', 'index.wxml');

  assert.match(componentWxml, /open-type="agreePrivacyAuthorization"/);
  assert.match(componentWxml, /bindagreeprivacyauthorization="onAgree"/);
  assert.match(componentWxml, /bindtap="onOpenContract"/);
});
