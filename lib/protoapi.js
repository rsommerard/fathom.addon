/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.proto API.
 *
 * Implements various application protocols on top of the socket API.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const {error, FathomException} = require("./error");

// actual protocol implementations
const upnp = require("./proto/upnp");
const http = require("./proto/http");
const dns = require("./proto/dns");
const mdns = require("./proto/mdns");
const jsonrpc = require("./proto/jsonrpc");

var id = 1;
var protos = {};

/**
 * Start the API component.
 */
var start = exports.start = function() {
    id = 1;
    protos = {};
};

/**
 * Stop the API component.
 */
var stop = exports.stop = function() {};

/**
 * Executes the given request and callback with the data or an object with
 * error field with a short error message.
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
        return callback(error("missingmethod"));

    var pid, obj = undefined;
    if (req.method === "create") {
        // create new protocol object 
        console.log("proto." + req.submodule + ".create");

        switch (req.submodule) {
        case "http":
            obj = new http.HTTP(manifest, 
                    req.params[0], 
                    req.params[1]);

            obj.connect(function(res) {
                if (res.error) {
                    callback(res, true);
                } else {
                    pid = id;
                    protos[pid] = obj;
                    id += 1;
                    callback(pid, true);
                }
            });
            break;
            
        case "dns":
            obj = new dns.DNS(manifest, 
                      req.params[0], 
                      req.params[1], 
                      req.params[2]);
            pid = id;
            protos[pid] = obj;
            id += 1;
            callback(pid, true);

            break;
            
        case "mdns":
            obj = new mdns.MDNS(manifest);
            pid = id;
            protos[pid] = obj;
            id += 1;
            callback(pid, true);
            break;
            
        case "upnp":
            obj = new upnp.UPNP(manifest);
            pid = id;
            protos[pid] = obj;
            id += 1;
            callback(pid, true);
            break;
            
        case "jsonrpc":
            obj = new jsonrpc.JSONRPC(manifest, 
                          req.params[0], 
                          req.params[1], 
                          req.params[2], 
                          req.params[3], 
                          req.params[4]);

            obj.connect(function(res) {
                if (res.error) {
                    callback(res, true);
                } else {
                    pid = id;
                    protos[pid] = obj;
                    id += 1;
                    callback(pid, true);
                }
            });
            break;
            
        default:
            return callback(error("nosuchmethod", 
                      req.submodule+"."+req.method));
        }

    } else if (req.params && req.params.length>0 && protos[req.params[0]]) {
        // call method on existing object
        pid = req.params[0];
        obj = protos[pid];
        console.log("proto." + req.submodule + "." + req.method + 
                " pid="+pid);

        if (obj && typeof obj[req.method] === "function") {
            var args = [callback].concat(req.params.splice(1));
            obj[req.method].apply(obj,args);
        } else {
            // instance found but not the method
            return callback(error("nosuchmethod", 
                      req.submodule+"."+req.method));
        }

        // cache cleanup on close
        if (req.method === 'close')
            delete protos[pid];

    } else {
        callback(error("invalidid", "protocolid="+
                   req.submodule+"/"+(req.params ? req.params[0] : "na")));
    }
};

/** Exec promise. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};


const api = {}

const generateId = function() {
    return Math.floor((Math.random() * 10000000) + 10000)
}

const createReq = function(requestModule, requestSubmodule, requestMethod, requestParams, requestMultiresponse) {
    const req = {}

    req.module = requestModule
    req.submodule = requestSubmodule
    req.method = requestMethod
    req.params = requestParams
    req.multiresp = requestMultiresponse || false

    req.id = generateId()

    return req
}

const createManifest = function() {
    const manifest = {}

    manifest.winid = -1
    manifest.isaddon = true
    manifest.neighbors = []

    return manifest
}

const makeRequest = function(callback, requestModule, requestSubmodule, requestMethod, requestParams, requestMultiresponse) {
    const req = createReq(requestModule, requestSubmodule, requestMethod, requestParams, requestMultiresponse)
    const manifest = createManifest()

    return exec(callback, req, manifest)
}

// proto.dns

api.dns = {}

api.dns.close = function(callback, dnsid) {
    return makeRequest(callback, 'proto', 'dns', 'close', [dnsid], false)
}

api.dns.create = function(callback, server, proto, port) {
    return makeRequest(callback, 'proto', 'dns', 'create', [server, proto, port], false)
}

api.dns.lookup = function(callback, dnsid, host, timeout) {
    return makeRequest(callback, 'proto', 'dns', 'lookup', [dnsid, host, timeout], false)
}

// proto.http

api.http = {}

api.http.close = function(callback, httpid) {
    return makeRequest(callback, 'proto', 'http', 'close', [httpid], false)
}

api.http.create = function(callback, ip, port) {
    return makeRequest(callback, 'proto', 'http', 'create', [ip, port], false)
}

api.http.receive = function(callback, httpid) {
    return makeRequest(callback, 'proto', 'http', 'receive', [httpid], false)
}

api.http.send = function(callback, httpid, method, path, headers, data) {
    return makeRequest(callback, 'proto', 'http', 'send', [httpid, method, path, headers, data], false)
}

// proto.jsonrpc

api.jsonrpc = {}

api.jsonrpc.close = function(callback, id) {
    return makeRequest(callback, 'proto', 'jsonrpc', 'close', [id], false)
}

api.jsonrpc.create = function(callback, dst, port, server, proto, path) {
    return makeRequest(callback, 'proto', 'jsonrpc', 'create', [dst, port, server, proto, path], false)
}

api.jsonrpc.listen = function(callback, id) {
    return makeRequest(callback, 'proto', 'jsonrpc', 'listen', [id], false)
}

api.jsonrpc.makereq = function(callback, id, method, params, mdle, urlparams) {
    return makeRequest(callback, 'proto', 'jsonrpc', 'makereq', [id, method, params, mdle, params], false)
}

api.jsonrpc.sendres = function(callback, id, res, error) {
    return makeRequest(callback, 'proto', 'jsonrpc', 'sendres', [id, res, error], false)
}

// proto.mdns

api.mdns = {}

api.mdns.close = function(callback, mdnsid) {
    return makeRequest(callback, 'proto', 'mdns', 'close', [mdnsid], false)
}

api.mdns.create = function(callback) {
    return makeRequest(callback, 'proto', 'mdns', 'create', [], false)
}

api.mdns.discovery = function(callback, mdnsid, timeout) {
    return makeRequest(callback, 'proto', 'mdns', 'discovery', [mdnsid, timeout], false)
}

// proto.upnp

api.upnp = {}

api.upnp.close = function(callback, upnpid) {
    return makeRequest(callback, 'proto', 'upnp', 'close', [upnpid], false)
}

api.upnp.create = function(callback) {
    return makeRequest(callback, 'proto', 'upnp', 'create', [], false)
}

api.upnp.discovery = function(callback, upnpid, timeout) {
    return makeRequest(callback, 'proto', 'upnp', 'discovery', [upnpid, timeout], false)
}

exports.api = api