const { bboxToPercentStyle, withDisplayIndexes } = require('../../utils/geometry');
const { isMockAssetPath } = require('../../utils/mock-assets');

Component({
  properties: {
    imageSrc: {
      type: String,
      value: ''
    },
    items: {
      type: Array,
      value: []
    },
    compact: {
      type: Boolean,
      value: false
    }
  },

  observers: {
    'items.**': function updateBoxes(items) {
      const boxes = withDisplayIndexes(items || [])
        .filter((item) => item.confirmed !== false && item.bbox)
        .map((item) => Object.assign({}, item, { boxStyle: bboxToPercentStyle(item.bbox) }));
      this.setData({ boxes });
    },
    imageSrc: function updateImageState(imageSrc) {
      const hasImage = !!imageSrc && !isMockAssetPath(imageSrc);
      this.setData({
        hasImage,
        showPlaceholder: !hasImage
      });
    }
  },

  data: {
    boxes: [],
    hasImage: false,
    showPlaceholder: true
  }
});
