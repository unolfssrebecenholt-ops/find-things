const FILLER_WORDS = [
  '帮我找',
  '帮忙找',
  '在哪里',
  '在哪',
  '哪里',
  '一个',
  '一件',
  '一本',
  '一支',
  '这个',
  '那个',
  '找'
];

const TOKEN_MAPPINGS = [
  { match: '签字笔', token: 'pen' },
  { match: '黑笔', token: 'pen' },
  { match: '水笔', token: 'pen' },
  { match: '笔', token: 'pen' },
  { match: '书', token: 'book' },
  { match: '发卡', token: 'accessory' },
  { match: '发夹', token: 'accessory' },
  { match: '头饰', token: 'accessory' },
  { match: '充电线', token: 'cable' },
  { match: '线', token: 'cable' }
];

const COLORS = ['黑色', '蓝色', '白色', '红色', '绿色', '黄色', '灰色', '透明'];

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function cleanQuery(query) {
  let text = String(query || '').trim().toLowerCase();
  FILLER_WORDS.forEach((word) => {
    text = text.split(word).join('');
  });
  return text.replace(/[，。！？,.!?;；：:\s]+/g, '');
}

function normalizeQuery(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const tokens = [];
  COLORS.forEach((color) => {
    if (cleaned.includes(color)) tokens.push(color);
  });

  const matchedTerms = [];
  TOKEN_MAPPINGS
    .slice()
    .sort((a, b) => b.match.length - a.match.length)
    .forEach((mapping) => {
      if (!cleaned.includes(mapping.match)) return;
      const coveredByLongerTerm = matchedTerms.some((term) => term.includes(mapping.match));
      if (!coveredByLongerTerm) {
        tokens.push(mapping.match);
        matchedTerms.push(mapping.match);
      }
      tokens.push(mapping.token);
    });

  if (!tokens.length) tokens.push(cleaned);

  return unique(tokens);
}

module.exports = {
  cleanQuery,
  normalizeQuery,
  TOKEN_MAPPINGS,
  COLORS
};
