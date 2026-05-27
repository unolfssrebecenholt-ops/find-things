const { normalizeQuery } = require('../utils/normalize');
const { scoreItem } = require('../utils/scoring');
const { semanticMatch } = require('../utils/semantic');
const storage = require('./storage');

const SEMANTIC_SCORE_THRESHOLD = 35;
const KEYWORD_SCORE_THRESHOLD = 30;

function byId(values) {
  return (values || []).reduce((map, value) => {
    map[value._id] = value;
    return map;
  }, {});
}

function findContentImage(container, item) {
  const images = (container && container.contentImages) || [];
  return images.find((image) => item.sourceImageId && image.imageId === item.sourceImageId)
    || images.find((image) => item.sourceImageFileId && image.fileId === item.sourceImageFileId)
    || images[0]
    || null;
}

function getMatchType(keywordScore, semanticScore) {
  if (keywordScore > 0 && semanticScore > 0) return 'hybrid';
  if (semanticScore > 0) return 'semantic';
  return 'keyword';
}

function isValidSemanticMatch(semantic) {
  const hasMatchedTokens = semantic.matchedTokens && semantic.matchedTokens.length > 0;
  const hasRequiredNonColorMatch = !semantic.requiresNonColorMatch
    || (semantic.matchedNonColorTokens && semantic.matchedNonColorTokens.length > 0);
  return semantic.score >= SEMANTIC_SCORE_THRESHOLD
    && hasMatchedTokens
    && hasRequiredNonColorMatch
    && !semantic.colorMismatch;
}

function isColorOnlyIntentMiss(semantic) {
  return semantic.requiresNonColorMatch
    && (!semantic.matchedNonColorTokens || semantic.matchedNonColorTokens.length === 0);
}

function searchItems(query, data) {
  const tokens = normalizeQuery(query);
  if (!tokens.length) return [];

  const containers = data && data.containers ? data.containers : storage.listContainers();
  const items = data && data.items ? data.items : storage.listItems();
  const containerMap = byId(containers);

  return (items || [])
    .map((item) => {
      const container = containerMap[item.containerId] || {};
      const contentImage = findContentImage(container, item);
      const scored = scoreItem(tokens, item, container);
      const semantic = semanticMatch(query, item);
      const validSemantic = isValidSemanticMatch(semantic);
      const semanticScore = validSemantic ? semantic.score : 0;
      const semanticPercent = Math.max(0, Math.min(100, Math.round(semanticScore)));
      const keywordScore = scored.keywordScore || 0;
      const score = scored.score + semanticScore;
      return {
        resultId: item._id,
        item,
        container,
        containerName: container.name || '未命名容器',
        containerPhoto: container.coverImageFileId || (contentImage && contentImage.fileId) || container.contentImageFileId || '',
        contentImage: (contentImage && contentImage.fileId) || container.contentImageFileId || '',
        matchedImageId: (contentImage && contentImage.imageId) || item.sourceImageId || '',
        matchedImageFileId: (contentImage && contentImage.fileId) || item.sourceImageFileId || '',
        locationText: item.locationText || [contentImage && contentImage.label, item.relativePosition].filter(Boolean).join(' · '),
        matchType: getMatchType(keywordScore, semanticScore),
        semanticScore,
        semanticPercent,
        matchSummary: validSemantic ? semantic.summary : (scored.reasons[0] || ''),
        score,
        keywordScore,
        reasons: scored.reasons,
        colorOnlyIntentMiss: isColorOnlyIntentMiss(semantic)
      };
    })
    .filter((result) => !result.colorOnlyIntentMiss && (
      result.semanticScore > 0 || result.keywordScore >= KEYWORD_SCORE_THRESHOLD
    ))
    .map((result) => {
      const publicResult = Object.assign({}, result);
      delete publicResult.colorOnlyIntentMiss;
      delete publicResult.keywordScore;
      return publicResult;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.semanticScore !== a.semanticScore) return b.semanticScore - a.semanticScore;
      const timeDelta = (b.container.updatedAt || 0) - (a.container.updatedAt || 0);
      if (timeDelta) return timeDelta;
      return (b.item.confidence || 0) - (a.item.confidence || 0);
    });
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function includesToken(text, token) {
  return normalizeText(text).indexOf(normalizeText(token)) >= 0;
}

function scoreContainer(tokens, container, items) {
  const reasons = [];
  let score = 0;
  const name = container.name || '';
  const location = container.locationPath || '';
  const containerItems = (items || []).filter((item) => item.containerId === container._id);

  tokens.forEach((token) => {
    if (includesToken(name, token)) {
      score += 80;
      reasons.push(`名称包含「${token}」`);
    }
    if (includesToken(location, token)) {
      score += 60;
      reasons.push(`位置包含「${token}」`);
    }
    const matchedItem = containerItems.find((item) => {
      return includesToken(item.displayName, token)
        || includesToken(item.visibleText, token)
        || includesToken(item.description, token)
        || (item.aliases || []).some((alias) => includesToken(alias, token))
        || (item.colors || []).some((color) => includesToken(color, token))
        || (item.features || []).some((feature) => includesToken(feature, token));
    });
    if (matchedItem) {
      score += 70;
      reasons.push(`物品包含「${matchedItem.displayName || token}」`);
    }
  });

  return {
    score,
    reasons: reasons.filter((reason, index) => reasons.indexOf(reason) === index)
  };
}

function searchContainers(query, data) {
  const tokens = normalizeQuery(query);
  if (!tokens.length) return [];

  const containers = data && data.containers ? data.containers : storage.listContainers();
  const items = data && data.items ? data.items : storage.listItems();

  return (containers || [])
    .map((container) => {
      const scored = scoreContainer(tokens, container, items);
      const imageCount = (container.contentImages || []).length;
      return {
        resultId: container._id,
        container,
        score: scored.score,
        reasons: scored.reasons,
        matchSummary: scored.reasons[0] || `${container.itemCount || 0} 件物品 · ${imageCount} 张照片`
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.container.updatedAt || 0) - (a.container.updatedAt || 0);
    });
}

module.exports = {
  searchItems,
  searchContainers
};
