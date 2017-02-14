const self = require("sdk/self");
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);

const baselineapi = require('./baselineapi');

const apisenseUploader = self.data.url("workerscripts/apisense_uploader.js");

exports.doBaselineMeasurements = function() {
  const uploader = new ChromeWorker(apisenseUploader);

  const ts = new Date();

  baselineapi.domeasurements(function(baseline) {
    baseline.latency = Date.now() - ts.getTime();
    
    uploader.postMessage(baseline);
  });
};
