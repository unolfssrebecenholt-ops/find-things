const { bboxToPercentStyle, bboxToPixelStyle, withDisplayIndexes } = require('../../utils/geometry');
const { isMockAssetPath } = require('../../utils/mock-assets');

function boxKey(item, index) {
  return item._id || item.tempId || `${item.displayName || 'item'}_${index}`;
}

function hasDrawableBbox(item) {
  const bbox = item && item.bbox;
  return !!bbox && Number(bbox.width) > 0 && Number(bbox.height) > 0;
}

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
    'items.**': function updateBoxes() {
      this.updateBoxes();
    },
    imageSrc: function updateImageState(imageSrc) {
      const hasImage = !!imageSrc && !isMockAssetPath(imageSrc);
      this.setData({
        hasImage,
        showPlaceholder: !hasImage
      });
      this.measureLayout();
    }
  },

  lifetimes: {
    attached() {
      this.measureLayout();
    },
    ready() {
      this.measureLayout();
    }
  },

  data: {
    boxes: [],
    hasImage: false,
    showPlaceholder: true,
    imageSize: null,
    containerSize: null
  },

  methods: {
    handleImageLoad(event) {
      const detail = event.detail || {};
      this.setData({
        imageSize: {
          width: detail.width || 0,
          height: detail.height || 0
        }
      });
      this.measureLayout();
    },

    measureLayout() {
      if (typeof wx === 'undefined' || !wx.createSelectorQuery) {
        this.updateBoxes();
        return;
      }
      const query = () => {
        wx.createSelectorQuery()
          .in(this)
          .select('.annotated-image')
          .boundingClientRect((rect) => {
            if (!rect) {
              this.updateBoxes();
              return;
            }
            this.setData({
              containerSize: {
                width: rect.width || 0,
                height: rect.height || 0
              }
            });
            this.updateBoxes();
          })
          .exec();
      };
      if (wx.nextTick) {
        wx.nextTick(query);
        return;
      }
      setTimeout(query, 0);
    },

    updateBoxes() {
      const imageSize = this.data.imageSize;
      const containerSize = this.data.containerSize;
      const canUsePixelStyle = imageSize && containerSize && imageSize.width && imageSize.height && containerSize.width && containerSize.height;
      const boxes = withDisplayIndexes(this.data.items || [])
        .filter((item) => item.confirmed !== false && hasDrawableBbox(item))
        .map((item, index) => Object.assign({}, item, {
          boxKey: boxKey(item, index),
          boxStyle: canUsePixelStyle
            ? bboxToPixelStyle(item.bbox, imageSize, containerSize)
            : bboxToPercentStyle(item.bbox)
        }));
      this.setData({ boxes });
    }
  }
});
