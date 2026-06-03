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
  assert.equal(cloudConfig.collections.reminderNotices, 'ft_reminder_notices');
  assert.equal(cloudConfig.collections.analyzeTasks, 'ft_analyze_tasks');
  assert.equal(cloudConfig.collections.userUsage, 'ft_user_usage');
  assert.equal(cloudConfig.collections.userQuotaOverrides, 'ft_user_quota_overrides');
  assert.equal(cloudConfig.collections.abuseFlags, 'ft_abuse_flags');
  assert.equal(cloudConfig.collections.opsConfig, 'ft_ops_config');
  assert.equal(cloudConfig.storageRoot, 'find-things');
});

test('WeChat DevTools project config imports the miniprogram root', () => {
  const configPath = path.join(__dirname, '..', 'project.config.json');
  const projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.equal(projectConfig.appid, cloudConfig.appId);
  assert.equal(projectConfig.compileType, 'miniprogram');
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/');
});

test('cloud functions pin wx-server-sdk to an exact version', () => {
  const functionDirs = ['ftAnalyzeImage', 'ftExpiryReminder'];

  for (const dir of functionDirs) {
    const packagePath = path.join(__dirname, '..', 'cloudfunctions', dir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const version = packageJson.dependencies && packageJson.dependencies['wx-server-sdk'];

    assert.match(version, /^\d+\.\d+\.\d+$/, `${dir} should pin wx-server-sdk to an exact version`);
  }
});
