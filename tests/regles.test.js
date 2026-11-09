// Tests des règles : lance « node tests/regles.test.js »
const assert = require("assert");
const R = require("../js/regles.js");
let ok = 0;
function test(nom, fn) { fn(); ok++; console.log("✔", nom); }

test("flotte officielle : 5 navires, 17 cases", () => {
  assert.strictEqual(R.FLOTTE.length, 5);
  assert.strictEqual(R.TOTAL_CASES, 17);
});
test("un navire ne dépasse pas de la grille", () => {
  assert.ok(!R.placementValide([], { id: "pa", x: 7, y: 0, h: true }).ok);
  assert.ok(R.placementValide([], { id: "pa", x: 5, y: 0, h: true }).ok);
  assert.ok(!R.placementValide([], { id: "pa", x: 0, y: 6, h: false }).ok);
});
test("deux navires ne se chevauchent pas", () => {
  const a = [{ id: "pa", x: 0, y: 0, h: true }];
  assert.ok(!R.placementValide(a, { id: "to", x: 2, y: 0, h: false }).ok);
});
test("option « navires collés »", () => {
  const a = [{ id: "pa", x: 0, y: 0, h: true }];
  const colle = { id: "to", x: 0, y: 1, h: true };
  assert.ok(R.placementValide(a, colle, { colles: true }).ok);
  assert.ok(!R.placementValide(a, colle, { colles: false }).ok);
  assert.ok(!R.placementValide(a, { id: "to", x: 5, y: 1, h: true }, { colles: false }).ok, "diagonale interdite");
  assert.ok(R.placementValide(a, { id: "to", x: 0, y: 2, h: true }, { colles: false }).ok);
});
test("placement aléatoire toujours valide (500 essais, 2 règles)", () => {
  for (let i = 0; i < 500; i++) {
    const regles = { colles: i % 2 === 0 };
    assert.ok(R.flotteValide(R.placementAleatoire(regles), regles));
  }
});
test("recadrer ramène dans la grille", () => {
  assert.deepStrictEqual(R.recadrer({ id: "pa", x: 9, y: 9, h: true }), { id: "pa", x: 5, y: 9, h: true });
});
test("à l'eau, touché, coulé, fin de partie", () => {
  const flotte = [{ id: "to", x: 0, y: 0, h: true }, { id: "pa", x: 0, y: 2, h: true },
    { id: "cr", x: 0, y: 4, h: true }, { id: "ct", x: 0, y: 6, h: true }, { id: "sm", x: 0, y: 8, h: true }];
  const tirs = [];
  assert.strictEqual(R.resoudreTir(flotte, tirs, 9, 9).res, "eau");
  assert.strictEqual(R.resoudreTir(flotte, tirs, 0, 0).res, "touche");
  tirs.push({ x: 0, y: 0 });
  const c = R.resoudreTir(flotte, tirs, 1, 0);
  assert.strictEqual(c.res, "coule"); assert.strictEqual(c.navire, "to"); assert.ok(!c.fin);
  const toutes = flotte.flatMap(R.casesDe);
  const avant = toutes.slice(0, -1);
  const dernier = toutes[toutes.length - 1];
  assert.ok(R.resoudreTir(flotte, avant, dernier.x, dernier.y).fin);
});
test("un seul tir par tour, à tour de rôle", () => {
  assert.ok(R.estMonTour(true, 0, 0));   // premier joueur commence
  assert.ok(!R.estMonTour(false, 0, 0));
  assert.ok(R.estMonTour(false, 0, 1));  // le second répond
  assert.ok(!R.estMonTour(true, 1, 0));  // le premier attend
  assert.ok(R.estMonTour(true, 1, 1));
});
test("nom des cases", () => {
  assert.strictEqual(R.nomCase(0, 0), "A1");
  assert.strictEqual(R.nomCase(9, 9), "J10");
});

