const pkg = require.main.require('./package.json');
const ACME = require('acme');
const Keypairs = require('@root/keypairs');
const punycode = require('punycode');
const CSR = require('@root/csr');
const PEM = require('@root/pem');
const acmewebroot = require('acme-http-01-webroot');
const cert2json = require('cert2json');
const fssync = require('fs');
const fs = require('fs').promises;

async function runLetsencryptv2 (domains, key, cert, maintainerEmail) {
  if (fssync.existsSync(cert)) {
    const certificate = cert2json.parseFromFile(cert);
    var exp = new Date(certificate.tbs.validity.notAfter).getTime();
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

  const acme = ACME.create({ maintainerEmail, packageAgent, notify });
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
    subscriberEmail: maintainerEmail,
    agreeToTerms,
    accountKey
  });
  console.info('created account with id', account.key.kid);

  if (!await fssync.existsSync(key)) {
    console.log("creating server key");
    var serverKeypair = await Keypairs.generate({ kty: 'RSA', format: 'jwk' });
    var serverKey = serverKeypair.private;
    var serverPem = await Keypairs.export({ jwk: serverKey });
    await fs.writeFile(key, serverPem, 'ascii');
  }

  var serverPem = await fs.readFile(key, 'ascii');
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
  try {
    var pems = await acme.certificates.create({
      account,
      accountKey,
      csr,
      domains,
      challenges
    });
  } catch (e) {
    console.info('exception:' + e);
    return;
  }

  var fullchain = pems.cert + '\n' + pems.chain + '\n';

  await fs.writeFile(cert, fullchain, 'ascii');
  console.info(`wrote ${cert}`);
}

module.exports = { runLetsencryptv2 };
