function isMockAssetPath(filePath) {
  return typeof filePath === 'string' && filePath.indexOf('/assets/mock-') === 0;
}

module.exports = {
  isMockAssetPath
};
