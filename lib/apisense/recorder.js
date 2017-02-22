const apisense = require('./apisense')

const sync = function(data) {
  return apisense.upload(data)
}

exports.sync = sync