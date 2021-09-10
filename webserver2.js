const http = require("http");
const http2 = require("http2");
const fs = require('fs').promises;
const fssync = require('fs');
const cert2json = require('cert2json');
const process = require('process');
const pkg = require.main.require('./package.json');
const ACME = require('acme');
const Keypairs = require('@root/keypairs');
const punycode = require('punycode');
const CSR = require('@root/csr');
const PEM = require('@root/pem');
const acmewebroot = require('acme-http-01-webroot');

const classConstructors = {};

module.exports = {
  doLetsEncrypt: function (domains) {
    this.runLetsencrypt = async function runLetsencrypt () {
      if (fssync.existsSync("./cert.pem")) {
        const cert = cert2json.parseFromFile('./cert.pem');
        var exp = new Date(cert.tbs.validity.notAfter).getTime();
        var now15 = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
        if (exp > now15) {
          console.log(`expire in ${(exp - now15) / (24 * 3600000)}`);
          return;
        } else {
          console.log(`expired ${(now15 - exp) / (24 * 3600000)}`);
        }
      }

      const packageAgent = pkg.name + '/' + pkg.version;

      function notify (ev, msg) {
        if ('error' === ev || 'warning' === ev) {
          console.log(ev, msg.altname || '', msg.status || '');
          return;
        }
        console.log(ev, msg.altname || '', msg.status || '');
      }

      const acme = ACME.create({ maintainerEmail: "alex_letsencrypt@brickwedde.de", packageAgent, notify });
      var directoryUrl = 'https://acme-staging-v02.api.letsencrypt.org/directory';
      directoryUrl = 'https://acme-v02.api.letsencrypt.org/directory';
      await acme.init(directoryUrl);

      if (!await fssync.existsSync("./account.pem")) {
        console.log("Creating accountkey");
        var accountKeypair = await Keypairs.generate({ kty: 'EC', format: 'jwk' });
        var accountKey = accountKeypair.private;
        var accountPem = await Keypairs.export({ jwk: accountKey });
        await fs.writeFile('./account.pem', accountPem, 'ascii');
      }

      var accountPem = await fs.readFile('./account.pem', 'ascii');
      var accountKey = await Keypairs.import({ pem: accountPem });

      var agreeToTerms = true;

      var account = await acme.accounts.create({
        subscriberEmail: "alex_letsencrypt@brickwedde.de",
        agreeToTerms,
        accountKey
      });
      console.info('created account with id', account.key.kid);

      if (!await fssync.existsSync('./key.pem')) {
        console.log("creating server key");
        var serverKeypair = await Keypairs.generate({ kty: 'RSA', format: 'jwk' });
        var serverKey = serverKeypair.private;
        var serverPem = await Keypairs.export({ jwk: serverKey });
        await fs.writeFile('./key.pem', serverPem, 'ascii');
      }

      var serverPem = await fs.readFile('./key.pem', 'ascii');
      var serverKey = await Keypairs.import({ pem: serverPem });

      domains = domains.map(function (name) { return punycode.toASCII(name); });

      var encoding = 'der';
      var typ = 'CERTIFICATE REQUEST';

      var csrDer = await CSR.csr({ jwk: serverKey, domains, encoding });
      var csr = PEM.packBlock({ type: typ, bytes: csrDer });
      var webroot = acmewebroot.create({ webroot: process.cwd() + '/client/.well-known/acme-challenge/' });
      var challenges = {
        'http-01': webroot
      };

      console.info('validating domain authorization for ' + domains.join(' '));
      var pems = await acme.certificates.create({
        account,
        accountKey,
        csr,
        domains,
        challenges
      });

      var fullchain = pems.cert + '\n' + pems.chain + '\n';

      await fs.writeFile('cert.pem', fullchain, 'ascii');
      console.info('wrote ./cert.pem');
      process.exit();
    };

    setInterval(() => {
      this.runLetsencrypt();
    }, 24 * 3600 * 1000);
  },

  addInstanciateClass: function (name, theConstructor) {
    classConstructors[name] = theConstructor;
  },

  createRedirectServer: function (host, port) {
    var redirectorserver = http.createServer({}, (req, res) => {
      res.setHeader("Location", 'https://' + req.headers.host + req.url);
      res.writeHead(301);
      res.end();
    });
    redirectorserver.listen(80, "", () => {
      console.log(`Redirector is running on http://${host}:${port}`);
    });
    return { redirectorserver };
  },

  createWebserver: function (host, port, key, cert, urlmapping) {
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
    };

    var instances = {};

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
            if (map.apiobject && map.apiobject.checksession) {
              let user = {};
              promise = map.apiobject.checksession({}, req, res, user, "");
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
                    res.setHeader("eTag", "\"" + stats.mtime + "\"");
                    if (map.staticfile.slice(-3) == ".js") {
                      res.setHeader("Cache-Control", "no-cache");
                    } else {
                      res.setHeader("Cache-Control", "max-age=600");
                    }
                    res.writeHead(200);
                    res.end(contents);
                  });
              })
              .catch(err => {
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
            file = file.replace(/\\.\\./g, "__");
            fs.readFile(process.cwd() + "/" + map.staticfile + "/" + file)
              .then(contents => {
                fs.stat(process.cwd() + "/" + map.staticfile + "/" + file)
                  .then((stats) => {
                    res.setHeader("Content-Type", mime(file));
                    res.setHeader("Last-Modified", new Date(stats.mtime));
                    res.setHeader("eTag", "\"" + stats.mtime + "\"");
                    if (file.slice(-3) == ".js") {
                      res.setHeader("Cache-Control", "no-cache");
                    } else {
                      res.setHeader("Cache-Control", "max-age=600");
                    }
                    res.writeHead(200);
                    res.end(contents);
                  });
              })
              .catch(err => {
                res.writeHead(404);
                res.end("" + map.staticfile + "/" + file + " not found");
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
                });

                if (!map.apiobject.__internal_sseconnections) {
                  map.apiobject.__internal_sseconnections = [];
                }
                let obj = { req, res };
                map.apiobject.__internal_sseconnections.push(obj);

                req.on('close', () => {
                  var index = map.apiobject.__internal_sseconnections.indexOf(obj);
                  if (index >= 0) {
                    map.apiobject.__internal_sseconnections.splice(index, 1);
                  }
                });
              })
                .catch((e) => {
                  res.writeHead(500, {
                    'Content-Type': "text/plain",
                    'Cache-Control': 'no-cache',
                  });
                  res.end("" + e);
                });
              return;
            }

            var body = '';
            req.on('data', function (data) {
              console.log(requrl + " on data");
              body += data;
            });
            req.on('end', function () {
              console.log(requrl + " on end");
              var parameters = [];
              try {
                if (!body) {
                  var url = new URL(req.url, 'http://example.com');
                  if (url.search.length > 1) {
                    var buf = Buffer.from(url.search.substring(1), 'base64');
                    body = buf.toString();
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
                });
                res.end("Failed on body: " + body + ", " + e);
                return;
              }
              try {
                if (what.substring(0, 12) == "sse/register") {
                  for (let fnname of parameters) {
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
                        const data = JSON.stringify({ fnname, params });
                        const message = `id:${id}\ndata: ${data}\n\n`;
                        if (map.apiobject.__internal_sseconnections) {
                          for (var conn of map.apiobject.__internal_sseconnections) {
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
                          if (oInfo.htmltemplate) {
                            res.writeHead(200, {
                              'Content-Type': "text/html",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(oInfo.htmltemplate.replace(/@@/, x));
                          } else {
                            res.writeHead(200, {
                              'Content-Type': "application/json",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(JSON.stringify(x));
                          }
                        })
                        .catch((e) => {
                          if (oInfo.htmltemplate) {
                            res.writeHead(500, {
                              'Content-Type': "text/html",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(oInfo.htmltemplate.replace(/@@/, e));
                          } else {
                            res.writeHead(500, {
                              'Content-Type': "text/plain",
                              'Cache-Control': 'no-cache',
                              "X-Exception": "" + e,
                            });
                            res.end("" + e);
                          }
                        });
                    } else {
                      if (oInfo.htmltemplate) {
                        res.writeHead(200, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, result));
                      } else {
                        res.writeHead(200, {
                          'Content-Type': "application/json",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(JSON.stringify(result));
                      }
                    }
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                if (what.substring(0, 18) == "instance_construct") {
                  var fnname = what.substring(19);
                  if (!classConstructors[fnname]) {
                    console.error("construct not allowed:" + fnname);
                    res.writeHead(403, {
                      'Content-Type': "text/plain",
                      'Cache-Control': 'no-cache',
                    });
                    res.end("construct not allowed: " + fnname);
                    return;
                  }
                  var oInfo = {};
                  var promise = Promise.resolve();
                  if (map.apiobject.checksession) {
                    let user = {};
                    promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                  }
                  parameters.unshift(oInfo);
                  parameters.unshift(null);
                  promise.then(() => {
                    var id = new Date().getTime();
                    instances[id] = {
                      id,
                      obj: new (Function.prototype.bind.apply(classConstructors[fnname], parameters)),
                      lastused: id,
                    };
                    res.writeHead(200, {
                      'Content-Type': "application/json",
                      'Cache-Control': 'no-cache',
                      'X-InstanceNo': id,
                    });
                    res.end("");
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                if (what.substring(0, 14) == "instance_get") {
                  var fnname = what.substring(15);
                  var id = req.headers["x-instanceno"];
                  var oInfo = {};
                  var promise = Promise.resolve();
                  if (map.apiobject.checksession) {
                    let user = {};
                    promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                  }

                  promise.then(() => {
                    if (!instances[id]) {
                      res.writeHead(403, {
                        'Content-Type': "application/json",
                        'Cache-Control': 'no-cache',
                      });
                      res.end("instance not found!");
                      return;
                    }
                    if (instances[id].obj[fnname] instanceof Function) {
                      res.writeHead(200, {
                        'Content-Type': "application/json",
                        'Cache-Control': 'no-cache',
                        'X-PropertyType': 'function',
                      });
                      res.end("");
                    } else {
                      res.writeHead(200, {
                        'Content-Type': "application/json",
                        'Cache-Control': 'no-cache',
                        'X-PropertyType': 'json',
                      });
                      res.end(JSON.stringify(instances[id].obj[fnname]));
                    }
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                if (what.substring(0, 13) == "instance_json") {
                  var id = req.headers["x-instanceno"];
                  var oInfo = {};
                  var promise = Promise.resolve();
                  if (map.apiobject.checksession) {
                    let user = {};
                    promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                  }

                  promise.then(() => {
                    if (!instances[id]) {
                      res.writeHead(403, {
                        'Content-Type': "application/json",
                        'Cache-Control': 'no-cache',
                      });
                      res.end("instance not found!");
                      return;
                    }
                    res.writeHead(200, {
                      'Content-Type': "application/json",
                      'Cache-Control': 'no-cache',
                      'X-PropertyType': 'function',
                    });
                    res.end(JSON.stringify(instances[id].obj));
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                if (what.substring(0, 12) == "instance_set") {
                  var fnname = what.substring(13);
                  var id = req.headers["x-instanceno"];
                  var oInfo = {};
                  var promise = Promise.resolve();
                  if (map.apiobject.checksession) {
                    let user = {};
                    promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                  }

                  promise.then(() => {
                    if (!instances[id]) {
                      res.writeHead(403, {
                        'Content-Type': "application/json",
                        'Cache-Control': 'no-cache',
                      });
                      res.end("instance not found!");
                      return;
                    }
                    instances[id].obj[fnname] = parameters[0];
                    res.writeHead(200, {
                      'Content-Type': "application/json",
                      'Cache-Control': 'no-cache',
                      'X-PropertyType': 'json',
                    });
                    res.end(JSON.stringify(instances[id].obj[fnname]));
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                if (what.substring(0, 13) == "instance_call") {
                  var id = req.headers["x-instanceno"];
                  var fnname = what.substring(14);
                  var oInfo = {};
                  var promise = Promise.resolve();
                  if (map.apiobject.checksession) {
                    let user = {};
                    promise = map.apiobject.checksession(oInfo, req, res, user, fnname);
                  }
                  parameters.unshift(oInfo);

                  promise.then(() => {
                    var result = instances[id].obj[fnname].apply(instances[id].obj, parameters);
                    if (result instanceof Promise) {
                      result
                        .then((x) => {
                          if (oInfo.htmltemplate) {
                            res.writeHead(200, {
                              'Content-Type': "text/html",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(oInfo.htmltemplate.replace(/@@/, x));
                          } else {
                            res.writeHead(200, {
                              'Content-Type': "application/json",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(JSON.stringify(x));
                          }
                        })
                        .catch((e) => {
                          if (oInfo.htmltemplate) {
                            res.writeHead(500, {
                              'Content-Type': "text/html",
                              'Cache-Control': 'no-cache',
                            });
                            res.end(oInfo.htmltemplate.replace(/@@/, e));
                          } else {
                            res.writeHead(500, {
                              'Content-Type': "text/plain",
                              'Cache-Control': 'no-cache',
                              "X-Exception": "" + e,
                            });
                            res.end("" + e);
                          }
                        });
                    } else {
                      if (oInfo.htmltemplate) {
                        res.writeHead(200, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, result));
                      } else {
                        res.writeHead(200, {
                          'Content-Type': "application/json",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(JSON.stringify(result));
                      }
                    }
                  })
                    .catch((w) => {
                      if (oInfo.htmltemplate) {
                        res.writeHead(403, {
                          'Content-Type': "text/html",
                          'Cache-Control': 'no-cache',
                        });
                        res.end(oInfo.htmltemplate.replace(/@@/, "User unauthorized by apiobject: " + w));
                      } else {
                        res.writeHead(403, {
                          'Content-Type': "text/plain",
                          'Cache-Control': 'no-cache',
                        });
                        res.end("User unauthorized by apiobject: " + w);
                      }
                    });
                  return;
                }
                throw "Unknown what";
              } catch (e) {
                res.writeHead(500, {
                  'Content-Type': "text/plain",
                  'Cache-Control': 'no-cache',
                });
                res.end("Failed on function: " + e);
                return;
              }
            });
            return;
          }
        }
      }

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
      if (options.key) {
        server = http2.createSecureServer(options, requestListener);
        server.listen(port, host, () => {
          console.log(`Server is running on https://${host}:${port}`);
        });
      }
    } else {
      server = http.createServer(options, requestListener);
      server.listen(port, host, () => {
        console.log(`Server is running on http://${host}:${port}`);
      });
    }

    return { server, options, mimemapping };
  }
};

