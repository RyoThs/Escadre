// Tests rapides : lance « node tests/regles.test.js »
const assert = require("assert");
const R = require("../js/regles.js");
const M = require("../js/moteur.js");
const D = require("../js/discussion.js");
const IA = require("../js/ia.js");
const TR = require("../js/trophees.js");
let ok = 0;
function test(nom, fn) { fn(); ok++; console.log("✔", nom); }
// Hasard reproductible : les tests donnent toujours le même résultat
function graine(n) { let x = n; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }

// ---------- Règles ----------
test("flotte : 5 navires dont 2 larges, 27 cases ; bonus frégate et vedette", () => {
  assert.deepStrictEqual(R.flotteDe({}).map((n) => n.id), ["pa", "cr", "sm", "ct", "to"]);
  assert.strictEqual(R.totalCases({}), 27);
  assert.strictEqual(R.totalCases({ bonus: 1 }), 30);
  assert.strictEqual(R.totalCases({ bonus: 2 }), 32);
  assert.deepStrictEqual([R.NAVIRES.pa.long, R.NAVIRES.pa.larg, R.NAVIRES.cr.larg, R.NAVIRES.sm.long], [5, 2, 2, 4]);
});
test("réglages : tailles 8 à 14, le mode Compétences impose 12 ou 14", () => {
  assert.strictEqual(R.normaliser({ taille: 8 }).taille, 8);
  assert.strictEqual(R.normaliser({ taille: 9 }).taille, 10);
  assert.strictEqual(R.normaliser({ taille: 8, competences: true }).taille, 12);
  assert.strictEqual(R.normaliser({ taille: 14, competences: true }).taille, 14);
  assert.strictEqual(R.normaliser({ bonus: 7 }).bonus, 2);
});
test("navire large : 10 cases, horizontal ou vertical", () => {
  const h = R.casesDe({ id: "pa", x: 0, y: 0, h: true });
  assert.strictEqual(h.length, 10);
  assert.ok(h.some((c) => c.x === 4 && c.y === 1));
  const v = R.casesDe({ id: "pa", x: 0, y: 0, h: false });
  assert.ok(v.some((c) => c.x === 1 && c.y === 4));
});
test("un navire ne dépasse pas de la grille (selon la taille de la carte)", () => {
  assert.ok(!R.placementValide([], { id: "pa", x: 6, y: 0, h: true }, { taille: 10 }).ok);
  assert.ok(R.placementValide([], { id: "pa", x: 5, y: 8, h: true }, { taille: 10 }).ok);
  assert.ok(!R.placementValide([], { id: "pa", x: 5, y: 9, h: true }, { taille: 10 }).ok, "la largeur compte aussi");
  assert.ok(R.placementValide([], { id: "pa", x: 9, y: 0, h: true }, { taille: 14 }).ok);
  assert.deepStrictEqual(R.recadrer({ id: "cr", x: 9, y: 9, h: true }, 10), { id: "cr", x: 6, y: 8, h: true });
});
test("chevauchement et option « navires collés »", () => {
  const a = [{ id: "pa", x: 0, y: 0, h: true }];
  assert.ok(!R.placementValide(a, { id: "to", x: 2, y: 1, h: true }).ok);
  assert.ok(R.placementValide(a, { id: "to", x: 0, y: 2, h: true }, { colles: true }).ok);
  assert.ok(!R.placementValide(a, { id: "to", x: 0, y: 2, h: true }, { colles: false }).ok);
  assert.ok(R.placementValide(a, { id: "to", x: 0, y: 3, h: true }, { colles: false }).ok);
});
test("placement aléatoire toujours valide (toutes les cartes, avec bonus)", () => {
  for (let i = 0; i < 240; i++) {
    const regles = { taille: R.TAILLES[i % 4], bonus: i % 3, colles: i % 2 === 0 };
    if (!R.reglesJouables(regles)) continue;
    assert.ok(R.flotteValide(R.placementAleatoire(regles, graine(i + 1)), regles), JSON.stringify(regles));
  }
});
test("nom des cases jusqu'à N14", () => {
  assert.strictEqual(R.nomCase(0, 0), "A1");
  assert.strictEqual(R.nomCase(13, 13), "N14");
});

