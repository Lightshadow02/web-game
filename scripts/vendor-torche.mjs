#!/usr/bin/env node
/**
 * Importe le design system Claude Design « Torche » (Les Profondeurs) dans le jeu.
 *
 *   node scripts/vendor-torche.mjs <dossier "project" exporté de l'artefact>
 *
 * Source : https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs (tokens.json, components/bundle.{js,css}, fonts/, assets/Licences/).
 * Sortie : games/profondeurs/client/torche/ (torche.css, bundle.js, fonts/, licences/).
 *
 * Adaptations pour vivre dans le Hub sans rien y casser :
 *  - tokens.css est compilé depuis tokens.json (même format que l'artefact) mais posé sur `.prof` au lieu de `:root` ;
 *  - toutes les règles de bundle.css sont préfixées par `:where(.prof)` (spécificité inchangée) ;
 *  - l'interrupteur d'animations (`data-motion`) vit sur l'élément `[data-motion-host]` du jeu, pas sur <html> ;
 *  - bundle.js lit les tokens et l'interrupteur sur ce même élément.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = '.prof';
const HOST = '[data-motion-host]';
const src = process.argv[2];
if (!src) {
  console.error('Usage : node scripts/vendor-torche.mjs <dossier project>');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'games/profondeurs/client/torche');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(out, 'licences'), { recursive: true });

// ------------------------------------------------------------------ tokens.json -> CSS
const tokens = JSON.parse(fs.readFileSync(path.join(src, 'tokens.json'), 'utf8'));
const alias = (v) => (typeof v === 'string' ? v.replace(/^\{([^}]+)\}$/, 'var(--$1)') : v);
const vars = [];
const firstTheme = tokens.color.themes?.[0]?.id;
for (const t of tokens.color.tokens) vars.push(`--${t.name}: ${alias(typeof t.value === 'object' ? t.value[firstTheme] : t.value)};`);
for (const [family, def] of Object.entries(tokens)) {
  if (['name', 'version', 'color', 'type'].includes(family) || !def?.tokens) continue;
  for (const t of def.tokens) vars.push(`--${t.name}: ${typeof t.value === 'number' ? `${t.value}px` : t.value};`);
}
for (const [key, stack] of Object.entries(tokens.type.families)) vars.push(`--font-${key}: ${stack};`);

const typeClasses = tokens.type.groups.flatMap((g) => g.styles.map((s) => {
  const decl = [`font-family: var(--font-${s.family ?? g.family})`, `font-size: ${s.fontSize}`];
  if (s.lineHeight) decl.push(`line-height: ${s.lineHeight}`);
  if (s.fontWeight) decl.push(`font-weight: ${s.fontWeight}`);
  if (s.letterSpacing) decl.push(`letter-spacing: ${s.letterSpacing}`);
  if (s.fontStyle) decl.push(`font-style: ${s.fontStyle}`);
  return `:where(${SCOPE}) .${s.name} { ${decl.join('; ')}; }`;
}));

const fontFaces = tokens.type.fonts.map((f) => {
  const file = path.basename(f.file);
  fs.copyFileSync(path.join(src, 'fonts', file), path.join(out, 'fonts', file));
  return `@font-face { font-family: "${f.family}"; src: url("fonts/${file}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`;
});

// ------------------------------------------------------------------ bundle.css, règles préfixées
function scopeSelector(sel) {
  const s = sel.trim();
  if (!s || s === 'html') return null;
  if (s.startsWith(':root:not([data-motion="on"])')) return `${HOST}:not([data-motion="on"])${s.slice(':root:not([data-motion="on"])'.length)}`;
  if (s.startsWith('[data-motion="off"]')) return `${HOST}${s}`;
  if (s.startsWith(':root')) return SCOPE + s.slice(5);
  if (s.startsWith('body')) return SCOPE + s.slice(4);
  return `:where(${SCOPE}) ${s}`;
}
function splitSelectors(list) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}
/** Parcourt une feuille de style (sans commentaires) et préfixe chaque sélecteur. */
function transform(css) {
  let i = 0;
  let res = '';
  while (i < css.length) {
    const open = findBrace(css, i);
    if (open < 0) { res += css.slice(i); break; }
    const prelude = css.slice(i, open).trim();
    const close = matching(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith('@media') || prelude.startsWith('@container') || prelude.startsWith('@supports')) {
      res += `${prelude} {\n${transform(body)}}\n`;
    } else if (prelude.startsWith('@')) {
      res += `${prelude} {${body}}\n`;
    } else {
      const sels = splitSelectors(prelude).map(scopeSelector).filter(Boolean);
      if (sels.length) res += `${sels.join(',\n')} {${body}}\n`;
    }
    i = close + 1;
  }
  return res;
}
function findBrace(css, from) {
  let q = null;
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === q && css[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') return i;
  }
  return -1;
}
function matching(css, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === q && css[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('Accolade non fermée');
}
const bundleCss = fs.readFileSync(path.join(src, 'components/bundle.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

fs.writeFileSync(path.join(out, 'torche.css'), [
  '/* Design system « Torche » (Claude Design) — généré par scripts/vendor-torche.mjs, ne pas modifier à la main.',
  '   Tokens et règles limités au conteneur .prof du jeu. Polices : SIL OFL 1.1 (voir licences/). */',
  ...fontFaces,
  `${SCOPE} {\n  ${vars.join('\n  ')}\n}`,
  ...typeClasses,
  transform(bundleCss),
].join('\n'));

// ------------------------------------------------------------------ bundle.js, deux points d'ancrage
let js = fs.readFileSync(path.join(src, 'components/bundle.js'), 'utf8');
const patches = [
  // l'interrupteur d'animations vit sur l'élément du jeu
  ["var MOT = T.motion = {", `function motionHost() { return (doc && doc.querySelector('${HOST}')) || doc.documentElement; }\nvar MOT = T.motion = {`],
  ["var a = doc.documentElement.getAttribute('data-motion');", "var a = motionHost().getAttribute('data-motion');"],
  ["doc.documentElement.setAttribute('data-motion', on ? 'on' : 'off');", "motionHost().setAttribute('data-motion', on ? 'on' : 'off');"],
  // les tokens sont posés sur .prof
  ["getComputedStyle(doc.documentElement).getPropertyValue('--' + name)", `getComputedStyle(doc.querySelector('${SCOPE}') || doc.documentElement).getPropertyValue('--' + name)`],
  // correctif : done() résolvait sa promesse avec la timeline, qui a une méthode then() (« thenable ») :
  // la promesse l'adoptait et ne se résolvait jamais. On résout sans valeur.
  ["    self.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });\n    return self;\n  }", "    self.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });\n  }"],
];
for (const [from, to] of patches) {
  if (!js.includes(from)) throw new Error(`Point d'ancrage introuvable dans bundle.js : ${from}`);
  js = js.replace(from, to);
}
fs.writeFileSync(path.join(out, 'bundle.js'), `/* Design system « Torche » (Claude Design) — importé par scripts/vendor-torche.mjs (interrupteur et tokens lus sur ${HOST} / ${SCOPE}). */\n${js}`);

for (const f of ['OFL-Cinzel.txt', 'OFL-Alegreya-Sans.txt', 'README.md']) {
  fs.copyFileSync(path.join(src, 'assets/Licences', f), path.join(out, 'licences', f));
}
console.log(`Torche importé dans ${path.relative(root, out)}`);
