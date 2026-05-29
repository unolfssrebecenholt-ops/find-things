const { COLORS } = require('../../utils/normalize');

function splitTerms(value) {
  return String(value || '')
    .split(/[、,，;；\s]+/)
    .map((term) => term.trim())
    .filter((term, index, terms) => term && terms.indexOf(term) === index);
}

Component({
  properties: {
    items: {
      type: Array,
      value: []
    },
    hideHead: {
      type: Boolean,
      value: false,
      observer(value) {
        this.setData({
          showHead: !value,
          showToolbar: !value,
          showKeepAction: !value,
          editorClass: value ? 'embedded' : ''
        });
      }
    },
    contextKey: {
      type: String,
      value: ''
    }
  },

  data: {
    showHead: true,
    showToolbar: true,
    showKeepAction: true,
    editorClass: ''
  },

  methods: {
    emit(items) {
      this.triggerEvent('change', {
        items,
        contextKey: this.data.contextKey
      });
    },

    patchItem(index, patch) {
      const items = (this.data.items || []).map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return Object.assign({}, item, patch);
      });
      this.emit(items);
    },

    toggleConfirmed(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      this.patchItem(index, { confirmed: !item.confirmed });
    },

    rename(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        displayName: event.detail.value
      });
    },

    editCategory(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        category: event.detail.value
      });
    },

    editTags(event) {
      const terms = splitTerms(event.detail.value);
      const colors = terms.filter((term) => COLORS.includes(term));
      const searchableTerms = terms.filter((term) => !COLORS.includes(term));
      this.patchItem(Number(event.currentTarget.dataset.index), {
        colors,
        features: searchableTerms,
        aliases: searchableTerms
      });
    },

    editDescription(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        description: event.detail.value
      });
    },

    editNote(event) {
      this.patchItem(Number(event.currentTarget.dataset.index), {
        note: event.detail.value
      });
    },

    removeItem(event) {
      const index = Number(event.currentTarget.dataset.index);
      const items = (this.data.items || []).filter((_, itemIndex) => itemIndex !== index);
      this.emit(items);
    }
  }
});
