const { COLORS, TOKEN_MAPPINGS, cleanQuery, normalizeQuery } = require('./normalize');

const SEMANTIC_GROUPS = [
  { id: 'book', label: '书', terms: ['book', '书', '图书', '书本', '小说', '教材', '绘本', '漫画'] },
  { id: 'pen', label: '笔', terms: ['pen', '笔', '签字笔', '黑笔', '水笔', '圆珠笔', '中性笔'] },
  { id: 'accessory', label: '配饰', terms: ['accessory', '配饰', '发卡', '发夹', '头饰', '饰品'] },
  { id: 'cable', label: '线', terms: ['cable', '线', '充电线', '数据线', '线缆', '电源线'] },
  { id: 'bag', label: '包', terms: ['bag', '包', '小包', '袋', '袋子', '收纳包', '拉链包', '网格包'] },
  { id: 'bear', label: '小熊', terms: ['小熊', '熊', 'bear', 'butterbear', '黄油小熊'] },
  { id: 'charm', label: '挂件', terms: ['挂件', '吊饰', '钥匙扣', '标签挂饰', '挂饰'] },
  { id: 'tissue', label: '纸巾', terms: ['纸巾', '卫生纸', '抽纸'] },
  { id: 'sanitary_pad', label: '卫生巾', terms: ['卫生巾', '护垫'] }
];

const FEATURE_TERMS = [
  '封面',
  '书名',
  '科幻',
  '弧形',
  '网格',
  '拉链',
  '标签',
  '签字笔',
  '水笔',
  '发卡',
  '发夹',
  '头饰',
  '充电线',
  '数据线'
];

const FIELD_WEIGHTS = {
  displayName: 3.8,
  aiName: 3.2,
  alias: 3.2,
  feature: 2.8,
  visibleText: 2.8,
  category: 2.4,
  color: 1.4,
  note: 2.2,
  description: 0.45
};

const GROUP_LABELS = SEMANTIC_GROUPS.reduce((labels, group) => {
  labels[group.id] = group.label;
  return labels;
}, {});

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function addWeighted(vector, key, weight) {
  if (!key || !weight) return;
  vector[key] = (vector[key] || 0) + weight;
}

function addToken(tokens, token) {
  const value = cleanQuery(token);
  if (value) tokens.push(value);
}

function addMatchedTerms(value, callback) {
  COLORS.forEach((color) => {
    if (value.includes(color)) callback(color, `color:${color}`, 1.1);
  });
  FEATURE_TERMS.forEach((term) => {
    const cleaned = cleanQuery(term);
    if (cleaned && value.includes(cleaned)) callback(cleaned, `term:${cleaned}`, 1);
  });
  TOKEN_MAPPINGS.forEach((mapping) => {
    const cleaned = cleanQuery(mapping.match);
    if (!cleaned || !value.includes(cleaned)) return;
    callback(cleaned, `term:${cleaned}`, 1);
    callback(mapping.token, `concept:${mapping.token}`, 1.35);
  });
  SEMANTIC_GROUPS.forEach((group) => {
    group.terms.forEach((term) => {
      const cleaned = cleanQuery(term);
      if (!cleaned || !value.includes(cleaned)) return;
      callback(cleaned, `term:${cleaned}`, 1);
      callback(group.id, `concept:${group.id}`, 1.45);
    });
  });
}

function addTextTokens(tokens, text) {
  const value = cleanQuery(text);
  if (!value) return;
  tokens.push(value);
  addMatchedTerms(value, (label) => addToken(tokens, label));
}

function addNgrams(vector, value, weight) {
  const maxSize = Math.min(4, value.length);
  for (let size = 2; size <= maxSize; size += 1) {
    for (let index = 0; index <= value.length - size; index += 1) {
      addWeighted(vector, `gram:${value.slice(index, index + size)}`, weight);
    }
  }
}

function addTextVector(vector, text, weight) {
  const value = cleanQuery(text);
  if (!value) return;
  addWeighted(vector, `raw:${value}`, weight * 0.55);
  addMatchedTerms(value, (label, key, termWeight) => {
    addWeighted(vector, key, weight * termWeight);
  });
  if (value.length === 1) {
    addWeighted(vector, `term:${value}`, weight);
  } else {
    addNgrams(vector, value, weight * 0.22);
  }
}

function buildQueryVector(query) {
  const vector = {};
  addTextVector(vector, query, 1.4);
  normalizeQuery(query).forEach((token) => addTextVector(vector, token, 1.1));
  return vector;
}

