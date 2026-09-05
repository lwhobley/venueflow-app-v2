'use strict';

// Expo Router's query-string@7 uses a recursive decoder on malformed input.
// Decode valid URI components normally; preserve invalid input literally rather
// than recursively trying exponentially many partitions of attacker input.
module.exports = function safeUriDecode(value) {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
  try { return decodeURIComponent(value); }
  catch { return value; }
};
