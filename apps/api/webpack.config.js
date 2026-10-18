const nodeExternals = require('webpack-node-externals');

// Bundle workspace packages (@bms/*) into dist — they ship TS source and cannot
// stay external. Everything else follows Nest's default: external node_modules.
module.exports = (options) => ({
  ...options,
  externals: [nodeExternals({ allowlist: [/^@bms\//] })],
});