function buildItemVectors(item) {
  const identityVector = {};
  const contextVector = {};

  addTextVector(identityVector, item.displayName, FIELD_WEIGHTS.displayName);
  addTextVector(identityVector, item.aiName, FIELD_WEIGHTS.aiName);
  addTextVector(identityVector, item.visibleText, FIELD_WEIGHTS.visibleText);
  addTextVector(identityVector, item.note, FIELD_WEIGHTS.note);
  addTextVector(identityVector, item.category, FIELD_WEIGHTS.category);
  (item.aliases || []).forEach((text) => addTextVector(identityVector, text, FIELD_WEIGHTS.alias));
  (item.features || []).forEach((text) => addTextVector(identityVector, text, FIELD_WEIGHTS.feature));
  (item.colors || []).forEach((text) => addTextVector(identityVector, text, FIELD_WEIGHTS.color));

  addTextVector(contextVector, item.description, FIELD_WEIGHTS.description);

  return { identityVector, contextVector };
}

function dotProduct(left, right) {
  return Object.keys(left).reduce((sum, key) => sum + (left[key] * (right[key] || 0)), 0);
}

function vectorMagnitude(vector) {
  return Math.sqrt(Object.keys(vector).reduce((sum, key) => sum + (vector[key] * vector[key]), 0));
}

function cosineSimilarity(left, right) {
  const leftMagnitude = vectorMagnitude(left);
  const rightMagnitude = vectorMagnitude(right);
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dotProduct(left, right) / (leftMagnitude * rightMagnitude);
}

function queryCoverage(queryVector, identityVector) {
  const keys = Object.keys(queryVector).filter((key) => !key.startsWith('raw:'));
  const total = keys.reduce((sum, key) => sum + queryVector[key], 0);
  if (!total) return 0;
  const matched = keys.reduce((sum, key) => (
    identityVector[key] ? sum + queryVector[key] : sum
  ), 0);
  return matched / total;
}

function tokensFromQuery(query) {
  const tokens = normalizeQuery(query).slice();
  addTextTokens(tokens, query);
  return unique(tokens);
}

function tokensFromItem(item) {
  const tokens = [];
  [
    item.displayName,
    item.aiName,
    item.visibleText,
    item.note,
    item.category
  ].forEach((text) => addTextTokens(tokens, text));
  (item.aliases || []).forEach((text) => addTextTokens(tokens, text));
  (item.features || []).forEach((text) => addTextTokens(tokens, text));
  (item.colors || []).forEach((text) => addTextTokens(tokens, text));
  return unique(tokens);
}

function formatToken(token) {
  return GROUP_LABELS[token] || token;
}

function getMatchedTokens(queryTokens, itemTokens) {
  return queryTokens.filter((queryToken) => (
    itemTokens.some((itemToken) => (
      itemToken === queryToken
        || (queryToken.length > 1 && itemToken.includes(queryToken))
    ))
  ));
}

function semanticMatch(query, item) {
  const queryTokens = tokensFromQuery(query);
  const itemTokens = tokensFromItem(item);
  const matchedTokens = getMatchedTokens(queryTokens, itemTokens);
  const queryColors = queryTokens.filter((token) => COLORS.includes(token));
  const itemColors = itemTokens.filter((token) => COLORS.includes(token));
  const nonColorTokens = queryTokens.filter((token) => !COLORS.includes(token));
  const matchedNonColorTokens = matchedTokens.filter((token) => !COLORS.includes(token));
  const queryVector = buildQueryVector(query);
  const itemVectors = buildItemVectors(item);
  const identitySimilarity = cosineSimilarity(queryVector, itemVectors.identityVector);
  const contextSimilarity = cosineSimilarity(queryVector, itemVectors.contextVector);
  const coverage = queryCoverage(queryVector, itemVectors.identityVector);
  const score = Math.round(Math.min(1, (
    identitySimilarity * 0.64
    + coverage * 0.31
    + Math.min(contextSimilarity, 0.25) * 0.05
  )) * 100);
  const summaryTokens = unique(matchedTokens.map(formatToken));

  return {
    score,
    matchedTokens,
    matchedNonColorTokens,
    colorMismatch: queryColors.length > 0 && itemColors.length > 0
      && !queryColors.some((color) => itemColors.includes(color)),
    requiresNonColorMatch: queryTokens.some((token) => COLORS.includes(token)) && nonColorTokens.length > 0,
    summary: summaryTokens.length ? `语义匹配：${summaryTokens.slice(0, 3).join('、')}` : '',
    identitySimilarity,
    contextSimilarity,
    coverage
  };
}

module.exports = {
  semanticMatch,
  tokensFromItem,
  tokensFromQuery
};
