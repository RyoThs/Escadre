/* ==========================================================================
   Tests « de bout en bout » : on ouvre le vrai jeu dans un navigateur
   (Chromium, piloté par Playwright) et on joue des parties complètes.
   Lancement : node tests/e2e/escadre.e2e.js
   (il faut Playwright : npm install playwright && npx playwright install chromium)

   Le mode test « ?local=1 » remplace Internet par un canal entre onglets :
   chaque onglet est un téléphone. « &perte=0.3 » perd 30 % des messages,
   « &bloque=1 » empêche la connexion, « &vite=1 » accélère l'ordinateur.
   ========================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RACINE = path.join(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// Petit serveur web pour servir le jeu pendant les tests
function demarrerServeur() {
  const serveur = http.createServer((req, res) => {
    const chemin = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const fichier = path.join(RACINE, chemin === "/" ? "index.html" : chemin);
    if (!fichier.startsWith(RACINE)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((ok) => serveur.listen(0, "127.0.0.1", () => ok(serveur)));
}

let echecs = 0;
function verifier(condition, message) {
  if (condition) console.log("  ✔", message);
  else { console.log("  ✘", message); echecs++; }
}

function surveillerErreurs(page, nom, erreurs) {
  page.on("pageerror", (e) => erreurs.push(nom + " : " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/vibrate/i.test(m.text())) erreurs.push(nom + " (console) : " + m.text()); });
}

// Joue un tour comme un vrai joueur : choisit une compétence si on en a gagné,
// l'utilise si c'est possible, sinon tire (tactique « moyen » de l'ordinateur,
// pour des parties plus courtes). Renvoie le nom de ce qui a été joué.
async function jouerUnTour(page) {
  const clic = (sel) => page.click(sel, { timeout: 5000 });
  // Une nouvelle compétence à choisir : on prend la première proposée
  if (await page.$("#fenetre-offre[open]")) { await clic("#liste-offre .carte-competence"); return "choix"; }
  if (await page.$("#btn-offre")) { await clic("#btn-offre"); return "choix"; }
  const competence = await page.evaluate(() => {
    const b = document.querySelector(".jeton-competence:not(.cadeau):not(:disabled)");
    return b ? b.dataset.competence : null;
  });
  if (competence) {
    await clic(`.jeton-competence[data-competence="${competence}"]`);
    const cible = await page.evaluate((id) => window.Moteur.COMPETENCES[id].cible, competence);
    if (cible === "maNavire" || cible === "maCaseVide") {
      const choix = await page.evaluate((type) => {
        const cases = [...document.querySelectorAll("#grille-defense .case")];
        const ok = cases.find((c) => type === "maNavire"
          ? c.classList.contains("nav") && !c.classList.contains("touche") && !c.classList.contains("protege")
          : !c.classList.contains("nav") && !c.classList.contains("eau") && !c.querySelector(".marque-case"));
        return ok ? ok.getAttribute("aria-label") : null;
      }, cible);
      if (choix) await clic(`#grille-defense .case[aria-label="${choix}"]`);
      if (choix && !(await page.isDisabled("#btn-defense-ok"))) { await clic("#btn-defense-ok"); return competence; }
      await clic("#fenetre-defense [data-fermer]");
      return "rien";
    }
    const libres = await casesLibres(page, 2);
    if (cible === "deux") { for (const c of libres) await clic(`#grille-adverse .case[aria-label="${c}"]`); }
    else if (cible !== "aucune") await clic(`#grille-adverse .case[aria-label="${libres[0]}"]`);
    if (!(await page.isDisabled("#btn-feu"))) { await clic("#btn-feu"); return competence; }
    await clic("#btn-annuler-comp");
  }
  const cible = await page.evaluate(() => {
    const grille = document.querySelector("#grille-adverse");
    const n = Number(grille.dataset.taille);
    const cases = [...grille.querySelectorAll(".case")];
    const connu = cases.map((c) => (c.classList.contains("coule") ? "coule" : c.classList.contains("touche") ? "touche"
      : c.classList.contains("eau") || c.classList.contains("attente") ? "eau" : c.classList.contains("bloque") ? "bouclier" : null));
    if (!connu.includes(null) && !connu.includes("bouclier")) return null;
    // la meilleure tactique de l'ordinateur, pour des parties de test plus courtes
    const t = window.IA.choisirTir("difficile", connu, window.Regles.flotteDe({ bonus: 2 }), { taille: n });
    return cases[t.y * n + t.x].getAttribute("aria-label");
  });
  if (!cible) return "rien";
  await clic(`#grille-adverse .case[aria-label="${cible}"]`);
  await clic(`#grille-adverse .case[aria-label="${cible}"]`);
  return "tir";
}
async function casesLibres(page, nb) {
  return page.evaluate((nb) => [...document.querySelectorAll("#grille-adverse .case")]
    .filter((c) => !["eau", "touche", "coule", "attente"].some((k) => c.classList.contains(k)))
    .slice(0, nb).map((c) => c.getAttribute("aria-label")), nb);
}
const titre = (page) => page.textContent("#bandeau-titre");
const fini = (t) => /Victoire|Défaite/.test(t);
const aMoi = (page) => page.$eval("#bandeau", (b) => b.classList.contains("mon-tour"));
const bataille = () => /tirer|Tour de|Tir en cours|✨|🔊|🎯|🚀|✈️|💣|🔭|📡|⚡|📶/.test(document.querySelector("#bandeau-titre").textContent);

// Règle les options de la nouvelle partie sur l'accueil
async function regler(page, { mode, taille, bonus }) {
  if (mode) await page.click(`#choix-mode [data-mode="${mode}"]`);
  if (taille) await page.click(`#choix-carte [data-taille="${taille}"]`);
  if (bonus != null) await page.click(`#choix-bonus [data-bonus="${bonus}"]`);
}

/* Joue jusqu'à la fin. pages = joueurs à faire jouer. Renvoie le nombre de
   tours et la liste des compétences utilisées. surTour(n) : appelé après chaque tour. */
