polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),
  actions: {
    toggleScanner() {
      this.toggleProperty('isShowingDiv');
    },

    toggleFile() {
      this.toggleProperty('isShowingFile');
    }
  }
});
