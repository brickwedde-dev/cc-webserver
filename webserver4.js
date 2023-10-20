const http = require("http");
const http2 = require("http2");
const fs = require('fs').promises;
const fssync = require('fs');
const Buffer = require('buffer').Buffer;

const { runLetsencryptv2 } = require('./letsencrypt4.js');

var maintainerEmail = "nobody@invalid.domain.name";

class WebserverResponseSent {
}

class WebserverResponse {
  constructor(status, headers, html) {
    this.status = status;
    this.headers = headers;
    this.html = html;
  }
}

function handleApiObject(oInfo, map, what, apiobject, requrl, req, res, failcount) {
  if (what == "connection") {
    let fnname = "__SSE__";
    var promise = Promise.resolve();
    if (apiobject.checksession) {
      let user = {};
      try {
        promise = apiobject.checksession(oInfo, req, res, user, fnname);
      } catch(e) {
        console.log("checksession failed", e)
      }
    }

    promise.then(() => {
      if (failcount[req.socket.remoteAddress] > 0) {
        failcount[req.socket.remoteAddress]--
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Vary': '*',
      });

      if (!apiobject.__internal_sseconnections) {
        apiobject.__internal_sseconnections = [];
      }
      let obj = { req, res };
      apiobject.__internal_sseconnections.push(obj);

      const id = Date.now();
      const data = JSON.stringify({ fnname: "testsse", params: [id] });
      const message = `id:${id}\ndata: ${data}\n\n`;
      res.write(message);

      req.on('close', () => {
        var index = apiobject.__internal_sseconnections.indexOf(obj);
        if (index >= 0) {
          apiobject.__internal_sseconnections.splice(index, 1);
        }
      });
    })
    .catch((e) => {
      console.log("sse failed", e)
        res.writeHead(500, {
          'Content-Type': "text/plain",
          'Cache-Control': 'no-cache',
          'Vary': '*',
      });
      res.end("" + e);
    });
    return;
  }

  var body = '';
  req.on('data', function (data) {
    body += data;
  });
  req.on('end', function () {
    var parameters = [];
    try {
      if (!body) {
        var url = new URL(req.url, 'http://example.com');
        if (url.search.length > 1) {
          if (url.search.startsWith("?1?")) {
            var buf = url.search.substring(3);
            var a = buf.split("&");
            for(var i = 0; i < a.length; i++) {
              parameters.push(a[i].replace (/.*=/, ""));
            }
          } else {
            var buf = Buffer.from(url.search.substring(1), 'base64');
            body = buf.toString();
          }
        }
      }
      if (body) {
        parameters = JSON.parse(body);
        if (!parameters || typeof parameters != "object") {
          throw `Invalid ${JSON.stringify(parameters)} ${typeof parameters}`;
        }
      }
    } catch (e) {
      res.writeHead(500, {
        'Content-Type': "text/plain",
        'Cache-Control': 'no-cache',
        'Vary': '*',
      });
      res.end("Failed on body: " + body + ", " + e);
      return;
    }
    try {
      if (what == "register") {
        for (let fnname of parameters) {
          if (!apiobject) {
            console.log("SSE no apiobject")
            continue;
          }
          if (!apiobject[fnname]) {
            console.log("SSE no fnname " + fnname)
            continue;
          }
          if (!apiobject.__internal_ssefunctions) {
            apiobject.__internal_ssefunctions = {};
          }
          if (!apiobject.__internal_ssefunctions[fnname]) {
            apiobject.__internal_ssefunctions[fnname] = true;

            apiobject[fnname] = (...params) => {
              const id = Date.now();
              const data = JSON.stringify({ fnname, params });
              const message = `id:${id}\ndata: ${data}\n\n`;
              if (apiobject.__internal_sseconnections) {
                for (var conn of apiobject.__internal_sseconnections) {
                  try {
                    conn.res.write(message);
                  } catch (e) {
                  }
                }
              }
            };
          }
        }
        res.writeHead(200, {
          'Content-Type': "application/json; charset=utf-8",
          'Cache-Control': 'no-cache',
          'Vary': '*',
        });
        res.end(JSON.stringify({ ok: true }));

        if (failcount[req.socket.remoteAddress] > 0) {
          failcount[req.socket.remoteAddress]--
        }
        return;
      }

      if (what.substring(0, 6) == "method") {
        let fnname = what.substring(7);
        if (!apiobject[fnname]) {
          throw "Function " + fnname + " not found";
        }

//        let oInfo = { };
        let promise = Promise.resolve();
        if (apiobject.checksession) {
          let user = {};
          promise = apiobject.checksession(oInfo, req, res, user, fnname);
        }
        parameters.unshift(oInfo);

        promise.then(() => {
          if (!map.entrycounter) {
            map.entrycounter = {};
          }
          map.entrycounter[fnname] = (map.entrycounter[fnname] || 0) + 1;
          oInfo.entrycounter = map.entrycounter[fnname];

          var result = null;
          try {
            result = apiobject[fnname].apply(apiobject, parameters);
          } catch (e) {
            console.error(e);
          }
          if (result instanceof Promise) {
            result
              .then((x) => {
                if (x instanceof WebserverResponseSent) {

                } else if (x instanceof WebserverResponse) {
                  if (x.status > 0) {
                    res.writeHead(x.status, x.headers);
                    res.end(x.html);
                  }
                } else if (oInfo.htmltemplate) {
                  if (failcount[req.socket.remoteAddress] > 0) {
                    failcount[req.socket.remoteAddress]--
                  }

                  res.writeHead(200, {
                    'Content-Type': "text/html",
                    'Cache-Control': 'no-cache',
                    'Vary': '*',
                  });
                  res.end(oInfo.htmltemplate.replace(/@@/, x));
                } else {
                  if (failcount[req.socket.remoteAddress] > 0) {
                    failcount[req.socket.remoteAddress]--
                  }

                  x = JSON.stringify(x);
                  res.writeHead(200, {
                    'Content-Type': "application/json; charset=utf-8",
                    'Cache-Control': 'no-cache',
                    'Vary': '*',
                  });
                  res.end(x);
                }
                map.entrycounter[fnname] = map.entrycounter[fnname] - 1;
              })
              .catch((e) => {
                map.entrycounter[fnname] = map.entrycounter[fnname] - 1;
                if (oInfo.htmltemplate) {
                  res.writeHead(500, {
                    'Content-Type': "text/html",
                    'Cache-Control': 'no-cache',
                    'Vary': '*',
                  });
                  res.end(oInfo.htmltemplate.replace(/@@/, e));
                } else {
                  res.writeHead(500, {
                    'Content-Type': "text/plain",
                    'Cache-Control': 'no-cache',
                    'Vary': '*',
                    "X-Exception": "" + ("" + e).replace(/[^\x20-\x7F]/g, ""),
                  });
                  res.end("" + e);
                }
              });
          } else if (result instanceof WebserverResponseSent) {
            map.entrycounter[fnname] = map.entrycounter[fnname] - 1;
          } else {
            map.entrycounter[fnname] = map.entrycounter[fnname] - 1;
            if (oInfo.htmltemplate) {
              if (failcount[req.socket.remoteAddress] > 0) {
                failcount[req.socket.remoteAddress]--
              }
              res.writeHead(200, {
                'Content-Type': "text/html",
                'Cache-Control': 'no-cache',
                'Vary': '*',
              });
              res.end(oInfo.htmltemplate.replace(/@@/, result));
            } else {
              if (failcount[req.socket.remoteAddress] > 0) {
                failcount[req.socket.remoteAddress]--
              }
              result = JSON.stringify(result)
              res.writeHead(200, {
                'Content-Type': "application/json; charset=utf-8",
                'Cache-Control': 'no-cache',
                'Vary': '*',
              });
              res.end(result);
            }
          }
        })
          .catch((w) => {
            if (oInfo.htmltemplate) {
              res.writeHead(403, {
                'Content-Type': "text/html",
                'Cache-Control': 'no-cache',
                'Vary': '*',
              });
              res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
            } else {
              res.writeHead(403, {
                'Content-Type': "text/plain",
                'Cache-Control': 'no-cache',
                'Vary': '*',
              });
              res.end("User unauthorized by apiobject: " + w);
            }
          });
        return;
      }

      throw `Unknown what '${what}'`;
    } catch (e) {
      res.writeHead(500, {
        'Content-Type': "text/plain",
        'Cache-Control': 'no-cache',
        'Vary': '*',
      });
      res.end("Failed on function: " + e);
      return;
    }
  });
}

