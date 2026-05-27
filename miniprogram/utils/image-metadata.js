function firstChosenFile(result) {
  if (result && result.tempFiles && result.tempFiles[0]) return result.tempFiles[0];
  return null;
}

function inferOrientation(width, height) {
  if (!width || !height) return '';
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

function createImageMetadata(input) {
  const provided = (input && input.imageMetadata) || {};
  const file = firstChosenFile(input && input.chooseResult) || {};
  const width = Number(input && input.width) || Number(provided.width) || Number(file.width) || 0;
  const height = Number(input && input.height) || Number(provided.height) || Number(file.height) || 0;
  const analyzedAt = Number(input && input.analyzedAt) || Number(provided.analyzedAt) || Date.now();
  return {
    orientation: (input && input.orientation) || provided.orientation || inferOrientation(width, height),
    width,
    height,
    analyzeStatus: (input && input.analyzeStatus) || provided.analyzeStatus || 'ready',
    analyzedAt
  };
}

module.exports = {
  createImageMetadata
};
