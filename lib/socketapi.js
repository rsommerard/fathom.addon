/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.socket.* & fathom.tools.* APIs.
 *
 * We use the NSPR library and worker threads to provide an asynchronous acces
 * socket APIs. This module takes care of creating and messaging with
 * the ChromeWorkers. The actual API implementation is in the worker code
 * at ./data/workerscripts/*.js.
 *
 * Note that the add-on sdk adds another layer of async callbacks compared 
 * to the previous implementation (from the content script to addon an
 * from the addon to the worker).
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);

const self = require("sdk/self");
const timers = require("sdk/timers");

const {error, FathomException} = require("./error");
const security = require('./security');
const consts = require('./consts');
const utils = require('./utils');
const nsprfile = utils.nsprFile;

// id and cache of async API socket workers
var socketid = 1;
var socketworkers = {}; // socketid -> workerstruct

/**
 * Start the API component.
 */
var start = exports.start = function() {
    socketid = 1;
    socketworkers = {}; // socketid -> workerstruct
    security.start();
};

/**
 * Stop the API component.
 */
 var stop = exports.stop = function() {
    for (var s in socketworkers) {
        if (socketworkers[s] && socketworkers[s].worker)
            socketworkers[s].worker.postMessage(JSON.stringify({ method : 'close' }));
    }
    socketworkers = {};
    security.stop();
};

// worker fatal error messages handler
var geterrorhandler = function(sid) {
    return function(event) {
        var msg = "socketapi [worker"+sid+"] error: " + event.message + 
            ' [' + event.filename + ':' + event.lineno + ']';
            console.error(msg, event);
    };
};

// worker message
var getmessagehandler = function(sid) {
    return function(event) {
        if (!socketworkers[sid]) {
            // can happen for example when recv loop is stopping ..
            return;
        }
        var sw = socketworkers[sid];

        if (!event.data) {
            console.warn("socketapi [worker"+sid+"] sends empty message?!?");
            return;
        }

        console.debug("socketapi [worker"+sid+"] got message: " + 
                 (event.data.length > 50 ? 
                  event.data.substring(0,50) + " ... }" : event.data));

        var msg = JSON.parse(event.data);
        if (msg.error)
            console.warn("socketapi [worker"+sid+"] req "+msg.id+" error: "+
                 JSON.stringify(msg.error));

        if (sw.requests[msg.id]) {
            if (!sw.init && !msg.error) {
                // worker created, return the socketid (unless flagged not to)
                sw.init = true;
                if (!sw.noinitresp)
                    sw.requests[msg.id](sid, msg.done);
            } else if (msg.error) {
                sw.requests[msg.id](error("socketerror",msg.error), 
                            msg.done);
            } else {
                sw.requests[msg.id](msg.data, msg.done);
            }

            // cleanup callback ?
            if (msg.done)
                delete sw.requests[msg.id];

        } else {
            console.warn("socketapi [worker"+sid+"] request "+ 
                 msg.id + " has no callback?!");
        }
    };
};

/**
 * Cleanup executing sockets for the given window.
 */
var windowclose = exports.windowclose = function(winid) {
    var sw;
    var del = [];
    for (var s in socketworkers) {  
        sw = socketworkers[s];
        if (sw.winid === winid) {
            sw.worker.postMessage(JSON.stringify({ method : 'close' }));
            del.push(s);
        }
    }
    // give some time for the workers to cleanup
    timers.setTimeout(function() {
        for (var i = 0; i < del.length; i++) {
          var s = del[i]
          socketworkers[s].worker.terminate();
          delete socketworkers[s];
        }
    }, 500);
};

