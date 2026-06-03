const privacy = require('../../utils/privacy');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    contractName: {
      type: String,
      value: '《拍箱找物用户隐私保护指引》'
    }
  },

  methods: {
    onAgree() {
      privacy.resolvePendingAuthorization({
        buttonId: 'privacy-agree-btn',
        event: 'agree'
      });
    },

    onDisagree() {
      privacy.resolvePendingAuthorization({ event: 'disagree' });
    },

    onOpenContract() {
      privacy.openPrivacyContract(wx);
    }
  }
});
