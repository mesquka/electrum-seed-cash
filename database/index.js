const level = require('level');

const db = level(`${__dirname}/../.data`);

module.exports = db;
