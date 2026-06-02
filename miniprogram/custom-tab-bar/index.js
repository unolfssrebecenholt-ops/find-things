const { switchSection } = require('../utils/navigation');

Component({
  data: {
    selected: 0
  },

  methods: {
    switchTab(event) {
      const dataset = event.currentTarget.dataset || {};
      const url = dataset.url;
      if (!url) return;
      this.setData({ selected: Number(dataset.index) || 0 });
      switchSection(url);
    }
  }
});
