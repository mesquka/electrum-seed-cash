require('dotenv').config();
const express = require('express');
const semver = require('semver');
const electrum = require('./electrum');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Add server to DB after getting info and checking connection
 *
 * @param {object} server - server to add
 * @returns {Promise} complete
 */
function addServer(server) {
  return new Promise((resolve, reject) => {
    electrum.getServerInfo(server).then((serverData) => {
      db.put(`${serverData.network}:${serverData.host}`, JSON.stringify(serverData));
      resolve();
    }).catch(reject);
  });
}

/**
 * Crawl for new servers
 */
function crawl() {
  db.createReadStream().on('data', (data) => {
    const server = JSON.parse(data.value);

    electrum.getPeers(server, (peer) => {
      db.get(`${server.network}:${peer.host}`).then(() => {}).catch(() => {
        addServer(peer);
      });
    });
  });
}

/**
 * Refresh servers
 */
function refreshServers() {
  db.createReadStream().on('data', (data) => {
    const server = JSON.parse(data.value);

    addServer(server).catch(() => {
      if (Date.now() - server.last_seen > 7 * 24 * 60 * 60 * 1000) {
        // Delete server if it's offline for more than a week
        db.del(`${server.network}:${server.host}`);
      }
    });
  });
}

/**
 * Add server's peers to DB
 *
 * @param {object} server - server to add peers
 */
function addServerPeers(server) {
  electrum.getPeers(server, (peer) => {
    addServer(peer);
  });
}

/**
 * Get servers from DB
 *
 * @returns {object} server - server to add peers
 */
function getServers() {
  return new Promise((resolve) => {
    const response = {
      mainnet: [],
      testnet: [],
    };

    db.createReadStream().on('data', (data) => {
      const server = JSON.parse(data.value);
      if (server.network === 'mainnet') {
        response.mainnet.push(server);
      } else if (server.network === 'testnet') {
        response.testnet.push(server);
      }
    }).on('end', () => {
      resolve(response);
    });
  });
}

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    help: '/servers lists all nodes crawled, /servers?version=1.4.4 lists all nodes compatible with electrum protocol version 1.4.4,'
    + ' /servers?websockets=true to filter only servers with websockets support, /servers?secure=true to filter only servers with tls/ssl support,'
    + ' /servers?version=1.4.4&websockets=true&secure=true to get only servers supporting version 1.4.4 and have websockets with ssl, '
    + 'POST /servers with `{"host":"electrum.imaginary.cash","version":{"max":"1.4.4"},"transports":{"ssl_port":50002}}` adds `electrum.imaginary.cash`'
    + 'to database',
  });
});

app.get('/seed', (req, res) => {
  const seed = {
    host: 'electrum.imaginary.cash',
    version: {
      max: '1.4.4',
    },
    transports: {
      ssl_port: 50002,
    },
  };

  const seedTestnet = {
    host: 'testnet2.imaginary.cash',
    version: {
      max: '1.4.4',
    },
    transports: {
      ssl_port: 50002,
    },
  };

  addServer(seed).then(() => {
    addServerPeers(seed);
  });

  addServer(seedTestnet).then(() => {
    addServerPeers(seedTestnet);
  });

  res.json({
    status: 'success',
  });
});

app.get('/servers', (req, res) => {
  getServers().then((serverList) => {
    // Filter for supported version
    if (req.query.version) {
      serverList.mainnet = serverList.mainnet.filter(
        (server) => semver.satisfies(
          semver.coerce(req.query.version).version,
          `>=${server.version.min} <=${server.version.max}`,
        ),
      );
      serverList.testnet = serverList.testnet.filter(
        (server) => semver.satisfies(
          semver.coerce(req.query.version).version,
          `>=${server.version.min} <=${server.version.max}`,
        ),
      );
    }

    // Filter for websockets and tls/ssl
    if (req.query.websockets && req.query.secure) {
      serverList.mainnet = serverList.mainnet.filter(
        (server) => server.transports.wss_port,
      );
      serverList.testnet = serverList.testnet.filter(
        (server) => server.transports.wss_port,
      );
    } else if (req.query.websockets) {
      serverList.mainnet = serverList.mainnet.filter(
        (server) => server.transports.ws_port || server.transports.wss_port,
      );
      serverList.testnet = serverList.testnet.filter(
        (server) => server.transports.ws_port || server.transports.wss_port,
      );
    } else if (req.query.secure) {
      serverList.mainnet = serverList.mainnet.filter(
        (server) => server.transports.ssl_port,
      );
      serverList.testnet = serverList.testnet.filter(
        (server) => server.transports.ssl_port,
      );
    }

    res.json(serverList);
  });
});

app.post('/servers', (req, res) => {
  addServer(req.body).then(() => {
    addServerPeers(req.body);
    res.json({
      status: 'success',
    });
  }).catch(() => {
    res.json({
      status: 'error',
    });
  });
});

app.listen(process.env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Listening at http://127.0.0.1:${process.env.PORT}`);
});

setInterval(refreshServers, 60 * 60 * 1000); // Refresh servers once an hour
setInterval(crawl, 24 * 60 * 60 * 1000); // Crawl for new servers once a day