function debounce(callback, timeout) {
    let timer;
    return function (...args) {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(callback, timeout, ...args);
    };
}


function reloadcert (server, keyfile, certfile) {
  console.log("read certs");
  let key = fssync.readFileSync(keyfile);
  let cert = fssync.readFileSync(certfile);

  server._sharedCreds.context.setCert(cert);
  server._sharedCreds.context.setKey(key);

  console.log("ready reading certs");
}

module.exports = {
  setMaintainerEmail: function (email) {
    maintainerEmail = email;
  },

  createRedirectServer: function (host, port) {
    var redirectorserver = http.createServer({}, (req, res) => {
      res.setHeader("Location", 'https://' + req.headers.host + req.url);
      res.writeHead(301);
      res.end();
    });
    redirectorserver.listen(port, host, () => {
      console.log(`Redirector is running on http://${host}:${port}`);
    });
    return { redirectorserver };
  },

  createWebserver: function (host, port, key, cert, domains, maintainerEmail, urlmapping) {
    var mimemapping = {
      "html": "text/html",
      "js": "text/javascript",
      "css": "text/css",
      "txt": "text/plain",
      "gif": "image/gif",
      "png": "image/png",
      "jpeg": "image/jpeg",
      "jpg": "image/jpeg",
      "pdf": "application/pdf",
      "zip": "application/zip",
      "mp4": "video/mp4",
      "mpeg": "video/mpeg",
      "apk": "application/vnd.android.package-archive",
    };

    var failcount = {}

    const mime = (filename) => {
      filename = filename.toLowerCase();
      var i = filename.lastIndexOf(".");
      if (i > 0) {
        var extension = filename.substring(i + 1);
        if (mimemapping[extension]) {
          return mimemapping[extension];
        }
      }
      return "application/octet-stream";
    };

    const requestListener = function (req, res) {
      try {
        if (failcount[req.socket.remoteAddress] > 10) {
          res.setHeader("Location", "https://" + req.socket.remoteAddress);
          res.writeHead(308);
          res.end("");
          return
        }

        var requrl = decodeURIComponent(req.url);
        var i = requrl.indexOf("?");
        if (i >= 0) {
          requrl = requrl.substring(0, i);
        }
        for (var map of urlmapping) {
          if (map.hosts.length > 0 && map.hosts.lastIndexOf(req.headers.host) < 0 && map.hosts.lastIndexOf(req.headers[":authority"]) < 0) {
            continue;
          }
          var bExact = map.exacturl && requrl == map.exacturl;
          var bPrefix = map.urlprefix && requrl.substring(0, map.urlprefix.length) == map.urlprefix;

          if (bExact || bPrefix) {
            if (map.uploadfolder) {
              console.log(requrl + " has uploadfolder");
              if (apiobject && apiobject.checksession) {
                let user = {};
                promise = apiobject.checksession({}, req, res, user, "");
              }

              var body = '';
              req.on('data', function (data) {
                body += data;
              });
              req.on('end', function () {
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
                    if (failcount[req.socket.remoteAddress] > 0) {
                      failcount[req.socket.remoteAddress]--
                    }
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
          }

          if (bExact) {
            if (map.staticfile) {
              fs.readFile(process.cwd() + "/" + map.staticfile)
                .then(contents => {
                  fs.stat(process.cwd() + "/" + map.staticfile)
                    .then((stats) => {
                      var contType = mime(map.staticfile);
                      res.setHeader("Content-Type", contType);
                      res.setHeader("Last-Modified", new Date(stats.mtime));
                      res.setHeader("eTag", "\"" + stats.mtime + "\"");
                      if (map.nocache || contType == "text/html" || contType == "text/javascript" || map.staticfile.slice(-3) == ".js" || map.staticfile.slice(-5) == ".html") {
                        res.setHeader("Cache-Control", "no-cache");
                      } else {
                        res.setHeader("Cache-Control", "max-age=600");
                      }
                      res.writeHead(200);
                      res.end(contents);

                      if (failcount[req.socket.remoteAddress] > 0) {
                        failcount[req.socket.remoteAddress]--
                      }
                    });
                })
                .catch(err => {
                  if (!failcount[req.socket.remoteAddress]) {
                    failcount[req.socket.remoteAddress] = 0
                  }
                  failcount[req.socket.remoteAddress]++
                  res.writeHead(404);
                  res.end("" + map.staticfile + " not found");
                });
            }
            return;
          }

          if (bPrefix) {
            if (map.staticfile) {
              console.log(requrl + " has staticfile");
              var file = requrl.substring(map.urlprefix.length);
              file = file.replace(/\.\./g, "__");

              if (file.endsWith("@all.js")) {
                fs.readdir(process.cwd() + "/" + map.staticfile + "/" + file.slice(0, -7))
                  .then(async (files) => {
                    if (failcount[req.socket.remoteAddress] > 0) {
                      failcount[req.socket.remoteAddress]--
                    }
                    res.writeHead(200);
                    files.sort((a, b) => {
                      return a.localeCompare(b);
                    });
                    for (var singlefile of files) {
                      if (singlefile.endsWith(".js")) {
                        try {
                          var content = await fs.readFile(process.cwd() + "/" + map.staticfile + "/" + file.slice(0, -7) + "/" + singlefile);
                          res.write(content);
                        } catch (e) {
                        }
                      }
                    }
                    res.end("");
                  })
                  .catch((e) => {
                    res.writeHead(500);
                    res.end(file + ":" + "" + e);
                  });
                return;
              }

              fs.stat(process.cwd() + "/" + map.staticfile + "/" + file)
                .then(async (stats) => {
                  var contType = mime(file);
                  res.setHeader("Content-Type", contType);
                  res.setHeader("Content-Length", stats.size);
                  res.setHeader("Last-Modified", new Date(stats.mtime));
                  res.setHeader("eTag", "\"" + stats.mtime + "\"");
                  if (map.nocache || contType == "text/html" || contType == "text/javascript" || file.slice(-3) == ".js" || file.slice(-5) == ".html") {
                    res.setHeader("Cache-Control", "no-cache");
                  } else {
                    res.setHeader("Cache-Control", "max-age=600");
                  }
                  res.writeHead(200);

                  if (failcount[req.socket.remoteAddress] > 0) {
                    failcount[req.socket.remoteAddress]--
                  }

                  if (stats.size > 102400) {
                    let oInfo = { count: 0 };
                    let filehandle = await fs.open(process.cwd() + "/" + map.staticfile + "/" + file);
                    try {
                      let buf = Buffer.alloc(102400);
                      while (oInfo.count < stats.size) {
                        var p = new Promise((resolve, reject) => {
                          var rest = stats.size - oInfo.count;
                          if (rest <= 0) {
                            resolve(0);
                          }
                          if (rest > buf.length) {
                            rest = buf.length;
                          }
                          filehandle.read(buf, 0, rest)
                            .then(async (o) => {
                              let outbuf = o.buffer;
                              if (o.bytesRead != o.buffer.length) {
                                outbuf = o.buffer.slice(0, o.bytesRead);
                              }
                              var pw = new Promise((resolve, reject) => {
                                res.write(outbuf, null, () => { resolve(); });
                              });
                              await pw;
                              oInfo.count += o.bytesRead;
                              resolve(1);
                            })
                            .catch((e) => {
                              reject(e);
                            });
                        });
                        var result = await p;
                        if (!result) {
                          break;
                        }
                      }
                      res.end();
                    } catch (e) {
                      res.stream.destroy();
                    }
                    filehandle.close();
                  } else {
                    fs.readFile(process.cwd() + "/" + map.staticfile + "/" + file)
                      .then(contents => {
                        res.end(contents);
                      });
                  }
                })
                .catch(err => {
//                  console.error(err);
                  try {
                    res.setHeader("X-Exception", `${err}`);
                  }
                  catch (e) {
                    console.error(e);
                  }
                  try {
                    if (!failcount[req.socket.remoteAddress]) {
                      failcount[req.socket.remoteAddress] = 0
                    }
                    failcount[req.socket.remoteAddress]++
                    res.writeHead(404);
                    res.end("" + map.staticfile + "/" + file + " not found");
                  }
                  catch (e) {
                    res.stream.destroy();
                  }
                });
              return;
            }
          }

          if (map.apiobject) {
            let oInfo = {};
            let what = requrl.substr(map.urlprefix.length + 1);
            handleApiObject(oInfo, map, what, map.apiobject, requrl, req, res, failcount);
            return;
          }

          if (bExact || bPrefix) {
            if (map.core) {
              let what = requrl.substr(map.urlprefix.length + 1);
              var i = what.indexOf("/");
              var plugin = "core";
              if (i >= 0) {
                plugin = what.substring(0, i);
                what = what.substring(i + 1);
              }

  console.log("XXX:" + requrl + "," + plugin + "," + what);

              var oInfo = {};
              map.core.getsession (oInfo, req, res, plugin, what)
              .then((oInfo2) => {
                var api = map.core.getApiForPlugin(plugin);
                if (api) {
                  if(plugin == "sse" && (what == "connection" || what == "register")) {
                    handleApiObject(oInfo, map, what, api, requrl, req, res, failcount);
                  } else {
                    handleApiObject(oInfo, map, "method/" + what, api, requrl, req, res, failcount);
                  }
                  return;
                }
              })
              .catch((e) => {
                res.writeHead(403, {
                  'Content-Type': "text/plain",
                  'Cache-Control': 'no-cache',
                  'Vary': '*',
                });
                res.end("User unauthorized by core: " + e);
              });
              return;
            }
          }
        }
      } catch(e) {
        console.log("Exception, Host:" + req.headers.host + ", URL:" + req.url + ", " + e);
        res.writeHead(500);
        res.end("Server error");
        return
      }
      
      if (!failcount[req.socket.remoteAddress]) {
        failcount[req.socket.remoteAddress] = 0
      }
      failcount[req.socket.remoteAddress]++

      console.log("Not found, Host:" + req.headers.host + ", URL:" + req.url);
      res.writeHead(404);
      res.end("Not found!");
    };

    if (!(port > 0)) {
      return;
    }

    const options = {
      allowHTTP1: true,
    };

    if (key && cert) {
      options.key = fssync.readFileSync(key),
      options.cert = fssync.readFileSync(cert);
    }

    var server = null;
    if (options.key) {
      server = http2.createSecureServer(options, requestListener);
      server.listen(port, host, () => {
        console.log(`Server is running on https://${host}:${port}`);
      });
    } else {
      server = http.createServer(options, requestListener);
      server.listen(port, host, () => {
        console.log(`Server is running on http://${host}:${port}`);
      });
    }

    if (key && cert) {
      if (domains) {
        setTimeout(() => { runLetsencryptv2 (domains, key, cert, maintainerEmail); }, 1000);
        setInterval(() => { runLetsencryptv2 (domains, key, cert, maintainerEmail); }, 24 * 3600 * 1000);
      }
      const reloadcertkey = debounce(() => { console.log("cert files refreshed"); reloadcert(server, key, cert); }, 10000);
      fssync.watch(key, reloadcertkey);
      fssync.watch(cert, reloadcertkey);
    }

    var instance = { server, options, mimemapping, failcount };
    return instance;
  },

  WebserverResponseSent: WebserverResponseSent,

  WebserverResponse: WebserverResponse,
};

Promise.allProgress = function promiseAllProgress (target, eventname, promises) {
  var ready = 0;
  var last = undefined;
  for (var i = 0; i < promises.length; i++) {
    let p = promises[i];
    promises[i] = new Promise((resolve, reject) => {
      setImmediate(() => {
        p.then(() => {
          resolve(i);
          var percent = (ready++ / promises.length * 100).toFixed(1);
          if (last != percent) {
            last = percent;
            target.dispatchEvent(new CustomEvent(eventname, { detail: percent }));
          }
        }).catch((e) => {
          reject(e);
        });
      });
    });
  }
  return Promise.all(promises);
};