async function jouerJusquALaFin(pages, limiteMs, surTour) {
  let tours = 0;
  const competences = [];
  const debut = Date.now();
  while (Date.now() - debut < limiteMs) {
    const titres = await Promise.all(pages.map(titre));
    if (titres.every(fini)) break;
    let joue = false;
    for (const p of pages) {
      if (await p.$("#fenetre-offre[open]")) { await jouerUnTour(p); joue = true; continue; }
      if (!(await aMoi(p))) continue;
      let quoi = "rien";
      try { quoi = await jouerUnTour(p); }
      catch (e) { console.log("   (tour à rejouer : " + e.message.split("\n")[0] + ")"); await p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close())); }
      if (quoi !== "choix" && quoi !== "rien") { tours++; if (quoi !== "tir") competences.push(quoi); if (surTour) await surTour(tours); }
      joue = true;
    }
    if (!joue) await pages[0].waitForTimeout(40);
  }
  return { tours, competences };
}

/* ---------------- Scénario 1 : deux amis, mode Compétences, réseau qui perd des messages ---------------- */
async function scenarioDeuxJoueurs(navigateur, base) {
  console.log("\n▶ Deux joueurs, mode Compétences 12×12 + frégate, 15 % de messages perdus");
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
  const erreurs = [];
  const A = await ctx.newPage(), B = await ctx.newPage();
  surveillerErreurs(A, "A", erreurs); surveillerErreurs(B, "B", erreurs);
  const q = "local=1&perte=0.15";

  await A.goto(`${base}/index.html?${q}`);
  await A.fill("#champ-nom", "Yoann");
  await regler(A, { mode: "competences", taille: 12, bonus: 1 });
  verifier(await A.isDisabled('#choix-carte [data-taille="8"]'), "mode Compétences : la carte 8×8 est bloquée (taille imposée)");
  await A.click("#btn-creer");
  await A.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector("#code-partie").textContent));
  const code = await A.textContent("#code-partie");
  verifier((await A.$$eval("#grille-moi .case", (c) => c.length)) === 144, "la grille fait bien 12×12");
  // Message écrit avant l'arrivée de l'ami : il doit partir plus tard
  await A.click("#btn-chat"); await A.fill("#champ-chat", "Salut !"); await A.press("#champ-chat", "Enter");
  await A.click("#fenetre-chat [data-fermer]");
  await A.click("#btn-hasard");

  await B.goto(`${base}/index.html?salle=${code}&${q}`);
  await B.fill("#champ-nom", "Léa");
  await B.click("#btn-rejoindre");
  await B.waitForFunction(() => document.querySelector("#texte-reseau").textContent.includes("En ligne avec Yoann"), null, { timeout: 30000 });
  verifier(true, "Léa rejoint la partie de Yoann");
  await B.waitForFunction(() => document.querySelectorAll("#grille-moi .case").length === 144, null, { timeout: 15000 });
  verifier((await B.$$eval("#quai li", (l) => l.length)) === 6, "Léa reçoit les réglages : carte 12×12 et 6 navires");
  await B.click("#btn-hasard");
  await B.click("#btn-pret");
  await A.click("#btn-pret");
  await A.waitForFunction(bataille, null, { timeout: 30000 });
  await B.waitForFunction(bataille, null, { timeout: 30000 });
  verifier(true, "la bataille commence des deux côtés");

  let recharge = false;
  const { tours, competences } = await jouerJusquALaFin([A, B], 540000, async (n) => {
    if (n === 14 && !recharge) { // l'invitée recharge la page en pleine partie
      recharge = true;
      await B.reload();
      await B.waitForFunction(() => document.querySelector("#texte-reseau").textContent.includes("En ligne"), null, { timeout: 30000 });
      verifier(true, "après rechargement de la page, la partie reprend");
    }
  });
  const [tA, tB] = [await titre(A), await titre(B)];
  verifier(fini(tA) && fini(tB) && tA !== tB, `partie terminée : Yoann « ${tA} », Léa « ${tB} » (${tours} tours)`);
  if (!(fini(tA) && fini(tB))) { // diagnostic : la fin des deux journaux
    for (const [nom, pg] of [["Yoann", A], ["Léa", B]]) {
      const j = await pg.evaluate(() => { const P = JSON.parse(sessionStorage.getItem("escadre.partie.v2")); return { premier: P.premier, role: P.role, fin: P.journal.slice(-4) }; });
      console.log("   journal " + nom + " :", JSON.stringify(j));
    }
  }
  verifier(competences.length >= 2, `compétences utilisées pendant la partie : ${competences.length} (${[...new Set(competences)].join(", ")})`);

  // Fenêtre de fin : vérification anti-triche, score, replay
  await A.waitForSelector("#fenetre-fin[open]", { timeout: 10000 });
  await A.waitForFunction(() => document.querySelector("#fin-honnetete").textContent.includes("✅"), null, { timeout: 20000 });
  verifier(true, "flotte de l'ami vérifiée, compétences comprises (partie loyale)");
  await B.waitForFunction(() => document.querySelector("#fin-honnetete").textContent.includes("✅"), null, { timeout: 20000 });
  verifier(true, "vérification aussi réussie chez Léa");
  verifier(/Toi [01] – [01] Léa/.test(await A.textContent("#fin-score")), "score face à face affiché : " + (await A.textContent("#fin-score")));
  await A.click("#btn-replay");
  await A.waitForSelector("#fenetre-replay[open]");
  await A.click("#replay-lecture"); // pause
  await A.click("#replay-debut");
  verifier((await A.textContent("#replay-compteur")).startsWith("Coup 0 /"), "replay : retour au début");
  await A.click("#replay-suivant"); await A.click("#replay-suivant");
  verifier((await A.textContent("#replay-compteur")).startsWith("Coup 2 /"), "replay : coup par coup");
  await A.$eval("#replay-curseur", (c) => { c.value = c.max; c.dispatchEvent(new Event("input")); });
  const coulesReplay = await A.$$eval("#replay-lui .silhouette.coule, #replay-moi .silhouette.coule", (e) => e.length);
  verifier(coulesReplay >= 6, "replay : à la fin, la flotte perdante est entièrement coulée");
  await A.click("#fenetre-replay [data-fermer]");

  // Discussion : le message envoyé avant l'arrivée de Léa est bien arrivé
  await B.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await B.click("#btn-chat");
  const filB = await B.$$eval("#fil-chat .msg.lui p", (e) => e.map((x) => x.textContent));
  verifier(filB.includes("Salut !"), "discussion : le message écrit avant l'arrivée de l'ami est reçu");
  await B.click("#fenetre-chat [data-fermer]");

  // Revanche
  await A.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await A.click("#btn-feu"); await A.click("#btn-revanche");
  await B.click("#btn-feu"); await B.click("#btn-revanche");
  await A.waitForFunction(() => document.querySelector("#bandeau-titre").textContent === "Place ta flotte", null, { timeout: 30000 });
  await B.waitForFunction(() => document.querySelector("#bandeau-titre").textContent === "Place ta flotte", null, { timeout: 30000 });
  verifier((await B.$$eval("#grille-moi .case", (c) => c.length)) === 144, "revanche lancée des deux côtés, mêmes réglages");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await ctx.close();
}

