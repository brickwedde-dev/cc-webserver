const http = require("http");
const https = require("https");
const fs = require('fs').promises;
const fs1 = require('fs');

module.exports = {
    createWebserver : function (host, port, mapping, sslport) {
        const mime = (filename) => {
            var mapping = {
                "html" : "text/html",
                "js" : "text/javascript",
                "css" : "text/css",
                "txt" : "text/plain",
                "gif" : "image/gif",
                "png" : "image/png",
                "jpeg" : "image/jpeg",
                "jpg" : "image/jpeg",
                "pdf" : "application/pdf",
                "zip" : "application/zip",
                "mp4" : "video/mp4",
                "mpeg" : "video/mpeg",
            };
            filename = filename.toLowerCase();
            var i = filename.lastIndexOf(".");
            if (i > 0) {
                var extension = filename.substring(i + 1);
                if (mapping[extension]) {
                    return mapping[extension];
                }
            }
            return "application/octet-stream";
        };

        const requestListener = function (req, res) {
            var requrl = req.url;
            var i = requrl.indexOf("?");
            if (i >= 0) {
                requrl = requrl.substring(0, i);
            }
            for (var map of mapping) {
                if(map.hosts.length > 0 && map.hosts.lastIndexOf (req.headers.host) < 0) {
                    continue;
                }
                var bExact = map.exacturl && requrl == map.exacturl;
                var bPrefix = map.urlprefix && requrl.substring(0, map.urlprefix.length) == map.urlprefix;

                if (bExact || bPrefix) {
                    if (map.uploadfolder) {
                        console.log(requrl + " has uploadfolder");
                        if (map.apiobject && map.apiobject.checksession) {
                            let user = {};
                            promise = map.apiobject.checksession({}, req, res, user, "");
                        }
    
                        var body = ''
                        req.on('data', function(data) {
                            body += data
                        });
                        req.on('end', function() {
                            var json = null;
                            try {
                                json = body ? JSON.parse(body) : null;
                            } catch (e) {
                            }
                            if (!json || !json.filename || !json.content) {
                                res.writeHead(500);
                                res.end("");
                            }
                            var filename = json.filename;
                            filename = filename.replace(/\.\./g, "__");
                            filename = filename.replace(/\//g, "_");
                            filename = filename.replace(/\\/g, "_");
                            var b64 = json.content;
                            if (b64.substring(0, 5) == "data:") {
                                var b64index = b64.indexOf("base64,");
                                if (b64index >= 0) {
                                    b64 = b64.substring(b64index + 7);
                                }
                            }
                            var content = Buffer.from(b64, "base64");
    
                            fs.writeFile(process.cwd() + "/" + map.uploadfolder + "/" + filename, content)
                            .then(() => {
                                res.writeHead(200);
                                res.end("");
                            })
                            .catch((e) => {
                                res.writeHead(500);
                                res.end("" + e);
                            });
                        });
                        return;
                    }

                    if (map.handleobject) {
                        console.log(requrl + " has handleobject");
                        var oInfo = {};
                        var promise = Promise.resolve();
                        if (map.handleobject.checksession) {
                            let user = {};
                            promise = map.handleobject.checksession(oInfo, req, res, user, fnname);
                        }

                        promise.then(() => {
                            if (map.handleobject.handlerequest) {
                                map.handleobject.handlerequest(oInfo, req, res, requrl);
                            } else {
                                res.writeHead(404);
                            }
                        })
                        .catch((e) => {
                            res.writeHead(500);
                            res.end("" + e);
                        });
                        return;
                    }
                }

                if (bExact) {
                    if (map.staticfile) {
                        fs.readFile(process.cwd() + "/" + map.staticfile)
                        .then(contents => {
                            fs.stat(process.cwd() + "/" + map.staticfile)
                            .then((stats) => {
                                res.setHeader("Content-Type", mime(map.staticfile));
                                res.setHeader("Last-Modified", new Date(stats.mtime));
                                res.setHeader("Cache-Control", "max-age=600");
                                res.setHeader("eTag", "\"" + stats.mtime + "\"");
                                res.writeHead(200);
                                res.end(contents);
                            });
                        })
                        .catch(err => {
                            res.writeHead(500);
                            res.end(""+err);
                        });
                    }
                    return;
                }

                if (bPrefix) {
                    if (map.staticfile) {
                        console.log(requrl + " has staticfile");
                        var file = requrl.substring(map.urlprefix.length);
                        file = file.replace(/\.\./g, "__");
                        fs.readFile(process.cwd() + "/" + map.staticfile + "/" + file)
                        .then(contents => {
                            fs.stat(process.cwd() + "/" + map.staticfile + "/" + file)
                            .then((stats) => {
                                res.setHeader("Content-Type", mime(file));
                                res.setHeader("Last-Modified", new Date(stats.mtime));
                                res.setHeader("Cache-Control", "max-age=600");
                                res.setHeader("eTag", "\"" + stats.mtime + "\"");
                                res.writeHead(200);
                                res.end(contents);
                            });
                        })
                        .catch(err => {
                            res.writeHead(404);
                            res.end("");
                        });
                        return;
                    }

                    if (map.apiobject) {
                        console.log(requrl + " has apiobject");
                        let what = requrl.substr(map.urlprefix.length + 1);
                        if (what.substring(0, 14) == "sse/connection") {
                            let fnname = "__SSE__";
                            var oInfo = {};
                            var promise = Promise.resolve();
                            if (map.apiobject.checksession) {
                                let user = {};
                                promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                            }

                            promise.then(() => {
                                res.writeHead(200, {
                                    'Content-Type': 'text/event-stream',
                                    'Cache-Control': 'no-cache',
                                    'Connection': 'keep-alive',
                                });
            
                                if (!map.apiobject.__internal_sseconnections) {
                                    map.apiobject.__internal_sseconnections = [];
                                }
                                let obj = {req, res};
                                map.apiobject.__internal_sseconnections.push(obj);
            
                                const id = Date.now();
                                const data = JSON.stringify({ fnname: "testsse", params : [id] });
                                const message = `id:${id}\ndata: ${data}\n\n`;
                                res.write(message);

                                req.on('close', () => {
                                    var index = map.apiobject.__internal_sseconnections.indexOf(obj);
                                    if (index >= 0) {
                                        map.apiobject.__internal_sseconnections.splice(index, 1);
                                    }
                                });
                            })
                            .catch((e) => {
                                res.writeHead(500, {
                                    'Content-Type': 'text/plain',
                                    'Cache-Control': 'no-cache',
                                    'Connection': 'keep-alive',
                                });
                                res.end("" + e);
                            });
                            return;
                        }
                        
                        var body = ''
                        req.on('data', function(data) {
                            console.log(requrl + " on data");
                            body += data
                        })
                        req.on('end', function() {
                            console.log(requrl + " on end");
                            var parameters = [];
                            try {
                                if (body) {
                                    parameters = JSON.parse(body);
                                }
                            } catch (e) {
                                res.writeHead(500, {
                                    'Content-Type': 'text/plain',
                                    'Cache-Control': 'no-cache',
                                    'Connection': 'keep-alive',
                                });
                                res.end("Failed on body: " + body);
                                return;
                            }
                            try {
                                if (what.substring(0, 12) == "sse/register") {
                                    for(let fnname of parameters) {
                                        if (!map.apiobject || !map.apiobject[fnname]) {
                                            continue;
                                        }
                                        if (!map.apiobject.__internal_ssefunctions) {
                                            map.apiobject.__internal_ssefunctions = {};
                                        }
                                        if (!map.apiobject.__internal_ssefunctions[fnname]) {
                                            map.apiobject.__internal_ssefunctions[fnname] = true;
                                
                                            map.apiobject[fnname] = (...params) => {
                                                const id = Date.now();
                                                const data = JSON.stringify({fnname, params});
                                                const message = `id:${id}\ndata: ${data}\n\n`;
                                                if (map.apiobject.__internal_sseconnections) {
                                                    for(var conn of map.apiobject.__internal_sseconnections) {
                                                        try {
                                                            conn.res.write(message);
                                                        } catch (e) {
                                                        }
                                                    }
                                                }
                                            };
                                        }
                                    }
                                    return;
                                }
            
                                if (what.substring(0, 6) == "method") {
                                    var fnname = what.substring(7);
                                    if (!map.apiobject[fnname]) {
                                        throw "Function " + fnname + " not found";
                                    }
        
                                    var oInfo = {};
                                    var promise = Promise.resolve();
                                    if (map.apiobject.checksession) {
                                        let user = {};
                                        promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                                    }
                                    parameters.unshift(oInfo);
        
                                    promise.then(() => {
                                        var result = map.apiobject[fnname].apply(map.apiobject, parameters);
                                        if (result instanceof Promise) {
                                            result
                                            .then((x) => {
                                                res.writeHead(200, {
                                                    'Content-Type': "application/json",
                                                    'Cache-Control': 'no-cache',
                                                    'Connection': 'keep-alive',
                                                });
                                                res.end(JSON.stringify(x));
                                            })
                                            .catch((e) => {
                                                res.writeHead(500, {
                                                    'Content-Type': "text/plain",
                                                    'Cache-Control': 'no-cache',
                                                    'Connection': 'keep-alive',
                                                    "X-Exception": "" + e,
                                                });
                                                res.end(e);
                                            });
                                        } else {
                                            res.writeHead(200, {
                                                'Content-Type': "application/json",
                                                'Cache-Control': 'no-cache',
                                                'Connection': 'keep-alive',
                                            });
                                            res.end(JSON.stringify(result));
                                        }
                                    })
                                    .catch((w) => {
                                        res.writeHead(403, {
                                            'Content-Type': "text/plain",
                                            'Cache-Control': 'no-cache',
                                            'Connection': 'keep-alive',
                                        });
                                        res.end("User unauthorized by apiobject: " + w);
                                    });
                                    return;
                                }
                                throw "Unknown what";
                            } catch (e) {
                                res.writeHead(500, {
                                    'Content-Type': "text/plain",
                                    'Cache-Control': 'no-cache',
                                    'Connection': 'keep-alive',
                                });
                                res.end("Failed on function: " + e);
                                return;
                            }
                        })
                        return;
                    }
                }
            }
        
            console.log("Not found, Host:" + req.headers.host + ", URL:" + req.url);
          
            res.writeHead(404);
            res.end("Not found!");
        };
        if (port > 0) {
          const server = http.createServer(requestListener);
          server.listen(port, host, () => {
            console.log(`Server is running on http://${host}:${port}`);
          });
        }
        if (sslport > 0) {
          const options = {
            key: fs1.readFileSync('key.pem'),
            cert: fs1.readFileSync('cert.pem')
          };
          const sserver = https.createServer(options, requestListener);
          sserver.listen(sslport, host, () => {
            console.log(`Server is running on https://${host}:${port}`);
          });
       }
    }
};
  
