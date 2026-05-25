const { COLORS, TOKEN_MAPPINGS, cleanQuery, normalizeQuery } = require('./normalize');

const CATEGORY_ALIASES = {
  book: ['book', '书', '图书', '书本', '封面'],
  pen: ['pen', '笔', '签字笔', '黑笔', '水笔'],
  accessory: ['accessory', '发卡', '发夹', '头饰', '配饰'],
  cable: ['cable', '线', '充电线', '数据线', '线缆']
};

const FEATURE_TERMS = [
  '封面',
  '书名',
  '科幻',
  '弧形',
  '签字笔',
  '水笔',
  '发卡',
  '发夹',
  '头饰',
  '充电线',
  '数据线'
];

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function addTextTokens(tokens, text) {
  const value = cleanQuery(text);
  if (!value) return;
  tokens.push(value);
  COLORS.forEach((color) => {
    if (value.includes(color)) tokens.push(color);
  });
  FEATURE_TERMS.forEach((term) => {
    if (value.includes(term)) tokens.push(term);
  });
  TOKEN_MAPPINGS.forEach((mapping) => {
    if (value.includes(mapping.match)) {
      tokens.push(mapping.match);
      tokens.push(mapping.token);
    }
  });
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
    item.description,
    item.note,
    item.category
  ].forEach((text) => addTextTokens(tokens, text));
  (item.aliases || []).forEach((text) => addTextTokens(tokens, text));
  (item.colors || []).forEach((text) => addTextTokens(tokens, text));
  (CATEGORY_ALIASES[item.category] || []).forEach((token) => tokens.push(token));
  return unique(tokens);
}

function characterOverlap(queryText, itemText) {
  const queryChars = unique(cleanQuery(queryText).split(''));
  const itemChars = unique(cleanQuery(itemText).split(''));
  if (!queryChars.length || !itemChars.length) return 0;
  const shared = queryChars.filter((char) => itemChars.includes(char)).length;
  return shared / queryChars.length;
}

function semanticMatch(query, item) {
  const queryTokens = tokensFromQuery(query);
  const itemTokens = tokensFromItem(item);
  const matchedTokens = queryTokens.filter((queryToken) => (
    itemTokens.some((itemToken) => itemToken === queryToken || itemToken.includes(queryToken))
  ));
  const nonColorTokens = queryTokens.filter((token) => !COLORS.includes(token));
  const matchedNonColorTokens = matchedTokens.filter((token) => !COLORS.includes(token));
  const fieldText = [
    item.displayName,
    item.aiName,
    item.visibleText,
    item.description,
    item.note,
    (item.aliases || []).join(' '),
    (item.colors || []).join(' '),
    item.category
  ].filter(Boolean).join(' ');
  const overlap = characterOverlap(query, fieldText);
  const tokenScore = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
  const score = Math.round(Math.min(1, tokenScore * 0.85 + overlap * 0.15) * 100);
  return {
    score,
    matchedTokens,
    matchedNonColorTokens,
    requiresNonColorMatch: queryTokens.some((token) => COLORS.includes(token)) && nonColorTokens.length > 0,
    summary: matchedTokens.length ? `语义匹配：${matchedTokens.slice(0, 3).join('、')}` : ''
  };
}

module.exports = {
  semanticMatch,
  tokensFromItem,
  tokensFromQuery
};