/* ---------------- Scénario 2 : seul contre l'ordinateur ---------------- */
async function scenarioSolo(navigateur, base, { mode, taille, bonus, niveau, nomOrdi, attenduCases }) {
  console.log(`\n▶ Seul contre l'ordinateur (${niveau}, ${mode}, ${taille}×${taille}, bonus ${bonus})`);
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
  const erreurs = [];
  const A = await ctx.newPage();
  surveillerErreurs(A, "solo", erreurs);
  await A.goto(`${base}/index.html?local=1&vite=1`);
  await A.fill("#champ-nom", "Yoann");
  await regler(A, { mode, taille, bonus });
  await A.click(`#choix-niveau [data-niveau="${niveau}"]`);
  verifier((await A.textContent("#resume-flotte")).includes(`(${attenduCases} cases)`), "flotte annoncée : " + (await A.textContent("#resume-flotte")));
  await A.click("#btn-solo");
  verifier((await A.textContent("#texte-reseau")).includes("Partie solo"), "partie solo lancée");
  verifier((await A.$$eval("#grille-moi .case", (c) => c.length)) === taille * taille, `grille de ${taille}×${taille}`);
  await A.click("#btn-hasard");
  await A.click("#btn-pret");
  await A.waitForFunction(bataille, null, { timeout: 15000 });
  verifier(true, "l'ordinateur place sa flotte et la bataille commence");
  verifier((await A.isHidden("#barre-competences")) === (mode !== "competences"), mode === "competences" ? "barre des compétences visible" : "pas de compétences en mode classique");

  let recharge = false;
  const { tours, competences } = await jouerJusquALaFin([A], 180000, async (n) => {
    if (n === 10 && !recharge) {
      recharge = true;
      await A.reload();
      await A.waitForFunction(bataille, null, { timeout: 15000 });
      verifier(true, "partie solo reprise après rechargement");
    }
  });
  const t = await titre(A);
  verifier(fini(t), `partie solo terminée : « ${t} » après ${tours} tours`);
  if (mode === "competences") verifier(competences.length >= 1, `compétences utilisées par le joueur : ${competences.length} (${[...new Set(competences)].join(", ")})`);
  await A.waitForSelector("#fenetre-fin[open]", { timeout: 10000 });
  await A.waitForFunction(() => document.querySelector("#fin-honnetete").textContent.includes("✅"), null, { timeout: 10000 });
  verifier(true, "flotte de l'ordinateur vérifiée (il ne triche pas, même avec ses compétences)");
  verifier(new RegExp("Toi [01] – [01] " + nomOrdi).test(await A.textContent("#fin-score")), "score contre l'ordinateur : " + (await A.textContent("#fin-score")));

  // Palmarès sur l'accueil
  await A.click("#btn-accueil");
  await A.click("#btn-palmares");
  verifier((await A.textContent("#pal-parties")) === "1", "palmarès : 1 partie jouée");
  verifier((await A.textContent("#liste-duels")).includes(nomOrdi), "palmarès : face à face contre " + nomOrdi);
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await ctx.close();
}

