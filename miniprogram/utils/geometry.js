function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBbox(bbox) {
  const x = clamp(toNumber(bbox && bbox.x, 0), 0, 1);
  const y = clamp(toNumber(bbox && bbox.y, 0), 0, 1);
  const maxWidth = 1 - x;
  const maxHeight = 1 - y;
  return {
    x,
    y,
    width: clamp(toNumber(bbox && bbox.width, 0), 0, maxWidth),
    height: clamp(toNumber(bbox && bbox.height, 0), 0, maxHeight)
  };
}

function normalizedBboxToStyle(bbox, imageSize) {
  const safe = normalizeBbox(bbox);
  const width = toNumber(imageSize && imageSize.width, 0);
  const height = toNumber(imageSize && imageSize.height, 0);
  return {
    left: Math.round(safe.x * width),
    top: Math.round(safe.y * height),
    width: Math.round(safe.width * width),
    height: Math.round(safe.height * height)
  };
}

function bboxToPercentStyle(bbox) {
  const safe = normalizeBbox(bbox);
  return [
    `left:${safe.x * 100}%`,
    `top:${safe.y * 100}%`,
    `width:${safe.width * 100}%`,
    `height:${safe.height * 100}%`
  ].join(';');
}

function withDisplayIndexes(items) {
  return (items || []).map((item, index) => Object.assign({}, item, { displayIndex: index + 1 }));
}

module.exports = {
  clamp,
  normalizeBbox,
  normalizedBboxToStyle,
  bboxToPercentStyle,
  withDisplayIndexes
};
