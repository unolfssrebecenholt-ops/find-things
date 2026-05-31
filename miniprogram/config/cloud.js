const appId = 'wxebb5b2dc618082a5';
const envId = 'cloud1-d2g79srh64b6eb263';
const collectionPrefix = 'ft_';

const collections = {
  containers: `${collectionPrefix}containers`,
  items: `${collectionPrefix}items`,
  reminderNotices: `${collectionPrefix}reminder_notices`,
  analyzeTasks: `${collectionPrefix}analyze_tasks`,
  queryLogs: `${collectionPrefix}query_logs`,
  userUsage: `${collectionPrefix}user_usage`,
  userQuotaOverrides: `${collectionPrefix}user_quota_overrides`,
  abuseFlags: `${collectionPrefix}abuse_flags`,
  opsConfig: `${collectionPrefix}ops_config`
};

module.exports = {
  appId,
  envId,
  collectionPrefix,
  collections,
  storageRoot: 'find-things',
  cloudFunctionPrefix: 'ft'
};