/* ---------------- Scénario 3 : connexion impossible ---------------- */
async function scenarioConnexionImpossible(navigateur, base) {
  console.log("\n▶ Connexion impossible entre les deux réseaux");
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
  const erreurs = [];
  const A = await ctx.newPage(), B = await ctx.newPage();
  surveillerErreurs(A, "A", erreurs); surveillerErreurs(B, "B", erreurs);
  await A.goto(`${base}/index.html?local=1&bloque=1`);
  await A.click("#btn-creer");
  await A.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector("#code-partie").textContent));
  const code = await A.textContent("#code-partie");
  await B.goto(`${base}/index.html?salle=${code}&local=1&bloque=1`);
  await B.click("#btn-rejoindre");
  await B.waitForSelector("#aide-connexion:not([hidden])", { timeout: 45000 });
  verifier(true, "l'aide « Ça ne se connecte pas ? » apparaît au lieu d'une attente sans fin");
  verifier((await B.textContent("#aide-detail")).includes("Wi-Fi"), "le conseil Wi-Fi est affiché : " + (await B.textContent("#aide-detail")));
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await ctx.close();
}

(async () => {
  const serveur = await demarrerServeur();
  const base = "http://127.0.0.1:" + serveur.address().port;
  const navigateur = await chromium.launch();
  try {
    await scenarioSolo(navigateur, base, { mode: "competences", taille: 14, bonus: 2, niveau: "difficile", nomOrdi: "Amiral Vega", attenduCases: 32 });
    await scenarioSolo(navigateur, base, { mode: "normal", taille: 8, bonus: 0, niveau: "facile", nomOrdi: "Matelot Robin", attenduCases: 27 });
    await scenarioDeuxJoueurs(navigateur, base);
    await scenarioConnexionImpossible(navigateur, base);
  } catch (e) {
    console.log("  ✘ Erreur inattendue :", e.message);
    echecs++;
  } finally {
    await navigateur.close();
    serveur.close();
  }
  console.log(echecs ? `\n${echecs} vérification(s) en échec` : "\nTous les tests de bout en bout sont réussis");
  process.exit(echecs ? 1 : 0);
})();