// ---------- Discussion ----------
const D = require("../js/discussion.js");
test("discussion : messages numérotés, doublons ignorés, ordre respecté", () => {
  const moi = D.initialiser({}), ami = D.initialiser({});
  const m0 = D.ecrire(moi, "  Salut   capitaine ! ");
  const m1 = D.ecrire(moi, "Prêt ?");
  assert.strictEqual(m0.texte, "Salut capitaine !");
  assert.strictEqual(D.ecrire(moi, "   "), null, "message vide refusé");
  assert.strictEqual(D.recevoir(ami, m1), null, "message 1 avant le 0 : refusé");
  assert.ok(D.recevoir(ami, m0));
  assert.strictEqual(D.recevoir(ami, m0), null, "doublon ignoré");
  assert.ok(D.recevoir(ami, m1));
  assert.deepStrictEqual(ami.chat.map((m) => m.texte), ["Salut capitaine !", "Prêt ?"]);
});
test("discussion : les messages perdus sont renvoyés", () => {
  const moi = D.initialiser({}), ami = D.initialiser({});
  const envois = ["a", "b", "c"].map((t) => D.ecrire(moi, t));
  D.recevoir(ami, envois[0]);                          // b et c se sont perdus
  const renvoi = D.aRenvoyer(moi, ami.chatRecus);
  assert.deepStrictEqual(renvoi.map((m) => m.texte), ["b", "c"]);
  renvoi.forEach((m) => D.recevoir(ami, m));
  assert.strictEqual(ami.chatRecus, 3);
  assert.deepStrictEqual(D.aRenvoyer(moi, ami.chatRecus), []);
});
test("discussion : texte trop long coupé, contenu non textuel refusé", () => {
  const moi = D.initialiser({}), ami = D.initialiser({});
  assert.strictEqual(D.ecrire(moi, "x".repeat(500)).texte.length, D.LONGUEUR_MAX);
  assert.strictEqual(D.recevoir(ami, { t: "chat", n: 0, texte: { pas: "du texte" } }), null);
});
// ---------- Ordinateur (mode solo) ----------
const IA = require("../js/ia.js");
// Hasard reproductible : les tests donnent toujours le même résultat
function graine(n) { let x = n; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }

function partieContreOrdi(niveau, rnd, regles) {
  const flotte = R.placementAleatoire(regles, rnd);
  const connu = new Array(100).fill(null);
  const recus = [];
  const coules = [];
  for (let tir = 1; tir <= 100; tir++) {
    const restants = R.FLOTTE.filter((f) => !coules.includes(f.id)).map((f) => f.taille);
    const c = IA.choisirTir(niveau, connu, restants, regles, rnd);
    assert.strictEqual(connu[c.y * 10 + c.x], null, "l'ordinateur ne tire jamais deux fois au même endroit");
    const r = R.resoudreTir(flotte, recus, c.x, c.y);
    recus.push({ x: c.x, y: c.y });
    connu[c.y * 10 + c.x] = r.res === "eau" ? "eau" : "touche";
    if (r.res === "coule") { coules.push(r.navire); r.cases.forEach((k) => (connu[k.y * 10 + k.x] = "coule")); }
    if (r.fin) return tir;
  }
  throw new Error("partie non terminée");
}
test("ordinateur : chaque niveau finit toujours la partie, et le difficile est le plus fort", () => {
  const moyennes = {};
  for (const niveau of ["facile", "moyen", "difficile"]) {
    let total = 0;
    for (let i = 0; i < 40; i++) total += partieContreOrdi(niveau, graine(i + 1), { colles: i % 2 === 0 });
    moyennes[niveau] = total / 40;
  }
  console.log("   tirs moyens pour gagner :", JSON.stringify(moyennes));
  assert.ok(moyennes.difficile < moyennes.moyen, "difficile plus fort que moyen");
  assert.ok(moyennes.moyen < moyennes.facile, "moyen plus fort que facile");
  assert.ok(moyennes.difficile < 60, "difficile vraiment redoutable");
});
test("ordinateur : après un touché, il achève le navire", () => {
  const connu = new Array(100).fill(null);
  connu[4 * 10 + 4] = "touche";
  for (const niveau of ["moyen", "difficile"]) {
    const c = IA.choisirTir(niveau, connu, [5, 4, 3, 3, 2], {}, graine(3));
    assert.strictEqual(Math.abs(c.x - 4) + Math.abs(c.y - 4), 1, niveau + " vise une case voisine");
  }
  connu[4 * 10 + 5] = "touche"; // deux touchés alignés à l'horizontale
  const c = IA.choisirTir("moyen", connu, [5, 4, 3, 3, 2], {}, graine(4));
  assert.ok(c.y === 4 && (c.x === 3 || c.x === 6), "il prolonge la ligne");
});
test("ordinateur : règle « navires séparés », il ne tire pas autour d'une épave", () => {
  const connu = new Array(100).fill("eau");
  connu[0] = "coule"; connu[1] = "coule";        // torpilleur coulé en A1-B1
  connu[2] = null; connu[11] = null; connu[99] = null;
  for (let i = 0; i < 20; i++) {
    const c = IA.choisirTir("difficile", connu, [5], { colles: false }, graine(i + 10));
    assert.deepStrictEqual(c, { x: 9, y: 9 });
  }
});

