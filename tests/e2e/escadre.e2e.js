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

// Choisit une case (avec la tactique « moyen » de l'ordinateur, pour des parties
// plus courtes), puis la touche deux fois : viser, puis tirer.
async function tirerAuHasard(page) {
  const cible = await page.evaluate(() => {
    const cases = [...document.querySelectorAll("#grille-adverse .case")];
    const connu = cases.map((c) => (c.classList.contains("coule") ? "coule" : c.classList.contains("touche") ? "touche"
      : c.classList.contains("eau") || c.classList.contains("attente") ? "eau" : null));
    if (!connu.includes(null)) return null;
    const t = window.IA.choisirTir("moyen", connu, [5, 4, 3, 3, 2], {});
    return cases[t.y * 10 + t.x].getAttribute("aria-label");
  });
  if (!cible) return false;
  await page.click(`#grille-adverse .case[aria-label="${cible}"]`);
  await page.click(`#grille-adverse .case[aria-label="${cible}"]`);
  return true;
}
const titre = (page) => page.textContent("#bandeau-titre");
const fini = (t) => /Victoire|Défaite/.test(t);

/* ---------------- Scénario 1 : deux amis, réseau qui perd des messages ---------------- */
async function scenarioDeuxJoueurs(navigateur, base) {
  console.log("\n▶ Deux joueurs, 30 % de messages perdus");
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
  const erreurs = [];
  const A = await ctx.newPage(), B = await ctx.newPage();
  surveillerErreurs(A, "A", erreurs); surveillerErreurs(B, "B", erreurs);
  const q = "local=1&perte=0.3";

  await A.goto(`${base}/index.html?${q}`);
  await A.fill("#champ-nom", "Yoann");
  await A.click("#btn-creer");
  await A.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector("#code-partie").textContent));
  const code = await A.textContent("#code-partie");
  // Message écrit avant l'arrivée de l'ami : il doit partir plus tard
  await A.click("#btn-chat"); await A.fill("#champ-chat", "Salut !"); await A.press("#champ-chat", "Enter");
  await A.click("#fenetre-chat [data-fermer]");
  await A.click("#btn-hasard");

  await B.goto(`${base}/index.html?salle=${code}&${q}`);
  await B.fill("#champ-nom", "Léa");
  await B.click("#btn-rejoindre");
  await B.waitForFunction(() => document.querySelector("#texte-reseau").textContent.includes("En ligne avec Yoann"), null, { timeout: 30000 });
  verifier(true, "Léa rejoint la partie de Yoann");
  await B.click("#btn-hasard");
  await B.click("#btn-pret");
  await A.click("#btn-pret");
  await A.waitForFunction(() => /tirer|Tour de|Tir en cours/.test(document.querySelector("#bandeau-titre").textContent), null, { timeout: 30000 });
  verifier(true, "la bataille commence des deux côtés (plus de blocage au placement)");

  let tours = 0, recharge = false;
  const debut = Date.now();
  while (Date.now() - debut < 240000) {
    const [tA, tB] = [await titre(A), await titre(B)];
    if (fini(tA) && fini(tB)) break;
    const p = tA === "À toi de tirer" ? A : tB === "À toi de tirer" ? B : null;
    if (!p) { await A.waitForTimeout(80); continue; }
    if (await tirerAuHasard(p)) tours++;
    if (tours === 12 && !recharge) { // l'invitée recharge la page en pleine partie
      recharge = true;
      await B.reload();
      await B.waitForFunction(() => document.querySelector("#texte-reseau").textContent.includes("En ligne"), null, { timeout: 30000 });
      verifier(true, "après rechargement de la page, la partie reprend");
    }
  }
  const [tA, tB] = [await titre(A), await titre(B)];
  verifier(fini(tA) && fini(tB) && tA !== tB, `partie terminée : Yoann « ${tA} », Léa « ${tB} » (${tours} tirs)`);

  // Fenêtre de fin : vérification anti-triche, score, replay
  await A.waitForSelector("#fenetre-fin[open]", { timeout: 10000 });
  await A.waitForFunction(() => document.querySelector("#fin-honnetete").textContent.includes("✅"), null, { timeout: 20000 });
  verifier(true, "flotte de l'ami vérifiée (partie loyale)");
  verifier(/Toi [01] – [01] Léa/.test(await A.textContent("#fin-score")), "score face à face affiché : " + (await A.textContent("#fin-score")));
  await A.click("#btn-replay");
  await A.waitForSelector("#fenetre-replay[open]");
  await A.click("#replay-lecture"); // pause
  await A.click("#replay-debut");
  verifier((await A.textContent("#replay-compteur")).startsWith("Coup 0 /"), "replay : retour au début");
  await A.click("#replay-suivant"); await A.click("#replay-suivant");
  verifier((await A.textContent("#replay-compteur")).startsWith("Coup 2 /"), "replay : coup par coup");
  const total = Number((await A.textContent("#replay-compteur")).split("/")[1]);
  verifier(total === tours, `replay : tous les tirs sont là (${total})`);
  await A.$eval("#replay-curseur", (c) => { c.value = c.max; c.dispatchEvent(new Event("input")); });
  const coulesReplay = await A.$$eval("#replay-lui .silhouette.coule, #replay-moi .silhouette.coule", (e) => e.length);
  verifier(coulesReplay >= 5, "replay : à la fin, la flotte perdante est entièrement coulée");
  await A.click("#fenetre-replay [data-fermer]");

  // Discussion : le message envoyé avant l'arrivée de Léa est bien arrivé
  await B.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await B.click("#btn-chat");
  const filB = await B.$$eval("#fil-chat .msg.lui p", (e) => e.map((x) => x.textContent));
  verifier(filB.includes("Salut !"), "discussion : le message écrit avant l'arrivée de l'ami est reçu");
  await B.click("#fenetre-chat [data-fermer]");

  // Revanche
  await A.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await B.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await A.click("#btn-feu"); await A.click("#btn-revanche");
  await B.click("#btn-feu"); await B.click("#btn-revanche");
  await A.waitForFunction(() => document.querySelector("#bandeau-titre").textContent === "Place ta flotte", null, { timeout: 30000 });
  await B.waitForFunction(() => document.querySelector("#bandeau-titre").textContent === "Place ta flotte", null, { timeout: 30000 });
  verifier(true, "revanche lancée des deux côtés");
  verifier(erreurs.length === 0, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await ctx.close();
}

