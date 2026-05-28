const appId = 'wxebb5b2dc618082a5';
const envId = 'cloud1-d2g79srh64b6eb263';
const collectionPrefix = 'ft_';

const collections = {
  containers: `${collectionPrefix}containers`,
  items: `${collectionPrefix}items`,
  analyzeTasks: `${collectionPrefix}analyze_tasks`,
  queryLogs: `${collectionPrefix}query_logs`
};

module.exports = {
  appId,
  envId,
  collectionPrefix,
  collections,
  storageRoot: 'find-things',
  cloudFunctionPrefix: 'ft'
};
