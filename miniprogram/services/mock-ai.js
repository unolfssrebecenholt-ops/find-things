const { normalizeBbox, withDisplayIndexes } = require('../utils/geometry');

const MOCK_ITEMS = [
  {
    tempId: 'mock_1',
    displayName: '蓝色发卡',
    aiName: '蓝色发卡',
    category: 'accessory',
    colors: ['蓝色'],
    visibleText: '',
    description: '一个蓝色弧形发卡，位于画面右下角。',
    aliases: ['发夹', '头饰', '蓝色发夹'],
    bbox: { x: 0.68, y: 0.62, width: 0.18, height: 0.16 },
    confidence: 0.82,
    uncertaintyReason: ''
  },
  {
    tempId: 'mock_2',
    displayName: '黑色笔',
    aiName: '黑色笔',
    category: 'pen',
    colors: ['黑色'],
    visibleText: '',
    description: '一支黑色签字笔，位于抽屉中部偏左。',
    aliases: ['黑笔', '签字笔', '水笔'],
    bbox: { x: 0.36, y: 0.44, width: 0.22, height: 0.06 },
    confidence: 0.8,
    uncertaintyReason: ''
  },
  {
    tempId: 'mock_3',
    displayName: '《三体》',
    aiName: '《三体》',
    category: 'book',
    colors: [],
    visibleText: '三体',
    description: '一本书，封面可见三体字样。',
    aliases: ['三体', '科幻书', '书'],
    bbox: { x: 0.44, y: 0.08, width: 0.3, height: 0.24 },
    confidence: 0.9,
    uncertaintyReason: ''
  },
  {
    tempId: 'mock_4',
    displayName: '蓝色封面的书',
    aiName: '蓝色封面的书',
    category: 'book',
    colors: ['蓝色'],
    visibleText: '',
    description: '一本蓝色封面的书，书名不清晰。',
    aliases: ['蓝色书', '书', '疑似西游记'],
    bbox: { x: 0.58, y: 0.34, width: 0.28, height: 0.25 },
    confidence: 0.62,
    uncertaintyReason: '书名不清晰，需要人工确认。'
  },
  {
    tempId: 'mock_5',
    displayName: '白色充电线',
    aiName: '白色充电线',
    category: 'cable',
    colors: ['白色'],
    visibleText: '',
    description: '一团白色充电线，靠近抽屉左下角。',
    aliases: ['数据线', '线缆', '充电线'],
    bbox: { x: 0.12, y: 0.66, width: 0.28, height: 0.18 },
    confidence: 0.76,
    uncertaintyReason: ''
  }
];

function cloneItem(item, index) {
  return Object.assign({}, item, {
    tempId: item.tempId || `mock_${index + 1}`,
    bbox: normalizeBbox(item.bbox),
    aliases: (item.aliases || []).slice(),
    colors: (item.colors || []).slice(),
    confirmed: true,
    note: ''
  });
}

function analyzeImage(options) {
  const imagePath = options && options.imagePath ? options.imagePath : '/assets/mock-container-content.jpg';
  return {
    imagePath,
    items: withDisplayIndexes(MOCK_ITEMS.map(cloneItem)),
    warnings: ['当前为本地 mock 识别结果，请确认名称和位置。']
  };
}

module.exports = {
  analyzeImage,
  MOCK_ITEMS
};
