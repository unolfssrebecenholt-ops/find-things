function includesText(value, token) {
  if (!value || !token) return false;
  return String(value).toLowerCase().includes(String(token).toLowerCase());
}

function arrayIncludes(values, token) {
  return (values || []).some((value) => includesText(value, token));
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function scoreItem(tokens, item, container) {
  let score = 0;
  const reasons = [];

  (tokens || []).forEach((token) => {
    if (includesText(item.displayName, token) || includesText(item.aiName, token)) {
      score += 50;
      addReason(reasons, `名称匹配“${token}”`);
    }
    if (arrayIncludes(item.aliases, token)) {
      score += 35;
      addReason(reasons, `别名匹配“${token}”`);
    }
    if (includesText(item.category, token)) {
      score += 30;
      addReason(reasons, `类别匹配“${token}”`);
    }
    if (includesText(item.visibleText, token)) {
      score += 30;
      addReason(reasons, `可见文字匹配“${token}”`);
    }
    if (includesText(item.description, token) || includesText(item.note, token)) {
      score += 15;
      addReason(reasons, `描述匹配“${token}”`);
    }
    if (arrayIncludes(item.features, token)) {
      score += 15;
      addReason(reasons, `特征匹配“${token}”`);
    }
    if (arrayIncludes(item.colors, token)) {
      score += 10;
      addReason(reasons, `颜色匹配“${token}”`);
    }
    if (includesText(container && container.name, token) || includesText(container && container.locationPath, token)) {
      score += 10;
      addReason(reasons, `容器匹配“${token}”`);
    }
  });

  const confidenceBoost = Math.round((Number(item.confidence) || 0) * 10);
  return {
    score: score + confidenceBoost,
    keywordScore: score,
    confidenceBoost,
    reasons
  };
}

module.exports = {
  scoreItem
};