/**
 * Executes the given socket request and calls back with the data or 
 * an object with error field with a short error message.
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
        return callback(error("missingmethod"));

    // TODO: params array could really be an object (and check for 
    // req.params.ip) so we don't need to know the index for each 
    // method here... this is rather ugly like this
    var checkok = undefined;
    var dst = {
        host : undefined,      // after sec check, this is IP address
        hostname : undefined,  // this is the orig param of API call
        port : undefined,
        proto : req.submodule
    };

    switch (req.method) {
    case "udpSendTo":
        if (!req.params || req.params.length < 3 || !req.params[2])
            return callback(error("missingparams","host"));
        if (!req.params || req.params.length < 4 || !req.params[3])
            return callback(error("missingparams","port"));

        dst.host = dst.hostname = req.params[2];
        dst.port = req.params[3];
        dst.proto = 'udp';
        checkok = security.checkDstPermission(dst, manifest);
        if (checkok)
            req.params[2] = dst.host; // hostname -> ip
        break;

    case "udpConnect":
        dst.proto = 'udp';
    case "multicastJoin":
        if (!req.params || req.params.length < 2 || !req.params[1])
            return callback(error("missingparams","host"));
        if (!req.params || req.params.length < 3 || !req.params[2])
            return callback(error("missingparams","port"));

        dst.host = dst.hostname = req.params[1];
        dst.port = req.params[2];
        checkok = security.checkDstPermission(dst, manifest);
        if (checkok)
            req.params[1] = dst.host; // hostname -> ip
        break;

    case "tcpOpenSendSocket":
        if (!req.params || req.params.length < 1 || !req.params[0])
            return callback(error("missingparams","host"));
        if (!req.params || req.params.length < 2 || !req.params[1])
            return callback(error("missingparams","port"));

        dst.host = dst.hostname = req.params[0];
        dst.port = req.params[1];
        dst.proto = 'tcp';
        checkok = security.checkDstPermission(dst, manifest);
        if (checkok)
            req.params[0] = dst.host; // hostname -> ip
        break;

    case "start":
        if (!req.params || req.params.length < 1 || !req.params[0])
            return callback(error("missingparams","destination"));

        dst.host = dst.hostname = req.params[0];

        var opt = (req.params.length > 1 ? req.params[1] : {});
        req.params[1] = opt;

        if (req.submodule === 'ping') {
            // tools.ping.start
            dst.proto = opt.proto || 'udp';
            if (dst.proto === 'udp')
                dst.port = opt.port || consts.PING_PORT;
            if (dst.proto === 'ws')
                dst.port = opt.port || 80;
            if (dst.proto === 'http')
                dst.port = opt.port || 80;
            if (dst.proto === 'xmlhttpreq')
                dst.port = opt.port || 80;

            checkok = security.checkDstPermission(dst, manifest);
            if (checkok) {
                req.params[0] = dst.host; // hostname -> ip
                req.params[1].port = dst.port;
            }

        } else if (req.submodule === 'iperf') {
            // tools.iperf.start
            dst.port = opt.port || consts.IPERF_PORT;
            dst.proto = opt.proto || 'udp';
            checkok = security.checkDstPermission(dst, manifest);
            if (checkok) {
                req.params[0] = dst.host; // hostname -> ip
                req.params[1].port = dst.port;
            }

        } else { // should not happen
            checkok = false;
        }
        break;

    default:
        checkok = true;
    }

    if (dst.host) {
        console.log("socketapi init host " + dst.hostname + 
                    " -> " + dst.proto+"://"+dst.host+":"+dst.port +
                    " securitycheck="+checkok);

        // the socket API works with IPv4 only (FIXME)
        if (!utils.isValidIPv4(dst.host)) {
            return callback(error('notipv4', dst.host)); 
        }

        if (!checkok) {
            return callback(error("destinationnotallowed", 
                          dst.proto+"://"+dst.host+":"+dst.port));
        }
        
        if (!security.checkDstServerPermission(dst, manifest)) {
           return callback(error("serverforbidden",dst.host));
        }
    }

    var sid = undefined;
    var worker = undefined;
    var sw = undefined;    
    if (req.method.toLowerCase().indexOf('open')>=0 || 
        (req.module === "tools" && req.method.indexOf("start")>=0)) 
    {
        // creating a new chromeworker
        sid = socketid;
        socketid = socketid + 1;
        console.debug("socketapi [worker" + sid + "] create req " + 
                 req.id + " method " + req.submodule+"." + req.method);

        var scriptname = self.data.url("workerscripts/socketworker.js");
        worker = new ChromeWorker(scriptname);
        worker.onerror = geterrorhandler(sid);
        worker.onmessage = getmessagehandler(sid);

        sw = {
            init : false,
            winid : manifest.winid,  // for handling window close events
            worker : worker,
            requests : {},           // on-going requests
            noinitresp : ((req.submodule === 'ping' || req.submodule === 'iperf') && req.method === 'start')
        };
        socketworkers[sid] = sw;

        // add few fields for initializing the socket worker
        req.createworker = true;
        req.nsprpath = nsprfile.path;
        req.nsprname = nsprfile.leafName;
        req.workerid = sid;

        // send open request to the worker
        sw.requests[req.id] = callback;
        sw.worker.postMessage(JSON.stringify(req));

    } else if (req.params && req.params.length>0) { 
        sid = req.params[0];
        req.params = req.params.slice(1);

        console.debug("socketapi [worker" + sid + "] exec req " + 
                 req.id + " method " + req.submodule+"." + req.method);

        sw = socketworkers[sid];
        if (!sw)
            return callback(error("invalidid", "socket="+sid));

        if (req.method === 'close' || req.method === 'stop') {
            sw.worker.postMessage(JSON.stringify(req));
            // give the worker some time to cleanup itself
            timers.setTimeout(function() {
                sw.worker.terminate();
                delete socketworkers[sid];
                callback({},true);
            }, 100);

        } else {
            sw.requests[req.id] = callback;
            sw.worker.postMessage(JSON.stringify(req));
        }
    } else {
        // socket API call for existing worker, but no socketid parameter
        return callback(error("missingparams","socketid"));
    }
};

const api = {}

const createReq = function(requestModule, requestMethod, requestParams, requestMultiresponse) {
    const req = {}

    req.module = requestModule
    req.method = requestMethod
    req.params = requestParams
    req.multiresp = requestMultiresponse || false

    req.id = utils.generateId()

    return req
}

const makeRequest = function(callback, requestModule, requestMethod, requestParams, requestMultiresponse) {
    const req = createReq(requestModule, requestMethod, requestParams, requestMultiresponse)
    const manifest = utils.createManifest()

    return exec(callback, req, manifest)
}

// socket

api.close = function (callback, socketid) {
    return makeRequest(callback, 'socket', 'close', [socketid], false)
}

api.getHostIP = function (callback, socketid) {
    return makeRequest(callback, 'socket', 'getHostIP', [socketid], false)
}

api.getPeerIP = function (callback, socketid) {
    return makeRequest(callback, 'socket', 'getPeerIP', [socketid], false)
}

// socket.tcp

api.tcp = {}

api.tcp.close = function (callback, socketid) {
    return makeRequest(callback, 'socket.tcp', 'close', [socketid], false)
}

api.tcp.getHostIP = function (callback, socketid) {
    return makeRequest(callback, 'socket.tcp', 'getHostIP', [socketid], false)
}

api.tcp.getPeerIP = function (callback, socketid) {
    return makeRequest(callback, 'socket.tcp', 'getPeerIP', [socketid], false)
}

api.tcp.openReceiveSocket = function(callback, port, reuse) {
    return makeRequest(callback, 'socket.tcp', 'tcpOpenReceiveSocket', [port, reuse], false)
}

api.tcp.openSendSocket = function(callback, destip, destport) {
    return makeRequest(callback, 'socket.tcp', 'tcpOpenSendSocket', [destip, destport], false)
}

api.tcp.recv = function (callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.tcp', 'recv', [socketid, asstring || false, timeout, size], false)
}

api.tcp.send = function (callback, socketid, msg) {
    return makeRequest(callback, 'socket.tcp', 'send', [socketid, msg], false)
}

// socket.udp

api.udp = {}

api.udp.bind = function(callback, socketid, addr, port, reuse) {
    return makeRequest(callback, 'socket.udp', 'udpBind', [socketid, addr, port, reuse], false)
}

api.udp.close = function (callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'close', [socketid], false)
}

api.udp.connect = function(callback, socketid, addr, port) {
    return makeRequest(callback, 'socket.udp', 'udpConnect', [socketid, addr, port], false)
}

api.udp.getHostIP = function (callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'getHostIP', [socketid], false)
}

api.udp.getPeerIP = function (callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'getPeerIP', [socketid], false)
}

api.udp.open = function(callback) {
    return makeRequest(callback, 'socket.udp', 'udpOpen', [], false)
}

api.udp.recv = function (callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.udp', 'recv', [socketid, asstring || false, timeout, size], false)
}

api.udp.recvfrom = function(callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvFrom', [socketid, asstring || false, timeout, size], false)
}

api.udp.recvfromstart = function(callback, socketid, asstring, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvFromStart', [socketid, asstring || false, size], true)
}

api.udp.recvfromstop = function(callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStop', [socketid], false)
}

api.udp.recvstart = function(callback, socketid, asstring, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStart', [socketid, asstring || false, size], true)
}

api.udp.recvstop = function(callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStop', [socketid], false)
}

api.udp.send = function(callback, socketid, data) {
    return makeRequest(callback, 'socket.udp', 'send', [socketid, data], false)
}

api.udp.sendrecv = function(callback, socketid, data, asstring, timeout, size) {
    return makeRequest(callback, 'socket.udp', 'udpSendRecv', [socketid, data, asstring || false, timeout, size], false)
}

api.udp.sendto = function(callback, socketid, data, ip, port) {
    return makeRequest(callback, 'socket.udp', 'udpSendTo', [socketid, data, ip, port], false)
}

// socket.broadcast

api.broadcast = {}

api.broadcast.close = function (callback, socketid) {
    return makeRequest(callback, 'socket.broadcast', 'close', [socketid], false)
}

api.broadcast.openReceiveSocket = function (callback, port) {
    return makeRequest(callback, 'socket.broadcast', 'broadcastOpenReceiveSocket', [port], false)
}

api.broadcast.openSendSocket = function (callback) {
    return makeRequest(callback, 'socket.broadcast', 'broadcastOpenSendSocket', [], false)
}

api.broadcast.recvFrom = function (callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.broadcast', 'udpRecvFrom', [socketid, asstring || false, timeout, size], false)
}

api.broadcast.sendTo = function(callback, socketid, msg, ip, port) {
    return makeRequest(callback, 'socket.broadcast', 'udpSendTo', [socketid, msg, ip, port], false)
}

// socket.multicast

api.multicast = {}

api.multicast.close = function (callback, socketid) {
    return makeRequest(callback, 'socket.multicast', 'close', [socketid], false)
}

api.multicast.join = function (callback, socketid, ip, port, reuse) {
    return makeRequest(callback, 'socket.multicast', 'multicastJoin', [socketid, ip, port, reuse], false)
}

api.multicast.open = function (callback, ttl, loopback) {
    return makeRequest(callback, 'socket.multicast', 'multicastOpenSocket', [ttl, loopback], false)
}

api.multicast.recv = function(callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.multicast', 'recv', [socketid, asstring || false, timeout, size], false)
}

api.multicast.recvfrom = function(callback, socketid, asstring, timeout, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvFrom', [socketid, asstring || false, timeout, size], false)
}

api.multicast.recvfromstart = function(callback, socketid, asstring, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvFromStart', [socketid, asstring || false, size], false)
}

api.multicast.recvfromstop = function(callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStop', [socketid], false)
}

api.multicast.recvstart = function(callback, socketid, asstring, size) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStart', [socketid, asstring || false, size], false)
}

api.multicast.recvstop = function(callback, socketid) {
    return makeRequest(callback, 'socket.udp', 'udpRecvStop', [socketid], false)
}

api.multicast.send = function(callback, socketid, data) {
    return makeRequest(callback, 'socket.multicast', 'send', [socketid, data], false)
}

api.multicast.sendrecv = function(callback, socketid, data, asstring, timeout, size) {
    return makeRequest(callback, 'socket.multicast', 'udpSendRecv', [socketid, data, asstring || false, timeout, size], false)
}

api.multicast.sendto = function(callback, socketid, data, ip, port) {
    return makeRequest(callback, 'socket.udp', 'udpSendTo', [socketid, data, ip, port], false)
}

exports.api = api