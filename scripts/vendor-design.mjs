#!/usr/bin/env node
/**
 * Importe un design system Claude Design dans le Hub, sans qu'il déteigne sur le reste de la page.
 *
 *   node scripts/vendor-design.mjs torche <dossier "project" exporté de l'artefact>
 *   node scripts/vendor-design.mjs tapis  <dossier "project" exporté de l'artefact>
 *
 * - torche : « Donjon à la torche », Les Profondeurs (https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs)
 *            -> games/profondeurs/client/torche/, conteneur .prof
 * - tapis  : jeux de cartes, La Chute des Rois et Tarot (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD)
 *            -> public/vendor/tapis/ (partagé par tous les jeux de cartes), conteneur .tp-scope
 *
 * Adaptations (identiques pour les deux) :
 *  - tokens.css est compilé depuis tokens.json (format de l'artefact) mais posé sur le conteneur du jeu, pas sur :root
 *    (le Hub a ses propres --text, --panel, --danger…) ; les thèmes (data-theme) restent à l'intérieur du conteneur ;
 *  - toutes les règles de bundle.css sont préfixées par :where(<conteneur>) (spécificité inchangée) ;
 *  - l'interrupteur d'animations (data-motion) vit sur le conteneur [data-motion-host], pas sur <html>, et chaque
 *    système ne réagit qu'aux boutons de son propre conteneur ;
 *  - correctif : Timeline.done() résolvait sa promesse avec la timeline, qui a une méthode then() (« thenable ») :
 *    la promesse l'adoptait et ne se résolvait jamais. On résout sans valeur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SYSTEMS = {
  torche: { scope: '.prof', out: 'games/profondeurs/client/torche', css: 'torche.css' },
  tapis: { scope: '.tp-scope', out: 'public/vendor/tapis', css: 'tapis.css' },
};
const HOST = '[data-motion-host]';

const [name, src] = process.argv.slice(2);
const sys = SYSTEMS[name];
if (!sys || !src) {
  console.error('Usage : node scripts/vendor-design.mjs <torche|tapis> <dossier project>');
  process.exit(1);
}
const SCOPE = sys.scope;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, sys.out);
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(out, 'licences'), { recursive: true });

// ------------------------------------------------------------------ tokens.json -> CSS
const tokens = JSON.parse(fs.readFileSync(path.join(src, 'tokens.json'), 'utf8'));
const themes = (tokens.color.themes ?? []).map((t) => t.id);
const alias = (v) => (typeof v === 'string' ? v.replace(/^\{([^}]+)\}$/, 'var(--$1)') : v);
const valueFor = (v, theme) => (v && typeof v === 'object' ? v[theme] ?? v[themes[0]] : v);

const base = []; // valeurs communes à tous les thèmes
const perTheme = Object.fromEntries(themes.map((t) => [t, []]));
for (const family of ['color', 'shadow']) {
  for (const t of tokens[family]?.tokens ?? []) {
    if (t.value && typeof t.value === 'object' && themes.length > 1) {
      for (const th of themes) perTheme[th].push(`--${t.name}: ${alias(valueFor(t.value, th))};`);
    } else base.push(`--${t.name}: ${alias(valueFor(t.value, themes[0]))};`);
  }
}
for (const [family, def] of Object.entries(tokens)) {
  if (['name', 'version', 'color', 'type', 'shadow'].includes(family) || !def?.tokens) continue;
  for (const t of def.tokens) base.push(`--${t.name}: ${typeof t.value === 'number' ? `${t.value}px` : t.value};`);
}
for (const [key, stack] of Object.entries(tokens.type.families)) base.push(`--${'font-'}${key}: ${stack};`);

const themeBlocks = themes.length > 1
  ? themes.map((th, i) => {
    const sel = [`${SCOPE}[data-theme="${th}"]`, `:where(${SCOPE}) [data-theme="${th}"]`];
    if (i === 0) sel.unshift(SCOPE); // premier thème par défaut
    return `${sel.join(',\n')} {\n  ${perTheme[th].join('\n  ')}\n}`;
  })
  : [];

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
  if (!s || s === 'html') return [];
  if (s.startsWith(':root:not([data-motion="on"])')) return [`${HOST}:not([data-motion="on"])${s.slice(':root:not([data-motion="on"])'.length)}`];
  if (s.startsWith('[data-motion="off"]')) return [`${HOST}${s}`];
  if (s.startsWith(':root')) return [SCOPE + s.slice(5)];
  if (s.startsWith('body')) return [SCOPE + s.slice(4)];
  // un attribut en tête (data-table, data-theme, data-deck…) peut être posé sur le conteneur lui-même
  if (s.startsWith('[')) return [`${SCOPE}${s}`, `:where(${SCOPE}) ${s}`];
  return [`:where(${SCOPE}) ${s}`];
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
      const sels = splitSelectors(prelude).flatMap(scopeSelector);
      if (sels.length) res += `${sels.join(',\n')} {${body}}\n`;
    }
    i = close + 1;
  }
  return res;
}
const bundleCss = fs.readFileSync(path.join(src, 'components/bundle.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

fs.writeFileSync(path.join(out, sys.css), [
  `/* Design system « ${name} » (Claude Design) — généré par scripts/vendor-design.mjs, ne pas modifier à la main.`,
  `   Tokens et règles limités au conteneur ${SCOPE}. Polices : SIL OFL 1.1 (voir licences/). */`,
  ...fontFaces,
  `${SCOPE} {\n  ${base.join('\n  ')}\n}`,
  ...themeBlocks,
  ...typeClasses,
  transform(bundleCss),
].join('\n'));

// ------------------------------------------------------------------ bundle.js, points d'ancrage
let js = fs.readFileSync(path.join(src, 'components/bundle.js'), 'utf8');
const patches = [
  // l'interrupteur d'animations vit sur le conteneur du jeu
  [/(\n)(var MOT = T\.motion = \{)/, `$1function motionHost() { return (doc && doc.querySelector('${SCOPE}${HOST}')) || doc.documentElement; }\n$2`],
  [/doc\.documentElement\.getAttribute\('data-motion'\)/, "motionHost().getAttribute('data-motion')"],
  [/doc\.documentElement\.setAttribute\('data-motion', on \? 'on' : 'off'\)/, "motionHost().setAttribute('data-motion', on ? 'on' : 'off')"],
  // chaque système ne bascule que sur les boutons de son conteneur (deux bundles peuvent être chargés)
  [/(addEventListener\('click', function \(e\) \{[\s\S]{0,120}?)closest\('\[data-motion-toggle\]'\)/, `$1closest('${SCOPE} [data-motion-toggle]')`],
  // correctif : done() ne résout plus sa promesse avec la timeline « thenable »
  [/(function finish\(\) \{[\s\S]*?)\n    return self;\n  \}/, '$1\n  }'],
];
if (name === 'torche') {
  // Torche lit quelques tokens à l'exécution : ils sont posés sur le conteneur
  patches.push([/getComputedStyle\(doc\.documentElement\)\.getPropertyValue\('--' \+ name\)/, `getComputedStyle(doc.querySelector('${SCOPE}') || doc.documentElement).getPropertyValue('--' + name)`]);
}
for (const [from, to] of patches) {
  if (!from.test(js)) throw new Error(`Point d'ancrage introuvable dans bundle.js : ${from}`);
  js = js.replace(from, to);
}
fs.writeFileSync(path.join(out, 'bundle.js'), `/* Design system « ${name} » (Claude Design) — importé par scripts/vendor-design.mjs (interrupteur et tokens sur ${SCOPE}${HOST}). */\n${js}`);

const lic = path.join(src, 'assets/Licences');
for (const f of fs.readdirSync(lic)) fs.copyFileSync(path.join(lic, f), path.join(out, 'licences', f));
console.log(`${name} importé dans ${path.relative(root, out)}`);