/* ---------------- Scénario 2 : seul contre l'ordinateur ---------------- */
async function scenarioSolo(navigateur, base) {
  console.log("\n▶ Seul contre l'ordinateur");
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 } });
  const erreurs = [];
  const A = await ctx.newPage();
  surveillerErreurs(A, "solo", erreurs);
  await A.goto(`${base}/index.html?local=1&vite=1`);
  await A.fill("#champ-nom", "Yoann");
  await A.click('#choix-niveau [data-niveau="difficile"]');
  verifier(await A.getAttribute('#choix-niveau [data-niveau="difficile"]', "aria-pressed") === "true", "niveau difficile choisi");
  await A.click("#btn-solo");
  verifier((await A.textContent("#texte-reseau")).includes("Partie solo"), "partie solo lancée");
  await A.click("#btn-hasard");
  await A.click("#btn-pret");
  await A.waitForFunction(() => /tirer|Tour de|Tir en cours/.test(document.querySelector("#bandeau-titre").textContent), null, { timeout: 15000 });
  verifier(true, "l'ordinateur place sa flotte et la bataille commence");

  let tours = 0, recharge = false;
  const debut = Date.now();
  while (Date.now() - debut < 120000) {
    const t = await titre(A);
    if (fini(t)) break;
    if (t !== "À toi de tirer") { await A.waitForTimeout(30); continue; }
    if (await tirerAuHasard(A)) tours++;
    if (tours === 10 && !recharge) {
      recharge = true;
      await A.reload();
      await A.waitForFunction(() => /tirer|Tour de|Tir en cours/.test(document.querySelector("#bandeau-titre").textContent), null, { timeout: 15000 });
      verifier(true, "partie solo reprise après rechargement");
    }
  }
  const t = await titre(A);
  verifier(fini(t), `partie solo terminée : « ${t} » après ${tours} tirs`);
  await A.waitForSelector("#fenetre-fin[open]", { timeout: 10000 });
  await A.waitForFunction(() => document.querySelector("#fin-honnetete").textContent.includes("✅"), null, { timeout: 10000 });
  verifier(true, "flotte de l'ordinateur vérifiée (il ne triche pas)");
  verifier(/Toi [01] – [01] Amiral Vega/.test(await A.textContent("#fin-score")), "score contre l'ordinateur : " + (await A.textContent("#fin-score")));
  const trophees = await A.$$eval("#fin-trophees li", (e) => e.length);
  verifier(t !== "Victoire !" || trophees >= 1, "trophée(s) débloqué(s) en cas de victoire : " + trophees);

  // Palmarès sur l'accueil
  await A.click("#btn-accueil");
  await A.click("#btn-palmares");
  verifier((await A.textContent("#pal-parties")) === "1", "palmarès : 1 partie jouée");
  verifier((await A.textContent("#liste-duels")).includes("Amiral Vega"), "palmarès : face à face contre Amiral Vega");
  verifier((await A.$$eval("#liste-trophees li", (e) => e.length)) === 10, "palmarès : les 10 trophées sont listés");
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
    await scenarioSolo(navigateur, base);
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