// ---------- Moteur : tours, compétences, anti-triche ----------
// Une petite flotte connue pour tester les compétences
const REG = { taille: 12, competences: true };
const FLOTTE = [
  { id: "pa", x: 0, y: 0, h: true },  // A1-E2
  { id: "cr", x: 0, y: 4, h: true },  // A5-D6
  { id: "sm", x: 11, y: 0, h: false }, // L1-L4
  { id: "ct", x: 6, y: 9, h: true },  // G10-I10
  { id: "to", x: 10, y: 11, h: true }, // K12-L12
];
const action = (g, qui, type, p) => ({ g, qui, type, p: M.normaliserParams(type, p, 12), res: null });
function resoudre(journal, a, defense) {
  const e = M.etatDefense(FLOTTE, defense || [], journal, "invite", REG);
  a.res = e.resoudre(a, graine(1));
  journal.push(a);
  return a.res;
}
// L'invité joue « à l'eau » sur la grille de l'hôte (résultat inventé)
const coupInvite = (journal) => journal.push({ g: journal.length, qui: "invite", type: "tir", p: { x: 0, y: 0 }, res: { cases: [{ x: 0, y: 0, res: "eau" }] } });

test("tir : à l'eau, touché, coulé (navire large = 10 cases)", () => {
  const j = [];
  assert.strictEqual(resoudre(j, action(0, "hote", "tir", { x: 6, y: 6 })).cases[0].res, "eau");
  assert.strictEqual(resoudre(j, action(1, "hote", "tir", { x: 0, y: 0 })).cases[0].res, "touche");
  const e = M.etatDefense(FLOTTE, [], j, "invite", REG);
  let dernier;
  R.casesDe(FLOTTE[0]).slice(1).forEach((c) => (dernier = e.resoudre({ type: "tir", p: c })));
  assert.strictEqual(dernier.cases[0].res, "coule");
  assert.strictEqual(dernier.cases[0].navire, "pa");
});
test("à qui le tour : alternance, Éclair qui fait rejouer, mine qui fait perdre un tour", () => {
  const j = [];
  assert.strictEqual(M.quiJoue(j, "hote"), "hote");
  j.push({ g: 0, qui: "hote", type: "tir", res: { cases: [] } });
  assert.strictEqual(M.quiJoue(j, "hote"), "invite");
  j.push({ g: 1, qui: "invite", type: "eclair", res: { cases: [], rejoue: true } });
  assert.strictEqual(M.quiJoue(j, "hote"), "invite", "Éclair réussi : l'invité rejoue");
  j.push({ g: 2, qui: "invite", type: "tir", res: { cases: [], perdTour: true } });
  assert.strictEqual(M.quiJoue(j, "hote"), "hote");
  j.push({ g: 3, qui: "hote", type: "tir", res: { cases: [] } });
  assert.strictEqual(M.quiJoue(j, "hote"), "hote", "l'invité a marché sur une mine : il passe son tour");
  j.push({ g: 4, qui: "hote", type: "tir", res: null });
  assert.strictEqual(M.quiJoue(j, "hote"), null, "réponse en attente : personne ne joue");
});
test("compétences gagnées : 2 tirs à l'eau d'affilée, 2 en réserve au maximum", () => {
  const j = [];
  const eau = (qui) => j.push({ g: j.length, qui, type: "tir", res: { cases: [{ x: 0, y: 0, res: "eau" }] } });
  eau("hote"); eau("invite");
  assert.strictEqual(M.stock(j, "hote").dispo, 0);
  eau("hote");
  assert.strictEqual(M.stock(j, "hote").dispo, 1);
  j.push({ g: j.length, qui: "hote", type: "tir", res: { cases: [{ x: 1, y: 0, res: "touche" }] } });
  eau("hote");
  assert.strictEqual(M.stock(j, "hote").dispo, 1, "un touché remet la série à zéro");
  eau("hote"); eau("hote"); eau("hote"); eau("hote"); eau("hote");
  assert.strictEqual(M.stock(j, "hote").dispo, 2, "jamais plus de 2 en réserve");
});
test("une compétence n'est acceptée que si on l'a gagnée, et seulement en mode Compétences", () => {
  const j = [];
  assert.strictEqual(M.actionValide(j, REG, "hote", { g: 0, qui: "hote", type: "sonar", p: { x: 3, y: 3 } }), null);
  assert.ok(M.actionValide(j, REG, "hote", { g: 0, qui: "hote", type: "tir", p: { x: 3, y: 3 } }));
  assert.strictEqual(M.actionValide(j, REG, "hote", { g: 0, qui: "invite", type: "tir", p: { x: 3, y: 3 } }), null, "pas son tour");
  assert.strictEqual(M.actionValide(j, REG, "hote", { g: 0, qui: "hote", type: "tir", p: { x: 12, y: 3 } }), null, "hors de la carte");
  const jeuSans = [{ g: 0, qui: "hote", type: "tir", res: { cases: [{ x: 0, y: 0, res: "eau" }] } }, { g: 1, qui: "invite", type: "tir", res: { cases: [{ x: 0, y: 0, res: "eau" }] } }, { g: 2, qui: "hote", type: "tir", res: { cases: [{ x: 0, y: 1, res: "eau" }] } }, { g: 3, qui: "invite", type: "tir", res: { cases: [{ x: 0, y: 0, res: "eau" }] } }];
  assert.ok(M.actionValide(jeuSans, REG, "hote", { g: 4, qui: "hote", type: "sonar", p: { x: 3, y: 3 } }));
  assert.strictEqual(M.actionValide(jeuSans, { taille: 12 }, "hote", { g: 4, qui: "hote", type: "sonar", p: { x: 3, y: 3 } }), null, "mode normal : pas de compétence");
});
test("sonar, radar et grenadage comptent les cases de navire intactes", () => {
  const e = M.EtatDefense(FLOTTE, REG);
  assert.strictEqual(e.resoudre(action(0, "hote", "sonar", { x: 1, y: 1 })).info.n, 6);  // A1-C3 : 6 cases du porte-avions
  assert.strictEqual(e.resoudre(action(0, "hote", "radar", { axe: "colonne", index: 11 })).info.n, 5); // sous-marin 4 + torpilleur 1
  const g = e.resoudre(action(0, "hote", "grenadage", { x: 1, y: 2 }));
  assert.strictEqual(g.cases[0].res, "eau");
  assert.strictEqual(g.info.n, 3, "B3 est entouré de 3 cases du porte-avions");
});
test("salve, raid et bombardement frappent plusieurs cases", () => {
  const e = M.EtatDefense(FLOTTE, REG);
  assert.deepStrictEqual(e.resoudre(action(0, "hote", "salve", { cases: [{ x: 0, y: 0 }, { x: 6, y: 6 }] })).cases.map((c) => c.res), ["touche", "eau"]);
  assert.deepStrictEqual(e.resoudre(action(0, "hote", "raid", { x: 11, y: 1, h: false })).cases.map((c) => c.y), [1, 2, 3]);
  const b = e.resoudre(action(0, "hote", "bombardement", { x: 11, y: 11 }));
  assert.strictEqual(b.cases.length, 4, "recadré dans la carte");
  assert.strictEqual(b.cases.filter((c) => c.res === "touche" || c.res === "coule").length, 2);
});
test("torpille : file jusqu'au premier navire intact", () => {
  const e = M.EtatDefense(FLOTTE, REG);
  const t = e.resoudre(action(0, "hote", "torpille", { axe: "ligne", index: 9, sens: 1 }));
  assert.deepStrictEqual(t.cases.map((c) => c.res), ["eau", "eau", "eau", "eau", "eau", "eau", "touche"]);
  const t2 = e.resoudre(action(1, "hote", "torpille", { axe: "ligne", index: 9, sens: 1 }));
  assert.strictEqual(t2.cases[t2.cases.length - 1].x, 7, "passe au-dessus de la case déjà touchée");
});
test("Éclair fait rejouer, périscope montre une vraie case de navire", () => {
  const e = M.EtatDefense(FLOTTE, REG);
  assert.ok(e.resoudre(action(0, "hote", "eclair", { x: 0, y: 0 })).rejoue);
  assert.ok(!e.resoudre(action(0, "hote", "eclair", { x: 6, y: 6 })).rejoue);
  const p = e.resoudre(action(0, "hote", "periscope", {}), graine(5));
  assert.ok(e.intacte(p.info.x, p.info.y));
});
test("bouclier et mine : posés en secret, puis déclenchés", () => {
  const j = [];
  coupInvite(j); // g0 : l'invité (défenseur ici = invité) … on simule l'ordre
  j.length = 0;
  const defense = [{ type: "bouclier", x: 0, y: 4, g: 0 }, { type: "mine", x: 6, y: 6, g: 1 }];
  j.push({ g: 0, qui: "invite", type: "bouclier", p: {}, res: { cases: [] } });
  j.push({ g: 1, qui: "invite", type: "mine", p: {}, res: { cases: [] } });
  const r1 = resoudre(j, action(2, "hote", "tir", { x: 0, y: 4 }), defense);
  assert.strictEqual(r1.cases[0].res, "bouclier");
  const r2 = resoudre(j, action(3, "hote", "tir", { x: 0, y: 4 }), defense);
  assert.strictEqual(r2.cases[0].res, "touche", "le bouclier ne sert qu'une fois");
  const r3 = resoudre(j, action(4, "hote", "tir", { x: 6, y: 6 }), defense);
  assert.ok(r3.cases[0].mine && r3.perdTour);
  assert.ok(M.verifierDefense(FLOTTE, defense, j, "invite", REG).ok);
  assert.ok(!M.verifierDefense(FLOTTE, [defense[1]], j, "invite", REG).ok, "bouclier caché à la fin : triche détectée");
  const e = M.etatDefense(FLOTTE, defense, j, "invite", REG);
  assert.ok(!e.defensePossible("mine", 0, 0), "pas de mine sous un navire");
  assert.ok(!e.defensePossible("bouclier", 6, 0), "pas de bouclier sur l'eau");
});
test("anti-triche : une réponse fausse est détectée", () => {
  const j = [];
  resoudre(j, action(0, "hote", "tir", { x: 0, y: 0 }));
  coupInvite(j);
  resoudre(j, action(2, "hote", "sonar", { x: 5, y: 5 }));
  assert.ok(M.verifierDefense(FLOTTE, [], j, "invite", REG).ok);
  j[2].res.info.n = 3;
  assert.ok(!M.verifierDefense(FLOTTE, [], j, "invite", REG).ok);
});
test("réponse abîmée venue du réseau : refusée sans planter", () => {
  assert.strictEqual(M.nettoyerRes(null, 12), null);
  assert.strictEqual(M.nettoyerRes({ cases: [{ x: 40, y: 0, res: "eau" }] }, 12), null);
  assert.strictEqual(M.nettoyerRes({ cases: [{ x: 1, y: 0, res: "boum" }] }, 12), null);
  assert.deepStrictEqual(M.nettoyerRes({ cases: [{ x: 1, y: 0, res: "eau", pirate: 1 }], info: { n: 2 } }, 12).cases, [{ x: 1, y: 0, res: "eau" }]);
});
test("tirage des compétences : 3 différentes, sans celles des navires coulés", () => {
  const liste = M.reserve({ bonus: 2 }, ["sm"]);
  assert.ok(!liste.includes("periscope") && liste.includes("radar") && liste.includes("mine") && liste.includes("sonar"));
  const t = M.tirage(liste, 3, graine(2));
  assert.strictEqual(new Set(t).size, 3);
});

