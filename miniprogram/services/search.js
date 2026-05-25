const { normalizeQuery } = require('../utils/normalize');
const { scoreItem } = require('../utils/scoring');
const { semanticMatch } = require('../utils/semantic');
const storage = require('./storage');

const SEMANTIC_SCORE_THRESHOLD = 35;

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
  return semantic.score >= SEMANTIC_SCORE_THRESHOLD && hasMatchedTokens && hasRequiredNonColorMatch;
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
        matchType: getMatchType(keywordScore, semanticScore),
        semanticScore,
        matchSummary: validSemantic ? semantic.summary : (scored.reasons[0] || ''),
        score,
        reasons: scored.reasons,
        colorOnlyIntentMiss: isColorOnlyIntentMiss(semantic)
      };
    })
    .filter((result) => !result.colorOnlyIntentMiss && (result.reasons.length || result.matchSummary))
    .map((result) => {
      const publicResult = Object.assign({}, result);
      delete publicResult.colorOnlyIntentMiss;
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

module.exports = {
  searchItems
};