// ---------- Scores et trophées ----------
const TR = require("../js/trophees.js");
test("trophées : score face à face et premiers trophées", () => {
  const p = TR.initialiser({ victoires: 0, defaites: 0 });
  const g = TR.enregistrerPartie(p, { gagne: true, tirs: 28, reussis: 17, mesCoules: 0, idAdverse: "ami1", nomAdverse: "Léa" }, 1);
  assert.deepStrictEqual(g.sort(), ["eclair", "elite", "intouchable", "premiere"]);
  TR.enregistrerPartie(p, { gagne: false, tirs: 60, reussis: 12, mesCoules: 5, idAdverse: "ami1", nomAdverse: "Léa" }, 2);
  assert.deepStrictEqual(TR.score(p, "ami1"), { v: 1, d: 1 });
  assert.strictEqual(p.serie, 0);
  assert.deepStrictEqual(TR.enregistrerPartie(p, { gagne: true, tirs: 30, reussis: 17, mesCoules: 0, idAdverse: "ami1" }, 3), [], "un trophée ne se gagne qu'une fois");
});
test("trophées : série, sur le fil, amiral, fidèle, beau joueur", () => {
  const p = TR.initialiser({});
  TR.enregistrerPartie(p, { gagne: true, tirs: 70, reussis: 17, mesCoules: 4, idAdverse: "a" });
  assert.ok(p.trophees.fil);
  TR.enregistrerPartie(p, { gagne: true, tirs: 70, reussis: 17, mesCoules: 2, idAdverse: "ordinateur-difficile", solo: true, niveau: "difficile" });
  assert.ok(p.trophees.amiral);
  TR.enregistrerPartie(p, { gagne: true, tirs: 70, reussis: 17, mesCoules: 2, idAdverse: "a" });
  assert.ok(p.trophees.serie3);
  assert.strictEqual(p.meilleureSerie, 3);
  for (let i = 0; i < 2; i++) TR.enregistrerPartie(p, { gagne: false, tirs: 70, reussis: 10, mesCoules: 5, idAdverse: "a" });
  assert.ok(!p.trophees.fidele, "4 parties contre a : pas encore");
  TR.enregistrerPartie(p, { gagne: false, tirs: 70, reussis: 10, mesCoules: 5, idAdverse: "a" });
  assert.ok(p.trophees.fidele, "5 parties contre le même ami");
  assert.deepStrictEqual(TR.beauJoueur(p), ["beau"]);
  assert.deepStrictEqual(TR.beauJoueur(p), []);
  assert.strictEqual(TR.duels(p).length, 2);
});
console.log(`\n${ok} tests réussis`);
