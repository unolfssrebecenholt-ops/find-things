const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cloudConfig = require('../miniprogram/config/cloud');

test('uses the confirmed mini program appid and cloud environment id', () => {
  assert.equal(cloudConfig.appId, 'wxebb5b2dc618082a5');
  assert.equal(cloudConfig.envId, 'cloud1-d2g79srh64b6eb263');
  assert.equal(cloudConfig.collectionPrefix, 'ft_');
  assert.equal(cloudConfig.collections.containers, 'ft_containers');
  assert.equal(cloudConfig.storageRoot, 'find-things');
});

test('WeChat DevTools project config imports the miniprogram root', () => {
  const configPath = path.join(__dirname, '..', 'project.config.json');
  const projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(projectConfig.appid, cloudConfig.appId);
  assert.equal(projectConfig.compileType, 'miniprogram');
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/');
});
