Component({
  properties: {
    items: {
      type: Array,
      value: []
    }
  },

  methods: {
    emit(items) {
      this.triggerEvent('change', { items });
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
