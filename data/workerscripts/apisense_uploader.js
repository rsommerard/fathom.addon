importScripts("./debug.js");

const tag = 'apisense';

onerror = function(event) { 
  error(tag, JSON.stringify(event));
};

onmessage = function(event) {
  return login().then(function(token) {
    return cropsInfo(token);
  }).then(function(info) {
    const data = formatData(event.data);
    debug(tag, data);
    return uploadMeasurements(info.cropLocation, info.dataToken, data);
  }).catch(function (err) {
    error(tag, err.statusText);
  });
};

const login = function() {
  return new Promise(function (resolve, reject) {
    const url = "http://localhost:4000/v1/login";
    const packageIdentifier = "fr.inria.muse.fathom";
    const sdkkey = "110e8400-e29b-11d4-a716-446655440000";
    const content = "{ \"username\": \"" + packageIdentifier + "\", \"password\": \"" + sdkkey + "\"}";
  
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", 'application/json');
    xhr.setRequestHeader("sdkkey", sdkkey);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          debug(tag, xhr.response);
          resolve(JSON.parse(xhr.response).token);
        } else {
          error(tag, xhr.statusText);
          reject({
            status: xhr.status,
            statusText: xhr.statusText
          });
        }
      }
    };

    xhr.onerror = function () {
      reject({
        status: xhr.status,
        statusText: xhr.statusText
      });
    };

    xhr.send(content);
  });
};

const cropsInfo = function(token) {
  return new Promise(function (resolve, reject) {
    const url = "http://localhost:4000/v1/crops/12345";
    const packageIdentifier = "fr.inria.muse.fathom";
    const sdkkey = "110e8400-e29b-11d4-a716-446655440000";
  
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.setRequestHeader("sdkkey", sdkkey);
    xhr.setRequestHeader("authorization", token);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          debug(tag, xhr.response);
          resolve(JSON.parse(xhr.response));
        } else {
          error(tag, xhr.statusText);
          reject({
            status: xhr.status,
            statusText: xhr.statusText
          });
        }
      }
    };

    xhr.onerror = function () {
      reject({
        status: xhr.status,
        statusText: xhr.statusText
      });
    };

    xhr.send();
  });
};

const uploadMeasurements = function(url, dataToken, data) {
  return new Promise(function (resolve, reject) {
    const packageIdentifier = "fr.inria.muse.fathom";
    const sdkkey = "110e8400-e29b-11d4-a716-446655440000";
  
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", 'application/json');
    xhr.setRequestHeader("dataToken", dataToken);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          debug(tag, xhr.response);
          resolve();
        } else {
          error(tag, xhr.statusText);
          reject({
            status: xhr.status,
            statusText: xhr.statusText
          });
        }
      }
    };

    xhr.onerror = function () {
      reject({
        status: xhr.status,
        statusText: xhr.statusText
      });
    };

    xhr.send(data);
  });
};

const formatData = function(data) {
  const formattedData = {};

  formattedData.metadata = {};
  formattedData.metadata.timestamp = new Date().toISOString();
  formattedData.metadata.device = "PC:Fathom";

  formattedData.body = [];
  formattedData.body.push(data);

  return JSON.stringify([formattedData]);
};