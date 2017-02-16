const self = require("sdk/self");
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);
const Request = require("sdk/request").Request;
const base64 = require("sdk/base64");

const baselineapi = require('./baselineapi');

const apisenseUploader = self.data.url("workerscripts/apisense_uploader.js");
const apisenseDownloader = self.data.url("workerscripts/apisense_downloader.js");

const hive = "http://localhost:9000/v1/";

const packageIdentifier = "fr.inria.muse.fathom";
const sdkkey = "025cf8e9-e190-498a-a311-3e173f115c05";

const slug = "lQNO1Y1zZ0i9aEyJzrNd";

const doBaselineMeasurements = function() {
  const uploader = new ChromeWorker(apisenseUploader);

  const ts = new Date();

  baselineapi.domeasurements(function(baseline) {
    baseline.latency = Date.now() - ts.getTime();

    uploader.postMessage(baseline);
  });
};

const checkCrop = function() {
  const uploader = new ChromeWorker(apisenseDownloader);

  const ts = new Date();

  baselineapi.domeasurements(function(baseline) {
    baseline.latency = Date.now() - ts.getTime();

    uploader.postMessage(baseline);
  });
};

exports.start = function() {
  process();
};

const login = function() {
  const url = hive + "login";

  const authorization = "Application " + base64.encode(packageIdentifier + ":" + sdkkey);

  const request = Request({
    url: url,
    headers: {sdkkey: sdkkey, authorization: authorization},
    onComplete: function(res) {
      const token = JSON.parse(res.text).token;

      cropsInfo(token);
    }
  });

  request.post();
};

const process = function() {
  login();
};

const cropsInfo = function(token) {
  const url = hive + "crops/" + slug;

  const authorization = "Bearer " + token;

  const request = Request({
    url: url,
    headers: {sdkkey: sdkkey, authorization: authorization},
    onComplete: function(res) {
      const info = JSON.parse(res.text);

      execCropScript(info, token);
    }
  });

  request.post();
};

const execCropScript = function(info, token) {
  const url = hive + info.subscriptionUrl;

  const authorization = "Bearer " + token;

  const request = Request({
    url: url,
    headers: {sdkkey: sdkkey, authorization: authorization},
    onComplete: function(res) {
      const received = JSON.parse(res.text);
      eval(received.script);
      // const scriptResult = eval(received.script);
      // uploadResult(scriptResult, info, received);
    }
  });

  request.get();
};

const uploadResult = function(scriptResult, info, received) {
  const url = received.collectUrl + "/" + received.version;
  const authorization = "dataToken " + info.dataToken;

  const request = Request({
    url: url,
    contentType: "application/json",
    headers: {authorization: authorization},
    content: JSON.stringify(scriptResult),
    onComplete: function(res) {
      result(res.status);
    }
  });

  request.post();
};

const result = function(res) {
  console.warn(res);
};
