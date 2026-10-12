/* Design system « tapis » (Claude Design) — importé par scripts/vendor-design.mjs (interrupteur et tokens sur .tp-scope[data-motion-host]). */
/* @ds-bundle: {"format":4,"namespace":"Tapis","components":[{"name":"Card"},{"name":"Hand"},{"name":"Seat"},{"name":"Pile"},{"name":"Trick"},{"name":"Status"},{"name":"Button"},{"name":"ActionBar"},{"name":"Bubble"},{"name":"Toast"},{"name":"Gauge"},{"name":"Drawer"},{"name":"Rules"},{"name":"EndScreen"},{"name":"LobbyBar"},{"name":"Boss"},{"name":"Sovereigns"},{"name":"PowerLegend"},{"name":"ComboPreview"},{"name":"BidPanel"},{"name":"KingCall"},{"name":"Contract"},{"name":"EcartGuide"},{"name":"ScoreSheet"},{"name":"DealSummary"}]} */
/* Tapis — système de design des jeux de cartes du Game Hub.
   JavaScript natif, sans dépendance. Chaque composant renvoie une chaîne HTML
   (tout texte est échappé) ; Tapis.node(html) la transforme en nœud DOM.
   Les classes .tp-* de bundle.css sont le contrat ; les attributs data-card-id,
   data-seat, data-pile, data-slot et data-zone sont stables pour les animations. */
