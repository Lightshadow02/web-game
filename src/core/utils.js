'use strict';

const crypto = require('crypto');

// Lettres sans ambiguïté visuelle (pas de I/O) pour des codes faciles à dicter.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Nettoie une chaîne utilisateur : type, espaces, caractères de contrôle, longueur. */
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Erreur "métier" dont le message peut être renvoyé tel quel au client. */
class UserError extends Error {}

module.exports = { randomCode, randomId, cleanText, UserError };
