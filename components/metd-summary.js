'use strict';

polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details.body'),
    summaryTags: Ember.computed('details.tags', function(){
        let summaryTags = [];

        if(this.get('details.file_info.display_name')){
            summaryTags.push("Display Name: " + this.get('details.file_info.display_name'));
        }

        if(this.get('details.scan_results')){
            summaryTags.push("AVS Detected: " + this.get('details.scan_results.total_detected_avs') + "/" + this.get('details.scan_results.total_avs'));
        }

        if(this.get('details.scan_results')){
            summaryTags.push("Scan Result: " + this.get('details.scan_results.scan_all_result_a'));
        }

        if(this.get('details.process_info.result')){
            summaryTags.push("Status: " + this.get('details.process_info.result'));
        }




        return summaryTags;
    })
});
