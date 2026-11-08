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
console.log(`\n${ok} tests réussis`);
