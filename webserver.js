const http = require("http");
const fs = require('fs').promises;

module.exports = {
    createWebserver : function (host, port, mapping) {
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
                if (map.exacturl && requrl == map.exacturl) {
                    if (map.staticfile) {
                        fs.readFile(process.cwd() + "/" + map.staticfile)
                        .then(contents => {
                            res.setHeader("Content-Type", "text/html");
                            res.writeHead(200);
                            res.end(contents);
                        })
                        .catch(err => {
                            res.writeHead(500);
                            res.end(""+err);
                        });
                    }
                    return;
                }
                if (map.urlprefix && requrl.substring(0, map.urlprefix.length) == map.urlprefix) {
                    if (map.staticfile) {
                        var file = requrl.substring(map.urlprefix.length);
                        file = file.replace(/\\.\\./g, "__");
                        fs.readFile(process.cwd() + "/" + map.staticfile + "/" + file)
                        .then(contents => {
                            res.setHeader("Content-Type", "text/html");
                            res.writeHead(200);
                            res.end(contents);
                        })
                        .catch(err => {
                            res.writeHead(500);
                            res.end(""+err);
                        });
                        return;
                    }
                    if (map.apiobject) {
                        let what = requrl.substr(map.urlprefix.length + 1);
                        if (what.substring(0, 14) == "sse/connection") {
                            let fnname = what.substring(4);
                            if (map.apiobject.checksession) {
                                let user = {};
                                if (!map.apiobject.checksession(user, fnname)) {
                                    res.writeHead(403);
                                    res.end("User unauthorized by apiobject");
                                    return;
                                }
                            }
        
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
        
                            req.on('close', () => {
                                var index = map.apiobject.__internal_sseconnections.indexOf(obj);
                                if (index >= 0) {
                                    map.apiobject.__internal_sseconnections.splice(index, 1);
                                }
                            });
                            return;
                        }
                        
                        var body = ''
                        req.on('data', function(data) {
                            body += data
                        })
                        req.on('end', function() {
                            var parameters = [];
                            try {
                                if (body) {
                                    parameters = JSON.parse(body);
                                }
                            } catch (e) {
                                res.writeHead(500);
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
        
                                    if (map.apiobject.checksession) {
                                        var user = {};
                                        if (!map.apiobject.checksession(user, fnname)) {
                                            res.writeHead(403);
                                            res.end("User unauthorized by apiobject");
                                            return;
                                        }
                                    }
        
                                    var result = map.apiobject[fnname].apply(map.apiobject, parameters);
                                    res.setHeader("Content-Type", "application/json");
                                    res.writeHead(200);
                                    res.end(JSON.stringify(result));
                                    return;
                                }
                                throw "Unknown what";
                            } catch (e) {
                                res.writeHead(500);
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
        const server = http.createServer(requestListener);
        server.listen(port, host, () => {
            console.log(`Server is running on http://${host}:${port}`);
        });
    }
};
  