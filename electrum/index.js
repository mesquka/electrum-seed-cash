const { ElectrumClient } = require('electrum-cash');

const MAINNET_GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const TESTNET_GENESIS_HASH = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';

/**
 * Gets peers list from server
 *
 * @param {object} server - server to info from
 * @returns {object} serverInfo
 */
async function getServerInfo(server) {
  let electrum;

  // Connect to SSL port if available, otherwise connect to plain tcp
  if (server.transports.ssl_port) {
    electrum = new ElectrumClient('crawler', server.version.max, server.host, server.transports.ssl_port);
  } else {
    electrum = new ElectrumClient('crawler', server.version.max, server.host, server.transports.tcp_port);
  }

  // Connect
  await electrum.connect();

  // Request data
  const featuresResponse = await electrum.request('server.features');

  // Disconnect, we no longer need this connection
  electrum.disconnect();

  if (featuresResponse.genesis_hash === MAINNET_GENESIS_HASH) {
    server.network = 'mainnet';
  } else if (featuresResponse.genesis_hash === TESTNET_GENESIS_HASH) {
    server.network = 'testnet';
  }

  Object.keys(featuresResponse.hosts).forEach((host) => {
    if (host === server.host) {
      server.transports = featuresResponse.hosts[host];
    }
  });

  server.version.max = featuresResponse.protocol_max;
  server.version.min = featuresResponse.protocol_min;

  server.last_seen = Date.now();

  return server;
}

/**
 * Gets peers list from server
 *
 * @param {object} server - server to get peers from
 * @param {Function} callback - callback for each server
 */
async function getPeers(server, callback) {
  let electrum;

  // Connect to SSL port if available, otherwise connect to plain tcp
  if (server.transports.ssl_port) {
    electrum = new ElectrumClient('crawler', server.version.max, server.host, server.transports.ssl_port, 'tcp_tls');
  } else {
    electrum = new ElectrumClient('crawler', server.version.max, server.host, server.transports.tcp_port, 'tcp');
  }

  // Connect
  await electrum.connect();

  // Request data
  const peersResponse = await electrum.request('server.peers.subscribe');

  // Disconnect, we no longer need this connection
  electrum.disconnect();

  // Loop through returned peers
  peersResponse.forEach(async (item) => {
    // We don't support tor nodes yet
    if (item[1].includes('.onion')) {
      return;
    }

    // Pull hostname from peer
    const peer = {
      host: item[1],
      transports: {},
      version: {},
    };

    // Loop through and parse port list
    item[2].forEach((feature) => {
      if (feature.startsWith('s')) {
        peer.transports.ssl_port = parseInt(feature.substring(1), 10);
      } else if (feature.startsWith('t')) {
        peer.transports.tcp_port = parseInt(feature.substring(1), 10);
      } else if (feature.startsWith('v')) {
        peer.version.max = feature.substring(1);
      }
    });

    callback(peer);
  });
}

module.exports = {
  getPeers,
  getServerInfo,
};
