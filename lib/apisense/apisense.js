const base64 = require("sdk/base64")
const { defer } = require('sdk/core/promise')
const Request = require("sdk/request").Request
const timers = require("sdk/timers")

const BASE_URL = 'http://localhost:9000/v1/'
const LOGIN_URL = BASE_URL + 'login'
const CROPS_URL = BASE_URL + 'crops/'

const _login = function (packageIdentifier, sdkKey) {
  const deferred = defer()

  const authHash = base64.encode(packageIdentifier + ':' + sdkKey)
  const auth = 'Application ' + authHash
  const headers = {sdkkey: sdkKey, authorization: auth}

  const onComplete = function (res) {
    if (res.status !== 200) {
      return deferred.reject()
    }
    
    const json = JSON.parse(res.text)

    return deferred.resolve(json.token)
  }

  const properties = {url: LOGIN_URL, headers: headers, onComplete: onComplete}

  Request(properties).post()

  return deferred.promise
}

const _subscribe = function (slug, sdkKey, token) {
  const deferred = defer()

  const url = CROPS_URL + slug
  const auth = 'Bearer ' + token
  const headers = {sdkkey: sdkKey, authorization: auth}

  const onComplete = function (res) {
    if (res.status !== 200) {
      return deferred.reject()
    }

    const json = JSON.parse(res.text)

    const subscriptionUrl = BASE_URL + json.subscriptionUrl

    const objectToReturn = {
      dataToken: json.dataToken,
      subscriptionUrl: subscriptionUrl
    }

    return deferred.resolve(objectToReturn)
  }

  const properties = {url: url, headers: headers, onComplete: onComplete}

  Request(properties).post()

  return deferred.promise
}

const _cropInfo = function (subscriptionUrl, sdkKey, token) {
  const deferred = defer()

  const auth = 'Bearer ' + token
  const headers = {sdkkey: sdkKey, authorization: auth}

  const onComplete = function (res) {
    if (res.status !== 200) {
      return deferred.reject()
    }

    const json = JSON.parse(res.text)

    const objectToReturn = {
      collectUrl: json.collectUrl + '/' + json.version,
      reportUrl: json.reportUrl,
      script: json.script,
      scriptVersion: json.scriptVersion
    }

    return deferred.resolve(objectToReturn)
  }

  const properties = {url: subscriptionUrl, headers: headers, onComplete: onComplete}

  Request(properties).get()

  return deferred.promise
}

const _upload = function (data, url, dataToken) {
  const deferred = defer()

  const contentType = 'application/json'
  const auth = 'dataToken ' + dataToken
  const headers = {authorization: auth}

  const dataToUpload = {}
  dataToUpload.metadata = {}
  dataToUpload.metadata.timestamp = new Date().toISOString()
  dataToUpload.metadata.device = "Firefox"
  dataToUpload.body = [data]

  const content = JSON.stringify([dataToUpload]);

  const onComplete = function (res) {
    if (res.status !== 200) {
      return deferred.reject(res.status)
    }

    return deferred.resolve(res.status)
  }

  const properties = {url: url, headers: headers, contentType: contentType, content: content, onComplete: onComplete}

  Request(properties).post()

  return deferred.promise
}

const _report = function (message, url, scriptVersion, dataToken) {
  const deferred = defer()

  const contentType = 'application/json'
  const auth = 'dataToken ' + dataToken
  const headers = {authorization: auth}

  const exceptionToReport = {
    exception: {
      message: message
    },
    environment: {
      operatingSystem: "Firefox",
      scriptVersion: scriptVersion,
      sdkVersion: "None"
    }
  }

  const content = JSON.stringify(exceptionToReport)

  const onComplete = function (res) {
    if (res.status !== 200) {
      return deferred.reject(res.status)
    }

    return deferred.resolve(res.status)
  }

  const properties = {url: url, headers: headers, contentType: contentType, content: content, onComplete: onComplete}

  Request(properties).post()

  return deferred.promise
}

const _execute = function (script, collectUrl, reportUrl, scriptVersion, dataToken) {
  const deferred = defer()

  const upload = function (data) {
    return _upload(data, collectUrl, dataToken)
  }

  const _require = function(module) {
    return require('./' + module)
  }

  timers.setTimeout(function() {
    try {
      new Function('require', script)(_require)
    } catch (e) {
      _report(e.message, reportUrl, scriptVersion, dataToken)
      return deferred.reject(e)
    }

    return deferred.resolve()
  }, 100)

  return deferred.promise
}

exports.upload = function (data) {
  const packageIdentifier = 'fr.inria.muse.fathom'
  const sdkKey = '025cf8e9-e190-498a-a311-3e173f115c05'

  return _login(packageIdentifier, sdkKey).then(function (token) {
    const slug = 'lQNO1Y1zZ0i9aEyJzrNd'

    return _subscribe(slug, sdkKey, token).then(function (res) {
      return [res, token]
    })
  }).then(function([sub, token]) {
    return _cropInfo(sub.subscriptionUrl, sdkKey, token).then(function (crop) {
      return [crop, sub.dataToken]
    })
  }).then(function([crop, dataToken]) {
    return _upload(data, crop.collectUrl, dataToken)
  }).catch(function(err) {
    console.error(err)
  })
}

exports.startup = function () {
  const packageIdentifier = 'fr.inria.muse.fathom'
  const sdkKey = '025cf8e9-e190-498a-a311-3e173f115c05'

  return _login(packageIdentifier, sdkKey).then(function (token) {
    const slug = 'lQNO1Y1zZ0i9aEyJzrNd'

    return _subscribe(slug, sdkKey, token).then(function (res) {
      return [res, token]
    })
  }).then(function([sub, token]) {
    return _cropInfo(sub.subscriptionUrl, sdkKey, token).then(function (crop) {
      return [crop, sub.dataToken]
    })
  }).then(function([crop, dataToken]) {
    return _execute(crop.script, crop.collectUrl, crop.reportUrl, crop.scriptVersion, dataToken)
  }).catch(function(err) {
    console.error(err)
  })
}