// ---------- Ordinateur ----------
/* Partie complète ordinateur contre ordinateur, avec le vrai moteur : chaque
   camp résout les actions de l'autre sur sa flotte, avec compétences. */
function partieOrdis(niveaux, regles, rnd) {
  const r = R.normaliser(regles);
  const camp = {
    hote: { navires: R.placementAleatoire(r, rnd), defense: [], main: [], vues: 0, niveau: niveaux[0] },
    invite: { navires: R.placementAleatoire(r, rnd), defense: [], main: [], vues: 0, niveau: niveaux[1] },
  };
  const journal = [];
  for (let tour = 0; tour < 1000; tour++) {
    const qui = M.quiJoue(journal, "hote"), lui = M.autre(qui), c = camp[qui];
    if (r.competences) {
      const s = M.stock(journal, qui);
      while (c.vues < s.gagnees) { c.vues++; c.main.push(IA.choisirCompetence(M.tirage(M.reserve(r, []), 3, rnd), c.niveau, rnd)); }
    }
    let type = "tir", p = null;
    if (r.competences && c.main.length && M.stock(journal, qui).dispo > 0) {
      type = c.main.shift();
      if (type === "bouclier" || type === "mine") {
        const e = M.etatDefense(c.navires, c.defense, journal, qui, r);
        const libres = [];
        for (let y = 0; y < r.taille; y++) for (let x = 0; x < r.taille; x++) if (e.defensePossible(type, x, y)) libres.push({ x, y });
        if (libres.length) c.defense.push({ type, g: journal.length, ...libres[Math.floor(rnd() * libres.length)] });
        else type = "tir";
      }
      if (type !== "tir") p = M.normaliserParams(type, IA.preparerAction(type, c.niveau, journal, qui, r, rnd, true), r.taille);
      if (!p) type = "tir";
    }
    if (type === "tir") p = M.normaliserParams("tir", IA.preparerAction("tir", c.niveau, journal, qui, r, rnd), r.taille);
    const a = M.actionValide(journal, r, "hote", { g: journal.length, qui, type, p });
    assert.ok(a, "action refusée : " + type + " " + JSON.stringify(p));
    a.res = M.etatDefense(camp[lui].navires, camp[lui].defense, journal, lui, r).resoudre(a, rnd);
    journal.push(a);
    if (a.res.fin) {
      // l'anti-triche des deux côtés doit être d'accord
      assert.ok(M.verifierDefense(camp.hote.navires, camp.hote.defense, journal, "hote", r).ok);
      assert.ok(M.verifierDefense(camp.invite.navires, camp.invite.defense, journal, "invite", r).ok);
      return { gagnant: qui, actions: journal.filter((x) => x.qui === qui).length, competences: journal.filter((x) => x.type !== "tir").length };
    }
  }
  throw new Error("partie non terminée");
}
test("ordinateur : parties complètes sur toutes les cartes, avec et sans compétences", () => {
  for (let i = 0; i < 24; i++) {
    const regles = { taille: R.TAILLES[i % 4], bonus: i % 3, competences: i % 2 === 1, colles: true };
    partieOrdis(["moyen", "difficile"], regles, graine(i + 7));
  }
});
test("ordinateur : le difficile est le plus fort, et il utilise ses compétences", () => {
  const victoires = { facile: 0, moyen: 0, difficile: 0 };
  let competences = 0;
  for (let i = 0; i < 20; i++) {
    const g1 = partieOrdis(["difficile", "facile"], { taille: 12, competences: true }, graine(100 + i));
    victoires[g1.gagnant === "hote" ? "difficile" : "facile"]++;
    competences += g1.competences;
    const g2 = partieOrdis(["moyen", "facile"], { taille: 10 }, graine(200 + i));
    if (g2.gagnant === "hote") victoires.moyen++;
  }
  console.log("   difficile bat facile :", victoires.difficile, "/ 20 · moyen bat facile :", victoires.moyen, "/ 20 · compétences utilisées :", competences);
  assert.ok(victoires.difficile >= 15);
  assert.ok(victoires.moyen >= 12);
  assert.ok(competences > 20);
});
test("ordinateur : après un touché, il achève le navire", () => {
  const k = new Array(100).fill(null);
  k[44] = "touche";
  for (const niveau of ["moyen", "difficile"]) {
    const c = IA.choisirTir(niveau, k, R.flotteDe({}), { taille: 10 }, graine(3));
    assert.strictEqual(Math.abs(c.x - 4) + Math.abs(c.y - 4), 1, niveau + " vise une case voisine");
  }
});