(function () {
'use strict';
var T = {};
var doc = typeof document !== 'undefined' ? document : null;

/* ---------- utilitaires ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function cx() { return [].slice.call(arguments).filter(Boolean).join(' '); }
function attrs(o) {
  var s = '';
  for (var k in o) { if (o[k] == null || o[k] === false) continue; s += ' ' + k + (o[k] === true ? '' : '="' + esc(o[k]) + '"'); }
  return s;
}
function nb(s) { return String(s).replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« '); }
T.esc = esc;
T.cx = cx;
T.node = function (html) {
  var t = doc.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.childNodes.length === 1 ? t.content.firstChild : t.content;
};
/* Applique la table (thème) à un élément : data-table + data-theme. */
T.table = function (el, id) { el.setAttribute('data-table', id); el.setAttribute('data-theme', id); return el; };

/* ---------- glyphes (grille 24, formes pleines, currentColor) ---------- */
var I = {
  pique: '<path d="M12 1.6c2.2 3 9.2 7.6 9.2 12.5 0 2.9-2.2 4.7-4.6 4.7-1.6 0-2.9-.8-3.6-2 .2 2 1 3.8 2.7 5.1H8.3c1.7-1.3 2.5-3.1 2.7-5.1-.7 1.2-2 2-3.6 2-2.4 0-4.6-1.8-4.6-4.7C2.8 9.2 9.8 4.6 12 1.6z"/>',
  coeur: '<path d="M12 21.4C9.8 19.4 2.4 14 2.4 8.4c0-3.2 2.5-5.7 5.6-5.7 1.8 0 3.2 1 4 2.4.8-1.4 2.2-2.4 4-2.4 3.1 0 5.6 2.5 5.6 5.7 0 5.6-7.4 11-9.6 13z"/>',
  carreau: '<path d="M12 1.5c1.9 3.4 4.6 6.9 8.3 10.5-3.7 3.6-6.4 7.1-8.3 10.5-1.9-3.4-4.6-6.9-8.3-10.5C7.4 8.4 10.1 4.9 12 1.5z"/>',
  trefle: '<circle cx="12" cy="7.2" r="4.5"/><circle cx="6.8" cy="13.6" r="4.5"/><circle cx="17.2" cy="13.6" r="4.5"/><path d="M10.7 9h2.6l.4 4.8c.2 3.4 1.1 5.9 2.9 7.8H7.4c1.8-1.9 2.7-4.4 2.9-7.8z"/>',
  star: '<path d="M12 1.8l2.9 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.3 5.7 21l1.6-7.1L1.9 9.1l7.2-.7z"/>',
  trump: '<path d="M1 5.5h22l-3.4 6.5 3.4 6.5H1l3.4-6.5z"/>',
  horse: '<path d="M6.4 22c0-3.2 1-5.8 2.6-8L7.6 12c-.6-.9-.4-2 .5-2.6l4.6-3.2-.4-3.4 2.6 1.8c3.6.7 6 3.6 6 7.4v.8c0 1-1 1.7-2 1.4l-2.6-.9-1.6 1.6c.9 2.2 1.4 4.6 1.4 7.1z"/>',
  crown: '<path d="M3 18.2h18V21H3zM2.4 7.6l5 3.9L12 4.4l4.6 7.1 5-3.9-1.3 9.1H3.7z"/><circle cx="2.4" cy="6.6" r="1.6"/><circle cx="12" cy="3.2" r="1.6"/><circle cx="21.6" cy="6.6" r="1.6"/>',
  shield: '<path d="M12 2.2l8.4 3.2v6.2c0 5.2-3.6 8.9-8.4 10.4-4.8-1.5-8.4-5.2-8.4-10.4V5.4z"/>',
  sword: '<path d="M20.2 2l1.8 1.8-11.6 11.9-1.9-1.9zM5.2 12.3l1.5-1.5 6.5 6.5-1.5 1.5zM7.3 16.6l-3.9 3.9-1.4-1.4 3.9-3.9z"/>',
  castle: '<path d="M3 21.5V8.5h2.6v2.2h1.6V8.5h2.6v2.2h1.2V6.4L12 5l1 1.4v4.3h1.2V8.5h2.6v2.2h1.6V8.5H21v13h-6.8v-4a2.2 2.2 0 0 0-4.4 0v4z"/><path d="M11.4 1.5h1.2v3.7h-1.2zM12.6 1.6l3.4 1.1-3.4 1.1z"/>',
  tavern: '<path d="M4.5 6h11v13.2c0 1-.8 1.8-1.8 1.8H6.3c-1 0-1.8-.8-1.8-1.8zM15.5 8.6h2.2c1.6 0 2.8 1.2 2.8 2.8v3c0 1.6-1.2 2.8-2.8 2.8h-2.2v-2.2h2.2c.4 0 .6-.2.6-.6v-3c0-.4-.2-.6-.6-.6h-2.2zM4.2 2.6c1.6-.8 3.2.4 4.2-.2 1.4-.8 3 .6 4.6.1 1.4-.4 2.6.3 2.6 1.5v1H4.2z"/>',
  deck: '<path d="M8 2.5h11.2c.7 0 1.3.6 1.3 1.3v14.4c0 .7-.6 1.3-1.3 1.3H8c-.7 0-1.3-.6-1.3-1.3V3.8c0-.7.6-1.3 1.3-1.3z"/><path d="M3.5 6.2h1.8v14.2h11v1.8H4.8c-.7 0-1.3-.6-1.3-1.3z"/>',
  discard: '<path d="M4.8 5.4l7.6-2 3.6 13.6-7.6 2z"/><path d="M14.4 5.6l5.5 1.9-4.2 12.3-2.2-.8 3.3-9.6-3.2-1.1z"/>',
  heal: '<path d="M9.6 3h4.8v6.6H21v4.8h-6.6V21H9.6v-6.6H3V9.6h6.6z"/>',
  draw: '<path d="M7 2.5h10c.8 0 1.5.7 1.5 1.5v8h-2.2V4.7H7.7V12H5.5V4c0-.8.7-1.5 1.5-1.5z"/><path d="M10.9 7.5h2.2v8.2l2.8-2.8 1.6 1.6-5.5 5.5-5.5-5.5 1.6-1.6 2.8 2.8zM3.5 19.8h17V22h-17z"/>',
  double: '<path d="M2.6 8.1l1.5-1.5 2.9 2.9 2.9-2.9 1.5 1.5-2.9 2.9 2.9 2.9-1.5 1.5-2.9-2.9-2.9 2.9-1.5-1.5 2.9-2.9zM13 9.3c0-2.2 1.7-3.7 4-3.7s3.9 1.4 3.9 3.4c0 1.5-.9 2.6-2.3 4l-2.5 2.3h5V18h-8.4v-1.9l4.5-4.3c1-1 1.4-1.6 1.4-2.4 0-.9-.7-1.5-1.6-1.5-1 0-1.7.7-1.8 1.8z"/>',
  immune: '<path fill-rule="evenodd" d="M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2zm0 2.6a7 7 0 0 0-4.3 1.5l9.8 9.8A7 7 0 0 0 12 5zm-5.8 3.1a7 7 0 0 0 9.7 9.7z"/>',
  bolt: '<path d="M13.6 1.8L4.6 13.6h5.8L9.2 22.2l10.2-12.6h-5.9z"/>',
  skull: '<path fill-rule="evenodd" d="M12 2.2c4.9 0 8.6 3.4 8.6 8 0 2.6-1.2 4.5-3 5.6V19c0 .8-.7 1.5-1.5 1.5h-1.3V18h-1.6v2.5h-2.4V18H9.2v2.5H7.9c-.8 0-1.5-.7-1.5-1.5v-3.2c-1.8-1.1-3-3-3-5.6 0-4.6 3.7-8 8.6-8zM8.4 9.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm7.2 0a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM12 13.6l-1.3 2.4h2.6z"/>',
  check: '<path d="M9.2 17.2L3.8 11.8l1.9-1.9 3.5 3.5 9.1-9.1 1.9 1.9z"/>',
  cross: '<path d="M6.2 4.4L12 10.2l5.8-5.8 1.8 1.8-5.8 5.8 5.8 5.8-1.8 1.8-5.8-5.8-5.8 5.8-1.8-1.8 5.8-5.8-5.8-5.8z"/>',
  book: '<path d="M2.4 4.6c3.7-.5 6.7.3 8.5 2v13.6c-1.8-1.5-4.8-2.1-8.5-1.6zM21.6 4.6c-3.7-.5-6.7.3-8.5 2v13.6c1.8-1.5 4.8-2.1 8.5-1.6z"/>',
  log: '<path d="M3.5 4.5H6V7H3.5zM8.5 4.8H21v2H8.5zM3.5 10.8H6v2.5H3.5zM8.5 11H21v2H8.5zM3.5 17H6v2.5H3.5zM8.5 17.2H21v2H8.5z"/>',
  scores: '<path fill-rule="evenodd" d="M2.5 3.5h19v17h-19zm2 2v3.2h4.2V5.5zm6.2 0v3.2h8.8V5.5zm-6.2 5.2v3.2h4.2v-3.2zm6.2 0v3.2h8.8v-3.2zm-6.2 5.2v2.6h4.2v-2.6zm6.2 0v2.6h8.8v-2.6z"/>',
  copy: '<path d="M8 2.5h10.5c1 0 1.8.8 1.8 1.8v11.2h-2.2V4.7H8z"/><path fill-rule="evenodd" d="M5.2 6.5h9.6c1 0 1.8.8 1.8 1.8v12c0 1-.8 1.8-1.8 1.8H5.2c-1 0-1.8-.8-1.8-1.8v-12c0-1 .8-1.8 1.8-1.8zm.4 2.2v11.2h8.8V8.7z"/>',
  exit: '<path d="M3.5 3h9.5v2.2H5.7v13.6H13V21H3.5z"/><path d="M15.9 6.9l5 5.1-5 5.1-1.6-1.6 2.4-2.4H9v-2.2h7.7l-2.4-2.4z"/>',
  back: '<path d="M10.6 5.2l1.6 1.6-4.1 4.1H20.5v2.2H8.1l4.1 4.1-1.6 1.6L3.7 12z"/>',
  'chevron-left': '<path d="M14.8 4.6l1.7 1.7-5.7 5.7 5.7 5.7-1.7 1.7L7.4 12z"/>',
  'chevron-right': '<path d="M9.2 4.6l7.4 7.4-7.4 7.4-1.7-1.7 5.7-5.7-5.7-5.7z"/>',
  'chevron-up': '<path d="M4.6 14.8L12 7.4l7.4 7.4-1.7 1.7-5.7-5.7-5.7 5.7z"/>',
  'chevron-down': '<path d="M4.6 9.2l1.7-1.7 5.7 5.7 5.7-5.7 1.7 1.7L12 16.6z"/>',
  sparkle: '<path d="M12 1.5l2.4 7.4 7.6 3.1-7.6 3.1L12 22.5l-2.4-7.4L2 12l7.6-3.1z"/>',
  motion: '<path d="M9.5 2.5l1.9 5.7 5.8 2.3-5.8 2.3-1.9 5.7-1.9-5.7-5.8-2.3 5.8-2.3z"/><path d="M18.3 13.4l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1zM18.3 1.8l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  'motion-off': '<path d="M9.5 2.5l1.9 5.7 5.8 2.3-5.8 2.3-1.9 5.7-1.9-5.7-5.8-2.3 5.8-2.3z" opacity=".55"/><path d="M3.3 2l18.7 18.7-1.6 1.6L1.7 3.6z"/>',
  trophy: '<path d="M6.5 2.5h11v2h3.3v3.2c0 2.3-1.8 4.2-4.1 4.3a5.4 5.4 0 0 1-3.5 3.3v2.9h3.3v3.3H7.5v-3.3h3.3v-2.9A5.4 5.4 0 0 1 7.3 12C5 11.9 3.2 10 3.2 7.7V4.5h3.3zm-1.1 4.2v1c0 .9.5 1.6 1.2 2v-3zm12 0v3c.7-.4 1.2-1.1 1.2-2v-1z"/>',
  user: '<circle cx="12" cy="7.5" r="4.5"/><path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z"/>',
  renew: '<path d="M12 3.5a8.5 8.5 0 0 1 7.6 4.7H22l-3.7 4.6-3.7-4.6h2.4A6.2 6.2 0 0 0 5.9 11L3.7 10.6A8.5 8.5 0 0 1 12 3.5zM12 20.5a8.5 8.5 0 0 1-7.6-4.7H2l3.7-4.6 3.7 4.6H7a6.2 6.2 0 0 0 11.1-2.8l2.2.4A8.5 8.5 0 0 1 12 20.5z"/>',
  pass: '<path d="M4.5 4.8l9.4 7.2-9.4 7.2zM15.2 4.8h3.3v14.4h-3.3z"/>',
  info: '<path fill-rule="evenodd" d="M12 2.2a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6zm-1.3 8.3v7.2h2.6v-7.2zM12 6a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 12 6z"/>',
  warning: '<path fill-rule="evenodd" d="M12 2.2l10.6 18.6H1.4zm-1.3 6.5v6h2.6v-6zm1.3 7.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>',
  hourglass: '<path d="M5.5 2h13v2.2h-1.1v3c0 1.4-.7 2.7-1.8 3.5L13.4 12l2.2 1.3c1.1.8 1.8 2.1 1.8 3.5v3h1.1V22h-13v-2.2h1.1v-3c0-1.4.7-2.7 1.8-3.5L10.6 12 8.4 10.7C7.3 9.9 6.6 8.6 6.6 7.2v-3H5.5z"/>',
  offline: '<path d="M8.6 2h2v4h2.8V2h2v4h1.2c.6 0 1 .4 1 1v4.2a5.5 5.5 0 0 1-4.5 5.4V22h-2.2v-5.4a5.5 5.5 0 0 1-4.5-5.4V7c0-.6.4-1 1-1h1.2z" opacity=".55"/><path d="M3.3 2l18.7 18.7-1.6 1.6L1.7 3.6z"/>',
  eye: '<path fill-rule="evenodd" d="M12 5c5 0 8.9 4.2 10.2 7-1.3 2.8-5.2 7-10.2 7S3.1 14.8 1.8 12C3.1 9.2 7 5 12 5zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"/>',
  lock: '<path fill-rule="evenodd" d="M7 10V7.2a5 5 0 0 1 10 0V10h1.2c.6 0 1 .4 1 1v9.5c0 .6-.4 1-1 1H5.8c-.6 0-1-.4-1-1V11c0-.6.4-1 1-1zm2.2 0h5.6V7.2a2.8 2.8 0 0 0-5.6 0zm2.8 3.8a1.6 1.6 0 0 0-1 2.9v1.8h2v-1.8a1.6 1.6 0 0 0-1-2.9z"/>',
  sort: '<path d="M3.5 5.5h17v2.2h-17zM3.5 10.9h11.5v2.2H3.5zM3.5 16.3h6v2.2h-6z"/>',
  flag: '<path d="M4.5 2.5h2.2v19H4.5zM7.8 3.6c3-1.5 5.6 1.3 9.6-.4v9.5c-4 1.7-6.6-1.1-9.6.4z"/>',
  pair: '<path fill-rule="evenodd" d="M8.5 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z"/><path fill-rule="evenodd" d="M15.5 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z"/>',
  fan: '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M9.4 4.2l5.2 0 0 11.6-5.2 0z" transform="rotate(-28 12 20.5)"/><path d="M9.4 4.2l5.2 0 0 11.6-5.2 0z" transform="rotate(28 12 20.5)"/><path d="M9.4 3.4l5.2 0 0 12.4-5.2 0z"/></g>',
  plus: '<path d="M10.9 4h2.2v6.9H20v2.2h-6.9V20h-2.2v-6.9H4v-2.2h6.9z"/>',
  minus: '<path d="M4 10.9h16v2.2H4z"/>',
  arrow: '<path d="M13.4 5.2l6.8 6.8-6.8 6.8-1.6-1.6 4.1-4.1H3.8v-2.2h12.1l-4.1-4.1z"/>',
  keyboard: '<path fill-rule="evenodd" d="M2.5 6h19v12h-19zm2.2 2.2v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h1.2v-2zM4.7 11.6v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h2v-2zm3.4 0v2h1.2v-2zM7 15v1.6h10V15z"/>'
};
T.icons = Object.keys(I);
var SUITS4 = ['pique', 'coeur', 'carreau', 'trefle'];

/* ---------- sprite : glyphes, motifs et symboles partagés, injectés une fois ---------- */
var SPRITE_ID = 'tp-sprite';
var spriteDefs = {};
function symbol(id, viewBox, body) { spriteDefs[id] = '<symbol id="' + id + '" viewBox="' + viewBox + '">' + body + '</symbol>'; }
Object.keys(I).forEach(function (k) { symbol('tp-i-' + k, '0 0 24 24', I[k]); });
function ensureSprite() {
  if (!doc || !doc.body) return null;
  var sp = doc.getElementById(SPRITE_ID);
  if (!sp) {
    sp = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sp.id = SPRITE_ID;
    sp.setAttribute('aria-hidden', 'true');
    sp.setAttribute('focusable', 'false');
    sp.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    sp.innerHTML = '<defs>' + Object.keys(spriteDefs).map(function (k) { return spriteDefs[k]; }).join('') + '</defs>';
    sp._has = {};
    Object.keys(spriteDefs).forEach(function (k) { sp._has[k] = 1; });
    doc.body.insertBefore(sp, doc.body.firstChild);
  }
  return sp;
}
function addSymbol(id, viewBox, body) {
  if (spriteDefs[id]) return;
  symbol(id, viewBox, body);
  var sp = doc && doc.getElementById(SPRITE_ID);
  if (sp && !sp._has[id]) {
    var tmp = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    tmp.innerHTML = spriteDefs[id];
    sp.firstChild.appendChild(tmp.firstChild);
    sp._has[id] = 1;
  }
}
T.sprite = { ensure: ensureSprite, add: addSymbol };

/* Tapis.icon(nom, { className, label, size }) : SVG en ligne qui pointe vers le sprite. */
T.icon = function (name, o) {
  o = o || {};
  ensureSprite();
  var lab = o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true"';
  var sz = o.size ? ' width="' + o.size + '" height="' + o.size + '"' : '';
  return '<svg class="' + cx('tp-ic', o.className) + '" viewBox="0 0 24 24"' + sz + lab + ' focusable="false"><use href="#tp-i-' + esc(name) + '"></use></svg>';
};
/* Le même glyphe en chemins pleins, sans sprite (pour un export ou un e-mail). */
T.icon.inline = function (name, o) {
  o = o || {};
  return '<svg class="' + cx('tp-ic', o.className) + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (I[name] || '') + '</svg>';
};
/* Remplace {pique} {coeur} {carreau} {trefle} {star} … par les glyphes, après échappement. */
function rich(s) {
  return nb(esc(s)).replace(/\{([a-z-]+)\}/g, function (m, k) { return I[k] ? T.icon(k, { className: 'tp-ic--inline tp-suit-' + k }) : m; });
}
T.rich = rich;

/* =====================================================================
   Cartes : jeu de 52 (La Chute des Rois) et jeu de 78 (Tarot).
   Tout est généré : index, pips, figures (sprite), atouts, Excuse, dos.
   ===================================================================== */
var SUIT_ALIAS = {
  pique: 'pique', spade: 'pique', spades: 'pique', s: 'pique', '♠': 'pique',
  coeur: 'coeur', 'cœur': 'coeur', heart: 'coeur', hearts: 'coeur', h: 'coeur', '♥': 'coeur',
  carreau: 'carreau', diamond: 'carreau', diamonds: 'carreau', d: 'carreau', '♦': 'carreau',
  trefle: 'trefle', 'trèfle': 'trefle', club: 'trefle', clubs: 'trefle', c: 'trefle', '♣': 'trefle',
  atout: 'atout', trump: 'atout', t: 'atout', excuse: 'excuse', fool: 'excuse', e: 'excuse'
};
var SUIT_NAME = { pique: 'Pique', coeur: 'Cœur', carreau: 'Carreau', trefle: 'Trèfle' };
var SUIT_RED = { coeur: 1, carreau: 1 };
var RANK_ALIAS = { a: 'A', as: 'A', ace: 'A', v: 'V', j: 'V', valet: 'V', jack: 'V', c: 'C', cavalier: 'C', knight: 'C', d: 'D', q: 'D', dame: 'D', queen: 'D', r: 'R', k: 'R', roi: 'R', king: 'R' };
var RANK_NAME = { A: 'As', V: 'Valet', C: 'Cavalier', D: 'Dame', R: 'Roi' };
var FIGURES = { V: 1, C: 1, D: 1, R: 1 };
/* Noms traditionnels du portrait français (Cavaliers : noms propres au système). */
var FIG_NAMES = {
  'R-pique': 'David', 'R-coeur': 'Charles', 'R-carreau': 'César', 'R-trefle': 'Alexandre',
  'D-pique': 'Pallas', 'D-coeur': 'Judith', 'D-carreau': 'Rachel', 'D-trefle': 'Argine',
  'V-pique': 'Ogier', 'V-coeur': 'La Hire', 'V-carreau': 'Hector', 'V-trefle': 'Lancelot',
  'C-pique': 'Roland', 'C-coeur': 'Olivier', 'C-carreau': 'Renaud', 'C-trefle': 'Gauvain'
};

function normSuit(s) { return SUIT_ALIAS[String(s || '').toLowerCase()] || String(s || '').toLowerCase(); }
function normRank(r) {
  if (r == null) return null;
  if (typeof r === 'number') return r;
  var k = String(r).toLowerCase();
  if (RANK_ALIAS[k]) return RANK_ALIAS[k];
  var n = parseInt(k, 10);
  return isNaN(n) ? String(r).toUpperCase() : n;
}
/* Décrit une carte : { suit, rank, id, label, short, value, red, figure, trump, bout } */
function cardInfo(o) {
  if (typeof o === 'string') o = parseId(o);
  var suit = normSuit(o.suit), rank = normRank(o.rank);
  var c = { suit: suit, rank: rank };
  if (suit === 'excuse') {
    c.id = 'excuse'; c.label = 'L’Excuse (bout)'; c.short = 'Excuse'; c.bout = true; c.trump = true;
  } else if (suit === 'atout') {
    c.id = 'atout-' + rank; c.trump = true; c.bout = rank === 1 || rank === 21;
    c.label = (rank === 1 ? 'Le Petit, atout 1 (bout)' : rank === 21 ? 'Atout 21 (bout)' : 'Atout ' + rank);
    c.short = rank + ' d’atout';
  } else {
    c.id = rank + '-' + suit; c.red = !!SUIT_RED[suit]; c.figure = !!FIGURES[rank];
    var rn = RANK_NAME[rank] || String(rank);
    c.label = rn + ' de ' + SUIT_NAME[suit];
    c.short = (rank === 'A' ? 'As' : rank === 'V' ? 'V' : rank) + ' ' + SUIT_GLYPH[suit];
    if (c.figure) c.name = FIG_NAMES[c.id];
    c.value = rank === 'A' ? 1 : rank === 'V' ? 10 : rank === 'D' ? 15 : rank === 'R' ? 20 : rank === 'C' ? 12 : rank;
  }
  if (o.id) c.id = o.id;
  return c;
}
var SUIT_GLYPH = { pique: '♠︎', coeur: '♥︎', carreau: '♦︎', trefle: '♣︎' };
function parseId(id) {
  if (id === 'excuse') return { suit: 'excuse' };
  var m = /^([^-]+)-(.+)$/.exec(id);
  if (!m) return { suit: id };
  if (m[1] === 'atout') return { suit: 'atout', rank: +m[2], id: id };
  return { rank: m[1], suit: m[2], id: id };
}
T.cardInfo = cardInfo;
T.suitName = function (s) { return SUIT_NAME[normSuit(s)] || ''; };

/* ---------- jeux ---------- */
T.deck = {
  /* 52 cartes : As, 2–10, Valet, Dame, Roi × 4 couleurs */
  standard: function () {
    var out = [];
    SUITS4.forEach(function (s) { ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'V', 'D', 'R'].forEach(function (r) { out.push({ suit: s, rank: r }); }); });
    return out;
  },
  /* 78 cartes : 1–10, Valet, Cavalier, Dame, Roi × 4 (56) + 21 atouts + l'Excuse */
  tarot: function () {
    var out = [];
    SUITS4.forEach(function (s) { [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'V', 'C', 'D', 'R'].forEach(function (r) { out.push({ suit: s, rank: r }); }); });
    for (var i = 1; i <= 21; i++) out.push({ suit: 'atout', rank: i });
    out.push({ suit: 'excuse' });
    return out;
  },
  /* Tri d'une main : par couleur (ordre donné), puis par rang ; atouts à la fin (Tarot). */
  sort: function (cards, order) {
    order = order || ['pique', 'coeur', 'trefle', 'carreau', 'atout', 'excuse'];
    var RV = { A: 1, V: 11, C: 12, D: 13, R: 14 };
    return cards.slice().sort(function (a, b) {
      var A = cardInfo(a), B = cardInfo(b);
      var so = order.indexOf(A.suit) - order.indexOf(B.suit);
      if (so) return so;
      return (RV[A.rank] || A.rank || 0) - (RV[B.rank] || B.rank || 0);
    });
  }
};

/* ---------- pips (viewBox 0 0 100 140) ---------- */
var L = 34, C = 50, R = 66;
var ROWS4 = [24, 54.7, 85.3, 116];
var PIPS = {
  1: [[C, 70]],
  2: [[C, 24], [C, 116]],
  3: [[C, 24], [C, 70], [C, 116]],
  4: [[L, 24], [R, 24], [L, 116], [R, 116]],
  5: [[L, 24], [R, 24], [C, 70], [L, 116], [R, 116]],
  6: [[L, 24], [R, 24], [L, 70], [R, 70], [L, 116], [R, 116]],
  7: [[L, 24], [R, 24], [C, 47], [L, 70], [R, 70], [L, 116], [R, 116]],
  8: [[L, 24], [R, 24], [C, 47], [L, 70], [R, 70], [C, 93], [L, 116], [R, 116]],
  9: ROWS4.map(function (y) { return [L, y]; }).concat(ROWS4.map(function (y) { return [R, y]; }), [[C, 70]]),
  10: ROWS4.map(function (y) { return [L, y]; }).concat(ROWS4.map(function (y) { return [R, y]; }), [[C, 39.3], [C, 100.7]])
};
function pips(suit, n) {
  var sz = n >= 9 ? 16 : n === 1 ? 26 : 18, h = sz / 2;
  return (PIPS[n] || []).map(function (p) {
    var flip = p[1] > 72 ? ' transform="rotate(180 ' + p[0] + ' ' + p[1] + ')"' : '';
    return '<use href="#tp-i-' + suit + '" x="' + (p[0] - h) + '" y="' + (p[1] - h) + '" width="' + sz + '" height="' + sz + '"' + flip + '/>';
  }).join('');
}
function aceArt(suit) {
  return '<g class="tp-ace">' +
    '<circle cx="50" cy="70" r="31" class="tp-orn"/><circle cx="50" cy="70" r="27.5" class="tp-orn tp-orn--thin"/>' +
    '<path d="M50 34v-6M50 112v-6M14 70h6M80 70h6" class="tp-orn"/>' +
    '<use href="#tp-i-' + suit + '" x="27" y="47" width="46" height="46"/></g>';
}

/* ---------- figures : portraits générés dans le sprite ---------- */
var F = {
  ink: 'fill:var(--card-ink)', red: 'fill:var(--card-red)', blue: 'fill:var(--fig-blue)', gold: 'fill:var(--fig-gold)',
  skin: 'fill:var(--fig-skin)', face: 'fill:var(--card-face)', steel: 'fill:var(--fig-hair-grey)',
  dark: 'fill:var(--fig-hair-dark)', brown: 'fill:var(--fig-hair-brown)', blond: 'fill:var(--fig-hair-blond)', grey: 'fill:var(--fig-hair-grey)'
};
function sp(d, f, extra) { return '<path d="' + d + '" style="' + F[f] + '"' + (extra || '') + '/>'; }
function circ(x, y, r, f) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" style="' + F[f] + '"/>'; }
var FIG = {
  'R-pique':   { main: 'blue', sec: 'red', hair: 'dark', item: 'sword', beard: 1 },
  'R-coeur':   { main: 'red', sec: 'blue', hair: 'grey', item: 'sceptre', beard: 1 },
  'R-carreau': { main: 'red', sec: 'gold', hair: 'brown', item: 'orb', beard: 1 },
  'R-trefle':  { main: 'blue', sec: 'gold', hair: 'blond', item: 'axe', beard: 1 },
  'D-pique':   { main: 'blue', sec: 'gold', hair: 'dark', item: 'shield' },
  'D-coeur':   { main: 'red', sec: 'gold', hair: 'blond', item: 'fan' },
  'D-carreau': { main: 'blue', sec: 'red', hair: 'brown', item: 'flower' },
  'D-trefle':  { main: 'red', sec: 'blue', hair: 'dark', item: 'sceptre' },
  'V-pique':   { main: 'blue', sec: 'red', hair: 'blond', item: 'halberd' },
  'V-coeur':   { main: 'red', sec: 'gold', hair: 'brown', item: 'sword' },
  'V-carreau': { main: 'red', sec: 'blue', hair: 'dark', item: 'axe' },
  'V-trefle':  { main: 'blue', sec: 'gold', hair: 'brown', item: 'shield' },
  'C-pique':   { main: 'blue', sec: 'red', hair: 'dark', item: 'lance' },
  'C-coeur':   { main: 'red', sec: 'blue', hair: 'blond', item: 'lance' },
  'C-carreau': { main: 'red', sec: 'gold', hair: 'brown', item: 'lance' },
  'C-trefle':  { main: 'blue', sec: 'gold', hair: 'grey', item: 'lance' }
};
var FACE_OVAL = '<ellipse cx="30" cy="25" rx="7.6" ry="9.2" style="' + F.skin + '"/>';
function hairBack(kind, hc) {
  if (kind === 'D') return sp('M21.4 22C21 11.6 39 11.6 38.6 22L40.6 41H35.2l.4-12.6H24.4l.4 12.6h-5.4z', hc);
  if (kind === 'R') return sp('M21.4 26C20.4 14.6 39.6 14.6 38.6 26l1.2 7.4-3.4-2 .5-8.8c-2.9-3.6-11.7-3.6-14.6 0l.5 8.8-3.4 2z', hc);
  if (kind === 'V') return sp('M22 26C20.8 14.2 39.2 14.2 38 26l-.6 5.4h-1.6l.2-9c-2.8-3.4-11.2-3.4-14 0l.2 9h-1.6z', hc);
  return '';
}
function faceFeatures(kind) {
  var lips = kind === 'D' ? sp('M28.2 30.1q1.8-1 3.6 0q-1.8 1.4-3.6 0z', 'red') : '<path d="M28.4 30.3q1.6.7 3.2 0" style="fill:none;stroke:var(--card-red);stroke-width:.8"/>';
  return '<ellipse cx="27.1" cy="24.6" rx="1" ry=".65" style="' + F.ink + ';stroke:none"/><ellipse cx="32.9" cy="24.6" rx="1" ry=".65" style="' + F.ink + ';stroke:none"/>' +
    '<path d="M25.2 22.4q1.8-1.1 3.4 0M31.4 22.4q1.6-1.1 3.4 0M30 24.8l-.9 3.1h1.5" style="fill:none;stroke-width:.6"/>' + lips +
    (kind === 'D' ? '<path d="M25.6 26.8q.9.5 1.8.2M32.6 27q.9.3 1.8-.2" style="fill:none;stroke:var(--card-red);stroke-width:.5;opacity:.6"/>' : '');
}
function headgear(kind, f) {
  if (kind === 'R') {
    return sp('M22.4 15.4C23 8.6 37 8.6 37.6 15.4z', f.sec) +
      sp('M21.4 15.2L20.4 6.6l4.6 4.6 2.5-6.8 2.5 5.8 2.5-5.8 2.5 6.8 4.6-4.6-1 8.6z', 'gold') +
      sp('M21.2 14.8h17.6v4H21.2z', 'gold') +
      circ(20.4, 6, 1.2, 'gold') + circ(27.5, 3.9, 1.2, 'gold') + circ(32.5, 3.9, 1.2, 'gold') + circ(39.6, 6, 1.2, 'gold') +
      circ(30, 16.8, 1.1, 'red') + circ(25, 16.8, .9, 'blue') + circ(35, 16.8, .9, 'blue');
  }
  if (kind === 'D') {
    return sp('M22.6 15.8l-.6-5.2 3.2 2.6 2.4-4.4 2.4 3.4 2.4-3.4 2.4 4.4 3.2-2.6-.6 5.2z', 'gold') +
      sp('M22.4 15h15.2v2.4H22.4z', 'gold') + circ(30, 16.2, .9, 'red');
  }
  if (kind === 'V') {
    return sp('M36.8 13.4C41.6 6.4 47.6 3 52 2.4c-2.8 3.8-7 8.6-13.6 12.8z', f.sec) +
      sp('M20.4 18C19.8 11 40.4 9.4 40.8 16.4c.2 2-2.6 3-10.8 3-7 0-9.4.6-9.6-1.4z', f.main) +
      sp('M21.4 17.4q8.6 2.6 17.9-.6l.2 1.9q-9.4 2.8-17.9.4z', 'gold');
  }
  if (kind === 'C') {
    return sp('M30.6 12.2C31.6 6.8 36.6 2.8 44.6 1.8c-4 3.2-8 7.2-11 11.2z', f.sec) +
      sp('M20.2 32C19.2 11 40.8 11 39.8 32h-3.2V20.6c-1.6-2.4-11.6-2.4-13.2 0V32z', 'steel') +
      sp('M29.2 11.2h1.6v9.4h-1.6z', 'gold') + sp('M20.6 26.5h2.8v2.2h-2.8zM36.6 26.5h2.8v2.2h-2.8z', 'gold');
  }
  return '';
}
function veil(f) { return sp('M21.8 16.6C19.6 26 19 35 15.8 44.6l6.6-3.4.4-22.6zM38.2 16.6c2.2 9.4 2.8 18.4 6 28l-6.6-3.4-.4-22.6z', f.sec); }
function beard(hc) {
  return sp('M22.6 27c.4 8 3.4 11.6 7.4 11.8 4-.2 7-3.8 7.4-11.8-1.4 4-3.9 5.4-7.4 5.4s-6-1.4-7.4-5.4z', hc) +
    sp('M26.6 29.6q3.4-1.8 6.8 0-3.4.4-6.8 0z', hc);
}
function bust(f, kind) {
  var m = f.main, s = f.sec;
  return sp('M2 64l1.6-11.4C5 46 11 42.4 21 40.2h18c10 2.2 16 5.8 17.4 12.4L58 64z', m) +
    sp('M21 40.2l9 15.6 9-15.6z', s) +
    sp('M14 47.2c2-1.6 4.2-2.6 6.6-3.2l1.6 4c-2.2.6-4.2 1.4-6 2.6zM46 47.2c-2-1.6-4.2-2.6-6.6-3.2l-1.6 4c2.2.6 4.2 1.4 6 2.6z', 'gold') +
    (kind === 'D' || kind === 'R' ? sp('M19.4 39.6q10.6 7 21.2 0l.2 2.6q-10.8 7.4-21.6 0z', 'gold') : sp('M21.6 40q8.4 4.4 16.8 0l.6 1.8q-9 5-18 0z', 'face')) +
    sp('M26.6 31h6.8v9.8h-6.8z', 'skin');
}
function item(name, f, suit) {
  switch (name) {
    case 'sword': return sp('M44.6 3.4l1.6-1.8 1.6 1.8V46h-3.2z', 'steel') + sp('M39.6 45.6h12.2v2.6H39.6z', 'gold') + sp('M45.2 48.2h2v6.6h-2z', 'brown') + circ(46.2, 56.4, 1.7, 'gold') + '<ellipse cx="46.2" cy="51.2" rx="3.2" ry="2.3" style="' + F.skin + '"/>';
    case 'sceptre': return sp('M45.2 13h1.8v51h-1.8z', 'gold') + sp('M46.1 3c-1.6 2.2-1.6 4.4 0 7 1.6-2.6 1.6-4.8 0-7zM46.1 10.2c-2.4-2-4.6-2-6 .2 2 1.2 4 1.2 6-.2zM46.1 10.2c2.4-2 4.6-2 6 .2-2 1.2-4 1.2-6-.2z', 'gold') + sp('M43.4 12h5.4v1.8h-5.4z', 'gold') + '<ellipse cx="46.1" cy="50" rx="3.4" ry="2.4" style="' + F.skin + '"/>';
    case 'orb': return circ(45.6, 48.6, 6.2, 'gold') + sp('M39.4 48h12.4v1.4H39.4zM44.9 42.4h1.4v12.4h-1.4z', 'red') + sp('M44.9 37.4h1.4v5h-1.4zM43.4 38.8h4.4v1.3h-4.4z', 'gold') + '<ellipse cx="45.6" cy="56.6" rx="4" ry="2.3" style="' + F.skin + '"/>';
    case 'axe': return sp('M45.2 7h1.8v57h-1.8z', 'brown') + sp('M47 8.6c6.8 0 9.8 4.6 9.8 11.2-3.2-1.6-6.4-1.6-9.8 0z', 'steel') + sp('M45.2 8.6c-3 .6-4.6 2.6-4.8 5.2 1.6-.6 3.2-.8 4.8-.6z', 'steel') + '<ellipse cx="46.1" cy="50" rx="3.4" ry="2.4" style="' + F.skin + '"/>';
    case 'halberd': return sp('M45.2 3h1.8v61h-1.8z', 'brown') + sp('M46.1 0l2.2 7h-4.4z', 'steel') + sp('M47 8c5.4.4 8 3.6 8.4 8.4-2.8-1.6-5.6-2-8.4-1.6z', 'steel') + sp('M45.2 9.4l-4.4 2.6 4.4 1.4z', 'steel') + '<ellipse cx="46.1" cy="50" rx="3.4" ry="2.4" style="' + F.skin + '"/>';
    case 'shield': return sp('M3.4 40.6l12.4-3.6 12.4 3.6v8.6c0 7-5.2 11.6-12.4 13.8C8.6 60.8 3.4 56.2 3.4 49.2z', 'face') + sp('M5.6 42.2l10.2-2.9 10.2 2.9v7c0 5.8-4.2 9.6-10.2 11.4C9.8 58.8 5.6 55 5.6 49.2z', f.main) + '<use href="#tp-i-' + suit + '" x="10.2" y="43.2" width="11.2" height="11.2" style="' + F.gold + '"/>' + sp('M43.8 4h1.6v60h-1.6z', 'brown') + sp('M44.6 0l2.6 6.4h-5.2z', 'steel');
    case 'fan': return sp('M46 52L34.6 37.6c4-4.2 18.8-4.2 22.8 0z', f.sec) + '<path d="M46 52L37.4 36.2M46 52l-4.2-16.8M46 52V35M46 52l4.2-16.8M46 52l8.6-15.8" style="fill:none;stroke-width:.5"/>' + '<ellipse cx="46" cy="52.4" rx="3.4" ry="2.4" style="' + F.skin + '"/>';
    case 'flower': return '<path d="M45 64c-.6-10.6 1-20 2.6-28" style="fill:none;stroke:var(--fig-blue);stroke-width:1.4"/>' + sp('M46.4 46c3.6-2.2 6.6-1.6 8 .8-3.2 1.6-5.8 1.4-8-.8z', 'blue') + circ(47.8, 31.8, 3.4, 'red') + circ(44.6, 34.6, 3, 'red') + circ(51, 34.6, 3, 'red') + circ(47.8, 34, 1.6, 'gold') + '<ellipse cx="45.6" cy="52" rx="3.2" ry="2.3" style="' + F.skin + '"/>';
    case 'lance': return sp('M42.8 64L53.8 1.4l1.8.3-10.8 62.6z', 'brown') + sp('M53.8 1.4L56.4 -4l.8 6z', 'steel') + sp('M54.2 4.6l-9.6 1.2 8.8 4.4z', f.sec) + '<ellipse cx="47.6" cy="44" rx="3.2" ry="2.4" style="' + F.skin + '"/>';
  }
  return '';
}
function portraitHalf(rank, suit) {
  var f = FIG[rank + '-' + suit], k = rank;
  var hc = f.hair;
  return '<g style="stroke:var(--card-ink);stroke-width:.65;stroke-linejoin:round">' +
    (k === 'D' ? veil(f) : '') + hairBack(k, hc) + bust(f, k) +
    FACE_OVAL + faceFeatures(k) + (f.beard ? beard(hc) : '') +
    (k === 'D' ? sp('M22.4 22C23 15.8 37 15.8 37.6 22c-3.6-3-11.6-3-15.2 0z', hc) : '') +
    (k === 'C' ? '<use href="#tp-i-horse" x="24.6" y="47" width="10.8" height="10.8" style="' + F.gold + '"/>' : '') +
    headgear(k, f) + item(f.item, f, suit) + '</g>';
}
/* Portrait plein (tailles lg et xl) : le buste agrandi, la robe jusqu'en bas, le nom. */
function portraitFull(rank, suit) {
  var f = FIG[rank + '-' + suit];
  return '<g style="stroke:var(--card-ink);stroke-width:.65;stroke-linejoin:round">' +
    sp('M3 70h64v54H3z', f.main) + sp('M27 70h16v54H27z', f.sec) +
    sp('M24.6 70h2.4v54h-2.4zM43 70h2.4v54H43z', 'gold') +
    '<use href="#tp-i-' + suit + '" x="28" y="78" width="14" height="14" style="' + F.gold + '"/>' +
    sp('M3 104h64v2.6H3z', 'gold') + '</g>' +
    '<g transform="translate(.5 1) scale(1.15)">' + portraitHalf(rank, suit) + '</g>';
}
function ensureFigure(rank, suit) {
  var id = rank + '-' + suit;
  if (!FIG[id]) return null;
  addSymbol('tp-fh-' + id, '0 0 60 64', portraitHalf(rank, suit));
  addSymbol('tp-ff-' + id, '0 0 70 124', portraitFull(rank, suit));
  return id;
}
function figureArt(c, wide) {
  ensureFigure(c.rank, c.suit);
  var id = c.rank + '-' + c.suit;
  if (wide) {
    var name = esc((RANK_NAME[c.rank] || '') + ' · ' + (c.name || ''));
    return '<rect x="18" y="6" width="64" height="128" rx="2" class="tp-frame"/>' +
      '<svg x="19.5" y="7.5" width="61" height="125" viewBox="0 0 70 124" preserveAspectRatio="xMidYMin slice" overflow="hidden"><use href="#tp-ff-' + id + '"/></svg>' +
      '<rect x="19.5" y="105" width="61" height="12" class="tp-ribbon"/><text x="50" y="113.4" class="tp-ribbon__t">' + name + '</text>';
  }
  return '<rect x="23" y="6" width="54" height="128" rx="1.6" class="tp-frame"/>' +
    '<svg x="24" y="7" width="52" height="63" viewBox="4 0 52 58" preserveAspectRatio="xMidYMax slice"><use href="#tp-fh-' + id + '"/></svg>' +
    '<g transform="rotate(180 50 70)"><svg x="24" y="7" width="52" height="63" viewBox="4 0 52 58" preserveAspectRatio="xMidYMax slice"><use href="#tp-fh-' + id + '"/></svg></g>' +
    '<path d="M23 70h54" class="tp-frame__mid"/>';
}

/* ---------- atouts et Excuse ---------- */
function rosette(n) {
  var petals = 3 + (n % 6), s = '', rot = (n * 23) % 360;
  for (var i = 0; i < petals; i++) {
    var a = rot + i * 360 / petals;
    s += '<ellipse cx="50" cy="23" rx="2.6" ry="6.6" transform="rotate(' + a + ' 50 30)" class="tp-trump__petal"/>';
  }
  var ring = n % 2 ? '<circle cx="50" cy="30" r="11.5" class="tp-orn tp-orn--thin"/>' : '<rect x="38.5" y="18.5" width="23" height="23" transform="rotate(45 50 30)" class="tp-orn tp-orn--thin"/>';
  return '<g class="tp-trump__vig">' + ring + s + '<circle cx="50" cy="30" r="2.6" class="tp-trump__heart"/></g>';
}
function trumpArt(c) {
  var n = c.rank;
  return rosette(n) +
    '<text x="50" y="86" class="tp-trump__num">' + n + '</text>' +
    '<path d="M24 101h52l-3.6 6 3.6 6H24l3.6-6z" class="tp-trump__ribbon"/><text x="50" y="110" class="tp-trump__label">Atout</text>' +
    (c.bout ? '<text x="50" y="125" class="tp-trump__bout">Bout</text>' : '');
}
function excuseArt() {
  return '<circle cx="50" cy="64" r="26" class="tp-orn tp-orn--thin"/>' +
    '<use href="#tp-i-star" x="27" y="41" width="46" height="46" class="tp-excuse__star"/>' +
    '<path d="M24 101h52l-3.6 6 3.6 6H24l3.6-6z" class="tp-trump__ribbon"/><text x="50" y="110" class="tp-trump__label">Excuse</text>' +
    '<text x="50" y="125" class="tp-trump__bout">Bout</text>';
}

/* ---------- dos (symboles du sprite) ---------- */
(function backs() {
  var lat = '';
  for (var i = -140; i <= 100; i += 10) lat += 'M' + i + ' 0l140 140M' + (i + 140) + ' 0l-140 140';
  symbol('tp-back-cour', '0 0 100 140',
    '<rect width="100" height="140" style="fill:var(--back)"/>' +
    '<rect x="6" y="6" width="88" height="128" rx="3" style="fill:none;stroke:var(--back-ornament);stroke-width:1.4"/>' +
    '<svg x="9" y="9" width="82" height="122" viewBox="9 9 82 122"><path d="' + lat + '" style="fill:none;stroke:var(--back-ornament);stroke-width:.5;opacity:.38"/></svg>' +
    '<rect x="9" y="9" width="82" height="122" rx="2" style="fill:none;stroke:var(--back-ornament);stroke-width:.6"/>' +
    '<path d="M50 42l19 7v15c0 13-8.6 21.8-19 25.4C39.6 85.8 31 77 31 64V49z" style="fill:var(--back);stroke:var(--back-ornament);stroke-width:1.6"/>' +
    '<use href="#tp-i-castle" x="38" y="50" width="24" height="24" style="fill:var(--back-ornament)"/>' +
    '<use href="#tp-i-crown" x="40" y="28" width="20" height="13" style="fill:var(--back-ornament)"/>' +
    '<path d="M50 96l3 4-3 4-3-4zM50 16l2.4 3.2-2.4 3.2-2.4-3.2zM50 118l2.4 3.2-2.4 3.2-2.4-3.2z" style="fill:var(--back-ornament)"/>');
  function guil(cx, cy, R, a, k, ph, n) {
    var d = '';
    for (var j = 0; j <= n; j++) {
      var t = j / n * Math.PI * 2, r = R + a * Math.cos(k * t + ph);
      d += (j ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(1) + ' ' + (cy + r * Math.sin(t)).toFixed(1);
    }
    return d;
  }
  var g = '';
  for (var m = 0; m < 6; m++) g += guil(50, 70, 21 - m * 2.6, 6 - m * .6, 12, m * .52, 240);
  var c4 = guil(0, 0, 7, 2.2, 8, 0, 96) + guil(0, 0, 4.6, 1.6, 8, .4, 96);
  symbol('tp-back-salon', '0 0 100 140',
    '<rect width="100" height="140" style="fill:var(--back)"/>' +
    '<rect x="5.5" y="5.5" width="89" height="129" rx="3" style="fill:none;stroke:var(--back-ornament);stroke-width:1.2"/>' +
    '<rect x="8.5" y="8.5" width="83" height="123" rx="2" style="fill:none;stroke:var(--back-ornament);stroke-width:.5"/>' +
    '<path d="' + g + '" style="fill:none;stroke:var(--back-ornament);stroke-width:.45"/>' +
    '<circle cx="50" cy="70" r="3.2" style="fill:var(--back-ornament)"/>' +
    ['translate(20 22)', 'translate(80 22)', 'translate(20 118)', 'translate(80 118)'].map(function (tr) { return '<path transform="' + tr + '" d="' + c4 + '" style="fill:none;stroke:var(--back-ornament);stroke-width:.45"/>'; }).join('') +
    '<path d="M50 30l2.2 3-2.2 3-2.2-3zM50 104l2.2 3-2.2 3-2.2-3z" style="fill:var(--back-ornament)"/>');
})();
function backArt() {
  return '<svg class="tp-back__art" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true" focusable="false"><use class="tp-back--cour" href="#tp-back-cour"/><use class="tp-back--salon" href="#tp-back-salon"/></svg>';
}

/* ---------- Tapis.Card ---------- */
var SIZES = { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 };
function idxHtml(c, cls) {
  var r, g;
  if (c.suit === 'excuse') { r = ''; g = 'star'; }
  else if (c.suit === 'atout') { r = c.rank; g = 'trump'; }
  else { r = c.rank; g = c.suit; }
  return '<span class="' + cx('tp-card__idx', cls) + '" aria-hidden="true">' + (r !== '' ? '<b>' + esc(r) + '</b>' : '') + '<svg viewBox="0 0 24 24" focusable="false"><use href="#tp-i-' + g + '"></use></svg></span>';
}
function artHtml(c, size) {
  var wide = size === 'lg' || size === 'xl', inner;
  if (c.suit === 'excuse') inner = excuseArt();
  else if (c.suit === 'atout') inner = trumpArt(c);
  else if (c.figure) inner = figureArt(c, wide);
  else if (c.rank === 'A') inner = aceArt(c.suit);
  else inner = pips(c.suit, c.rank);
  return '<svg class="tp-card__art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">' + inner + '</svg>';
}
/*
  Tapis.Card({ suit, rank, size, state, faceDown, interactive, selected, reason, tag, id, owner, attrs })
  suit : 'pique' | 'coeur' | 'carreau' | 'trefle' | 'atout' | 'excuse' (alias anglais acceptés)
  rank : 'A', 1–10, 'V', 'C', 'D', 'R' (alias J, Q, K) ; 1–21 pour les atouts
  size : 'xs' | 'sm' | 'md' (défaut) | 'lg' | 'xl'
  state : 'playable' | 'unplayable' | 'selected' | 'winner' | 'hidden' (combinables, séparés par des espaces)
*/
T.Card = function (o) {
  o = o || {};
  ensureSprite();
  var c = cardInfo(o);
  var size = SIZES[o.size] ? o.size : 'md';
  var states = String(o.state || '').split(/\s+/).filter(Boolean);
  if (o.selected && states.indexOf('selected') < 0) states.push('selected');
  var down = !!o.faceDown;
  var interactive = !!o.interactive && !down;
  var unplay = states.indexOf('unplayable') >= 0;
  var label = down ? 'Carte face cachée' : c.label;
  if (states.indexOf('winner') >= 0) label += ', gagne le pli';
  if (o.tag) label += ', ' + o.tag;
  if (unplay && o.reason) label += ' — injouable : ' + o.reason;
  var a = Object.assign({
    class: cx('tp-card', o.className),
    'data-card-id': c.id,
    'data-suit': c.suit,
    'data-rank': c.rank,
    'data-size': size,
    'data-state': states.join(' ') || null,
    'data-face': down ? 'down' : 'up',
    'data-bout': c.bout ? '' : null,
    'data-fig': c.figure ? '' : null,
    'data-owner': o.owner != null ? o.owner : null,
    'aria-label': label,
    title: unplay && o.reason ? o.reason : null
  }, o.attrs || {});
  var tag = 'div';
  if (interactive) {
    tag = 'button'; a.type = 'button';
    a['aria-pressed'] = states.indexOf('selected') >= 0 ? 'true' : 'false';
    if (unplay) a['aria-disabled'] = 'true';
  } else { a.role = 'img'; }
  var face = '<span class="tp-card__face">' + artHtml(c, size) + idxHtml(c) + idxHtml(c, 'tp-card__idx--br') +
    (o.tag ? '<span class="tp-card__tag">' + esc(o.tag) + '</span>' : '') + '</span>';
  var back = '<span class="tp-card__back">' + backArt() + '</span>';
  var why = unplay && o.reason ? '<span class="tp-card__why" aria-hidden="true">' + esc(o.reason) + '</span>' : '';
  return '<' + tag + attrs(a) + '>' + face + back + why + '</' + tag + '>';
};
/* Dos seul (adversaires, pioche). */
T.Back = function (o) {
  o = o || {};
  ensureSprite();
  var size = SIZES[o.size] ? o.size : 'md';
  return '<div' + attrs(Object.assign({ class: cx('tp-card', o.className), 'data-size': size, 'data-face': 'down', role: o.label ? 'img' : null, 'aria-label': o.label || null, 'aria-hidden': o.label ? null : 'true', 'data-card-id': o.id || null }, o.attrs || {})) + '><span class="tp-card__back">' + backArt() + '</span></div>';
};
/* Emplacement vide (carte cachée pendant un vol, place réservée). */
T.Slot = function (o) {
  o = o || {};
  return '<div' + attrs({ class: cx('tp-card tp-card--slot', o.className), 'data-size': SIZES[o.size] ? o.size : 'md', 'data-slot': o.slot || '', 'aria-hidden': 'true' }) + '>' + (o.label ? '<span class="tp-card__slotlabel label">' + esc(o.label) + '</span>' : '') + '</div>';
};
/* Retourne une carte (pour les animations) : met à jour data-face. */
T.Card.flip = function (el, up) { el.setAttribute('data-face', up ? 'up' : 'down'); return el; };

/* =====================================================================
   Composants communs
   ===================================================================== */
function uid(p) { uid.n = (uid.n || 0) + 1; return (p || 'tp') + '-' + uid.n; }

/* Bouton : variant 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'.
   disabled + reason : reste focalisable (aria-disabled) et annonce la raison. */
T.Button = function (o) {
  o = o || {};
  var v = o.variant || 'secondary', id = o.reason ? uid('why') : null;
  var a = Object.assign({
    type: 'button', class: cx('tp-btn', 'tp-btn--' + v, o.className),
    'aria-disabled': o.disabled ? 'true' : null,
    'aria-pressed': o.pressed != null ? String(!!o.pressed) : null,
    'aria-describedby': id && o.disabled ? id : null,
    'aria-label': v === 'icon' ? o.label : null,
    title: v === 'icon' ? o.label : null
  }, o.attrs || {});
  var inner = (o.icon ? T.icon(o.icon) : '') + (v === 'icon' ? '' : '<span>' + rich(o.label || '') + '</span>') +
    (o.count != null ? '<span class="tp-btn__count tp-num">' + esc(o.count) + '</span>' : '') +
    (o.kbd ? '<kbd class="tp-btn__kbd">' + esc(o.kbd) + '</kbd>' : '');
  var why = o.reason && o.disabled ? '<span class="tp-btn__why caption" id="' + id + '">' + rich(o.reason) + '</span>' : '';
  return why ? '<span class="tp-btnwrap">' + '<button' + attrs(a) + '>' + inner + '</button>' + why + '</span>' : '<button' + attrs(a) + '>' + inner + '</button>';
};
T.MotionToggle = function () {
  var on = T.motion ? T.motion.enabled() : true;
  return T.Button({ variant: 'icon', icon: on ? 'motion' : 'motion-off', label: on ? 'Animations activées' : 'Animations coupées', pressed: on, attrs: { 'data-motion-toggle': '' } });
};

/* Avatar : photo Discord (src) ou initiale. state : 'active' | 'waiting' | 'offline'. */
var AV_TONES = 6;
function hash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
T.Avatar = function (o) {
  o = o || {};
  var name = o.name || '?', ini = (o.initial || name.trim().charAt(0) || '?').toUpperCase();
  var img = o.src ? '<img src="' + esc(o.src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span aria-hidden="true">' + esc(ini) + '</span>';
  return '<span' + attrs({ class: cx('tp-avatar', o.className), 'data-tone': hash(name) % AV_TONES, 'data-state': o.state || null, 'data-size': o.size || null }) + '>' + img +
    (o.state === 'offline' ? '<i class="tp-avatar__off">' + T.icon('offline') + '</i>' : '') + '</span>';
};

/* Badge : { label, icon, tone: 'accent' | 'muted' | 'danger' | 'positive' | 'card' } */
T.Badge = function (b) {
  if (typeof b === 'string') b = { label: b };
  return '<span' + attrs({ class: cx('tp-badge', b.tone && 'tp-badge--' + b.tone), title: b.title || null }) + '>' + (b.icon ? T.icon(b.icon) : '') + '<span>' + rich(b.label) + '</span></span>';
};

/* Bulle d'annonce au-dessus d'un siège (enchère, dernière action). */
T.Bubble = function (o) {
  if (typeof o === 'string') o = { text: o };
  return '<span' + attrs({ class: cx('tp-bubble', o.tone && 'tp-bubble--' + o.tone, o.className), role: 'status' }) + '>' + rich(o.text) + '</span>';
};

/* Éventail de dos (adversaires) : n cartes, compté et annoncé. */
T.Fan = function (o) {
  o = o || {};
  var n = o.count || 0, shown = Math.min(n, o.max || 8), h = '';
  for (var i = 0; i < shown; i++) h += '<span class="tp-fan__c" style="--i:' + i + ';--m:' + ((shown - 1) / 2) + '">' + T.Back({ size: o.size || 'xs' }) + '</span>';
  return '<span class="tp-fan" data-zone="fan" role="img" aria-label="' + n + ' carte' + (n > 1 ? 's' : '') + ' en main">' + h + '</span>';
};

/*
  Siège : { seat, name, avatar, state, me, count, fan, badges, bubble, last, pos, played, playedLabel, note, compact }
  state : 'active' (son tour, halo) | 'waiting' | 'offline' (déconnecté)
*/
T.Seat = function (o) {
  o = o || {};
  var state = o.state || 'waiting';
  var stateTxt = state === 'active' ? (o.me ? 'C’est ton tour' : 'Joue…') : state === 'offline' ? 'Déconnecté' : '';
  var meta = [];
  if (o.count != null) meta.push(o.count + ' carte' + (o.count > 1 ? 's' : ''));
  if (o.tricks != null) meta.push(o.tricks + ' pli' + (o.tricks > 1 ? 's' : ''));
  if (o.meta) meta.push(o.meta);
  var played = o.played && o.played.length ? '<div class="tp-seat__played" data-zone="played"><span class="tp-seat__plabel label">' + esc(o.playedLabel || 'Posées contre ce boss') + '</span><div class="tp-seat__pcards">' +
    o.played.map(function (c) { return T.Card(Object.assign({ size: 'sm' }, c)); }).join('') + '</div></div>' : '';
  return '<section' + attrs({
    class: cx('tp-seat', o.compact && 'tp-seat--compact', o.className), 'data-seat': o.seat != null ? o.seat : null, 'data-state': state, 'data-pos': o.pos || null,
    'data-me': o.me ? '' : null, 'aria-label': (o.name || '') + (stateTxt ? ', ' + stateTxt : '') + (meta.length ? ', ' + meta.join(', ') : '')
  }) + '>' +
    (o.bubble ? T.Bubble(o.bubble) : '') +
    '<div class="tp-seat__id">' + T.Avatar({ name: o.name, src: o.avatar, state: state }) +
      '<div class="tp-seat__txt"><b class="tp-seat__name title-sm">' + esc(o.name) + (o.me ? ' <span class="tp-seat__you caption">(toi)</span>' : '') + '</b>' +
      '<span class="tp-seat__meta caption">' + (state === 'active' ? '<span class="tp-seat__turn">' + T.icon('hourglass') + esc(stateTxt) + '</span>' : state === 'offline' ? '<span class="tp-seat__off">' + esc(stateTxt) + '</span>' : '') + esc(meta.join(' · ')) + '</span></div>' +
      (o.badges && o.badges.length ? '<div class="tp-seat__badges">' + o.badges.map(T.Badge).join('') + '</div>' : '') +
    '</div>' +
    (o.fan && o.count ? T.Fan({ count: o.count }) : '') +
    (o.last ? '<p class="tp-seat__last caption">' + rich(o.last) + '</p>' : '') +
    played + (o.note ? '<p class="tp-seat__note caption">' + rich(o.note) + '</p>' : '') +
    '</section>';
};

/*
  Pile : { pile: 'chateau' | 'taverne' | 'defausse' | 'pioche' | 'plis' | 'chien', label, count, top, faceDown, size, icon, hint, empty }
*/
var PILE_ICON = { chateau: 'castle', taverne: 'tavern', defausse: 'discard', pioche: 'deck', plis: 'deck', chien: 'deck' };
T.Pile = function (o) {
  o = o || {};
  var size = o.size || 'sm', n = o.count || 0, layers = Math.min(3, Math.ceil(n / 8));
  var body;
  if (!n && !o.top) body = T.Slot({ size: size, label: o.empty || 'Vide' });
  else if (o.top && !o.faceDown) {
    body = (n > 1 ? '<span class="tp-pile__under">' + T.Back({ size: size }) + '</span>' : '') + T.Card(Object.assign({ size: size }, o.top));
  } else {
    body = '';
    for (var i = layers - 1; i > 0; i--) body += '<span class="tp-pile__layer" style="--l:' + i + '">' + T.Back({ size: size }) + '</span>';
    body += T.Back({ size: size });
  }
  var lab = o.label || { chateau: 'Château', taverne: 'Taverne', defausse: 'Défausse', pioche: 'Pioche', plis: 'Plis', chien: 'Chien' }[o.pile] || '';
  return '<figure' + attrs({ class: cx('tp-pile', o.className), 'data-pile': o.pile || null, 'aria-label': lab + ' : ' + n + ' carte' + (n > 1 ? 's' : '') }) + '>' +
    '<div class="tp-pile__stack">' + body + '<span class="tp-pile__count stat tp-num" aria-hidden="true">' + n + '</span></div>' +
    '<figcaption class="tp-pile__cap label">' + T.icon(o.icon || PILE_ICON[o.pile] || 'deck') + '<span>' + esc(lab) + '</span></figcaption>' +
    (o.hint ? '<p class="tp-pile__hint caption">' + rich(o.hint) + '</p>' : '') + '</figure>';
};

/* Bandeau de statut : { text, tone: 'turn' | 'wait' | 'alert' | 'info', detail, icon } */
T.Status = function (o) {
  if (typeof o === 'string') o = { text: o };
  var icon = o.icon || { turn: 'hourglass', wait: 'hourglass', alert: 'warning', info: 'info', win: 'trophy' }[o.tone || 'info'];
  return '<div' + attrs({ class: cx('tp-status', 'tp-status--' + (o.tone || 'info'), o.className), role: 'status', 'aria-live': 'polite', 'data-zone': 'status' }) + '>' +
    T.icon(icon) + '<span class="tp-status__t status">' + rich(o.text) + '</span>' + (o.detail ? '<span class="tp-status__d caption">' + rich(o.detail) + '</span>' : '') + '</div>';
};

/* Jauge chiffrée : { value, max, label, tone: 'hp' | 'pay' | 'accent', text } — la valeur est toujours écrite. */
T.Gauge = function (o) {
  o = o || {};
  var v = Math.max(0, o.value || 0), m = o.max || 1, p = Math.min(1, v / m);
  var txt = o.text || (v + '/' + m);
  return '<div' + attrs({ class: cx('tp-gauge', 'tp-gauge--' + (o.tone || 'accent'), o.size && 'tp-gauge--' + o.size, o.className), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': m, 'aria-valuenow': v, 'aria-label': (o.label || '') + ' ' + txt }) + '>' +
    (o.label ? '<span class="tp-gauge__l caption">' + rich(o.label) + '</span>' : '') +
    '<span class="tp-gauge__rail"><i class="tp-gauge__trail" style="--p:' + p.toFixed(3) + '"></i><i class="tp-gauge__fill" style="--p:' + p.toFixed(3) + '"></i></span>' +
    '<b class="tp-gauge__v gauge tp-num">' + rich(txt) + '</b></div>';
};

/* Barre d'actions : { primary: {label, icon, disabled, reason, kbd}, secondary: [...], note } */
T.ActionBar = function (o) {
  o = o || {};
  var sec = (o.secondary || []).map(function (b) { return T.Button(Object.assign({ variant: 'secondary' }, b)); }).join('');
  var pri = o.primary ? T.Button(Object.assign({ variant: 'primary' }, o.primary)) : '';
  return '<div' + attrs({ class: cx('tp-actions', o.className), 'data-zone': 'actions', role: 'group', 'aria-label': 'Actions' }) + '>' +
    (o.note ? '<p class="tp-actions__note caption">' + rich(o.note) + '</p>' : '') + '<div class="tp-actions__row">' + sec + pri + '</div></div>';
};

/* Notifications : ne masquent jamais la main (coin haut droit de la zone). */
T.Toast = function (o) {
  o = o || {};
  var tone = o.tone || 'info', icon = { info: 'info', success: 'check', error: 'warning' }[tone];
  return '<div' + attrs({ class: cx('tp-toast', 'tp-toast--' + tone), role: tone === 'error' ? 'alert' : 'status' }) + '>' + T.icon(icon) +
    '<div class="tp-toast__b">' + (o.title ? '<b class="body-strong">' + rich(o.title) + '</b>' : '') + '<span class="caption">' + rich(o.text || '') + '</span></div>' +
    T.Button({ variant: 'icon', icon: 'cross', label: 'Fermer', className: 'tp-toast__x', attrs: { 'data-dismiss': '' } }) + '</div>';
};
T.Toasts = function (list) { return '<div class="tp-toasts" aria-live="polite">' + (list || []).map(T.Toast).join('') + '</div>'; };
T.notify = function (root, o) {
  var host = root.querySelector('.tp-toasts');
  if (!host) { host = T.node(T.Toasts()); root.appendChild(host); }
  var n = T.node(T.Toast(o));
  host.appendChild(n);
  var kill = function () { if (n.parentNode) n.parentNode.removeChild(n); };
  n.addEventListener('click', function (e) { if (e.target.closest('[data-dismiss]')) kill(); });
  if (o.timeout !== 0) setTimeout(kill, o.timeout || 4200);
  return n;
};

/* Journal : { entries: [{ text, tone, at }] } — le plus récent en haut. */
T.Log = function (o) {
  o = o || {};
  return '<ol class="tp-log" aria-label="Journal de la partie">' + (o.entries || []).map(function (e, i) {
    if (typeof e === 'string') e = { text: e };
    return '<li' + attrs({ class: cx('tp-log__e', e.tone && 'tp-log__e--' + e.tone), 'data-new': i === 0 ? '' : null }) + '>' + (e.at ? '<span class="tp-log__at caption tp-num">' + esc(e.at) + '</span>' : '') + '<span class="body">' + rich(e.text) + '</span></li>';
  }).join('') + '</ol>';
};

/* Tiroir latéral escamotable : { id, title, body, open, side } */
T.Drawer = function (o) {
  o = o || {};
  var id = o.id || uid('drawer');
  return '<aside' + attrs({ class: cx('tp-drawer', o.className), id: id, 'data-side': o.side || 'right', 'data-open': o.open ? '' : null, 'aria-label': o.title, 'aria-hidden': o.open ? null : 'true' }) + '>' +
    '<header class="tp-drawer__h"><h2 class="title-md">' + rich(o.title || '') + '</h2>' + T.Button({ variant: 'icon', icon: 'cross', label: 'Fermer', attrs: { 'data-close': id } }) + '</header>' +
    '<div class="tp-drawer__b">' + (o.body || '') + '</div></aside>';
};

/* Fenêtre : { title, kicker, body, tabs: [{ id, label, body }], tab, actions, size, id } */
T.Dialog = function (o) {
  o = o || {};
  var id = o.id || uid('dlg'), tabs = o.tabs || null, cur = o.tab || (tabs && tabs[0].id);
  var tabBar = tabs ? '<div class="tp-tabs" role="tablist">' + tabs.map(function (t) {
    return '<button' + attrs({ type: 'button', role: 'tab', class: 'tp-tab button', id: id + '-t-' + t.id, 'aria-selected': String(t.id === cur), 'aria-controls': id + '-p-' + t.id, tabindex: t.id === cur ? '0' : '-1', 'data-tab': t.id }) + '>' + rich(t.label) + '</button>';
  }).join('') + '</div>' : '';
  var body = tabs ? tabs.map(function (t) {
    return '<section' + attrs({ class: 'tp-tabpanel', role: 'tabpanel', id: id + '-p-' + t.id, 'aria-labelledby': id + '-t-' + t.id, hidden: t.id === cur ? null : true }) + '>' + t.body + '</section>';
  }).join('') : (o.body || '');
  return '<div class="tp-modal" data-zone="modal"><div' + attrs({ class: cx('tp-dialog', o.size && 'tp-dialog--' + o.size, o.className), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-h', id: id }) + '>' +
    '<header class="tp-dialog__h"><div>' + (o.kicker ? '<span class="label tp-dialog__k">' + rich(o.kicker) + '</span>' : '') + '<h2 class="title-lg" id="' + id + '-h">' + rich(o.title || '') + '</h2></div>' +
    T.Button({ variant: 'icon', icon: 'cross', label: 'Fermer', attrs: { 'data-close': id } }) + '</header>' + tabBar +
    '<div class="tp-dialog__b">' + body + '</div>' + (o.actions ? '<footer class="tp-dialog__f">' + o.actions + '</footer>' : '') + '</div></div>';
};

/* Barre du salon du Hub (40 px max) : { game, code, players, max } */
T.LobbyBar = function (o) {
  o = o || {};
  return '<header class="tp-lobbybar" data-zone="lobby">' +
    '<div class="tp-lobbybar__l"><b class="tp-lobbybar__game title-sm">' + esc(o.game || '') + '</b>' +
    '<span class="tp-lobbybar__code caption">Salon <b class="tp-num" aria-label="code ' + esc((o.code || '').split('').join(' ')) + '">' + esc(o.code || '') + '</b></span>' +
    (o.players != null ? '<span class="tp-lobbybar__n caption">' + T.icon('user') + esc(o.players) + (o.max ? '/' + esc(o.max) : '') + '</span>' : '') + '</div>' +
    '<div class="tp-lobbybar__r">' + T.Button({ variant: 'ghost', icon: 'copy', label: 'Copier le lien', className: 'tp-btn--bar', attrs: { 'data-action': 'copy-link' } }) +
    T.Button({ variant: 'ghost', icon: 'back', label: 'Retour au salon', className: 'tp-btn--bar', attrs: { 'data-action': 'lobby' } }) +
    T.Button({ variant: 'ghost', icon: 'exit', label: 'Quitter', className: 'tp-btn--bar tp-btn--quit', attrs: { 'data-action': 'quit' } }) + '</div></header>';
};

/* Outils de la zone (haut droite) : journal, scores, règles, animations. */
T.Tools = function (o) {
  o = o || {};
  var list = o.buttons || ['journal', 'regles', 'animations'];
  var B = {
    journal: { icon: 'log', label: 'Journal', attrs: { 'data-open': 'journal', 'aria-controls': 'journal' } },
    scores: { icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores', 'aria-controls': 'scores' } },
    regles: { icon: 'book', label: 'Règles', attrs: { 'data-open': 'regles' } },
    dernier: { icon: 'eye', label: 'Voir le dernier pli', attrs: { 'data-open': 'dernier-pli' } }
  };
  return '<nav class="tp-tools" aria-label="Outils">' + list.map(function (k) {
    if (k === 'animations') return T.MotionToggle();
    return T.Button(Object.assign({ variant: 'icon' }, B[k]));
  }).join('') + '</nav>';
};

/* Écran de fin : { result: 'victoire' | 'defaite' | 'fin', title, subtitle, recap: [[libellé, valeur]], ranking: [{ name, score, me, note }], actions } */
T.EndScreen = function (o) {
  o = o || {};
  var r = o.result || 'fin', icon = r === 'defaite' ? 'skull' : r === 'victoire' ? 'crown' : 'trophy';
  return '<div class="' + cx('tp-end', o.className) + '" data-result="' + esc(r) + '" data-zone="end" role="dialog" aria-modal="true" aria-labelledby="tp-end-t">' +
    '<div class="tp-end__glow" aria-hidden="true"></div>' +
    '<div class="tp-end__card"><span class="tp-end__emblem">' + T.icon(icon) + '</span>' +
    '<h2 class="title-xl" id="tp-end-t">' + rich(o.title || (r === 'victoire' ? 'Victoire' : r === 'defaite' ? 'Défaite' : 'Fin de partie')) + '</h2>' +
    (o.subtitle ? '<p class="tp-end__sub body">' + rich(o.subtitle) + '</p>' : '') +
    (o.extra || '') +
    (o.recap ? '<dl class="tp-end__recap">' + o.recap.map(function (x) { return '<div><dt class="label">' + rich(x[0]) + '</dt><dd class="stat tp-num">' + rich(x[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
    (o.ranking ? '<ol class="tp-rank">' + o.ranking.map(function (p, i) {
      return '<li' + attrs({ class: 'tp-rank__r', 'data-me': p.me ? '' : null, 'data-first': i === 0 ? '' : null }) + '><span class="tp-rank__pos stat">' + (i + 1) + '</span>' + T.Avatar({ name: p.name, src: p.avatar, size: 'sm' }) +
        '<b class="tp-rank__n title-sm">' + esc(p.name) + (p.me ? ' <span class="caption">(toi)</span>' : '') + '</b>' + (p.note ? '<span class="caption tp-rank__note">' + rich(p.note) + '</span>' : '') +
        '<span class="tp-rank__s stat tp-num">' + rich(p.score) + '</span></li>';
    }).join('') + '</ol>' : '') +
    '<div class="tp-end__act">' + (o.actions || T.Button({ variant: 'secondary', icon: 'back', label: 'Retour au salon' }) + T.Button({ variant: 'primary', icon: 'renew', label: 'Rejouer' })) + '</div></div></div>';
};

/* Main : { cards, size, sort, groups, interactive, label, layout: 'row' | 'fan', multi, id, rows } */
T.Hand = function (o) {
  o = o || {};
  var size = o.size || 'md';
  var cards = o.sort ? T.deck.sort(o.cards || [], o.order) : (o.cards || []);
  var n = cards.length, tracks = [], col = [], prev = null;
  cards.forEach(function (c, i) {
    var s = cardInfo(c).suit; if (s === 'excuse') s = 'atout';
    if (o.groups !== false && prev && s !== prev) tracks.push('minmax(0, var(--hand-gap))');
    tracks.push(i === n - 1 ? 'var(--cw)' : 'minmax(0, var(--step))');
    col.push(tracks.length);
    prev = s;
  });
  var per = Math.ceil(n / 2), t2 = [];
  for (var k = 0; k < per; k++) t2.push(k === per - 1 ? 'var(--cw)' : 'minmax(0, var(--step))');
  var label = (o.label || 'Ta main') + ', ' + n + ' carte' + (n > 1 ? 's' : '');
  var slots = cards.map(function (c, i) {
    var r2 = i < per ? 1 : 2, c2 = i < per ? i + 1 : i - per + 1;
    return '<div class="tp-hand__slot" data-slot="' + i + '" style="--c:' + col[i] + ';--c2:' + c2 + ';--r2:' + r2 + ';--i:' + i + '">' +
      T.Card(Object.assign({ size: size, interactive: o.interactive !== false, attrs: { tabindex: o.interactive !== false ? (i === 0 ? '0' : '-1') : null } }, c)) + '</div>';
  }).join('');
  return '<div' + attrs({
    class: cx('tp-hand', o.className), 'data-zone': 'hand', 'data-layout': o.layout || 'row', 'data-size': size, 'data-multi': o.multi ? '' : null, 'data-few': n <= 7 ? '' : null,
    role: 'group', 'aria-label': label, id: o.id || null,
    style: '--n:' + n + ';--tpl1:' + tracks.join(' ') + ';--tpl2:' + t2.join(' ') + ';--mid:' + ((n - 1) / 2)
  }) + '><div class="tp-hand__grid">' + slots + '</div>' + (o.hint ? '<p class="tp-hand__hint caption">' + rich(o.hint) + '</p>' : '') + '</div>';
};

/* Pli : { plays: [{ pos, card, name, winner }], players, size, label } ; pos = 'bottom' | 'left' | 'top' | 'right' | 'top-left' | 'top-right' */
T.Trick = function (o) {
  o = o || {};
  return '<div' + attrs({ class: cx('tp-trick', o.className), 'data-zone': 'trick', 'data-players': o.players || null, role: 'group', 'aria-label': o.label || 'Pli en cours' }) + '>' +
    (o.plays || []).map(function (p) {
      var st = p.winner ? 'winner' : '';
      return '<div class="tp-trick__p" data-pos="' + esc(p.pos) + '" data-seat="' + esc(p.seat != null ? p.seat : p.pos) + '" data-slot="trick-' + esc(p.pos) + '">' +
        (p.card ? T.Card(Object.assign({ size: o.size || 'md', state: st }, p.card)) : T.Slot({ size: o.size || 'md' })) +
        (p.name ? '<span class="tp-trick__n caption">' + (p.winner ? T.icon('crown') : '') + esc(p.name) + '</span>' : '') + '</div>';
    }).join('') +
    (o.center ? '<div class="tp-trick__c">' + o.center + '</div>' : '') + '</div>';
};

/* =====================================================================
   La Chute des Rois (table « cour »)
   ===================================================================== */
var POWERS = {
  coeur: { name: 'Soin', text: 'N cartes de la défausse repassent sous la Taverne.', icon: 'heal' },
  carreau: { name: 'Pioche', text: 'L’équipe pioche N cartes à tour de rôle.', icon: 'draw' },
  trefle: { name: 'Double', text: 'Les dégâts de la carte sont doublés.', icon: 'double' },
  pique: { name: 'Bouclier', text: 'L’attaque du boss baisse de N, cumulatif.', icon: 'shield' }
};
T.powers = POWERS;
var BOSS_STATS = { V: { hp: 20, atk: 10 }, D: { hp: 30, atk: 15 }, R: { hp: 40, atk: 20 } };
T.bossStats = BOSS_STATS;

/* Légende des 4 pouvoirs, posée sur le tapis. immune : couleur du boss (pouvoir barré). */
T.PowerLegend = function (o) {
  o = o || {};
  return '<ul class="tp-powers" data-zone="powers" aria-label="Pouvoirs des couleurs">' + ['coeur', 'carreau', 'trefle', 'pique'].map(function (s) {
    var p = POWERS[s], off = o.immune === s;
    return '<li' + attrs({ class: 'tp-power', 'data-suit': s, 'data-immune': off ? '' : null }) + '>' +
      '<span class="tp-power__g">' + T.icon(s, { className: 'tp-suit-' + s }) + '</span>' +
      '<span class="tp-power__t"><b class="button">' + esc(p.name) + (off ? ' <span class="tp-power__x caption">' + T.icon('immune') + 'annulé</span>' : '') + '</b>' +
      (o.compact ? '' : '<span class="caption">' + esc(p.text) + '</span>') + '</span></li>';
  }).join('') + '</ul>';
};

/* Progression des 12 souverains : fallen = [{ id, ko }], current = id ('V-coeur'). */
T.Sovereigns = function (o) {
  o = o || {};
  var order = [];
  ['V', 'D', 'R'].forEach(function (r) { SUITS4.forEach(function (s) { order.push(r + '-' + s); }); });
  var fallen = {};
  (o.fallen || []).forEach(function (f) { if (typeof f === 'string') f = { id: f }; fallen[f.id] = f.ko ? 'ko' : 'down'; });
  var done = Object.keys(fallen).length;
  return '<ol class="tp-sov" data-zone="sovereigns" aria-label="Souverains : ' + done + ' tombé' + (done > 1 ? 's' : '') + ' sur 12">' + order.map(function (id) {
    var c = cardInfo(id), st = fallen[id] || (id === o.current ? 'current' : 'next');
    var txt = c.label + (st === 'ko' ? ', K.O., dans la Taverne' : st === 'down' ? ', vaincu' : st === 'current' ? ', en jeu' : '');
    return '<li' + attrs({ class: 'tp-sov__p', 'data-state': st, 'data-suit': c.suit, title: txt }) + '><span class="tp-vh">' + esc(txt) + '</span>' +
      '<b aria-hidden="true">' + c.rank + '</b>' + T.icon(c.suit) + (st === 'down' || st === 'ko' ? '<i class="tp-sov__x" aria-hidden="true">' + T.icon(st === 'ko' ? 'tavern' : 'cross') + '</i>' : '') + '</li>';
  }).join('') + '</ol>';
};

/*
  Le boss : { card: { suit, rank }, hp, hpMax, atk, shield, size, layout: 'row' | 'stack' }
  Immunité automatique : le boss est immunisé au pouvoir de sa propre couleur.
*/
T.Boss = function (o) {
  o = o || {};
  var c = cardInfo(o.card || { suit: 'coeur', rank: 'D' });
  var st = BOSS_STATS[c.rank] || { hp: 20, atk: 10 };
  var hpMax = o.hpMax || st.hp, hp = o.hp != null ? o.hp : hpMax, atk = o.atk != null ? o.atk : st.atk, sh = o.shield || 0;
  var eff = Math.max(0, atk - sh), pw = POWERS[c.suit];
  var atkTxt = sh ? atk + ' − ' + sh + ' = ' + eff : String(atk);
  return '<section' + attrs({ class: cx('tp-boss', o.className), 'data-zone': 'boss', 'data-suit': c.suit, 'data-layout': o.layout || 'row', 'aria-label': 'Boss : ' + c.label + ', ' + hp + ' points de vie sur ' + hpMax + ', attaque ' + eff }) + '>' +
    '<div class="tp-boss__card" data-slot="boss">' + T.Card({ suit: c.suit, rank: c.rank, size: o.size || 'lg', id: 'boss-' + c.id }) + '</div>' +
    '<div class="tp-boss__info">' +
      '<div class="tp-boss__name"><span class="label">' + esc({ V: 'Valet', D: 'Dame', R: 'Roi' }[c.rank] || '') + ' · ' + esc(c.name || '') + '</span><h2 class="title-lg">' + esc(c.label) + '</h2></div>' +
      '<div class="tp-boss__hp">' + T.Gauge({ value: hp, max: hpMax, tone: 'hp', label: 'Points de vie', size: 'lg' }) + '</div>' +
      '<div class="tp-boss__stats">' +
        '<div class="tp-boss__atk" data-zone="atk">' + T.icon('sword') + '<span class="caption">Attaque</span><b class="stat tp-num">' + esc(atkTxt) + '</b></div>' +
        (sh ? '<div class="tp-boss__shield" data-zone="shield">' + T.icon('shield') + '<span class="caption">Bouclier {pique}</span><b class="stat tp-num">' + sh + '</b></div>' : '') +
      '</div>' +
      '<p class="tp-boss__immune caption">' + T.icon('immune') + rich('Immunisé à {' + c.suit + '} : ' + pw.name + ' annulé') + '</p>' +
    '</div></section>';
};

/* Aperçu d'une sélection : { cards, text, valid, detail } */
T.ComboPreview = function (o) {
  o = o || {};
  var ok = o.valid !== false;
  return '<div' + attrs({ class: cx('tp-preview', ok ? 'tp-preview--ok' : 'tp-preview--bad'), role: 'status', 'aria-live': 'polite', 'data-zone': 'preview' }) + '>' +
    T.icon(ok ? 'bolt' : 'warning') + '<span class="tp-preview__t body-strong">' + rich(o.text || '') + '</span>' + (o.detail ? '<span class="tp-preview__d caption">' + rich(o.detail) + '</span>' : '') + '</div>';
};

/* Riposte : jauge des points défaussés. { paid, need, name } */
T.Ripost = function (o) {
  o = o || {};
  var ok = (o.paid || 0) >= o.need;
  return '<div class="tp-ripost" data-zone="ripost" data-ok="' + ok + '">' +
    '<p class="tp-ripost__t status">' + T.icon('warning') + rich(o.text || ('Encaisse ' + o.need + ' : défausse des cartes pour couvrir l’attaque')) + '</p>' +
    T.Gauge({ value: o.paid || 0, max: o.need, tone: 'pay', text: (o.paid || 0) + '/' + o.need + ' points défaussés', label: 'Riposte' }) + '</div>';
};

/* =====================================================================
   Tarot (table « salon »)
   ===================================================================== */
var BIDS = [
  { id: 'passe', label: 'Passe' },
  { id: 'petite', label: 'Petite', mult: 1 },
  { id: 'garde', label: 'Garde', mult: 2 },
  { id: 'garde-sans', label: 'Garde sans le chien', mult: 4 },
  { id: 'garde-contre', label: 'Garde contre le chien', mult: 6 }
];
T.bids = BIDS;
function bidLabel(id) { var b = BIDS.filter(function (x) { return x.id === id; })[0]; return b ? b.label : id; }
T.bidLabel = bidLabel;

/* Panneau d'enchères : { current: 'garde', by: 'Léa', mine: true, turn } — seules les enchères supérieures sont jouables. */
T.BidPanel = function (o) {
  o = o || {};
  var curI = -1;
  BIDS.forEach(function (b, i) { if (b.id === o.current) curI = i; });
  var btns = BIDS.map(function (b, i) {
    if (b.id === 'passe') return T.Button({ variant: 'secondary', label: 'Passe', attrs: { 'data-bid': 'passe' } });
    var low = i <= curI;
    return T.Button({ variant: 'secondary', className: 'tp-bid', label: b.label + ' <i>×' + b.mult + '</i>', disabled: low, attrs: { 'data-bid': b.id, title: low ? 'Inférieure ou égale à ' + bidLabel(o.current) : null } });
  }).join('').replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, '<i class="tp-bid__x">$1</i>');
  return '<section class="tp-panel tp-bids" data-zone="bids" aria-labelledby="tp-bids-h">' +
    '<header class="tp-panel__h"><h2 class="title-md" id="tp-bids-h">' + (o.mine ? 'À toi d’annoncer' : 'Enchères') + '</h2>' +
    '<span class="caption">' + (o.current ? 'Plus haute : <b>' + esc(bidLabel(o.current)) + '</b> (' + esc(o.by || '') + ')' : 'Personne n’a encore pris') + '</span></header>' +
    '<div class="tp-bids__row">' + btns + '</div></section>';
};

/* Appel au Roi : { rank: 'R' | 'D', selected } */
T.KingCall = function (o) {
  o = o || {};
  var rank = o.rank || 'R';
  return '<section class="tp-panel tp-kingcall" data-zone="kingcall" aria-labelledby="tp-kc-h">' +
    '<header class="tp-panel__h"><h2 class="title-md" id="tp-kc-h">Appelle ' + (rank === 'R' ? 'un Roi' : 'une Dame') + '</h2>' +
    '<span class="caption">' + (rank === 'R' ? 'Celui qui l’a sera ton partenaire secret.' : 'Tu as les 4 Rois : appelle une Dame.') + '</span></header>' +
    '<div class="tp-kingcall__row" role="radiogroup" aria-label="Carte appelée">' + SUITS4.map(function (s) {
      var sel = o.selected === s;
      return '<button' + attrs({ type: 'button', class: 'tp-kingcall__b', role: 'radio', 'aria-checked': String(sel), 'data-call': s }) + '>' + T.Card({ suit: s, rank: rank, size: 'sm', state: sel ? 'selected' : '' }) + '<span class="caption">' + esc(RANK_NAME[rank] + ' de ' + SUIT_NAME[s]) + '</span></button>';
    }).join('') + '</div>' +
    '<div class="tp-panel__f">' + T.Button({ variant: 'primary', icon: 'crown', label: o.selected ? 'Appeler le ' + RANK_NAME[rank] + ' de ' + SUIT_NAME[o.selected] : 'Choisis une couleur', disabled: !o.selected }) + '</div></section>';
};

/* Bandeau du contrat : { taker, bid, called: 'coeur', calledRank, partner } */
T.Contract = function (o) {
  o = o || {};
  var call = o.called ? ', ' + (o.calledRank === 'D' ? 'Dame' : 'Roi') + ' de {' + o.called + '} appelé' : '';
  return '<div class="tp-contract" data-zone="contract" role="status">' + T.icon('flag') +
    '<span class="tp-contract__t body-strong">' + rich(bidLabel(o.bid) + ' de ' + (o.taker || '') + call) + '</span>' +
    (o.partner ? '<span class="tp-contract__p caption">' + T.icon('pair') + rich('Partenaire : ' + o.partner) + '</span>' : (o.called ? '<span class="tp-contract__p caption">' + T.icon('lock') + 'Partenaire inconnu</span>' : '')) + '</div>';
};

/* Écart guidé : { done, need, canValidate } */
T.EcartGuide = function (o) {
  o = o || {};
  var ok = o.done === o.need;
  return '<section class="tp-panel tp-ecart" data-zone="ecart"><header class="tp-panel__h"><h2 class="title-md">Écarte ' + o.need + ' cartes</h2>' +
    '<span class="caption">Ni Roi ni bout. Les cartes du chien sont marquées.</span></header>' +
    T.Gauge({ value: o.done, max: o.need, tone: 'accent', text: o.done + '/' + o.need, label: 'Écart' }) +
    '<div class="tp-panel__f">' + T.Button({ variant: 'primary', icon: 'check', label: 'Valider l’écart', disabled: !ok, reason: ok ? null : 'Choisis encore ' + (o.need - o.done) + ' carte' + (o.need - o.done > 1 ? 's' : '') }) + '</div></section>';
};

/* Poignées : seuils selon le nombre de joueurs. */
var HANDFULS = { 3: [13, 15, 18], 4: [10, 13, 15], 5: [8, 10, 13] };
T.handfuls = HANDFULS;
/* Annonce de poignée : { players, trumps, chosen } */
T.HandfulPrompt = function (o) {
  o = o || {};
  var th = HANDFULS[o.players || 4], n = o.trumps || 0;
  var names = ['Simple', 'Double', 'Triple'], pts = [20, 30, 40];
  return '<section class="tp-panel tp-handful" data-zone="handful"><header class="tp-panel__h"><h2 class="title-md">Annoncer une poignée ?</h2>' +
    '<span class="caption">Tu as ' + n + ' atouts. À annoncer avant ta première carte.</span></header><div class="tp-bids__row">' +
    names.map(function (nm, i) {
      var can = n >= th[i];
      return T.Button({ variant: 'secondary', label: nm + ' (' + th[i] + ' atouts, ' + pts[i] + ' pts)', disabled: !can, attrs: { 'data-handful': nm.toLowerCase() }, pressed: o.chosen === nm.toLowerCase() });
    }).join('') + T.Button({ variant: 'ghost', label: 'Ne rien annoncer' }) + '</div></section>';
};
/* Poignée montrée à tous : { name, type, cards } */
T.HandfulShow = function (o) {
  o = o || {};
  return '<section class="tp-panel tp-handshow" data-zone="handful-show" aria-label="Poignée de ' + esc(o.name) + '"><header class="tp-panel__h"><h2 class="title-md">' + rich('Poignée ' + (o.type || 'simple') + ' de ' + o.name) + '</h2><span class="caption">' + (o.cards || []).length + ' atouts montrés</span></header>' +
    '<div class="tp-handshow__cards">' + (o.cards || []).map(function (c) { return T.Card(Object.assign({ size: 'sm' }, c)); }).join('') + '</div></section>';
};

/* Note privée du partenaire secret (visible par lui seul). */
T.PartnerNote = function (o) {
  o = o || {};
  return '<div class="tp-secret" data-zone="secret" role="note">' + T.icon('lock') + '<span><b class="body-strong">Tu es le partenaire secret</b><span class="caption">' + rich(o.text || 'Tu as le Roi appelé. Personne ne le sait avant qu’il tombe.') + '</span></span></div>';
};

/* Feuille de scores : { players: [noms], rows: [{ deal, taker, bid, made, diff, gains: [n] }], me } */
T.ScoreSheet = function (o) {
  o = o || {};
  var P = o.players || [];
  var tot = P.map(function () { return 0; });
  var rows = (o.rows || []).map(function (r) {
    r.gains.forEach(function (g, i) { tot[i] += g; });
    return '<tr><th scope="row" class="tp-num">' + r.deal + '</th><td>' + esc(r.taker) + '<span class="caption"> · ' + esc(bidLabel(r.bid)) + '</span></td>' +
      '<td class="tp-ss__res" data-made="' + !!r.made + '">' + T.icon(r.made ? 'check' : 'cross') + (r.made ? 'Réussi' : 'Chuté') + (r.diff != null ? ' <span class="caption tp-num">(' + (r.diff > 0 ? '+' : '') + r.diff + ')</span>' : '') + '</td>' +
      r.gains.map(function (g, i) { return '<td class="tp-num" data-me="' + (P[i] === o.me) + '" data-sign="' + (g > 0 ? '+' : g < 0 ? '-' : '0') + '">' + (g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g) + '</td>'; }).join('') + '</tr>';
  }).join('');
  return '<table class="tp-ss"><caption class="tp-vh">Feuille de scores</caption><thead><tr><th scope="col">Donne</th><th scope="col">Contrat</th><th scope="col">Résultat</th>' +
    P.map(function (p) { return '<th scope="col"' + (p === o.me ? ' data-me="true"' : '') + '>' + esc(p) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><th scope="row" colspan="3">Total</th>' + tot.map(function (t, i) { return '<td class="tp-num stat" data-me="' + (P[i] === o.me) + '">' + (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) + '</td>'; }).join('') + '</tr></tfoot></table>';
};

/* Résumé de donne : { taker, bid, bouts, need, made, base, petitAuBout, handful, mult, gains: [{ name, pts }] } */
var NEED = [56, 51, 41, 36];
T.tarotNeed = NEED;
T.DealSummary = function (o) {
  o = o || {};
  var need = NEED[o.bouts || 0], diff = o.made - need, ok = diff >= 0;
  var mult = o.mult || 1;
  var lines = [
    ['Contrat', rich(bidLabel(o.bid) + ' de ' + o.taker + ' (×' + mult + ')')],
    ['Bouts', (o.bouts || 0) + ' → ' + need + ' points requis'],
    ['Points réalisés', '<b class="tp-num">' + o.made + '</b> sur 91'],
    ['Écart au contrat', '<b class="tp-num">' + (diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.abs(diff) + '</b>'],
    ['Base', '25 + ' + Math.abs(diff) + ' = <b class="tp-num">' + (25 + Math.abs(diff)) + '</b>'],
    ['× contrat', '<b class="tp-num">' + ((25 + Math.abs(diff)) * mult) + '</b>']
  ];
  if (o.petitAuBout) lines.push(['Petit au bout', rich(o.petitAuBout)]);
  if (o.handful) lines.push(['Poignée', rich(o.handful)]);
  return '<div class="tp-deal" data-zone="deal-summary" data-made="' + ok + '">' +
    '<p class="tp-deal__verdict title-md">' + T.icon(ok ? 'check' : 'cross') + (ok ? 'Contrat réussi' : 'Contrat chuté') + '</p>' +
    '<dl class="tp-deal__lines">' + lines.map(function (l) { return '<div class="tp-deal__l"><dt class="caption">' + l[0] + '</dt><dd class="body">' + l[1] + '</dd></div>'; }).join('') + '</dl>' +
    '<ul class="tp-deal__gains">' + (o.gains || []).map(function (g) {
      return '<li data-sign="' + (g.pts > 0 ? '+' : '-') + '"' + (g.me ? ' data-me' : '') + '>' + T.Avatar({ name: g.name, size: 'sm' }) + '<span class="body">' + esc(g.name) + (g.role ? ' <span class="caption">' + esc(g.role) + '</span>' : '') + '</span><b class="stat tp-num">' + (g.pts > 0 ? '+' : '−') + Math.abs(g.pts) + '</b></li>';
    }).join('') + '</ul></div>';
};

/* =====================================================================
   Règles illustrées (4 onglets par jeu)
   ===================================================================== */
function mini(cards, size) { return '<div class="tp-rules__cards">' + cards.map(function (c) { return T.Card(Object.assign({ size: size || 'sm' }, c)); }).join('') + '</div>'; }
function para(list) { return list.map(function (t) { return '<p class="body">' + rich(t) + '</p>'; }).join(''); }
T.Rules = function (o) {
  o = o || {};
  var tabs;
  if (o.game === 'salon') {
    tabs = [
      { id: 'but', label: 'But', body: '<div class="tp-rules__g"><div>' + para(['Le preneur, seul (ou avec son partenaire à 5), doit marquer assez de points dans ses plis. Les autres défendent ensemble.', 'Les points requis dépendent des **bouts** gagnés : 0 bout, 56 ; 1 bout, 51 ; 2 bouts, 41 ; 3 bouts, 36.'.replace(/\*\*/g, ''), 'Une donne par joueur, puis classement final.']) + '</div>' + mini([{ suit: 'atout', rank: 1 }, { suit: 'atout', rank: 21 }, { suit: 'excuse' }]) + '</div>' },
      { id: 'encheres', label: 'Enchères', body: '<div class="tp-rules__g"><div>' + para(['Chacun parle une fois : Passe, Petite (×1), Garde (×2), Garde sans le chien (×4), Garde contre le chien (×6). Seule une enchère plus haute est possible.', 'À 5, le preneur appelle un Roi : son détenteur devient son partenaire secret jusqu’à ce que la carte tombe.']) + '</div>' + mini([{ suit: 'coeur', rank: 'R' }, { suit: 'pique', rank: 'R' }]) + '</div>' },
      { id: 'chien', label: 'Chien et poignées', body: '<div class="tp-rules__g"><div>' + para(['Petite et Garde : le chien est montré à tous, puis le preneur le prend et écarte autant de cartes, ni Roi ni bout.', 'Garde sans : le chien reste caché et compte pour le preneur. Garde contre : il va à la défense.', 'Poignée : 10, 13 ou 15 atouts à 4 joueurs, montrés avant ta première carte.']) + '</div>' + mini([{ suit: 'carreau', rank: 3, tag: 'Chien' }, { suit: 'atout', rank: 9, tag: 'Chien' }]) + '</div>' },
      { id: 'plis', label: 'Plis et points', body: '<div class="tp-rules__g"><div>' + para(['Fournis la couleur demandée. Sinon, coupe avec un atout, et monte sur l’atout le plus fort. L’Excuse peut se jouer à tout moment, ne gagne jamais et revient à son camp.', 'Points : bout et Roi 4,5 ; Dame 3,5 ; Cavalier 2,5 ; Valet 1,5 ; autre carte 0,5.', 'Score : 25 + l’écart, × le contrat, + Petit au bout et poignées.']) + '</div>' + mini([{ suit: 'pique', rank: 'R' }, { suit: 'pique', rank: 'D' }, { suit: 'pique', rank: 'C' }, { suit: 'pique', rank: 'V' }]) + '</div>' }
    ];
  } else {
    tabs = [
      { id: 'but', label: 'But', body: '<div class="tp-rules__g"><div>' + para(['Ensemble, renversez les 12 souverains du Château : 4 Valets (20 PV, attaque 10), 4 Dames (30 PV, 15), 4 Rois (40 PV, 20).', 'Main de 8, 7, 6 ou 5 cartes selon 1, 2, 3 ou 4 joueurs. La Taverne est votre pioche.']) + '</div>' + mini([{ suit: 'pique', rank: 'V' }, { suit: 'coeur', rank: 'D' }, { suit: 'trefle', rank: 'R' }]) + '</div>' },
      { id: 'tour', label: 'Ton tour', body: '<div class="tp-rules__g"><div>' + para(['Joue une carte ou un combo, ou passe.', 'Combo : un As + une carte, ou plusieurs cartes de même rang dont le total fait 10 au plus.', 'Les figures jouées valent 10, 15 et 20.']) + '</div>' + '<div>' + mini([{ suit: 'coeur', rank: 'A' }, { suit: 'trefle', rank: 7 }]) + mini([{ suit: 'pique', rank: 3 }, { suit: 'carreau', rank: 3 }, { suit: 'trefle', rank: 3 }]) + '</div></div>' },
      { id: 'pouvoirs', label: 'Pouvoirs', body: T.PowerLegend({}) + para(['Le boss est **immunisé** au pouvoir de sa propre couleur.'.replace(/\*\*/g, '')]) },
      { id: 'boss', label: 'Le boss', body: '<div class="tp-rules__g"><div>' + para(['Boss à 0 PV pile : K.O. Il rejoint la Taverne et pourra être joué.', 'Au-delà de 0 : il part à la défausse.', 'Sinon, il riposte : défausse des cartes dont le total couvre son attaque, ou l’équipe perd.', 'En solo : 2 Renouveaux (jeter ta main et repiocher).']) + '</div>' + mini([{ suit: 'carreau', rank: 'D' }]) + '</div>' }
    ];
  }
  return T.Dialog({ id: o.id || 'regles', kicker: o.game === 'salon' ? 'Tarot' : 'La Chute des Rois', title: 'Règles', tabs: tabs, tab: o.tab, size: 'lg' });
};

/* =====================================================================
   Données d'exemple et écrans de référence.
   Tapis.data : joueurs et mains de démonstration (pas la source de vérité des règles).
   Tapis.screens.cour.* / Tapis.screens.salon.* : écrans complets (chaînes HTML).
   Tapis.screens.sheet(root, 'cour.attaque') : l'écran aux trois tailles.
   ===================================================================== */
function cs(str) {
  /* 'R♥ 7♣ A♠ 10♦ 21 E' → cartes */
  return str.split(/\s+/).filter(Boolean).map(function (t) {
    if (t === 'E') return { suit: 'excuse' };
    if (/^\d+$/.test(t)) return { suit: 'atout', rank: +t };
    var g = t.slice(-1), r = t.slice(0, -1);
    var s = { '♠': 'pique', '♥': 'coeur', '♦': 'carreau', '♣': 'trefle' }[g];
    return { suit: s, rank: /^\d+$/.test(r) ? +r : r };
  });
}
T.cards = cs;
function mark(cards, ids, extra) {
  return cards.map(function (c) { var id = cardInfo(c).id; return ids.indexOf(id) >= 0 ? Object.assign({}, c, extra) : c; });
}
T.data = {
  me: 'Light',
  players: ['Light', 'Léa', 'Malo', 'Inès', 'Yanis'],
  hands: {
    cour4: cs('7♣ A♥ 9♠ 4♦ V♣'),
    cour1: cs('2♠ 6♠ A♥ 8♥ 3♣ 7♣ 5♦ 10♦'),
    tarot18: cs('3♠ 7♠ R♠ 2♥ 9♥ C♥ D♥ 5♣ V♣ 4♦ 8♦ 1 6 11 14 17 19 E'),
    tarot15: cs('R♠ 5♠ V♥ 9♥ 3♣ D♣ R♣ 8♦ R♦ 2 5 12 16 20 21'),
    tarot24: cs('2♠ 6♠ 9♠ D♠ 4♥ 7♥ V♥ R♥ 3♣ 8♣ C♣ 1♦ 5♦ 10♦ 1 3 4 8 10 13 15 18 21 E')
  },
  chien4: cs('5♥ R♦ 9♣ 2 7 C♠')
};

var VP = {
  pc: { w: 1920, h: 972, label: '1920 × 1080', note: 'fenêtre 1920 × 972, zone 1888 × 900' },
  laptop: { w: 1366, h: 657, label: '1366 × 768', note: 'fenêtre 1366 × 657, zone 1334 × 585' },
  mobile: { w: 390, h: 760, label: '390 px', note: 'téléphone, 390 × 760' }
};
var S = T.screens = { vp: VP, cour: {}, salon: {} };

function area(name, html, extra) { return '<div class="tp-area" data-area="' + name + '" style="grid-area:' + name + '"' + (extra || '') + '>' + (html || '') + '</div>'; }
var CASTLE = (function () {
  var d = 'M0 120V96h40V84h6v6h6v-6h6v6h6v-6h6v12h80V60h8v8h8v-8h8v8h8v-8h8v36h60V40h10v10h10V40h10v10h10V40h10v56h70V22h12v12h12V22h12v12h12V22h12v74h50V0h6l18 12-18 8v6h14v10h12v-10h12v10h12v60h60V22h12v12h12V22h12v12h12V22h12v74h70V40h10v10h10V40h10v10h10V40h10v56h60V60h8v8h8v-8h8v8h8v-8h8v36h80V84h6v6h6v-6h6v6h6v-6h6v12h40v24z';
  return '<svg class="tp-decor__castle" viewBox="0 0 1100 120" aria-hidden="true"><path d="' + d + '" fill="currentColor"/></svg>';
})();
var THRONE = '<svg class="tp-decor__throne" viewBox="0 0 200 160" aria-hidden="true" fill="none" stroke="currentColor"><path d="M14 160V72Q14 12 100 4q86 8 86 68v88" stroke-width="2"/><path d="M28 160V76q0-50 72-58 72 8 72 58v84" stroke-width="1"/><path d="M84 6l6-8 4 6 6-10 6 10 4-6 6 8" stroke-width="1.6"/><path d="M0 160h200" stroke-width="2"/></svg>';
function decor(kind) {
  if (kind === 'cour') return '<div class="tp-decor" aria-hidden="true">' + CASTLE + '</div>';
  return '<div class="tp-decor" aria-hidden="true"><div class="tp-decor__lamp" style="position:absolute"></div><div class="tp-decor__ring" style="position:absolute"></div></div>';
}
/* Écran complet : barre du salon + zone. */
S.app = function (o) {
  o = o || {};
  var t = o.table || 'cour';
  return '<div class="tp-app" data-table="' + t + '" data-theme="' + t + '"' + (o.deck4 ? ' data-deck="4"' : '') + (o.size ? ' style="width:' + o.size.w + 'px;height:' + o.size.h + 'px"' : '') + '>' +
    T.LobbyBar({ game: o.game || (t === 'salon' ? 'Tarot' : 'La Chute des Rois'), code: o.code || 'RCBP', players: o.players, max: o.max }) +
    '<main class="tp-zone" data-zone="game" aria-label="Table de jeu">' + decor(t) + (o.body || '') +
    T.Tools({ buttons: o.tools || (t === 'salon' ? ['journal', 'scores', 'regles', 'animations'] : ['journal', 'regles', 'animations']) }) +
    (o.toasts ? T.Toasts(o.toasts) : '') + (o.drawers || '') + (o.overlay || '') + '</main></div>';
};

/* ---------- La Chute des Rois ---------- */
function courTable(st) {
  var players = st.players || 4;
  var team = (st.team || []).map(function (p) { return T.Seat(Object.assign({ count: p.count, playedLabel: 'Contre ce boss' }, p)); }).join('');
  var boss = st.boss || {};
  var mine = '<div class="tp-mine" data-zone="mine"><span class="tp-mine__l label">Mes cartes posées</span><div class="tp-mine__c">' +
    ((st.mine && st.mine.length) ? st.mine.map(function (c) { return T.Card(Object.assign({ size: 'sm' }, c)); }).join('') : '<span class="tp-mine__empty caption">Aucune contre ce boss</span>') + '</div></div>';
  var meSeat = T.Seat({ name: T.data.me, me: true, state: st.myTurn ? 'active' : 'waiting', count: (st.hand || []).length, compact: true, badges: st.meBadges });
  var status = (st.status ? T.Status(st.status) : '') + (st.preview ? T.ComboPreview(st.preview) : '') + (st.ripost ? T.Ripost(st.ripost) : '');
  return '<div class="tp-table tp-table--cour" data-players="' + players + '">' +
    area('team', team) +
    area('castle', T.Pile({ pile: 'chateau', count: st.castle, size: 'sm', hint: st.castleHint }) + T.PowerLegend({ immune: cardInfo(boss.card).suit, compact: st.compactLegend })) +
    area('boss', '<div class="tp-decor tp-decor--boss" aria-hidden="true">' + THRONE + '</div>' + T.Sovereigns(st.sov || {}) + T.Boss(boss)) +
    area('piles', T.Pile({ pile: 'taverne', count: st.taverne, size: 'sm' }) + T.Pile({ pile: 'defausse', count: (st.defausse || {}).count || 0, top: (st.defausse || {}).top, size: 'sm' })) +
    area('mine', mine + meSeat) +
    area('status', status) +
    area('hand', T.Hand({ cards: st.hand || [], size: 'md', multi: true, interactive: st.interactive !== false, groups: false })) +
    area('actions', T.ActionBar(st.actions || {})) + '</div>';
}
S.courTable = courTable;
function courBase() {
  return {
    players: 4, castle: 7, taverne: 18,
    defausse: { count: 9, top: { suit: 'pique', rank: 9 } },
    sov: { fallen: [{ id: 'V-pique', ko: true }, 'V-coeur', 'V-carreau', { id: 'V-trefle', ko: true }], current: 'D-carreau' },
    boss: { card: { suit: 'carreau', rank: 'D' }, hp: 17, shield: 4 },
    team: [
      { seat: 1, name: 'Léa', count: 4, state: 'waiting', played: cs('4♠') },
      { seat: 2, name: 'Malo', count: 5, state: 'waiting', played: [], last: 'A passé' },
      { seat: 3, name: 'Inès', count: 3, state: 'waiting', played: cs('7♥') }
    ],
    mine: cs('2♦'),
    hand: T.data.hands.cour4
  };
}
S.cour.attaque = function () {
  var st = courBase();
  st.myTurn = true;
  st.hand = mark(st.hand, ['7-trefle', 'A-coeur'], { selected: true });
  st.status = { tone: 'turn', text: 'À toi de jouer', detail: 'Tour 14' };
  st.preview = { text: '7 {trefle} + As {coeur} : 16 dégâts, soigne 8', detail: 'Il restera 1 PV à la Dame' };
  st.actions = { primary: { label: 'Attaquer · 16', icon: 'sword', kbd: 'Entrée' }, secondary: [{ label: 'Passer', icon: 'pass' }] };
  return st;
};
S.cour.riposte = function () {
  var st = courBase();
  st.myTurn = true;
  st.boss.hp = 9;
  st.mine = cs('2♦ 7♣');
  st.hand = mark(cs('A♥ 9♠ 4♦ V♣'), ['A-coeur'], { selected: true });
  st.hand = mark(st.hand, ['4-carreau'], { selected: true });
  st.hand[0].selected = true;
  st.ripost = { need: 11, paid: 5, text: 'La Dame de Carreau riposte : encaisse 11' };
  st.status = { tone: 'alert', text: 'Riposte sur toi', detail: 'Attaque 15 − 4 = 11' };
  st.actions = { primary: { label: 'Encaisser', icon: 'shield', disabled: true, reason: 'Il manque 6 points (5/11)' }, note: 'Sélectionne des cartes dont le total couvre 11.' };
  return st;
};
S.cour.equipier = function () {
  var st = courBase();
  st.team[0].state = 'active';
  st.team[0].bubble = { text: 'Joue 8 {pique} : bouclier +8' };
  st.team[0].played = cs('4♠ 8♠');
  st.boss.shield = 12; st.boss.hp = 9;
  st.status = { tone: 'wait', text: 'Léa joue…', detail: 'Tu joues après Malo' };
  st.interactive = false;
  st.actions = { primary: { label: 'Attaquer', icon: 'sword', disabled: true, reason: 'Ce n’est pas ton tour' }, secondary: [{ label: 'Passer', icon: 'pass', disabled: true }] };
  return st;
};
S.cour.solo = function () {
  return {
    players: 1, castle: 9, taverne: 30, myTurn: true,
    defausse: { count: 4, top: { suit: 'trefle', rank: 6 } },
    sov: { fallen: ['V-pique', 'V-coeur'], current: 'V-carreau' },
    boss: { card: { suit: 'carreau', rank: 'V' }, hp: 14 },
    team: [], mine: cs('6♣'),
    hand: mark(T.data.hands.cour1, ['8-coeur'], { selected: true }),
    status: { tone: 'turn', text: 'À toi de jouer', detail: 'Solo' },
    preview: { text: '8 {coeur} : 8 dégâts, soigne 8', detail: '8 cartes de la défausse repassent sous la Taverne (4 disponibles)' },
    actions: { primary: { label: 'Attaquer · 8', icon: 'sword' }, secondary: [{ label: 'Passer', icon: 'pass' }, { label: 'Renouveau', icon: 'renew', count: 2 }] }
  };
};
S.cour.immunite = function () {
  var st = courBase();
  st.myTurn = true;
  st.castle = 2;
  st.sov = { fallen: ['V-pique', 'V-coeur', { id: 'V-carreau', ko: true }, 'V-trefle', 'D-pique', { id: 'D-coeur', ko: true }, 'D-carreau', 'D-trefle', 'R-pique'], current: 'R-trefle' };
  st.boss = { card: { suit: 'trefle', rank: 'R' }, hp: 31, shield: 9 };
  st.team[0].played = cs('4♠'); st.team[2].played = cs('5♠');
  st.mine = [];
  st.hand = mark(cs('10♣ 3♥ D♥ 6♦ 9♠'), ['10-trefle'], { selected: true });
  st.status = { tone: 'turn', text: 'À toi de jouer', detail: 'Bouclier cumulé : 4 + 5' };
  st.preview = { valid: false, text: '10 {trefle} : 10 dégâts, Double annulé', detail: 'Le Roi de Trèfle est immunisé au {trefle}' };
  st.actions = { primary: { label: 'Attaquer · 10', icon: 'sword' }, secondary: [{ label: 'Passer', icon: 'pass' }] };
  st.toasts = [{ tone: 'info', title: 'Immunité', text: 'Le Roi de Trèfle annule le pouvoir {trefle}.' }];
  return st;
};
function courScreen(st, extra) {
  extra = extra || {};
  return S.app(Object.assign({ table: 'cour', players: st.players, max: 4, body: courTable(st), toasts: st.toasts }, extra));
}
function courLog() {
  return T.Drawer({ id: 'journal', title: 'Journal', open: true, body: T.Log({ entries: [
    { at: '14', text: 'À toi de jouer.' }, { at: '13', text: 'Inès joue 7 {coeur} : 7 dégâts, soigne 7.' },
    { at: '12', text: 'Malo passe.' }, { at: '11', text: 'Léa joue 4 {pique} : bouclier +4.' },
    { at: '10', text: 'Tu joues 2 {carreau} : 2 dégâts, l’équipe pioche 2.' },
    { at: '9', text: 'Nouveau boss : Dame de Carreau.', tone: 'alert' }, { at: '8', text: 'Valet de Trèfle K.O. : il rejoint la Taverne.', tone: 'good' }
  ] }) });
}
var COUR_SCREENS = {
  attaque: function () { return courScreen(S.cour.attaque()); },
  riposte: function () { return courScreen(S.cour.riposte()); },
  equipier: function () { return courScreen(S.cour.equipier()); },
  solo: function () { return courScreen(S.cour.solo(), { players: 1, max: 1 }); },
  immunite: function () { var st = S.cour.immunite(); return courScreen(st); },
  journal: function () { return courScreen(S.cour.attaque(), { drawers: courLog() }); },
  victoire: function () {
    var st = courBase(); st.sov = { fallen: ['V-pique', 'V-coeur', 'V-carreau', 'V-trefle', 'D-pique', 'D-coeur', 'D-carreau', 'D-trefle', 'R-pique', 'R-coeur', 'R-carreau', 'R-trefle'] };
    st.boss = { card: { suit: 'trefle', rank: 'R' }, hp: 0, shield: 9 }; st.castle = 0; st.interactive = false;
    return courScreen(st, { overlay: T.EndScreen({ result: 'victoire', title: 'Victoire', subtitle: 'Les 12 souverains sont tombés. La cour est à vous.', extra: T.Sovereigns({ fallen: st.sov.fallen }),
      recap: [['Souverains', '12/12'], ['K.O. pile', '4'], ['Tours', '58'], ['Durée', '42 min']],
      ranking: [{ name: 'Léa', score: '96 dégâts', note: '3 K.O.' }, { name: 'Light', score: '88 dégâts', me: true }, { name: 'Inès', score: '71 dégâts' }, { name: 'Malo', score: '64 dégâts' }] }) });
  },
  defaite: function () {
    var st = courBase(); st.interactive = false;
    st.sov = { fallen: ['V-pique', 'V-coeur', 'V-carreau', 'V-trefle', 'D-pique', 'D-coeur'], current: 'D-carreau' };
    return courScreen(st, { overlay: T.EndScreen({ result: 'defaite', title: 'Défaite', subtitle: 'La Dame de Carreau frappait 11 : Malo n’avait plus que 7 points en main.',
      recap: [['Souverains', '6/12'], ['Tours', '31'], ['Durée', '24 min']],
      actions: T.Button({ variant: 'secondary', icon: 'back', label: 'Retour au salon' }) + T.Button({ variant: 'primary', icon: 'renew', label: 'Rejouer' }) }) });
  },
  regles: function () { return courScreen(S.cour.attaque(), { overlay: T.Rules({ game: 'cour', tab: 'pouvoirs' }) }); }
};
S.cour.render = function (name) { return COUR_SCREENS[name](); };
S.cour.list = Object.keys(COUR_SCREENS);

/* ---------- Tarot ---------- */
var POS = { 3: ['top-left', 'top-right'], 4: ['left', 'top', 'right'], 5: ['left', 'top-left', 'top-right', 'right'] };
var POS_AREA = { left: 's-left', top: 's-top', right: 's-right', 'top-left': 's-tl', 'top-right': 's-tr' };
function salonTable(st) {
  var n = st.players || 4, pos = POS[n];
  var seats = (st.seats || []).map(function (p, i) {
    return area(POS_AREA[pos[i]], T.Seat(Object.assign({ pos: pos[i], fan: true, seat: i + 1 }, p)));
  }).join('');
  var trick = st.trick ? T.Trick({ plays: st.trick, players: n, size: 'md', label: st.trickLabel }) : (st.center || '');
  var top = (st.contract ? T.Contract(st.contract) : '') + (st.topExtra || '');
  var info = st.trickInfo ? '<div class="tp-trickinfo"><span class="tp-trickinfo__n gauge">' + esc(st.trickInfo) + '</span>' + T.Button({ variant: 'secondary', icon: 'eye', label: 'Voir le dernier pli', attrs: { 'data-open': 'dernier-pli' } }) + '</div>' : '';
  var meSeat = T.Seat(Object.assign({ name: T.data.me, me: true, state: st.myTurn ? 'active' : 'waiting', count: (st.hand || []).length, compact: true }, st.me || {}));
  return '<div class="tp-table tp-table--salon" data-players="' + n + '">' + seats +
    area('trick', (top ? '<div class="tp-felt-top">' + top + '</div>' : '') + trick + info + (st.panel ? '<div class="tp-overpanel">' + st.panel + '</div>' : '')) +
    area('me', meSeat + (st.secret ? T.PartnerNote({}) : '')) +
    area('status', st.status ? T.Status(st.status) : '') +
    area('actions', st.actions ? T.ActionBar(st.actions) : '') +
    area('hand', T.Hand({ cards: st.hand || [], size: 'md', sort: st.sort !== false, interactive: st.interactive !== false, multi: st.multi })) + '</div>';
}
S.salonTable = salonTable;
function salonScreen(st, extra) {
  return S.app(Object.assign({ table: 'salon', players: st.players, max: 5, body: salonTable(st), toasts: st.toasts }, extra || {}));
}
var ME_DEALER = [{ label: 'Donneur', icon: 'fan', tone: 'muted' }];
S.salon.encheres = function () {
  return {
    players: 4, myTurn: true,
    seats: [
      { name: 'Léa', count: 18, state: 'waiting', bubble: { text: 'Garde' }, badges: [{ label: 'Garde', tone: 'accent' }] },
      { name: 'Malo', count: 18, state: 'waiting', bubble: { text: 'Passe', tone: 'pass' }, badges: ME_DEALER },
      { name: 'Inès', count: 18, state: 'waiting', bubble: { text: 'Petite' } }
    ],
    center: '<div class="tp-chien">' + '<div class="tp-chien__c">' + [0, 1, 2, 3, 4, 5].map(function () { return T.Back({ size: 'sm' }); }).join('') + '</div><span class="tp-chien__l label">Chien · 6 cartes</span></div>',
    panel: T.BidPanel({ current: 'garde', by: 'Léa', mine: true }),
    status: { tone: 'turn', text: 'À toi d’annoncer', detail: 'Donne 3/4' },
    hand: T.data.hands.tarot18, interactive: false
  };
};
S.salon.appel = function () {
  return {
    players: 5, myTurn: true,
    seats: [
      { name: 'Léa', count: 15, state: 'waiting', bubble: { text: 'Passe', tone: 'pass' } },
      { name: 'Malo', count: 15, state: 'waiting', bubble: { text: 'Passe', tone: 'pass' }, badges: ME_DEALER },
      { name: 'Inès', count: 15, state: 'waiting', bubble: { text: 'Petite' } },
      { name: 'Yanis', count: 15, state: 'waiting', bubble: { text: 'Passe', tone: 'pass' } }
    ],
    me: { badges: [{ label: 'Preneur', icon: 'flag', tone: 'accent' }] },
    contract: { taker: 'Light', bid: 'garde' },
    center: '<div class="tp-chien"><div class="tp-chien__c">' + [0, 1, 2].map(function () { return T.Back({ size: 'sm' }); }).join('') + '</div><span class="tp-chien__l label">Chien · 3 cartes</span></div>',
    panel: T.KingCall({ rank: 'R', selected: 'coeur' }),
    status: { tone: 'turn', text: 'Garde : appelle un Roi', detail: 'Tu n’as pas le Roi de Cœur' },
    hand: T.data.hands.tarot15, interactive: false
  };
};
function seats4(active) {
  var s = [
    { name: 'Léa', count: 18, state: 'waiting' },
    { name: 'Malo', count: 18, state: 'waiting', badges: ME_DEALER },
    { name: 'Inès', count: 18, state: 'waiting' }
  ];
  if (active != null) s[active].state = 'active';
  return s;
}
S.salon.chien = function () {
  return {
    players: 4, seats: seats4(),
    me: { badges: [{ label: 'Preneur', icon: 'flag', tone: 'accent' }] },
    contract: { taker: 'Light', bid: 'garde' },
    center: '<div class="tp-chien" data-zone="chien"><div class="tp-chien__c">' + T.data.chien4.map(function (c) { return T.Card(Object.assign({ size: 'md' }, c)); }).join('') + '</div><span class="tp-chien__l label">Le chien, montré à tous</span></div>',
    status: { tone: 'info', text: 'Le chien est retourné', detail: 'Il part dans ta main' },
    actions: { primary: { label: 'Prendre le chien', icon: 'arrow' } },
    hand: T.data.hands.tarot18, interactive: false
  };
};
S.salon.ecart = function () {
  var hand = T.deck.sort(T.data.hands.tarot18.concat(T.data.chien4));
  var dog = T.data.chien4.map(function (c) { return cardInfo(c).id; });
  hand = hand.map(function (c) {
    var i = cardInfo(c), o = Object.assign({}, c);
    if (dog.indexOf(i.id) >= 0) o.tag = 'Chien';
    if (i.rank === 'R' || i.bout) { o.state = 'unplayable'; o.reason = i.rank === 'R' ? 'Un Roi ne va pas à l’écart' : 'Un bout ne va pas à l’écart'; }
    if (i.id === '3-pique' || i.id === '5-coeur') o.selected = true;
    return o;
  });
  return {
    players: 4, seats: seats4(), me: { badges: [{ label: 'Preneur', icon: 'flag', tone: 'accent' }] },
    contract: { taker: 'Light', bid: 'garde' },
    center: '<div class="tp-chien"><div class="tp-chien__c">' + T.Slot({ size: 'md', label: 'Écart' }) + '</div></div>',
    panel: T.EcartGuide({ done: 2, need: 6 }),
    status: { tone: 'turn', text: 'Écarte 6 cartes : 2/6', detail: 'Rois et bouts estompés' },
    hand: hand, sort: false, multi: true
  };
};
S.salon.poignee = function () {
  var hand = T.data.hands.tarot18.slice();
  return {
    players: 4, myTurn: true, seats: seats4(), contract: { taker: 'Léa', bid: 'garde' },
    trick: [{ pos: 'bottom', card: null, name: 'Toi' }],
    trickLabel: 'Premier pli',
    seatsNote: '', center: '',
    panel: T.HandfulPrompt({ players: 4, trumps: 11, chosen: 'simple' }),
    status: { tone: 'turn', text: 'Ta première carte arrive', detail: 'Annonce d’abord ta poignée' },
    hand: mark(hand, ['atout-1', 'atout-6', 'atout-11', 'atout-14', 'atout-17', 'atout-19', 'excuse'], { tag: null }),
    interactive: false
  };
};
S.salon.poigneeMontree = function () {
  var st = S.salon.poignee();
  st.panel = T.HandfulShow({ name: 'Inès', type: 'simple', cards: cs('2 3 5 8 9 10 12 15 18 20') });
  st.seats[2].bubble = { text: 'Poignée simple' };
  st.seats[2].badges = [{ label: 'Poignée', icon: 'fan', tone: 'accent' }];
  st.status = { tone: 'info', text: 'Inès montre une poignée simple', detail: '10 atouts, 20 points au camp gagnant' };
  st.myTurn = false;
  return st;
};
function seats5() {
  return [
    { name: 'Léa', count: 9, tricks: 2, state: 'waiting' },
    { name: 'Malo', count: 9, tricks: 1, state: 'waiting', badges: [{ label: 'Preneur', icon: 'flag', tone: 'accent' }] },
    { name: 'Inès', count: 9, tricks: 1, state: 'waiting', badges: ME_DEALER },
    { name: 'Yanis', count: 8, tricks: 2, state: 'waiting' }
  ];
}
S.salon.pli = function () {
  var hand = cs('R♠ 5♠ V♥ 9♥ 3♣ 8♦ 2 12 21');
  hand = hand.map(function (c) { var i = cardInfo(c); return i.suit === 'coeur' ? Object.assign({ state: 'playable' }, c) : Object.assign({ state: 'unplayable', reason: rich('Tu dois fournir à Cœur') }, c); });
  hand = hand.map(function (c) { if (c.reason) c.reason = 'Tu dois fournir à Cœur'; return c; });
  return {
    players: 5, myTurn: true, seats: seats5(), me: { tricks: 1 },
    contract: { taker: 'Malo', bid: 'garde', called: 'coeur' },
    trick: [
      { pos: 'top-right', seat: 4, card: { suit: 'coeur', rank: 7 }, name: 'Inès' },
      { pos: 'right', seat: 5, card: { suit: 'coeur', rank: 'D' }, name: 'Yanis' },
      { pos: 'left', seat: 1, card: { suit: 'coeur', rank: 2 }, name: 'Léa' },
      { pos: 'top-left', seat: 3, card: { suit: 'atout', rank: 4 }, name: 'Malo' },
      { pos: 'bottom', seat: 0, card: null, name: 'Toi' }
    ],
    trickInfo: 'Pli 7/15',
    status: { tone: 'turn', text: 'À toi de jouer', detail: 'Fournis à Cœur' },
    hand: hand, sort: true
  };
};
S.salon.pliComplet = function () {
  var st = S.salon.pli();
  st.trick[3].winner = true;
  st.trick[4].card = { suit: 'coeur', rank: 'V' };
  st.hand = st.hand.filter(function (c) { return !(c.suit === 'coeur' && c.rank === 'V'); }).map(function (c) { return { suit: c.suit, rank: c.rank }; });
  st.myTurn = false;
  st.seats[1].state = 'active';
  st.status = { tone: 'info', text: 'Malo remporte le pli', detail: 'Coupe avec le 4 d’atout' };
  st.interactive = false;
  return st;
};
S.salon.dernierPli = function () {
  var st = S.salon.pliComplet();
  st.trick = null;
  st.center = '';
  st.trickInfo = 'Pli 8/15';
  st.seats[1].state = 'active';
  st.status = { tone: 'wait', text: 'Malo entame…' };
  st.panel = '<section class="tp-panel" data-zone="last-trick" aria-labelledby="tp-lt-h"><header class="tp-panel__h"><h2 class="title-md" id="tp-lt-h">Dernier pli</h2><span class="caption">Pli 7, gagné par Malo</span></header>' +
    '<div class="tp-lt">' + [['Inès', { suit: 'coeur', rank: 7 }], ['Yanis', { suit: 'coeur', rank: 'D' }], ['Léa', { suit: 'coeur', rank: 2 }], ['Malo', { suit: 'atout', rank: 4 }, 1], ['Toi', { suit: 'coeur', rank: 'V' }]].map(function (p) {
      return '<figure class="tp-lt__p">' + T.Card(Object.assign({ size: 'sm', state: p[2] ? 'winner' : '' }, p[1])) + '<figcaption class="caption">' + esc(p[0]) + '</figcaption></figure>';
    }).join('') + '</div><div class="tp-panel__f">' + T.Button({ variant: 'secondary', label: 'Fermer', icon: 'cross' }) + '</div></section>';
  return st;
};
S.salon.trois = function () {
  var hand = T.data.hands.tarot24.map(function (c) { var i = cardInfo(c); return (i.suit === 'atout' || i.suit === 'excuse') ? Object.assign({ state: 'playable' }, c) : Object.assign({ state: 'unplayable', reason: 'Tu dois couper avec un atout' }, c); });
  hand = hand.map(function (c) { var i = cardInfo(c); if (i.suit === 'atout' && i.rank < 9) { c.state = 'unplayable'; c.reason = 'Tu dois monter sur le 9'; } return c; });
  return {
    players: 3, myTurn: true,
    seats: [{ name: 'Léa', count: 23, tricks: 0, state: 'waiting', badges: [{ label: 'Preneur', icon: 'flag', tone: 'accent' }] }, { name: 'Malo', count: 23, tricks: 0, state: 'waiting', badges: ME_DEALER }],
    contract: { taker: 'Léa', bid: 'petite' },
    trick: [{ pos: 'top-left', card: { suit: 'pique', rank: 'R' }, name: 'Léa' }, { pos: 'top-right', card: { suit: 'atout', rank: 9 }, name: 'Malo' }, { pos: 'bottom', card: null, name: 'Toi' }],
    trickInfo: 'Pli 1/24',
    status: { tone: 'turn', text: 'À toi de jouer', detail: 'Pas de Pique : coupe et monte' },
    hand: hand
  };
};
function scoreRows() {
  return [
    { deal: 1, taker: 'Léa', bid: 'garde', made: true, diff: 6, gains: [-62, 186, -62, -62] },
    { deal: 2, taker: 'Malo', bid: 'petite', made: false, diff: -4, gains: [29, 29, -87, 29] },
    { deal: 3, taker: 'Light', bid: 'garde-sans', made: true, diff: 12, gains: [444, -148, -148, -148] },
    { deal: 4, taker: 'Inès', bid: 'garde', made: true, diff: 2, gains: [-74, -74, -74, 222] }
  ];
}
var SALON_SCREENS = {
  encheres: function () { return salonScreen(S.salon.encheres()); },
  appel: function () { return salonScreen(S.salon.appel()); },
  chien: function () { return salonScreen(S.salon.chien()); },
  ecart: function () { return salonScreen(S.salon.ecart()); },
  poignee: function () { return salonScreen(S.salon.poignee()); },
  poigneeMontree: function () { return salonScreen(S.salon.poigneeMontree()); },
  pli: function () { return salonScreen(S.salon.pli()); },
  pliComplet: function () { return salonScreen(S.salon.pliComplet()); },
  dernierPli: function () { return salonScreen(S.salon.dernierPli()); },
  resume: function () {
    var st = S.salon.pliComplet(); st.trick = null; st.hand = []; st.status = null; st.center = '';
    return salonScreen(st, { overlay: T.Dialog({ kicker: 'Donne 2/5', title: 'Résumé de la donne', size: 'lg', body: T.DealSummary({ taker: 'Malo', bid: 'garde', mult: 2, bouts: 2, made: 47, petitAuBout: 'Malo, +10 × 2', handful: 'Inès, simple : 20 à la défense', gains: [{ name: 'Malo', role: 'preneur', pts: 140 }, { name: 'Yanis', role: 'partenaire', pts: 70 }, { name: 'Light', pts: -70, me: true }, { name: 'Léa', pts: -70 }, { name: 'Inès', pts: -70 }] }),
      actions: T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores' }) + T.Button({ variant: 'primary', icon: 'arrow', label: 'Donne suivante' }) }) });
  },
  fin: function () {
    var st = S.salon.encheres(); st.panel = null; st.hand = []; st.status = null; st.center = '';
    st.seats.forEach(function (s) { s.bubble = null; s.count = 0; });
    return salonScreen(st, { overlay: T.EndScreen({ result: 'fin', title: 'Fin de partie', subtitle: '4 donnes jouées.',
      ranking: [{ name: 'Light', score: '+337', me: true }, { name: 'Inès', score: '+41' }, { name: 'Léa', score: '−7' }, { name: 'Malo', score: '−371' }],
      extra: '<div style="width:100%;text-align:left">' + T.ScoreSheet({ players: ['Light', 'Léa', 'Malo', 'Inès'], me: 'Light', rows: scoreRows() }) + '</div>' }) });
  },
  scores: function () {
    var st = S.salon.pli();
    return salonScreen(st, { drawers: T.Drawer({ id: 'scores', title: 'Feuille de scores', open: true, className: 'tp-drawer--wide', body: T.ScoreSheet({ players: ['Light', 'Léa', 'Malo', 'Inès'], me: 'Light', rows: scoreRows() }) }) });
  },
  trois: function () { return salonScreen(S.salon.trois()); },
  regles: function () { return salonScreen(S.salon.pli(), { overlay: T.Rules({ game: 'salon', tab: 'encheres' }) }); }
};
S.salon.render = function (name) { return SALON_SCREENS[name](); };
S.salon.list = Object.keys(SALON_SCREENS);

/* Planche : l'écran aux trois tailles (documentation). */
S.frame = function (html, vp, scale) {
  var v = VP[vp];
  scale = scale || 1;
  return '<figure class="tp-shot"><figcaption class="tp-shot__cap"><b>' + esc(v.label) + '</b><span>' + esc(v.note) + '</span></figcaption>' +
    '<div class="tp-shot__view" style="width:' + Math.round(v.w * scale) + 'px;height:' + Math.round(v.h * scale) + 'px">' +
    html.replace('<div class="tp-app"', '<div style="width:' + v.w + 'px;height:' + v.h + 'px;transform:scale(' + scale + ')" class="tp-app"') + '</div></figure>';
};
S.sheet = function (root, key, o) {
  o = o || {};
  var parts = key.split('.'), game = S[parts[0]];
  var html = game.render(parts[1]);
  root.innerHTML = '<div class="tp-sheet" data-table="' + parts[0] + '" data-theme="' + parts[0] + '">' +
    (o.title ? '<header class="tp-sheet__h"><span class="label">' + esc(parts[0] === 'salon' ? 'Tarot · table « salon »' : 'La Chute des Rois · table « cour »') + '</span><h1 class="title-lg">' + esc(o.title) + '</h1>' + (o.intro ? '<p>' + o.intro + '</p>' : '') + '</header>' : '') +
    S.frame(html, 'pc') + '<div class="tp-sheet__row">' + S.frame(html, 'laptop') + S.frame(html, 'mobile') + '</div></div>';
  if (T.interact) [].forEach.call(root.querySelectorAll('.tp-app'), function (a) { T.interact.screen(a); });
  return root;
};

/* =====================================================================
   Interactions : main (souris + clavier), onglets, tiroirs, fenêtres.
   Tapis.interact.hand(el, { multi, onChange })  → { selected(), clear() }
   Tapis.interact.screen(appEl) branche tout un écran (outils, tiroirs, règles).
   ===================================================================== */
var IX = T.interact = {};
IX.hand = function (hand, o) {
  o = o || {};
  if (!hand || hand._tpHand) return hand && hand._tpHand;
  var multi = o.multi != null ? o.multi : hand.hasAttribute('data-multi');
  function cards() { return [].slice.call(hand.querySelectorAll('button.tp-card')); }
  function sel() { return cards().filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; }); }
  function setSel(c, on) {
    c.setAttribute('aria-pressed', String(on));
    var st = (c.getAttribute('data-state') || '').split(/\s+/).filter(function (s) { return s && s !== 'selected'; });
    if (on) st.push('selected');
    c.setAttribute('data-state', st.join(' '));
  }
  function toggle(c) {
    if (c.getAttribute('aria-disabled') === 'true') {
      if (T.anim && T.anim.refuse) T.anim.refuse(c);
      return;
    }
    var on = c.getAttribute('aria-pressed') !== 'true';
    if (!multi) sel().forEach(function (x) { setSel(x, false); });
    setSel(c, on);
    if (o.onChange) o.onChange(sel().map(function (x) { return x.getAttribute('data-card-id'); }), c);
    hand.dispatchEvent(new CustomEvent('tapis:select', { bubbles: true, detail: { ids: sel().map(function (x) { return x.getAttribute('data-card-id'); }) } }));
  }
  function focusAt(i) {
    var cs = cards(); if (!cs.length) return;
    i = (i + cs.length) % cs.length;
    cs.forEach(function (c, k) { c.setAttribute('tabindex', k === i ? '0' : '-1'); });
    cs[i].focus();
  }
  hand.addEventListener('click', function (e) { var c = e.target.closest('button.tp-card'); if (c && hand.contains(c)) toggle(c); });
  hand.addEventListener('keydown', function (e) {
    var cs = cards(), i = cs.indexOf(doc.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(cs.length - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggle(cs[i]); }
    else if (e.key === 'Escape') { sel().forEach(function (x) { setSel(x, false); }); }
  });
  var api = {
    selected: function () { return sel().map(function (x) { return x.getAttribute('data-card-id'); }); },
    clear: function () { sel().forEach(function (x) { setSel(x, false); }); }
  };
  hand._tpHand = api;
  return api;
};
IX.tabs = function (root) {
  [].forEach.call(root.querySelectorAll('.tp-tabs'), function (bar) {
    if (bar._tp) return; bar._tp = 1;
    function go(t) {
      var tabs = [].slice.call(bar.querySelectorAll('[role="tab"]'));
      tabs.forEach(function (x) {
        var on = x === t; x.setAttribute('aria-selected', String(on)); x.setAttribute('tabindex', on ? '0' : '-1');
        var p = doc.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = !on;
      });
      t.focus();
    }
    bar.addEventListener('click', function (e) { var t = e.target.closest('[role="tab"]'); if (t) go(t); });
    bar.addEventListener('keydown', function (e) {
      var tabs = [].slice.call(bar.querySelectorAll('[role="tab"]')), i = tabs.indexOf(doc.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(tabs[(i + 1) % tabs.length]); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(tabs[(i - 1 + tabs.length) % tabs.length]); }
    });
  });
};
IX.screen = function (app) {
  if (!app || app._tp) return; app._tp = 1;
  [].forEach.call(app.querySelectorAll('.tp-hand'), function (h) { IX.hand(h); });
  IX.tabs(app);
  app.addEventListener('click', function (e) {
    var op = e.target.closest('[data-open]');
    if (op && !op.classList.contains('tp-drawer')) {
      var d = app.querySelector('#' + op.getAttribute('data-open'));
      if (d && d.classList.contains('tp-drawer')) {
        var open = !d.hasAttribute('data-open');
        d.toggleAttribute('data-open', open); d.setAttribute('aria-hidden', String(!open));
        op.setAttribute('aria-expanded', String(open));
      }
    }
    var cl = e.target.closest('[data-close]');
    if (cl) {
      var t = app.querySelector('#' + cl.getAttribute('data-close'));
      if (t && t.classList.contains('tp-drawer')) { t.removeAttribute('data-open'); t.setAttribute('aria-hidden', 'true'); }
      else if (t) { var m = t.closest('.tp-modal'); if (m) m.remove(); }
    }
    if (e.target.closest('[data-dismiss]')) { var ts = e.target.closest('.tp-toast'); if (ts) ts.remove(); }
  });
};

/* =====================================================================
   Mouvement. Tapis.motion : réglages + interrupteur. Tapis.anim : animations.
   Règle : l'appelant pose l'état final dans le DOM, l'animation le rejoue
   (Web Animations, fill: both, fantômes dans une couche .tp-fx).
   Chaque animation renvoie une Timeline :
     .end         durée totale (ms)
     .seek(t)     fige l'image à t ms (planches image par image)
     .finish()    saute à la fin tout de suite (le serveur envoie un nouvel état)
     .done()      Promise résolue une fois l'état final rendu
   Animations coupées (interrupteur ou prefers-reduced-motion) : rien ne bouge,
   l'état final est déjà là.
   ===================================================================== */
var E = {
  out: 'cubic-bezier(.22,.8,.3,1)', in: 'cubic-bezier(.5,0,.75,0)', std: 'cubic-bezier(.4,0,.2,1)',
  inOut: 'cubic-bezier(.65,0,.35,1)', back: 'cubic-bezier(.34,1.56,.64,1)', settle: 'cubic-bezier(.3,1.35,.5,1)',
  heavy: 'cubic-bezier(.7,0,.84,0)', linear: 'linear'
};
var D = {
  deal: 300, dealStagger: 55, play: 420, draw: 560, flip: 360, turn: 480, refuse: 320, sort: 420,
  impact: 900, double: 1000, shield: 760, heal: 1000, drawRound: 160, immune: 700, ripost: 950, pay: 560,
  ko: 1300, tear: 1100, burn: 1500, shatter: 950, dissolve: 1400, slash: 900, newBoss: 2100,
  victory: 2200, defeat: 1800, bubble: 360, chien: 900, chienTake: 640, ecart: 600, kingCall: 1500,
  handful: 1700, hold: 1200, collect: 520, excuse: 720, partner: 720, petit: 1000, summary: 1900, ranking: 1300, shuffle: 1300
};
function motionHost() { return (doc && doc.querySelector('.tp-scope[data-motion-host]')) || doc.documentElement; }
var MOT = T.motion = {
  ease: E, dur: D,
  enabled: function () {
    if (!doc) return false;
    var a = motionHost().getAttribute('data-motion');
    if (a === 'off') return false;
    if (a === 'on') return true;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  },
  set: function (on) {
    motionHost().setAttribute('data-motion', on ? 'on' : 'off');
    if (!on && T.anim) T.anim.finishAll();
    [].forEach.call(doc.querySelectorAll('[data-motion-toggle]'), function (b) {
      b.setAttribute('aria-pressed', String(!!on));
      b.setAttribute('aria-label', on ? 'Animations activées' : 'Animations coupées');
      b.setAttribute('title', on ? 'Animations activées' : 'Animations coupées');
      b.innerHTML = T.icon(on ? 'motion' : 'motion-off');
    });
    try { doc.dispatchEvent(new CustomEvent('tapis:motion', { detail: { on: !!on } })); } catch (e) {}
  },
  toggle: function () { MOT.set(!MOT.enabled()); return MOT.enabled(); }
};
if (doc) doc.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.tp-scope [data-motion-toggle]')) MOT.toggle(); });

/* ---------- Timeline ---------- */
var ACTIVE = [];
function TL(opts) {
  opts = opts || {};
  var p = opts.tl || null;
  this.parent = p;
  this.on = p ? p.on : (!!opts.force || MOT.enabled());
  this.base = (p ? p.base : 0) + (opts.delay || 0);
  this.anims = p ? p.anims : [];
  this.cleanups = p ? p.cleanups : [];
  this.nodes = p ? p.nodes : [];
  this._end = p ? p._end : { v: 0 };
  this.root = opts.root || (p && p.root) || null;
  if (!p) ACTIVE.push(this);
}
TL.prototype.add = function (el, kf, o) {
  if (!this.on || !el || !el.animate) return null;
  o = Object.assign({ duration: 300, fill: 'both' }, o || {});
  var multi = Array.isArray(kf) && kf.length > 2;
  var perKey = Array.isArray(kf) && kf.some(function (k) { return k && k.easing; });
  if (multi && !perKey && o.easing && o.easing !== 'linear') {
    var seg = o.easing;
    kf = kf.map(function (k, i) { return i < kf.length - 1 ? Object.assign({ easing: seg }, k) : k; });
    perKey = true;
  }
  o.easing = perKey ? 'linear' : (o.easing || E.out);
  o.delay = (o.delay || 0) + this.base;
  var a = el.animate(kf, o);
  this.anims.push(a);
  var e = o.delay + o.duration * (o.iterations && isFinite(o.iterations) ? o.iterations : 1);
  if (e > this._end.v) this._end.v = e;
  return a;
};
TL.prototype.at = function (ms) { return new TL({ tl: this, delay: ms }); };
TL.prototype.node = function (n) { this.nodes.push(n); return n; };
TL.prototype.then = function (fn) { this.cleanups.push(fn); return this; };
TL.prototype.seek = function (t) { this.anims.forEach(function (a) { a.pause(); a.currentTime = t; }); return this; };
TL.prototype.rate = function (r) { this.anims.forEach(function (a) { a.playbackRate = r; }); return this; };
TL.prototype.cancel = function () { this.anims.forEach(function (a) { a.cancel(); }); this.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); return this; };
TL.prototype.finish = function () {
  var r = this.parent || this;
  r.anims.forEach(function (a) { try { a.finish(); } catch (e) { a.cancel(); } });
  return r.done();
};
Object.defineProperty(TL.prototype, 'end', { get: function () { return this._end.v; } });
TL.prototype.done = function () {
  var self = this;
  if (self.parent) return self.parent.done();
  if (self._done) return self._done;
  function finish() {
    self.cleanups.forEach(function (f) { try { f(); } catch (e) { if (window.console) console.error(e); } });
    self.anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    self.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    var i = ACTIVE.indexOf(self); if (i >= 0) ACTIVE.splice(i, 1);
  }
  self._done = self.on && self.anims.length
    ? Promise.all(self.anims.map(function (a) { return a.finished.catch(function () {}); })).then(finish)
    : Promise.resolve(finish());
  return self._done;
};
TL.prototype.start = function () {
  var self = this;
  if (!self.parent && !self._sched) { self._sched = true; Promise.resolve().then(function () { self.done(); }); }
  return self;
};
T.Timeline = TL;

/* ---------- utilitaires ---------- */
function arr(x) { return !x ? [] : x.length != null && !x.nodeType ? [].slice.call(x) : [x]; }
function q(el, s) { return el ? el.querySelector(s) : null; }
function qa(el, s) { return el ? [].slice.call(el.querySelectorAll(s)) : []; }
function rootOf(el, o) { return (o && o.root) || (el && el.closest && (el.closest('[data-anim-root]') || el.closest('.tp-zone') || el.closest('.tp-app'))) || (doc && doc.body); }
function layer(root, tl) {
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  var l = doc.createElement('div');
  l.className = 'tp-fx';
  l.setAttribute('aria-hidden', 'true');
  root.appendChild(l);
  return tl.node(l);
}
function box(el, root) {
  if (el && el.x != null && el.w != null) return el;
  var r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
  var sx = o.width / (root.offsetWidth || o.width) || 1;
  var x = (r.left - o.left) / sx + root.scrollLeft - root.clientLeft, y = (r.top - o.top) / sx + root.scrollTop - root.clientTop;
  var w = r.width / sx, h = r.height / sx;
  return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2 };
}
function mk(tag, cls, html) { var n = doc.createElement(tag || 'span'); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
/* Fantôme d'une carte posé sur la couche fx, à la place de r. */
function ghost(lay, src, r) {
  var g;
  if (typeof src === 'string') g = T.node(src); else { g = src.cloneNode(true); g.removeAttribute('id'); }
  g.classList.add('tp-ghost');
  var st = (g.getAttribute('data-state') || '').replace(/\b(selected|hidden|playable|unplayable)\b/g, '').trim();
  if (st) g.setAttribute('data-state', st); else g.removeAttribute('data-state');
  g.style.cssText += ';position:absolute;left:' + r.x + 'px;top:' + r.y + 'px;height:' + r.h + 'px;width:' + r.w + 'px;--ch:' + r.h + 'px;margin:0;transform:none;';
  lay.appendChild(g);
  return g;
}
function backHtml() { return T.Back({ size: 'md' }); }
function P(dx, dy, s, rot, ry) {
  return 'perspective(1100px) translate(' + (dx || 0).toFixed(1) + 'px,' + (dy || 0).toFixed(1) + 'px) rotate(' + (rot || 0).toFixed(1) + 'deg) scale(' + (s == null ? 1 : s).toFixed(3) + ') rotateY(' + (ry || 0).toFixed(1) + 'deg)';
}
/* Vol d'un fantôme de a vers b (le fantôme est posé en b). */
function flight(tl, g, a, b, o) {
  o = o || {};
  var dx = a.cx - b.cx, dy = a.cy - b.cy, s0 = a.w / b.w, lift = o.lift == null ? 40 : o.lift;
  var r0 = o.rot0 || 0, r1 = o.rot1 || 0, ry0 = o.flip ? 180 : (o.ry0 || 0), ry1 = o.flipDown ? 180 : 0;
  var mid = o.mid || .55;
  var kf = [
    { transform: P(dx, dy, s0, r0, ry0), opacity: o.fade0 ? 0 : 1, offset: 0 },
    { transform: P(dx * (1 - mid) , dy * (1 - mid) - lift, (s0 + (o.s1 || 1)) / 2 * (o.peak || 1.06), (r0 + r1) / 2, (ry0 + ry1) / 2), opacity: 1, offset: mid },
    { transform: P(0, 0, o.s1 || 1, r1, ry1), opacity: o.fade1 ? 0 : 1, offset: 1 }
  ];
  return tl.add(g, kf, { duration: o.duration || D.play, delay: o.delay || 0, easing: o.easing || E.out });
}
/* Cache l'élément réel pendant qu'un fantôme vole vers lui. */
function hideUntil(tl, el, t) { if (el) tl.add(el, [{ opacity: 0 }, { opacity: 0, offset: .999 }, { opacity: 1 }], { duration: Math.max(1, t), easing: 'linear' }); }
function floatText(tl, lay, text, x, y, cls, delay, dur) {
  var s = lay.appendChild(mk('span', 'tp-float ' + (cls || ''), rich(text)));
  tl.add(s, [
    { transform: 'translate(' + x + 'px,' + (y + 10) + 'px) translate(-50%,-50%) scale(.5)', opacity: 0 },
    { transform: 'translate(' + x + 'px,' + (y - 8) + 'px) translate(-50%,-50%) scale(1.2)', opacity: 1, offset: .2 },
    { transform: 'translate(' + x + 'px,' + (y - 24) + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .72 },
    { transform: 'translate(' + x + 'px,' + (y - 40) + 'px) translate(-50%,-50%) scale(1)', opacity: 0 }
  ], { duration: dur || 900, delay: delay || 0, easing: E.out });
  return s;
}
function swapText(tl, node, oldText, newText, at, dur) {
  if (!node) return;
  node.textContent = newText;
  if (!tl.on || String(oldText) === String(newText)) return;
  node.textContent = '';
  var pos = getComputedStyle(node).position;
  if (pos === 'static') node.style.position = 'relative';
  var nw = node.appendChild(mk('span', 'tp-swap', esc(newText)));
  var od = node.appendChild(mk('span', 'tp-swap tp-swap--old', esc(oldText)));
  dur = dur || 260;
  tl.add(nw, [{ opacity: 0, transform: 'translateY(.45em)' }, { opacity: 1, transform: 'none' }], { duration: dur, delay: at || 0, easing: E.out });
  tl.add(od, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-.45em)' }], { duration: dur, delay: at || 0, easing: E.in });
  tl.then(function () { node.textContent = newText; if (pos === 'static') node.style.position = ''; });
}
/* Compteur qui défile (points, résumé). */
function countUp(tl, node, from, to, at, dur, fmt) {
  if (!node) return;
  fmt = fmt || function (v) { return String(v); };
  node.textContent = fmt(to);
  if (!tl.on) return;
  var steps = 12, h = '';
  for (var i = 0; i <= steps; i++) h += '<span>' + esc(fmt(Math.round(from + (to - from) * i / steps))) + '</span>';
  var w = node.offsetWidth, lh = node.offsetHeight || 20;
  var reel = mk('span', 'tp-reel', h);
  node.textContent = ''; node.style.display = 'inline-block'; node.style.minWidth = w + 'px';
  var clip = mk('span', 'tp-reel__clip'); clip.style.height = lh + 'px'; clip.appendChild(reel);
  node.appendChild(clip);
  tl.add(reel, [{ transform: 'translateY(0)' }, { transform: 'translateY(' + (-steps * lh) + 'px)' }], { duration: dur || 700, delay: at || 0, easing: E.out });
  tl.then(function () { node.textContent = fmt(to); node.style.minWidth = ''; node.style.display = ''; });
}
function burst(tl, lay, x, y, cls, delay, dur, size) {
  var f = lay.appendChild(mk('span', 'tp-flash ' + (cls || '')));
  if (size) { f.style.width = size + 'px'; f.style.height = size + 'px'; }
  tl.add(f, [{ transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .35 }, { transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(1.7)', opacity: 0 }], { duration: dur || 420, delay: delay || 0, easing: E.out });
  return f;
}
function sparks(tl, lay, x, y, n, radius, delay, cls) {
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2 + .3, sp = lay.appendChild(mk('span', 'tp-spark ' + (cls || ''), T.icon('sparkle')));
    tl.add(sp, [
      { transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(.2)', opacity: 0 },
      { transform: 'translate(' + (x + Math.cos(a) * radius * .65) + 'px,' + (y + Math.sin(a) * radius * .65) + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .45 },
      { transform: 'translate(' + (x + Math.cos(a) * radius) + 'px,' + (y + Math.sin(a) * radius) + 'px) translate(-50%,-50%) scale(.3)', opacity: 0 }
    ], { duration: 460, delay: (delay || 0) + i * 16, easing: E.out });
  }
}
function shake(tl, el, delay, dur, amp) {
  amp = amp || 6;
  tl.add(el, [{ transform: 'none' }, { transform: 'translateX(' + (-amp) + 'px)' }, { transform: 'translateX(' + amp + 'px)' }, { transform: 'translateX(' + (-amp * .6) + 'px)' }, { transform: 'translateX(' + (amp * .4) + 'px)' }, { transform: 'none' }], { duration: dur || D.refuse, delay: delay || 0, easing: E.std });
}
/* Générateur pseudo-aléatoire déterministe (mêmes images à chaque rendu de planche). */
function rnd(seed) { var s = seed || 7; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function cardsOf(x) { return arr(x).filter(Boolean); }

var A = T.anim = {};
A.finishAll = function () { ACTIVE.slice().forEach(function (t) { t.finish(); }); };
/* Lance une animation en terminant d'abord la précédente du même canal (états serveur rapprochés). */
var CHANNELS = {};
A.run = function (channel, fn) {
  if (CHANNELS[channel]) CHANNELS[channel].finish();
  var tl = fn();
  CHANNELS[channel] = tl;
  tl.done().then(function () { if (CHANNELS[channel] === tl) delete CHANNELS[channel]; });
  return tl;
};
A.swapText = function (node, a, b, o) { var tl = new TL(o); swapText(tl, node, a, b, 0, (o && o.duration) || 260); return tl.start(); };
A.countUp = function (node, a, b, o) { var tl = new TL(o); countUp(tl, node, a, b, 0, (o && o.duration) || 700); return tl.start(); };

/* ======================= communes ======================= */

/* Retournement d'une carte (face cachée → visible, ou l'inverse). */
A.flip = function (card, o) {
  o = o || {};
  var tl = new TL(o), up = o.up !== false;
  T.Card.flip(card, up);
  if (!tl.on) return tl.start();
  card.classList.add('is-flipping');
  tl.then(function () { card.classList.remove('is-flipping'); });
  tl.add(card, [{ transform: 'perspective(900px) rotateY(' + (up ? 180 : -180) + 'deg)' }, { transform: 'perspective(900px) rotateY(' + (up ? 90 : -90) + 'deg) scale(1.06)', offset: .5 }, { transform: 'perspective(900px) rotateY(0deg)' }], { duration: o.duration || D.flip, delay: o.delay || 0, easing: E.inOut });
  return tl.start();
};

/* Pose : la carte (déjà à sa place finale) vole depuis from (élément ou rect). Adversaire : flip: true (depuis son éventail, retournée). */
A.play = function (card, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on || !o.from) return tl.start();
  var root = rootOf(card, o), lay = layer(root, tl);
  var b = box(card, root), a = box(o.from, root);
  if (o.from.nodeType && o.from.classList.contains('tp-fan')) { a = { x: a.cx - b.w * .2, y: a.cy - b.h * .2, w: b.w * .4, h: b.h * .4, cx: a.cx, cy: a.cy }; }
  var g = ghost(lay, card, b);
  g.classList.add('is-flipping');
  var dur = o.duration || D.play;
  flight(tl, g, a, b, { flip: !!o.flip, duration: dur, lift: o.lift == null ? 50 : o.lift, rot0: o.rot0 || (a.cx < b.cx ? -10 : 10), easing: E.out });
  tl.add(g, [{ boxShadow: 'var(--shadow-card-lift)' }, { boxShadow: 'var(--shadow-card)' }], { duration: 160, delay: dur - 120 });
  hideUntil(tl, card, dur);
  return tl.start();
};

/* Pioche : la carte quitte la pile, vole en arc, se retourne chez moi et se cale. */
A.draw = function (pile, cards, o) {
  o = o || {};
  var tl = new TL(o);
  var list = cardsOf(cards);
  if (!tl.on || !list.length) return tl.start();
  var root = rootOf(list[0], o), lay = layer(root, tl), a0 = box(q(pile, '.tp-pile__stack') || pile, root);
  var top = q(pile, '.tp-pile__stack > .tp-card:last-of-type');
  list.forEach(function (card, i) {
    var b = box(card, root), delay = i * (o.stagger || 130);
    var a = { x: a0.x, y: a0.y, w: a0.w, h: a0.h, cx: a0.cx, cy: a0.cy };
    var faceDown = o.faceDown || card.getAttribute('data-face') === 'down';
    var g = ghost(lay, card, b);
    g.classList.add('is-flipping');
    /* la carte se soulève de la pile (0–120 ms), vole en arc en se retournant, puis se cale */
    var dur = o.duration || D.draw, tot = 120 + dur, k0 = 120 / tot, ry = faceDown ? 0 : 180;
    var ax = a.cx - b.cx, ay = a.cy - b.cy, s0 = a.w / b.w;
    tl.add(g, [
      { transform: P(ax, ay, s0, 0, ry), offset: 0, easing: E.out },
      { transform: P(ax, ay - 18, s0 * 1.05, -4, ry), offset: k0, easing: E.inOut },
      { transform: P(ax * .45, ay * .45 - 70, 1.12, 6, faceDown ? 0 : 90), offset: k0 + (1 - k0) * .5, easing: E.inOut },
      { transform: P(0, -10, 1.04, 0, 0), offset: k0 + (1 - k0) * .86, easing: E.out },
      { transform: P(0, 0, 1, 0, 0), offset: 1 }
    ], { duration: tot, delay: delay });
    tl.add(g, [{ boxShadow: 'var(--shadow-card-lift)' }, { boxShadow: 'var(--shadow-card-lift)', offset: .85 }, { boxShadow: 'var(--shadow-card)' }], { duration: tot, delay: delay });
    hideUntil(tl, card, delay + tot);
    if (o.counter !== false) {
      var cnt = q(pile, '.tp-pile__count');
      if (cnt && i === 0 && o.from != null) swapText(tl, cnt, o.from, o.to != null ? o.to : o.from - list.length, delay + 60, 220);
    }
  });
  if (top && list.length) tl.add(top, [{ transform: 'none' }, { transform: 'translateY(-3px)' }, { transform: 'none' }], { duration: 200, delay: 0 });
  return tl.start();
};

/* Pioche d'un adversaire : un dos file vers son éventail, son compteur monte. */
A.drawTo = function (pile, seat, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(seat, o), lay = layer(root, tl);
  var a = box(q(pile, '.tp-pile__stack') || pile, root), fan = q(seat, '.tp-fan') || q(seat, '.tp-avatar') || seat, b0 = box(fan, root);
  var n = o.count || 1;
  for (var i = 0; i < n; i++) {
    var w = a.w * .55, h = a.h * .55, b = { x: b0.cx - w / 2, y: b0.cy - h / 2, w: w, h: h, cx: b0.cx, cy: b0.cy };
    var g = ghost(lay, backHtml(), b);
    flight(tl, g, a, b, { duration: o.duration || 460, delay: i * 140, lift: 30, rot0: -8, rot1: 4, fade1: true, mid: .5 });
  }
  var meta = q(seat, '.tp-seat__meta');
  if (meta) tl.add(meta, [{ color: 'var(--text-muted)' }, { color: 'var(--accent-bright)', offset: .3 }, { color: 'var(--text-muted)' }], { duration: 600, delay: 300 });
  return tl.start();
};

/* Pile vide : la pile tremble, « Taverne vide » s'élève. */
A.drawEmpty = function (pile, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(pile, o), lay = layer(root, tl), b = box(pile, root);
  shake(tl, q(pile, '.tp-pile__stack') || pile, 0, 380, 5);
  floatText(tl, lay, o.text || 'Pile vide', b.cx, b.y, 'tp-float--muted', 60, 1000);
  return tl.start();
};

/* Mélange (riffle) : le paquet se coupe en deux et les moitiés s'entrelacent. */
A.shuffle = function (pile, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(pile, o), lay = layer(root, tl), st = q(pile, '.tp-pile__stack') || pile, b = box(st, root);
  hideUntil(tl, st, D.shuffle);
  var n = 10;
  for (var i = 0; i < n; i++) {
    var g = ghost(lay, backHtml(), b), left = i % 2 === 0, k = Math.floor(i / 2);
    var sx = (left ? -1 : 1) * b.w * .62;
    tl.add(g, [
      { transform: P(0, -k * 1.5, 1, 0), offset: 0 },
      { transform: P(sx, -k * 1.5, 1, left ? -6 : 6), offset: .28, easing: E.out },
      { transform: P(sx * .8, -k * 1.5 - 6, 1, left ? -14 : 14), offset: .42 + k * .04, easing: E.inOut },
      { transform: P(0, -i * 1.1, 1, 0), offset: .72 + k * .03, easing: E.out },
      { transform: P(0, 0, 1, 0), offset: 1 }
    ], { duration: D.shuffle, easing: E.inOut });
  }
  return tl.start();
};

/* Distribution : paquets de dos qui volent vers chaque siège, puis ma main s'ouvre et se trie.
   targets : [{ el: siège | éventail, n: cartes }] ; hand : la main finale (déjà rendue). */
A.deal = function (pile, targets, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(pile, o), lay = layer(root, tl), a = box(q(pile, '.tp-pile__stack') || pile, root);
  var packet = o.packet || 3, t = 0, step = o.stagger || 70;
  var rounds = Math.max.apply(null, targets.map(function (x) { return Math.ceil((x.n || packet) / packet); }));
  var handCards = o.hand ? qa(o.hand, '.tp-card') : [];
  handCards.forEach(function (c) { hideUntil(tl, c, 0); });
  var shownMine = 0;
  for (var r = 0; r < Math.min(rounds, o.maxRounds || 3); r++) {
    targets.forEach(function (x) {
      var el = x.el, b0 = box(q(el, '.tp-fan') || el, root), w = a.w * .7, h = a.h * .7;
      var b = { x: b0.cx - w / 2, y: b0.cy - h / 2, w: w, h: h, cx: b0.cx, cy: b0.cy };
      for (var k = 0; k < (x.chien ? 1 : Math.min(packet, 3)); k++) {
        var g = ghost(lay, backHtml(), b);
        flight(tl, g, a, b, { duration: D.deal, delay: t + k * 26, lift: 24, rot0: 0, rot1: (k - 1) * 6, fade1: !x.keep, mid: .5 });
      }
      t += step;
    });
  }
  /* ma main : les cartes apparaissent retournées, une à une */
  var t0 = t + 120;
  handCards.forEach(function (c, i) {
    tl.add(c, [{ opacity: 0, transform: 'perspective(900px) translateY(30px) rotateY(180deg)' }, { opacity: 1, transform: 'perspective(900px) translateY(-6px) rotateY(80deg)', offset: .5 }, { opacity: 1, transform: 'none' }], { duration: 360, delay: t0 + i * 30, easing: E.out });
    c.classList.add('is-flipping');
    shownMine++;
  });
  tl.then(function () { handCards.forEach(function (c) { c.classList.remove('is-flipping'); }); });
  return tl.start();
};

/* Tri de la main : chaque carte glisse de sa place dans l'ordre reçu vers sa place triée. order = ids dans l'ordre reçu. */
A.sort = function (hand, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var slots = qa(hand, '.tp-hand__slot'), root = rootOf(hand, o);
  var rects = slots.map(function (s) { return box(s, root); });
  var ids = slots.map(function (s) { return q(s, '.tp-card').getAttribute('data-card-id'); });
  var from = o.order || ids.slice().sort(function () { return 0; }).reverse();
  slots.forEach(function (s, i) {
    var j = from.indexOf(ids[i]); if (j < 0) j = i;
    var dx = rects[j].x - rects[i].x;
    tl.add(q(s, '.tp-card'), [{ transform: 'translate(' + dx + 'px,0)' }, { transform: 'translate(' + dx * .5 + 'px,-14px)', offset: .5 }, { transform: 'none' }], { duration: D.sort, delay: (o.delay || 0) + i * 12, easing: E.inOut });
  });
  return tl.start();
};

/* Passage de tour : le halo glisse d'un siège à l'autre. */
A.turn = function (from, to, o) {
  o = o || {};
  var tl = new TL(o);
  if (from) from.setAttribute('data-state', 'waiting');
  if (to) to.setAttribute('data-state', 'active');
  [from, to].forEach(function (s) { if (!s) return; var av = q(s, '.tp-avatar'); if (av) av.setAttribute('data-state', s.getAttribute('data-state')); });
  if (!tl.on || !from || !to) return tl.start();
  var root = rootOf(to, o), lay = layer(root, tl), a = box(from, root), b = box(to, root);
  var halo = lay.appendChild(mk('span', 'tp-halo'));
  halo.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px';
  tl.add(halo, [
    { transform: 'translate(' + (a.x - b.x) + 'px,' + (a.y - b.y) + 'px) scale(' + (a.w / b.w) + ',' + (a.h / b.h) + ')', opacity: 1 },
    { transform: 'none', opacity: 1, offset: .8 },
    { transform: 'none', opacity: 0 }
  ], { duration: D.turn, easing: E.inOut });
  tl.add(to, [{ boxShadow: 'none' }, { boxShadow: 'none', offset: .7 }, { boxShadow: 'var(--glow-turn)' }], { duration: D.turn });
  return tl.start();
};

/* Refus : la carte tremble, la raison s'affiche. */
A.refuse = function (card, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var face = q(card, '.tp-card__face') || card;
  shake(tl, face, 0, D.refuse, 5);
  var why = q(card, '.tp-card__why');
  if (why) tl.add(why, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 1600 });
  else if (o.reason) { var root = rootOf(card, o), lay = layer(root, tl), b = box(card, root); floatText(tl, lay, o.reason, b.cx, b.y - 10, 'tp-float--muted', 0, 1400); }
  return tl.start();
};

/* Bulle d'annonce qui éclot (enchère, dernière action). */
A.bubble = function (bubble, o) {
  var tl = new TL(o);
  tl.add(bubble, [{ opacity: 0, scale: .5, translate: '0 10px' }, { opacity: 1, scale: 1.08, translate: '0 0', offset: .6 }, { opacity: 1, scale: 1, translate: '0 0' }], { duration: D.bubble, easing: E.back });
  return tl.start();
};

/* ======================= destruction de cartes ======================= */
/* Toutes prennent la carte (encore dans le DOM), la retirent tout de suite (état final)
   et jouent des fantômes. o.to : pile où finissent les restes (défausse). o.keep : ne pas retirer. */
function prepDestroy(card, o, tl) {
  var root = rootOf(card, o), lay = layer(root, tl), b = box(card, root);
  var src = card.cloneNode(true);
  if (!o.keep) {
    if (tl.on) { card.style.visibility = 'hidden'; tl.then(function () { if (card.parentNode) card.parentNode.removeChild(card); }); }
    else if (card.parentNode) card.parentNode.removeChild(card);
  }
  return { root: root, lay: lay, b: b, src: src };
}
function piece(lay, src, b, clip) { var g = ghost(lay, src, b); g.style.clipPath = clip; g.style.boxShadow = 'none'; return g; }

/* Déchirure : la carte se déchire en deux, les moitiés tombent (dans la défausse si o.to). */
A.tear = function (card, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, R = rnd(o.seed || 11), zz = [], i;
  for (i = 0; i <= 12; i++) zz.push([(50 + (i % 2 ? 1 : -1) * (3 + R() * 4)).toFixed(1), (i / 12 * 100).toFixed(1)]);
  var left = 'polygon(0 0,' + zz.map(function (p) { return p[0] + '% ' + p[1] + '%'; }).join(',') + ',0 100%)';
  var right = 'polygon(100% 0,' + zz.map(function (p) { return p[0] + '% ' + p[1] + '%'; }).join(',') + ',100% 100%)';
  var gl = piece(P0.lay, P0.src, b, left), gr = piece(P0.lay, P0.src, b, right);
  var tgt = o.to ? box(q(o.to, '.tp-pile__stack') || o.to, P0.root) : { cx: b.cx, cy: b.cy + b.h * 1.4, w: b.w };
  var dur = o.duration || D.tear;
  /* tension (0–22 %), rupture (22–45 %), chute (45–100 %) */
  [[gl, -1], [gr, 1]].forEach(function (x) {
    var s = x[1], dx = tgt.cx - b.cx, dy = tgt.cy - b.cy, sc = Math.min(1, tgt.w / b.w);
    tl.add(x[0], [
      { transform: P(0, 0, 1, 0), offset: 0 },
      { transform: P(-s * 1.5, 0, 1.02, -s * 1.5), offset: .12 },
      { transform: P(s * 1.5, 0, 1.02, s * 1), offset: .22 },
      { transform: P(s * b.w * .16, -b.h * .04, 1, s * 9), offset: .45, easing: E.out },
      { transform: P(dx + s * b.w * .1, dy, sc * .9, s * 28), offset: 1, easing: E.in }
    ], { duration: dur, easing: E.std });
    tl.add(x[0], [{ opacity: 1 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: dur });
  });
  var seam = P0.lay.appendChild(mk('span', 'tp-tearseam'));
  seam.style.cssText = 'left:' + (b.cx - 2) + 'px;top:' + b.y + 'px;height:' + b.h + 'px';
  tl.add(seam, [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)', offset: .5 }, { opacity: 0, transform: 'scaleY(1)' }], { duration: dur * .45, easing: E.out });
  if (o.to) { var cnt = q(o.to, '.tp-pile__count'); if (cnt && o.counter) swapText(tl, cnt, o.counter[0], o.counter[1], dur * .9, 220); }
  return tl.start();
};

/* Brûlure : la carte se consume du bas vers le haut, braises qui montent, cendres. */
A.burn = function (card, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, R = rnd(o.seed || 5), N = 9, steps = 8, dur = o.duration || D.burn;
  var phase = []; for (var k = 0; k <= N; k++) phase.push(R() * 6.28);
  function edge(level) {
    var pts = ['0% -2%', '100% -2%'];
    for (var j = N; j >= 0; j--) {
      var y = level + Math.sin(phase[j] + level * .08) * 4 + (j % 2 ? 2.5 : -2.5);
      pts.push((j / N * 100).toFixed(1) + '% ' + Math.max(-12, Math.min(104, y)).toFixed(1) + '%');
    }
    return 'polygon(' + pts.join(',') + ')';
  }
  var g = piece(P0.lay, P0.src, b, edge(106));
  var kf = [];
  for (var s = 0; s <= steps; s++) kf.push({ clipPath: edge(106 - s / steps * 120), offset: s / steps });
  tl.add(g, kf, { duration: dur, easing: E.linear });
  tl.add(g, [{ filter: 'none' }, { filter: 'none', offset: .2 }, { filter: 'sepia(.25) brightness(.95)', offset: .5 }, { filter: 'sepia(.75) brightness(.68)' }], { duration: dur });
  var band = P0.lay.appendChild(mk('span', 'tp-charband'));
  band.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + (b.h * .2) + 'px';
  tl.add(band, [{ transform: 'translateY(' + (b.h * .84) + 'px)', opacity: 0 }, { transform: 'translateY(' + (b.h * .72) + 'px)', opacity: 1, offset: .1 }, { transform: 'translateY(' + (-b.h * .16) + 'px)', opacity: 1, offset: .88 }, { transform: 'translateY(' + (-b.h * .3) + 'px)', opacity: 0 }], { duration: dur, easing: E.linear });
  tl.add(g, [{ transform: 'none' }, { transform: 'translateY(-4px) rotate(-1.5deg)' }], { duration: dur, easing: E.inOut });
  var glow = P0.lay.appendChild(mk('span', 'tp-burnedge'));
  glow.style.cssText = 'left:' + (b.x - 6) + 'px;top:' + b.y + 'px;width:' + (b.w + 12) + 'px';
  tl.add(glow, [{ transform: 'translateY(' + (b.h * 1.04) + 'px)', opacity: 0 }, { transform: 'translateY(' + (b.h * .9) + 'px)', opacity: 1, offset: .08 }, { transform: 'translateY(' + (b.h * .02) + 'px)', opacity: 1, offset: .9 }, { transform: 'translateY(' + (-b.h * .12) + 'px)', opacity: 0 }], { duration: dur, easing: E.linear });
  for (var e = 0; e < 18; e++) {
    var t0 = R() * .82, x = b.x + R() * b.w, y = b.y + b.h * (1.02 - t0 * 1.15);
    var em = P0.lay.appendChild(mk('span', e % 3 ? 'tp-ember' : 'tp-ember tp-ember--ash'));
    var dx = (R() - .5) * 40, dy = -(40 + R() * 70);
    tl.add(em, [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(1)', opacity: 0 }, { transform: 'translate(' + (x + dx * .3) + 'px,' + (y + dy * .3) + 'px) scale(1)', opacity: 1, offset: .2 }, { transform: 'translate(' + (x + dx) + 'px,' + (y + dy) + 'px) scale(.3)', opacity: 0 }], { duration: 700 + R() * 500, delay: t0 * dur, easing: E.out });
  }
  return tl.start();
};

/* Éclats : la carte se fend depuis le point d'impact puis vole en morceaux. */
A.shatter = function (card, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, R = rnd(o.seed || 3), dur = o.duration || D.shatter;
  var cx = 52, cy = 44;
  var ring = [[0, 0], [30, 0], [62, 0], [100, 0], [100, 28], [100, 58], [100, 100], [70, 100], [38, 100], [0, 100], [0, 70], [0, 34]];
  var cracks = mk('span', 'tp-cracks', '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' + ring.map(function (p) { return '<path d="M' + cx + ' ' + cy + 'L' + p[0] + ' ' + p[1] + '"/>'; }).join('') + '</svg>');
  cracks.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px';
  var whole = piece(P0.lay, P0.src, b, 'none');
  P0.lay.appendChild(cracks);
  tl.add(whole, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'scale(1.03)', offset: .6 }, { opacity: 0, transform: 'scale(1.03)' }], { duration: dur * .24, easing: E.out });
  tl.add(cracks, [{ opacity: 0, clipPath: 'circle(0% at 52% 44%)' }, { opacity: 1, clipPath: 'circle(80% at 52% 44%)', offset: .9 }, { opacity: 0, clipPath: 'circle(80% at 52% 44%)' }], { duration: dur * .3, easing: E.out });
  ring.forEach(function (p, i) {
    var q2 = ring[(i + 1) % ring.length];
    var clip = 'polygon(' + cx + '% ' + cy + '%,' + p[0] + '% ' + p[1] + '%,' + q2[0] + '% ' + q2[1] + '%)';
    var sh = piece(P0.lay, P0.src, b, clip);
    var mx = (cx + p[0] + q2[0]) / 3 - cx, my = (cy + p[1] + q2[1]) / 3 - cy, len = Math.sqrt(mx * mx + my * my) || 1;
    var dist = b.w * (.7 + R() * .9), dx = mx / len * dist, dy = my / len * dist * .8, rot = (R() - .5) * 220;
    tl.add(sh, [
      { transform: 'none', opacity: 0, offset: 0 },
      { transform: 'none', opacity: 1, offset: .2 },
      { transform: 'translate(' + dx * .55 + 'px,' + (dy * .55 - 16) + 'px) rotate(' + rot * .5 + 'deg)', opacity: 1, offset: .55, easing: E.out },
      { transform: 'translate(' + dx + 'px,' + (dy + b.h * .5) + 'px) rotate(' + rot + 'deg) scale(.8)', opacity: 0, offset: 1, easing: E.in }
    ], { duration: dur, easing: E.out });
  });
  burst(tl, P0.lay, b.x + b.w * cx / 100, b.y + b.h * cy / 100, 'tp-flash--gold', dur * .18, 380, b.w * 1.6);
  return tl.start();
};

/* Dissolution : la carte part en poussière dorée, balayée de gauche à droite. */
A.dissolve = function (card, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, R = rnd(o.seed || 9), dur = o.duration || D.dissolve;
  var g = piece(P0.lay, P0.src, b, 'inset(0 0 0 0)');
  tl.add(g, [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 0%)', offset: .12 }, { clipPath: 'inset(0 0 0 100%)' }], { duration: dur * .8, easing: E.inOut });
  var edgeL = P0.lay.appendChild(mk('span', 'tp-dissolveedge'));
  edgeL.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;height:' + b.h + 'px';
  tl.add(edgeL, [{ transform: 'translateX(0)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1, offset: .12 }, { transform: 'translateX(' + b.w + 'px)', opacity: 1, offset: .96 }, { transform: 'translateX(' + b.w + 'px)', opacity: 0 }], { duration: dur * .8, easing: E.inOut });
  for (var i = 0; i < 90; i++) {
    var fx = R(), fy = R(), x = b.x + fx * b.w, y = b.y + fy * b.h, t0 = .1 + fx * .62;
    var d = P0.lay.appendChild(mk('span', i % 3 ? 'tp-dust' : 'tp-dust tp-dust--face'));
    var dx = 40 + R() * 120, dy = -(20 + R() * 90);
    if (i % 4 === 0) { d.style.width = '7px'; d.style.height = '7px'; }
    tl.add(d, [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(1)', opacity: 0 }, { transform: 'translate(' + x + 'px,' + y + 'px) scale(1)', opacity: 1, offset: .05 }, { transform: 'translate(' + (x + dx) + 'px,' + (y + dy) + 'px) scale(.2)', opacity: 0 }], { duration: 520 + R() * 420, delay: t0 * dur * .8, easing: E.out });
  }
  return tl.start();
};

/* Entaille : un coup d'épée traverse la carte en diagonale, les deux moitiés glissent et tombent. */
A.slash = function (card, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, dur = o.duration || D.slash;
  var up = piece(P0.lay, P0.src, b, 'polygon(0 0,100% 0,100% 18%,0 82%)');
  var dn = piece(P0.lay, P0.src, b, 'polygon(0 82%,100% 18%,100% 100%,0 100%)');
  var ang = Math.atan2(b.h * .64, b.w) * 180 / Math.PI;
  var line = P0.lay.appendChild(mk('span', 'tp-slashline'));
  var L2 = Math.sqrt(b.w * b.w + b.h * b.h * .41) * 1.5;
  line.style.cssText = 'left:' + (b.cx - L2 / 2) + 'px;top:' + b.cy + 'px;width:' + L2 + 'px;transform:rotate(' + (-ang) + 'deg)';
  tl.add(line, [{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: .45 }, { clipPath: 'inset(0 0 0 100%)', opacity: .6 }], { duration: dur * .36, easing: E.out });
  var ux = Math.cos(ang * Math.PI / 180), uy = -Math.sin(ang * Math.PI / 180);
  tl.add(up, [{ transform: 'none', opacity: 1 }, { transform: 'none', opacity: 1, offset: .22 }, { transform: 'translate(' + ux * 18 + 'px,' + (uy * 18 - 8) + 'px) rotate(-4deg)', opacity: 1, offset: .5, easing: E.out }, { transform: 'translate(' + (ux * 50 - 20) + 'px,' + (b.h * .9) + 'px) rotate(-22deg)', opacity: 0, easing: E.in }], { duration: dur });
  tl.add(dn, [{ transform: 'none', opacity: 1 }, { transform: 'none', opacity: 1, offset: .22 }, { transform: 'translate(' + (-ux * 14) + 'px,' + (-uy * 14 + 6) + 'px) rotate(3deg)', opacity: 1, offset: .5, easing: E.out }, { transform: 'translate(' + (-ux * 30 + 10) + 'px,' + (b.h * 1.1) + 'px) rotate(16deg)', opacity: 0, easing: E.in }], { duration: dur });
  burst(tl, P0.lay, b.cx, b.cy, 'tp-flash--white', dur * .12, 300, b.w);
  return tl.start();
};
A.destroy = function (card, kind, o) { return (A[kind] || A.tear)(card, o); };

/* ======================= La Chute des Rois ======================= */

/* Impact : « −14 » jaillit, la jauge de PV se vide (traînée dorée qui rattrape), éclat, tremblement. o.double : le chiffre se dédouble. */
A.impact = function (boss, dmg, o) {
  o = o || {};
  var tl = new TL(o);
  var g = q(boss, '.tp-gauge'), fill = q(g, '.tp-gauge__fill'), trail = q(g, '.tp-gauge__trail'), val = q(g, '.tp-gauge__v');
  var max = +g.getAttribute('aria-valuemax'), now = +g.getAttribute('aria-valuenow');
  var from = o.from != null ? o.from : now + dmg, to = Math.max(0, from - dmg);
  var p0 = Math.min(1, from / max), p1 = to / max;
  fill.style.setProperty('--p', p1.toFixed(3)); trail.style.setProperty('--p', p1.toFixed(3));
  g.setAttribute('aria-valuenow', to);
  if (!tl.on) { val.textContent = to + '/' + max; return tl.start(); }
  var root = rootOf(boss, o), lay = layer(root, tl), card = q(boss, '.tp-boss__card .tp-card') || boss, cb = box(card, root);
  var t = 0;
  if (o.double) {
    var half = Math.round(dmg / 2);
    var a1 = lay.appendChild(mk('span', 'tp-float tp-float--dmg', '−' + half)), a2 = lay.appendChild(mk('span', 'tp-float tp-float--dmg', '−' + half));
    [[a1, -1], [a2, 1]].forEach(function (x) {
      tl.add(x[0], [
        { transform: 'translate(' + cb.cx + 'px,' + (cb.y - 4) + 'px) translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: 'translate(' + cb.cx + 'px,' + (cb.y - 20) + 'px) translate(-50%,-50%) scale(1.1)', opacity: 1, offset: .25 },
        { transform: 'translate(' + (cb.cx + x[1] * 34) + 'px,' + (cb.y - 26) + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .6 },
        { transform: 'translate(' + cb.cx + 'px,' + (cb.y - 30) + 'px) translate(-50%,-50%) scale(.6)', opacity: 0 }
      ], { duration: 520, easing: E.out });
    });
    var x2 = lay.appendChild(mk('span', 'tp-float tp-float--x2', '×2'));
    tl.add(x2, [{ transform: 'translate(' + cb.cx + 'px,' + (cb.y - 26) + 'px) translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(' + cb.cx + 'px,' + (cb.y - 26) + 'px) translate(-50%,-50%) scale(1.3)', opacity: 1, offset: .5 }, { transform: 'translate(' + cb.cx + 'px,' + (cb.y - 26) + 'px) translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 300, delay: 300, easing: E.back });
    t = 460;
  }
  floatText(tl, lay, '−' + dmg, cb.cx, cb.y - 18, 'tp-float--dmg tp-float--big', t, 1000);
  burst(tl, lay, cb.cx, cb.cy, 'tp-flash--gold', t + 40, 380, cb.w * 1.3);
  tl.add(card, [{ transform: 'none', filter: 'none' }, { transform: 'translateX(-8px) rotate(-1.5deg)', filter: 'brightness(1.6)', offset: .15 }, { transform: 'translateX(7px) rotate(1deg)', offset: .35 }, { transform: 'translateX(-4px)', offset: .55 }, { transform: 'none', filter: 'none' }], { duration: 460, delay: t + 40, easing: E.std });
  tl.add(fill, [{ width: (p0 * 100) + '%' }, { width: (p1 * 100) + '%' }], { duration: 420, delay: t + 120, easing: E.out });
  tl.add(trail, [{ width: (p0 * 100) + '%', opacity: 1 }, { width: (p0 * 100) + '%', opacity: 1, offset: .4 }, { width: (p1 * 100) + '%', opacity: 1, offset: .95 }, { width: (p1 * 100) + '%', opacity: 0 }], { duration: 760, delay: t + 120, easing: E.inOut });
  swapText(tl, val, from + '/' + max, to + '/' + max, t + 120, 300);
  return tl.start();
};

/* ♠ Bouclier : le bouclier se forme devant l'attaque, qui baisse. o.atk [avant, après], o.shield [avant, après] */
A.shield = function (boss, o) {
  o = o || {};
  var tl = new TL(o);
  var atk = q(boss, '.tp-boss__atk b'), sh = q(boss, '.tp-boss__shield b');
  if (!tl.on) { if (atk && o.atk) atk.textContent = o.atk[1]; if (sh && o.shield) sh.textContent = o.shield[1]; return tl.start(); }
  var root = rootOf(boss, o), lay = layer(root, tl), anchor = q(boss, '.tp-boss__atk') || boss, b = box(anchor, root);
  var s = lay.appendChild(mk('span', 'tp-shieldfx', T.icon('shield')));
  tl.add(s, [
    { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(.2)', opacity: 0 },
    { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .35, easing: E.back },
    { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .7 },
    { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(1.1)', opacity: 0 }
  ], { duration: D.shield, easing: E.out });
  burst(tl, lay, b.cx, b.cy, 'tp-flash--white', 120, 360, 120);
  if (atk && o.atk) swapText(tl, atk, o.atk[0], o.atk[1], 300, 300);
  if (sh && o.shield) swapText(tl, sh, o.shield[0], o.shield[1], 260, 300);
  return tl.start();
};

/* ♥ Soin : des cartes de la défausse filent sous la Taverne. */
A.heal = function (discard, tavern, n, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(tavern, o), lay = layer(root, tl);
  var a = box(q(discard, '.tp-pile__stack') || discard, root), b = box(q(tavern, '.tp-pile__stack') || tavern, root);
  var k = Math.min(n, 8);
  for (var i = 0; i < k; i++) {
    var g = ghost(lay, backHtml(), { x: b.x, y: b.y + 6, w: b.w, h: b.h, cx: b.cx, cy: b.cy + 6 });
    g.style.zIndex = '-1';
    flight(tl, g, a, { x: b.x, y: b.y + 6, w: b.w, h: b.h, cx: b.cx, cy: b.cy + 6 }, { duration: 460, delay: i * 70, lift: 60, rot0: 8, rot1: 0, fade1: true, mid: .45 });
  }
  var hb = box(tavern, root);
  floatText(tl, lay, '+' + n, hb.cx, hb.y, 'tp-float--heal', k * 70 + 200, 900);
  if (o.counters) {
    swapText(tl, q(discard, '.tp-pile__count'), o.counters[0][0], o.counters[0][1], 200, 240);
    swapText(tl, q(tavern, '.tp-pile__count'), o.counters[1][0], o.counters[1][1], k * 70 + 300, 240);
  }
  return tl.start();
};

/* ♦ Pioche : la Taverne distribue N cartes à tour de rôle (sièges dans l'ordre, ma main comprise). targets : sièges ou cartes de ma main. */
A.drawRound = function (pile, targets, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(pile, o), lay = layer(root, tl), a = box(q(pile, '.tp-pile__stack') || pile, root);
  targets.forEach(function (t, i) {
    var delay = i * (o.stagger || D.drawRound);
    if (t.classList.contains('tp-card')) {
      var b = box(t, root), g = ghost(lay, t, b);
      g.classList.add('is-flipping');
      flight(tl, g, a, b, { duration: 520, delay: delay, flip: true, lift: 50, rot0: -6 });
      hideUntil(tl, t, delay + 520);
    } else {
      var f = q(t, '.tp-fan') || q(t, '.tp-avatar') || t, b0 = box(f, root), w = a.w * .55, h = a.h * .55;
      var bb = { x: b0.cx - w / 2, y: b0.cy - h / 2, w: w, h: h, cx: b0.cx, cy: b0.cy };
      flight(tl, ghost(lay, backHtml(), bb), a, bb, { duration: 420, delay: delay, lift: 30, rot0: -6, fade1: true, mid: .5 });
    }
  });
  return tl.start();
};

/* Immunité : le pouvoir est barré, « Immunisé » s'imprime sur la légende. */
A.immune = function (power, o) {
  o = o || {};
  var tl = new TL(o);
  if (power) power.setAttribute('data-immune', '');
  if (!tl.on || !power) return tl.start();
  var root = rootOf(power, o), lay = layer(root, tl), g = q(power, '.tp-power__g') || power, b = box(g, root);
  var bar = lay.appendChild(mk('span', 'tp-immunefx', T.icon('immune')));
  tl.add(bar, [{ transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(2.4) rotate(-30deg)', opacity: 0 }, { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(.9) rotate(0)', opacity: 1, offset: .45, easing: E.back }, { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .8 }, { transform: 'translate(' + b.cx + 'px,' + b.cy + 'px) translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: D.immune, easing: E.out });
  shake(tl, power, 280, 320, 4);
  var pb = box(power, root);
  floatText(tl, lay, 'Immunisé', pb.x + pb.w * .6, pb.y, 'tp-float--danger', 300, 1000);
  return tl.start();
};

/* Riposte : le boss charge vers le siège visé, l'alerte « Encaisse 11 » s'impose. */
A.ripost = function (boss, seat, atk, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(boss, o), lay = layer(root, tl), card = q(boss, '.tp-boss__card .tp-card') || boss, a = box(card, root), b = box(seat, root);
  var dx = (b.cx - a.cx) * .32, dy = (b.cy - a.cy) * .32;
  tl.add(card, [
    { transform: 'none' }, { transform: 'translate(' + (-dx * .15) + 'px,' + (-dy * .15) + 'px) scale(.96) rotate(-3deg)', offset: .25, easing: E.in },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1.12) rotate(4deg)', offset: .5, easing: E.out },
    { transform: 'translate(' + dx * .9 + 'px,' + dy * .9 + 'px) scale(1.1)', offset: .6 }, { transform: 'none' }
  ], { duration: 820, easing: E.inOut });
  tl.add(card, [{ zIndex: 20 }, { zIndex: 20 }], { duration: 820 });
  burst(tl, lay, b.cx, b.cy, 'tp-flash--danger', 380, 420, Math.max(b.w, 120));
  shake(tl, seat, 400, 360, 7);
  var al = lay.appendChild(mk('div', 'tp-alertfx', T.icon('warning') + '<span>' + rich(o.text || ('Encaisse ' + atk)) + '</span>'));
  var rb = box(root, root);
  tl.add(al, [{ transform: 'translate(' + (rb.w / 2) + 'px,' + (rb.h * .5) + 'px) translate(-50%,-50%) scale(1.6)', opacity: 0 }, { transform: 'translate(' + (rb.w / 2) + 'px,' + (rb.h * .5) + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .2, easing: E.back }, { transform: 'translate(' + (rb.w / 2) + 'px,' + (rb.h * .5) + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .8 }, { transform: 'translate(' + (rb.w / 2) + 'px,' + (rb.h * .5) + 'px) translate(-50%,-50%) scale(.96)', opacity: 0 }], { duration: 1300, delay: 420, easing: E.out });
  return tl.start();
};

/* Encaissement : les cartes défaussées filent vers la défausse, la jauge se remplit. o.paid [avant, après] */
A.pay = function (cards, discard, o) {
  o = o || {};
  var tl = new TL(o), list = cardsOf(cards), gauge = o.gauge;
  if (gauge && o.paid) {
    var m = +gauge.getAttribute('aria-valuemax'), f = q(gauge, '.tp-gauge__fill'), v = q(gauge, '.tp-gauge__v');
    f.style.setProperty('--p', Math.min(1, o.paid[1] / m).toFixed(3));
    gauge.setAttribute('aria-valuenow', o.paid[1]);
    if (tl.on) { tl.add(f, [{ width: Math.min(1, o.paid[0] / m) * 100 + '%' }, { width: Math.min(1, o.paid[1] / m) * 100 + '%' }], { duration: 420, delay: list.length * 90 + 200, easing: E.out }); swapText(tl, v, v.textContent.replace(/^\d+/, o.paid[0]), v.textContent.replace(/^\d+/, o.paid[1]), list.length * 90 + 200, 260); }
    else v.textContent = v.textContent.replace(/^\d+/, o.paid[1]);
  }
  if (!tl.on) { list.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); }); return tl.start(); }
  var root = rootOf(discard, o), lay = layer(root, tl), b = box(q(discard, '.tp-pile__stack') || discard, root);
  list.forEach(function (c, i) {
    var a = box(c, root), g = ghost(lay, c, b);
    flight(tl, g, a, b, { duration: D.pay, delay: i * 90, lift: 50, rot0: 0, rot1: (i % 2 ? 6 : -6), easing: E.inOut });
    c.style.visibility = 'hidden';
    tl.then(function () { if (c.parentNode) c.parentNode.removeChild(c); });
  });
  return tl.start();
};

/* K.O. : tampon « K.O. » puis la carte vole sur la Taverne. */
A.ko = function (card, tavern, o) {
  o = o || {};
  var tl = new TL(o), P0 = prepDestroy(card, o, tl);
  if (!tl.on) return tl.start();
  var b = P0.b, g = ghost(P0.lay, P0.src, b), dur = o.duration || D.ko;
  var stamp = mk('span', 'tp-stamp', 'K.O.');
  g.appendChild(stamp);
  tl.add(stamp, [{ transform: 'translate(-50%,-50%) rotate(-14deg) scale(2.6)', opacity: 0 }, { transform: 'translate(-50%,-50%) rotate(-14deg) scale(.92)', opacity: 1, offset: .6, easing: E.in }, { transform: 'translate(-50%,-50%) rotate(-14deg) scale(1)', opacity: 1 }], { duration: 360, easing: E.out });
  tl.add(g, [{ transform: 'none' }, { transform: 'scale(.97)', offset: .5 }, { transform: 'none' }], { duration: 200, delay: 220 });
  burst(tl, P0.lay, b.cx, b.cy, 'tp-flash--gold', 230, 420, b.w * 1.5);
  if (tavern) {
    var t = box(q(tavern, '.tp-pile__stack') || tavern, P0.root);
    var dx = t.cx - b.cx, dy = t.cy - b.cy, s = t.w / b.w;
    tl.add(g, [{ transform: P(0, 0, 1, 0) }, { transform: P(dx * .4, dy * .4 - 70, (1 + s) / 2 * 1.05, 8), offset: .5 }, { transform: P(dx, dy, s, 0) }], { duration: 640, delay: 620, easing: E.inOut });
    tl.add(g, [{ opacity: 1 }, { opacity: 1, offset: .9 }, { opacity: 0 }], { duration: 640, delay: 620 });
    if (o.counter) swapText(tl, q(tavern, '.tp-pile__count'), o.counter[0], o.counter[1], 1220, 240);
  }
  return tl.start();
};

/* Nouveau boss : retourné depuis le Château, arrivée lourde en xl au centre, puis il prend sa place ; ses PV se remplissent. */
A.newBoss = function (boss, castle, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(boss, o), lay = layer(root, tl), card = q(boss, '.tp-boss__card .tp-card'), b = box(card, root);
  var a = box(q(castle, '.tp-pile__stack') || castle, root), rb = box(root, root);
  var H = Math.min(rb.h * .62, b.h * 1.9), W = H * 5 / 7, c = { x: rb.w / 2 - W / 2, y: rb.h / 2 - H / 2, w: W, h: H, cx: rb.w / 2, cy: rb.h / 2 };
  var g = ghost(lay, card, b);
  g.classList.add('is-flipping');
  var veil = lay.appendChild(mk('span', 'tp-veil'));
  tl.add(veil, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .7 }, { opacity: 0 }], { duration: D.newBoss, easing: E.inOut });
  var sc = c.w / b.w;
  tl.add(g, [
    { transform: P(a.cx - b.cx, a.cy - b.cy, a.w / b.w, 0, 180), offset: 0 },
    { transform: P(c.cx - b.cx, c.cy - b.cy - 30, sc * 1.08, 0, 180), offset: .24, easing: E.inOut },
    { transform: P(c.cx - b.cx, c.cy - b.cy, sc, 0, 0), offset: .36, easing: E.heavy },
    { transform: P(c.cx - b.cx, c.cy - b.cy + 6, sc * .985, 0, 0), offset: .4, easing: E.out },
    { transform: P(c.cx - b.cx, c.cy - b.cy, sc, 0, 0), offset: .68, easing: E.inOut },
    { transform: P(0, 0, 1, 0, 0), offset: .9, easing: E.out },
    { transform: P(0, 0, 1, 0, 0), offset: 1 }
  ], { duration: D.newBoss, easing: E.inOut });
  burst(tl, lay, c.cx, c.cy, 'tp-flash--gold', D.newBoss * .37, 520, c.w * 1.4);
  var shakeEl = root.querySelector('.tp-table') || root;
  tl.add(shakeEl, [{ transform: 'none' }, { transform: 'translateY(5px)' }, { transform: 'translateY(-3px)' }, { transform: 'none' }], { duration: 260, delay: D.newBoss * .37, easing: E.std });
  hideUntil(tl, card, D.newBoss * .9);
  var info = q(boss, '.tp-boss__info');
  if (info) tl.add(info, [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: D.newBoss * .84, easing: E.out });
  var gg = q(boss, '.tp-gauge');
  if (gg) {
    var f = q(gg, '.tp-gauge__fill'), v = q(gg, '.tp-gauge__v'), max = +gg.getAttribute('aria-valuemax');
    tl.add(f, [{ width: '0%' }, { width: '100%' }], { duration: 520, delay: D.newBoss * .88, easing: E.out });
    countUp(tl, v, 0, max, D.newBoss * .88, 520, function (x) { return x + '/' + max; });
  }
  return tl.start();
};

/* Victoire : 12 couronnes s'allument en arc, puis l'écran de fin. */
A.victory = function (end, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(end, o), lay = layer(root, tl), rb = box(root, root);
  for (var i = 0; i < 12; i++) {
    var ang = Math.PI * (1.1 + i / 11 * .8), R = Math.min(rb.w, rb.h * 1.6) * .34;
    var x = rb.w / 2 + Math.cos(ang) * R, y = rb.h * .62 + Math.sin(ang) * R * .7;
    var cr = lay.appendChild(mk('span', 'tp-crownfx', T.icon('crown')));
    tl.add(cr, [{ transform: 'translate(' + x + 'px,' + (y + 30) + 'px) translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .3, easing: E.back }, { transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) scale(1)', opacity: 1, offset: .8 }, { transform: 'translate(' + x + 'px,' + (y - 20) + 'px) translate(-50%,-50%) scale(1)', opacity: 0 }], { duration: 1300, delay: i * 70, easing: E.out });
  }
  var card = q(end, '.tp-end__card');
  if (card) tl.add(card, [{ opacity: 0, transform: 'translateY(30px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 900, easing: E.out });
  var glow = q(end, '.tp-end__glow');
  if (glow) tl.add(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 700 });
  var em = q(end, '.tp-end__emblem');
  if (em) tl.add(em, [{ transform: 'scale(.3) rotate(-30deg)' }, { transform: 'scale(1.15)', offset: .6 }, { transform: 'none' }], { duration: 560, delay: 1100, easing: E.back });
  qa(end, '.tp-rank__r').forEach(function (r, i) { tl.add(r, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 1400 + i * 90, easing: E.out }); });
  return tl.start();
};
/* Défaite : la lumière baisse, l'écran de fin tombe lourdement. */
A.defeat = function (end, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  tl.add(end, [{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'var(--scrim)' }], { duration: 900, easing: E.in });
  var card = q(end, '.tp-end__card');
  if (card) tl.add(card, [{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'translateY(6px)', offset: .7, easing: E.in }, { opacity: 1, transform: 'none' }], { duration: 640, delay: 700 });
  var em = q(end, '.tp-end__emblem');
  if (em) shake(tl, em, 1300, 360, 4);
  return tl.start();
};

/* ======================= Tarot ======================= */

/* Chien retourné : les cartes se retournent en éventail, une à une. */
A.chienReveal = function (cards, o) {
  o = o || {};
  var tl = new TL(o), list = cardsOf(cards);
  list.forEach(function (c) { T.Card.flip(c, true); });
  if (!tl.on) return tl.start();
  list.forEach(function (c, i) {
    c.classList.add('is-flipping');
    var off = (i - (list.length - 1) / 2);
    tl.add(c, [
      { transform: 'perspective(900px) translateX(' + (-off * 40) + 'px) rotateY(180deg)', offset: 0 },
      { transform: 'perspective(900px) translateX(' + (-off * 20) + 'px) translateY(-14px) rotateY(90deg) scale(1.06)', offset: .5 },
      { transform: 'perspective(900px) rotateY(0deg)', offset: 1 }
    ], { duration: 520, delay: i * 110, easing: E.inOut });
  });
  tl.then(function () { list.forEach(function (c) { c.classList.remove('is-flipping'); }); });
  return tl.start();
};
/* Chien pris : les cartes du chien glissent dans la main du preneur (cartes de la main ayant les mêmes data-card-id). */
A.chienTake = function (chien, hand, o) {
  o = o || {};
  var tl = new TL(o), list = cardsOf(chien);
  if (!tl.on) return tl.start();
  var root = rootOf(hand, o), lay = layer(root, tl);
  list.forEach(function (c, i) {
    var id = c.getAttribute('data-card-id'), dst = q(hand, '.tp-card[data-card-id="' + id + '"]');
    var a = box(c, root);
    c.style.visibility = 'hidden';
    if (!dst) return;
    var b = box(dst, root), g = ghost(lay, dst, b);
    flight(tl, g, a, b, { duration: D.chienTake, delay: i * 90, lift: 40, rot0: 0 });
    hideUntil(tl, dst, i * 90 + D.chienTake);
  });
  return tl.start();
};
/* Écart : les cartes choisies filent, face cachée, vers le tas du preneur. */
A.ecart = function (cards, pile, o) {
  o = o || {};
  var tl = new TL(o), list = cardsOf(cards);
  if (!tl.on) { list.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); }); return tl.start(); }
  var root = rootOf(pile, o), lay = layer(root, tl), b0 = box(pile, root);
  list.forEach(function (c, i) {
    var a = box(c, root), b = { x: b0.cx - a.w * .35, y: b0.cy - a.h * .35, w: a.w * .7, h: a.h * .7, cx: b0.cx, cy: b0.cy };
    var g = ghost(lay, c, b);
    g.classList.add('is-flipping');
    flight(tl, g, a, b, { duration: D.ecart, delay: i * 80, lift: 40, flipDown: true, rot1: (i - 2) * 4 });
    tl.add(g, [{ opacity: 1 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: D.ecart, delay: i * 80 });
    c.style.visibility = 'hidden';
    tl.then(function () { if (c.parentNode) c.parentNode.removeChild(c); });
  });
  return tl.start();
};
/* Roi appelé : le Roi apparaît en grand au centre, puis se réduit dans le bandeau du contrat. */
A.kingCall = function (card, target, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(target, o), lay = layer(root, tl), rb = box(root, root), t = box(target, root);
  var H = Math.min(rb.h * .5, 420), W = H * 5 / 7, c = { x: rb.w / 2 - W / 2, y: rb.h * .45 - H / 2, w: W, h: H, cx: rb.w / 2, cy: rb.h * .45 };
  var g = ghost(lay, typeof card === 'string' ? card : T.Card(Object.assign({ size: 'xl' }, card)), c);
  var veil = lay.insertBefore(mk('span', 'tp-veil'), g);
  tl.add(veil, [{ opacity: 0 }, { opacity: .8, offset: .2 }, { opacity: .8, offset: .6 }, { opacity: 0 }], { duration: D.kingCall });
  var s = Math.min(t.h * 1.6, 60) / H;
  tl.add(g, [
    { transform: P(0, 40, .6, -6), opacity: 0, offset: 0 },
    { transform: P(0, 0, 1.04, 0), opacity: 1, offset: .2, easing: E.back },
    { transform: P(0, 0, 1, 0), opacity: 1, offset: .6, easing: E.inOut },
    { transform: P(t.cx - c.cx, t.cy - c.cy, s, 0), opacity: 1, offset: .92, easing: E.inOut },
    { transform: P(t.cx - c.cx, t.cy - c.cy, s * .8, 0), opacity: 0, offset: 1 }
  ], { duration: D.kingCall, easing: E.out });
  sparks(tl, lay, c.cx, c.cy - H * .3, 10, W * .7, D.kingCall * .14);
  tl.add(target, [{ boxShadow: 'none' }, { boxShadow: 'none', offset: .85 }, { boxShadow: 'var(--glow-winner)', offset: .93 }, { boxShadow: 'none' }], { duration: D.kingCall + 300 });
  return tl.start();
};
/* Poignée : l'éventail est montré à tous puis se replie. */
A.handful = function (show, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var cards = qa(show, '.tp-card'), n = cards.length, root = rootOf(show, o);
  var rs = cards.map(function (c) { return box(c, root); }), cx0 = rs[0] ? rs[0].cx : 0;
  cards.forEach(function (c, i) {
    var dx = rs[0].cx - rs[i].cx, rot = (i - (n - 1) / 2) * 5;
    tl.add(c, [
      { transform: 'translateX(' + dx + 'px) rotate(0) translateY(8px)', opacity: 0 },
      { transform: 'translateX(' + dx + 'px) translateY(-6px)', opacity: 1, offset: .12 },
      { transform: 'rotate(' + rot + 'deg) translateY(-10px)', opacity: 1, offset: .32, easing: E.out },
      { transform: 'rotate(' + rot + 'deg) translateY(-10px)', opacity: 1, offset: .74 },
      { transform: 'translateX(' + dx + 'px)', opacity: 1, offset: 1, easing: E.inOut }
    ], { duration: D.handful, delay: i * 18, easing: E.out });
  });
  return tl.start();
};
/* Pli : gardé ~1,2 s, la gagnante s'illumine, puis le pli file vers le gagnant (compteur de plis +1). */
A.collect = function (trick, seat, o) {
  o = o || {};
  var tl = new TL(o);
  var cards = qa(trick, '.tp-card:not(.tp-card--slot)');
  var hold = o.hold != null ? o.hold : D.hold;
  if (!tl.on) { if (o.clear !== false) cards.forEach(function (c) { c.remove(); }); return tl.start(); }
  var root = rootOf(trick, o), lay = layer(root, tl), dst = q(seat, '.tp-avatar') || seat, b0 = box(dst, root);
  var win = q(trick, '.tp-card[data-state~="winner"]');
  if (win) tl.add(win, [{ boxShadow: 'var(--shadow-card)' }, { boxShadow: 'var(--shadow-card-lift), var(--glow-winner)', offset: .3 }, { boxShadow: 'var(--shadow-card-lift), var(--glow-winner)' }], { duration: hold * .6 });
  cards.forEach(function (c, i) {
    var a = box(c, root), w = a.w * .4, h = a.h * .4, b = { x: b0.cx - w / 2, y: b0.cy - h / 2, w: w, h: h, cx: b0.cx, cy: b0.cy };
    var g = ghost(lay, c, a);
    tl.add(g, [{ transform: 'none', opacity: 1 }, { transform: P(b.cx - a.cx, b.cy - a.cy, .4, (i - 2) * 8), opacity: 1, offset: .85 }, { transform: P(b.cx - a.cx, b.cy - a.cy, .3, (i - 2) * 8), opacity: 0 }], { duration: D.collect, delay: hold + i * 40, easing: E.inOut });
    if (o.clear !== false) { tl.add(c, [{ opacity: 1 }, { opacity: 1, offset: .999 }, { opacity: 0 }], { duration: hold }); tl.then(function () { c.remove(); }); }
  });
  var meta = q(seat, '.tp-seat__meta');
  if (meta && o.tricks) swapText(tl, meta, o.tricks[0], o.tricks[1], hold + D.collect, 260);
  return tl.start();
};
/* L'Excuse revient à son camp (vers le siège de son joueur). */
A.excuse = function (card, seat, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) { card.remove(); return tl.start(); }
  var root = rootOf(seat, o), lay = layer(root, tl), a = box(card, root), d = box(q(seat, '.tp-avatar') || seat, root);
  var b = { x: d.cx - a.w * .25, y: d.cy - a.h * .25, w: a.w * .5, h: a.h * .5, cx: d.cx, cy: d.cy };
  var g = ghost(lay, card, b);
  card.style.visibility = 'hidden';
  tl.then(function () { card.remove(); });
  tl.add(g, [{ transform: P(a.cx - b.cx, a.cy - b.cy, 2, 0), opacity: 1 }, { transform: P(a.cx - b.cx, a.cy - b.cy - 26, 2.1, -6), opacity: 1, offset: .22, easing: E.out }, { transform: P(0, 0, 1, 12), opacity: 1, offset: .9, easing: E.inOut }, { transform: P(0, 0, .8, 12), opacity: 0 }], { duration: D.excuse });
  sparks(tl, lay, a.cx, a.cy, 6, a.w * .7, 60, 'tp-spark--muted');
  return tl.start();
};
/* Révélation du partenaire : le badge éclot sur son siège. */
A.partner = function (seat, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var badge = q(seat, '.tp-badge:last-child') || seat;
  tl.add(badge, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: .6 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: E.back });
  tl.add(seat, [{ boxShadow: 'none' }, { boxShadow: 'var(--glow-winner)', offset: .4 }, { boxShadow: 'none' }], { duration: D.partner });
  var root = rootOf(seat, o), lay = layer(root, tl), b = box(badge, root);
  sparks(tl, lay, b.cx, b.cy, 8, 46, 120);
  return tl.start();
};
/* Petit au bout : étincelle et anneau d'or sur le Petit joué au dernier pli. */
A.petit = function (card, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var root = rootOf(card, o), lay = layer(root, tl), b = box(card, root);
  burst(tl, lay, b.cx, b.cy, 'tp-flash--gold', 0, 520, b.w * 2);
  sparks(tl, lay, b.cx, b.cy, 12, b.w * .95, 80);
  tl.add(card, [{ transform: 'none' }, { transform: 'scale(1.12) rotate(-3deg)', offset: .35 }, { transform: 'none' }], { duration: 600, easing: E.back });
  floatText(tl, lay, 'Petit au bout', b.cx, b.y - 10, 'tp-float--gold', 200, 1100);
  return tl.start();
};
/* Résumé de donne : les lignes s'écrivent, les gains défilent. */
A.summary = function (deal, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var v = q(deal, '.tp-deal__verdict');
  if (v) tl.add(v, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: E.back });
  qa(deal, '.tp-deal__l').forEach(function (l, i) { tl.add(l, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 300, delay: 260 + i * 120, easing: E.out }); });
  var t0 = 260 + qa(deal, '.tp-deal__l').length * 120 + 100;
  qa(deal, '.tp-deal__gains li').forEach(function (li, i) {
    tl.add(li, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: t0 + i * 70, easing: E.out });
    var bn = q(li, 'b'); if (!bn) return;
    var txt = bn.textContent, sign = txt.charAt(0), n = parseInt(txt.replace(/[^\d]/g, ''), 10);
    countUp(tl, bn, 0, n, t0 + i * 70 + 80, 640, function (x) { return sign + x; });
  });
  return tl.start();
};
/* Classement final : les lignes montent dans l'ordre. */
A.ranking = function (end, o) {
  o = o || {};
  var tl = new TL(o);
  if (!tl.on) return tl.start();
  var card = q(end, '.tp-end__card');
  if (card) tl.add(card, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: E.out });
  var rows = qa(end, '.tp-rank__r');
  rows.slice().reverse().forEach(function (r, i) { tl.add(r, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: 380 + i * 160, easing: E.back }); });
  var first = rows[0];
  if (first) tl.add(first, [{ boxShadow: 'inset 0 0 0 2px var(--accent)' }, { boxShadow: 'inset 0 0 0 2px var(--accent), var(--glow-winner)', offset: .5 }, { boxShadow: 'inset 0 0 0 2px var(--accent)' }], { duration: 700, delay: 380 + rows.length * 160 });
  return tl.start();
};

/* =====================================================================
   Planches d'animation (documentation du système).
   Tapis.boards.render(root, spec) : démo rejouable, images clés figées à t ms
   par le vrai code (Timeline.seek), chronologie, courbes.
   Tapis.boards.catalog(root, spec) : tuiles rejouables.
   ===================================================================== */
var B = T.boards = {};
var CURVES = {
  in: { v: [.5, 0, .75, 0], name: 'ease-in', use: 'Ce qui tombe ou part : accélère.' },
  out: { v: [.22, .8, .3, 1], name: 'ease-out', use: 'Ce qui arrive ou glisse : décélère. Courbe par défaut.' },
  std: { v: [.4, 0, .2, 1], name: 'standard', use: 'Changements d’état sans élan.' },
  inOut: { v: [.65, 0, .35, 1], name: 'ease-in-out', use: 'Vols en arc, allers-retours, fondus.' },
  back: { v: [.34, 1.56, .64, 1], name: 'back', use: 'Ce qui se pose ou surgit : dépasse puis revient.' },
  heavy: { v: [.7, 0, .84, 0], name: 'heavy', use: 'Arrivée lourde : le boss qui tombe sur la table.' },
  linear: { v: [0, 0, 1, 1], name: 'linear', use: 'Brûlure, balayages réguliers.' }
};
B.curves = CURVES;
function bez(v, t) { var u = 1 - t; return [3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t * t * t, 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t * t * t]; }
B.curve = function (key) {
  var c = CURVES[key] || CURVES.out, v = c.v, W = 132, H = 108, pad = 14, pts = [], ymin = 0, ymax = 1;
  for (var i = 0; i <= 48; i++) { var p = bez(v, i / 48); pts.push(p); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  function X(x) { return pad + x * (W - pad * 2); }
  function Y(y) { return H - pad - (y - ymin) / (ymax - ymin) * (H - pad * 2); }
  var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' ');
  return '<figure class="tp-curve"><svg viewBox="0 0 ' + W + ' ' + H + '" class="tp-curve__svg" aria-hidden="true"><rect x="' + pad + '" y="' + Y(1) + '" width="' + (W - pad * 2) + '" height="' + (Y(0) - Y(1)) + '" class="tp-curve__box"/>' +
    '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(v[0]) + '" y2="' + Y(v[1]) + '" class="tp-curve__handle"/><line x1="' + X(1) + '" y1="' + Y(1) + '" x2="' + X(v[2]) + '" y2="' + Y(v[3]) + '" class="tp-curve__handle"/>' +
    '<circle cx="' + X(v[0]) + '" cy="' + Y(v[1]) + '" r="3" class="tp-curve__pt"/><circle cx="' + X(v[2]) + '" cy="' + Y(v[3]) + '" r="3" class="tp-curve__pt"/><path d="' + path + '" class="tp-curve__line"/></svg>' +
    '<figcaption><b class="button">' + esc(c.name) + '</b><code>cubic-bezier(' + v.join(', ') + ')</code><span class="caption">' + esc(c.use) + '</span></figcaption></figure>';
};
function timelineSvg(spec) {
  var W = 1040, L = 250, R = 18, rowH = 24, top = 34, n = spec.tracks.length, H = top + n * rowH + 10, tot = spec.total;
  function X(t) { return L + (W - L - R) * t / tot; }
  var step = tot > 1600 ? 200 : 100, s = '';
  for (var t = 0; t <= tot; t += step) s += '<line x1="' + X(t) + '" y1="' + (top - 8) + '" x2="' + X(t) + '" y2="' + (H - 6) + '" class="tp-tl__grid"/><text x="' + X(t) + '" y="' + (top - 14) + '" class="tp-tl__tick" text-anchor="middle">' + t + '</text>';
  (spec.frames || []).forEach(function (f, i) { s += '<line x1="' + X(f) + '" y1="' + (top - 4) + '" x2="' + X(f) + '" y2="' + (H - 6) + '" class="tp-tl__frame"/><circle cx="' + X(f) + '" cy="' + (top - 4) + '" r="7" class="tp-tl__fdot"/><text x="' + X(f) + '" y="' + (top - 1) + '" class="tp-tl__fnum" text-anchor="middle">' + (i + 1) + '</text>'; });
  spec.tracks.forEach(function (tr, i) {
    var y = top + i * rowH + 6, x0 = X(tr[1]), x1 = X(Math.min(tot, tr[2])), w = Math.max(3, x1 - x0);
    var lab = (CURVES[tr[3]] || { name: tr[3] || '' }).name + ' · ' + Math.round(tr[2] - tr[1]) + ' ms';
    s += '<text x="8" y="' + (y + 11) + '" class="tp-tl__label">' + esc(tr[0]) + '</text><rect x="' + x0 + '" y="' + y + '" width="' + w + '" height="15" rx="4" class="tp-tl__bar tp-tl__bar--' + (tr[4] || 'move') + '"/>' +
      (w > 150 ? '<text x="' + (x0 + 7) + '" y="' + (y + 11) + '" class="tp-tl__in">' + esc(lab) + '</text>' : x1 > W - 140 ? '<text x="' + (x0 - 6) + '" y="' + (y + 11) + '" class="tp-tl__out" text-anchor="end">' + esc(lab) + '</text>' : '<text x="' + (x1 + 6) + '" y="' + (y + 11) + '" class="tp-tl__out">' + esc(lab) + '</text>');
  });
  return '<svg class="tp-tl" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Chronologie : ' + esc(spec.title) + ', ' + tot + ' ms">' + s + '</svg>';
}
function sceneHtml(spec) { return '<div class="' + cx('tp-scene', spec.sceneClass) + '" data-anim-root' + (spec.sceneStyle ? ' style="' + spec.sceneStyle + '"' : '') + '>' + spec.scene() + '</div>'; }
function boardRoot(spec) { var t = spec.table || 'cour'; return ' data-table="' + t + '" data-theme="' + t + '"'; }
B.render = function (root, spec) {
  var frames = spec.frames || [];
  root.innerHTML = '<article class="tp-board"' + boardRoot(spec) + '>' +
    '<header class="tp-board__head"><div class="tp-board__title"><span class="label">' + esc(spec.kicker || 'Planche d’animation') + '</span><h1 class="title-lg">' + esc(spec.title) + '</h1><p class="body">' + spec.intro + '</p></div>' +
      '<dl class="tp-board__meta">' + (spec.meta || []).map(function (m) { return '<div><dt class="label">' + esc(m[0]) + '</dt><dd>' + (/^T\./.test(m[1]) ? '<code>' + esc(m[1]) + '</code>' : m[1]) + '</dd></div>'; }).join('') + '</dl></header>' +
    '<section class="tp-board__live"><div class="tp-board__stage">' + sceneHtml(spec) + '</div><div class="tp-board__ctrl">' +
      T.Button({ variant: 'primary', label: 'Rejouer', icon: 'renew', attrs: { 'data-replay': '' } }) + T.Button({ variant: 'secondary', label: 'Ralenti ×4', icon: 'hourglass', pressed: false, attrs: { 'data-slow': '' } }) +
      T.Button({ variant: 'secondary', label: 'Finir', icon: 'pass', attrs: { 'data-finish': '' } }) + T.MotionToggle() + '<span class="tp-board__hint caption">' + (spec.hint || '« Finir » montre ce que fait .finish() quand un nouvel état arrive du serveur.') + '</span></div></section>' +
    '<section class="tp-board__sec"><h2 class="label">Image par image</h2><div class="tp-board__frames"' + (spec.cols ? ' style="grid-template-columns:repeat(' + spec.cols + ',minmax(0,1fr))"' : '') + '>' +
      frames.map(function (t, i) { return '<figure class="tp-frame2"><div class="tp-frame2__view"><div class="tp-frame2__inner">' + sceneHtml(spec) + '</div><span class="tp-frame2__n">' + (i + 1) + '</span></div><figcaption><b class="gauge">' + t + ' ms</b><span class="caption">' + esc((spec.captions || [])[i] || '') + '</span></figcaption></figure>'; }).join('') + '</div></section>' +
    '<section class="tp-board__sec"><h2 class="label">Chronologie</h2>' + timelineSvg(spec) + '</section>' +
    '<section class="tp-board__sec"><h2 class="label">Courbes</h2><div class="tp-board__curves">' + (spec.curves || ['out']).map(B.curve).join('') + '</div></section>' +
    (spec.notes ? '<section class="tp-board__notes">' + spec.notes.map(function (n) { return '<p>' + n + '</p>'; }).join('') + '</section>' : '') + '</article>';
  function buildFrames() {
    var views = qa(root, '.tp-frame2__view'), inners = qa(root, '.tp-frame2__inner');
    var avail = views[0] ? views[0].clientWidth : 240;
    var w0 = 0, h0 = 0;
    inners.forEach(function (inner, i) {
      var sc = inner.firstElementChild;
      if (!w0) { w0 = sc.offsetWidth; h0 = sc.offsetHeight; }
      var tl = spec.play(sc, { force: true, root: sc });
      tl.seek(frames[i]);
    });
    var scale = avail / (w0 || 1);
    inners.forEach(function (inner) { inner.style.transform = 'scale(' + scale + ')'; });
    views.forEach(function (v) { v.style.height = Math.ceil(h0 * scale) + 'px'; });
  }
  var fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
  fontsReady.then(function () { requestAnimationFrame(buildFrames); });
  var stage = q(root, '.tp-board__stage'), slow = false, cur = null;
  function play() {
    if (cur) cur.cancel();
    stage.innerHTML = sceneHtml(spec);
    var sc = stage.firstElementChild;
    requestAnimationFrame(function () {
      var tl = cur = spec.play(sc, { root: sc }); if (slow) cur.rate(.25);
      if (spec.restore) tl.done().then(function () { setTimeout(function () { if (stage.firstElementChild === sc && cur === tl) stage.innerHTML = sceneHtml(spec); }, 1400); });
    });
  }
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-replay]')) play();
    if (e.target.closest('[data-finish]') && cur) cur.finish();
    var s = e.target.closest('[data-slow]');
    if (s) { slow = !slow; s.setAttribute('aria-pressed', String(slow)); if (cur) cur.rate(slow ? .25 : 1); }
  });
  fontsReady.then(function () { setTimeout(play, 500); });
  return { play: play };
};
B.catalog = function (root, spec) {
  root.innerHTML = '<article class="tp-board tp-board--catalog"' + boardRoot(spec) + '><header class="tp-board__head"><div class="tp-board__title"><span class="label">' + esc(spec.kicker || 'Catalogue d’animations') + '</span><h1 class="title-lg">' + esc(spec.title) + '</h1><p class="body">' + spec.intro + '</p></div>' +
    '<div class="tp-board__ctrl">' + T.Button({ variant: 'primary', label: 'Tout rejouer', icon: 'renew', attrs: { 'data-all': '' } }) + T.MotionToggle() + '</div></header>' +
    '<div class="tp-tiles"' + (spec.cols ? ' style="grid-template-columns:repeat(' + spec.cols + ',minmax(0,1fr))"' : '') + '>' + spec.tiles.map(function (t, i) {
      return '<article class="' + cx('tp-tile', t.wide && 'tp-tile--wide') + '" data-i="' + i + '"><div class="tp-tile__stage">' + sceneHtml(t) + '</div><div class="tp-tile__txt"><h3 class="title-sm">' + esc(t.name) + '</h3><p class="tp-tile__meta gauge">' + esc(t.dur) + ' <span class="caption">· ' + esc(t.ease) + '</span></p><p class="caption">' + t.desc + '</p></div>' +
        T.Button({ variant: 'icon', icon: 'renew', label: 'Rejouer : ' + t.name, attrs: { 'data-tile': i } }) + '</article>';
    }).join('') + '</div></article>';
  var cur = {};
  function play(i) {
    var t = spec.tiles[i], st = q(root, '.tp-tile[data-i="' + i + '"] .tp-tile__stage');
    if (cur[i]) cur[i].cancel();
    st.innerHTML = sceneHtml(t);
    var sc = st.firstElementChild;
    requestAnimationFrame(function () {
      var tl = cur[i] = t.play(sc, { root: sc });
      if (t.restore) tl.done().then(function () { setTimeout(function () { if (st.firstElementChild === sc && cur[i] === tl) st.innerHTML = sceneHtml(t); }, 1400); });
    });
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tile]');
    if (b) play(+b.getAttribute('data-tile'));
    if (e.target.closest('[data-all]')) spec.tiles.forEach(function (_, i) { setTimeout(function () { play(i); }, i * 120); });
  });
  var ready = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
  ready.then(function () { spec.tiles.forEach(function (_, i) { setTimeout(function () { play(i); }, 300 + i * 160); }); });
};

/* ---------- export ---------- */
T.version = '1.0.0';
if (doc) {
  if (doc.body) ensureSprite();
  else doc.addEventListener('DOMContentLoaded', ensureSprite);
}
if (typeof window !== 'undefined') window.Tapis = Object.assign(window.Tapis || {}, T);
})();