// ---------- Discussion ----------
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
});
test("discussion : les messages perdus sont renvoyés", () => {
  const moi = D.initialiser({}), ami = D.initialiser({});
  const envois = ["a", "b", "c"].map((t) => D.ecrire(moi, t));
  D.recevoir(ami, envois[0]);
  const renvoi = D.aRenvoyer(moi, ami.chatRecus);
  assert.deepStrictEqual(renvoi.map((m) => m.texte), ["b", "c"]);
  renvoi.forEach((m) => D.recevoir(ami, m));
  assert.deepStrictEqual(D.aRenvoyer(moi, ami.chatRecus), []);
});

// ---------- Scores et trophées ----------
test("trophées : score face à face et premiers trophées", () => {
  const p = TR.initialiser({ victoires: 0, defaites: 0 });
  const g = TR.enregistrerPartie(p, { gagne: true, tirs: 40, reussis: 27, mesCoules: 0, nbNavires: 5, totalCases: 27, idAdverse: "ami1", nomAdverse: "Léa" }, 1);
  assert.deepStrictEqual(g.sort(), ["eclair", "elite", "intouchable", "premiere"]);
  TR.enregistrerPartie(p, { gagne: false, tirs: 60, reussis: 12, mesCoules: 5, nbNavires: 5, totalCases: 27, idAdverse: "ami1" }, 2);
  assert.deepStrictEqual(TR.score(p, "ami1"), { v: 1, d: 1 });
});
test("trophées : sur le fil (selon le nombre de navires), amiral, fidèle, beau joueur", () => {
  const p = TR.initialiser({});
  TR.enregistrerPartie(p, { gagne: true, tirs: 99, reussis: 30, mesCoules: 6, nbNavires: 7, totalCases: 32, idAdverse: "a" });
  assert.ok(p.trophees.fil);
  TR.enregistrerPartie(p, { gagne: true, tirs: 99, reussis: 27, mesCoules: 2, nbNavires: 5, totalCases: 27, idAdverse: "ordinateur-difficile", solo: true, niveau: "difficile" });
  assert.ok(p.trophees.amiral);
  for (let i = 0; i < 4; i++) TR.enregistrerPartie(p, { gagne: false, tirs: 70, reussis: 10, mesCoules: 5, nbNavires: 5, totalCases: 27, idAdverse: "a" });
  assert.ok(p.trophees.fidele);
  assert.deepStrictEqual(TR.beauJoueur(p), ["beau"]);
});
console.log(`\n${ok} tests réussis`);
