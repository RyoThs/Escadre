/* ==========================================================================
   Escadre — le MODE SOLO (jouer contre l'ordinateur)
   --------------------------------------------------------------------------
   Astuce d'architecture : l'ordinateur se comporte EXACTEMENT comme un ami
   qui aurait rejoint la partie. Il reçoit et envoie les mêmes messages
   (« bonjour », « action », « reponse », « flotte »…) et utilise le même
   moteur (js/moteur.js). Ainsi tout le reste de l'appli (tours, annonces,
   anti-triche, revanche, discussion, compétences) marche sans rien changer,
   et l'ordinateur ne peut pas tricher non plus.

   Trois niveaux :
   - facile    : tire surtout au hasard, utilise ses compétences au petit bonheur ;
   - moyen     : chasse (une case sur deux), puis achève le navire touché ;
   - difficile : calcule pour chaque case combien de navires pourraient s'y
                 cacher, tire là où c'est le plus probable et choisit ses
                 compétences avec soin.
   ========================================================================== */
(function (racine) {
  "use strict";
  const req = (nom) => (typeof require !== "undefined" ? require(nom) : null);
  const R = racine.Regles || req("./regles.js");
  const D = racine.Discussion || req("./discussion.js");
  const M = racine.Moteur || req("./moteur.js");

  const NIVEAUX = {
    facile:    { nom: "Matelot Robin",  titre: "Facile" },
    moyen:     { nom: "Capitaine Hugo", titre: "Moyen" },
    difficile: { nom: "Amiral Vega",    titre: "Difficile" },
  };

  /* ------------------------------------------------------------------
     Choix du tir (logique pure, testable)
     connu : tableau de taille × taille : null (inconnu), "eau", "touche",
             "coule", "bouclier" (navire protégé : à retenter), "vide"
             (sûrement sans navire intact, d'après un sonar ou un radar)
     restants : navires pas encore coulés [{ long, larg }]
     ------------------------------------------------------------------ */
  const VOISINS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function outils(taille) {
    const idx = (x, y) => y * taille + x;
    const dedans = (x, y) => x >= 0 && x < taille && y >= 0 && y < taille;
    const versCase = (i) => ({ x: i % taille, y: Math.floor(i / taille) });
    return { idx, dedans, versCase };
  }

  function preparer(connu, taille, regles) {
    const { idx, dedans } = outils(taille);
    const k = connu.slice();
    if (regles && regles.colles === false) {
      // Autour d'un navire coulé, il ne peut rien y avoir : on les marque « eau ».
      for (let y = 0; y < taille; y++) for (let x = 0; x < taille; x++) {
        if (connu[idx(x, y)] !== "coule") continue;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (dedans(x + dx, y + dy) && k[idx(x + dx, y + dy)] === null) k[idx(x + dx, y + dy)] = "eau";
        }
      }
    }
    return k;
  }

  const auHasard = (liste, rnd) => liste[Math.floor(rnd() * liste.length)];
  const tirable = (v) => v === null || v === "vide" || v === "bouclier";

  // Cases inconnues voisines d'un « touché » pas encore coulé (en priorité dans l'alignement)
  function ciblesAutourDesTouches(k, taille) {
    const { idx, dedans, versCase } = outils(taille);
    const touches = [];
    for (let i = 0; i < k.length; i++) if (k[i] === "touche" || k[i] === "bouclier") touches.push(versCase(i));
    if (!touches.length) return [];
    const libre = (x, y) => dedans(x, y) && (k[idx(x, y)] === null || k[idx(x, y)] === "bouclier");
    const alignees = [];
    for (const a of touches) {
      for (const [dx, dy] of VOISINS) {
        if (!dedans(a.x + dx, a.y + dy) || k[idx(a.x + dx, a.y + dy)] !== "touche") continue;
        for (const s of [1, -1]) {
          let x = a.x, y = a.y;
          while (dedans(x, y) && k[idx(x, y)] === "touche") { x += dx * s; y += dy * s; }
          if (libre(x, y)) alignees.push(idx(x, y));
        }
      }
    }
    if (alignees.length) return Array.from(new Set(alignees));
    const autour = [];
    for (const a of touches) for (const [dx, dy] of VOISINS) if (libre(a.x + dx, a.y + dy)) autour.push(idx(a.x + dx, a.y + dy));
    return Array.from(new Set(autour));
  }

  // Carte des probabilités : pour chaque navire restant, toutes les positions possibles.
  function carteProbabilites(k, taille, restants) {
    const { idx, dedans } = outils(taille);
    const poids = new Array(taille * taille).fill(0);
    const chasse = k.includes("touche") || k.includes("bouclier");
    for (const nav of restants) {
      const formes = nav.long === nav.larg ? [[nav.long, nav.larg]] : [[nav.long, nav.larg], [nav.larg, nav.long]];
      for (const [l, h] of formes) {
        for (let y = 0; y <= taille - h; y++) for (let x = 0; x <= taille - l; x++) {
          const cases = [];
          let ok = true, nbTouches = 0;
          for (let j = 0; j < h && ok; j++) for (let i = 0; i < l; i++) {
            const cx = x + i, cy = y + j;
            if (!dedans(cx, cy)) { ok = false; break; }
            const v = k[idx(cx, cy)];
            if (v === "eau" || v === "coule" || v === "vide") { ok = false; break; }
            if (v === "touche" || v === "bouclier") nbTouches++;
            cases.push(idx(cx, cy));
          }
          if (!ok) continue;
          if (chasse && nbTouches === 0) continue; // on se concentre sur le navire blessé
          const p = chasse ? Math.pow(20, nbTouches) : 1;
          for (const c of cases) if (k[c] === null || k[c] === "bouclier") poids[c] += p;
        }
      }
    }
    return poids;
  }

  function choisirTir(niveau, connu, restants, regles, hasard, indices) {
    const rnd = hasard || Math.random;
    const r = R.normaliser(regles);
    const taille = r.taille;
    const { idx, versCase } = outils(taille);
    const k = preparer(connu, taille, r);
    // Une case de navire déjà repérée (périscope, bouclier) : on la vise
    const reperees = (indices || []).filter((c) => tirable(k[idx(c.x, c.y)]) && k[idx(c.x, c.y)] !== "vide");
    if (reperees.length && (niveau !== "facile" || rnd() < 0.5)) return auHasard(reperees, rnd);

    const tous = [];
    for (let i = 0; i < k.length; i++) if (k[i] === null || k[i] === "bouclier") tous.push(i);
    if (!tous.length) {
      for (let i = 0; i < k.length; i++) if (k[i] === "vide" || connu[i] === null) tous.push(i);
      if (!tous.length) return { x: 0, y: 0 };
      return versCase(auHasard(tous, rnd));
    }

    if (niveau === "facile") {
      const cibles = ciblesAutourDesTouches(k, taille);
      if (cibles.length && rnd() < 0.2) return versCase(auHasard(cibles, rnd));
      return versCase(auHasard(tous, rnd));
    }
    if (niveau === "moyen") {
      const cibles = ciblesAutourDesTouches(k, taille);
      if (cibles.length) return versCase(auHasard(cibles, rnd));
      const damier = tous.filter((i) => ((i % taille) + Math.floor(i / taille)) % 2 === 0);
      return versCase(auHasard(damier.length ? damier : tous, rnd));
    }
    const poids = carteProbabilites(k, taille, restants.length ? restants : [{ long: 2, larg: 1 }]);
    let max = -1, meilleures = [];
    for (const i of tous) {
      if (poids[i] > max) { max = poids[i]; meilleures = [i]; }
      else if (poids[i] === max) meilleures.push(i);
    }
    return versCase(auHasard(meilleures, rnd));
  }

  /* Ce que l'ordinateur sait de la grille du joueur, au format de choisirTir
     (les sonars / radars « 0 » marquent leur zone comme vide). */
  function savoir(journal, attaquant, regles) {
    const r = R.normaliser(regles);
    const c = M.connaissance(journal, attaquant, r.taille);
    const k = c.grille.slice();
    c.infos.forEach((info) => {
      if (info.n === 0 && info.zone) info.zone.forEach((z) => { const i = z.y * r.taille + z.x; if (k[i] === null) k[i] = "vide"; });
    });
    const coulesIds = c.coules.map((x) => x.id);
    const restants = R.flotteDe(r).filter((n) => !coulesIds.includes(n.id));
    return { k, restants, indices: c.indices };
  }

  /* ------------------------------------------------------------------
     Compétences de l'ordinateur
     ------------------------------------------------------------------ */
  const PREFERENCES = ["bombardement", "raid", "eclair", "salve", "periscope", "torpille", "grenadage", "bouclier", "sonar", "radar", "mine"];
  function choisirCompetence(offre, niveau, hasard) {
    const rnd = hasard || Math.random;
    if (niveau === "facile") return auHasard(offre, rnd);
    return offre.slice().sort((a, b) => PREFERENCES.indexOf(a) - PREFERENCES.indexOf(b))[0];
  }

  // Paramètres d'une compétence, autour de la meilleure case du moment
  function preparerAction(type, niveau, journal, moi, regles, rnd, defenseOk) {
    const r = R.normaliser(regles);
    const T = r.taille;
    const { k, restants, indices } = savoir(journal, moi, r);
    const meilleure = () => choisirTir(niveau, k, restants, r, rnd, indices);
    const c = meilleure();
    const lignePlusDense = () => ({ axe: rnd() < 0.5 ? "ligne" : "colonne", index: rnd() < 0.5 ? c.y : c.x });
    switch (type) {
      case "tir": case "eclair": case "grenadage": return { x: c.x, y: c.y };
      case "sonar": return { x: c.x, y: c.y };
      case "salve": {
        const k2 = k.slice(); k2[c.y * T + c.x] = "eau";
        let d = choisirTir(niveau, k2, restants, r, rnd, indices.filter((i) => i.x !== c.x || i.y !== c.y));
        if (d.x === c.x && d.y === c.y) d = { x: (c.x + 1) % T, y: c.y };
        return { cases: [c, d] };
      }
      case "raid": {
        const h = rnd() < 0.5;
        return h ? { x: c.x - 1, y: c.y, h } : { x: c.x, y: c.y - 1, h };
      }
      case "bombardement": return { x: c.x - (rnd() < 0.5 ? 1 : 0), y: c.y - (rnd() < 0.5 ? 1 : 0) };
      case "radar": { const l = lignePlusDense(); return { axe: l.axe, index: l.axe === "ligne" ? c.y : c.x }; }
      case "torpille": {
        const axe = rnd() < 0.5 ? "ligne" : "colonne";
        const pos = axe === "ligne" ? c.x : c.y;
        return { axe, index: axe === "ligne" ? c.y : c.x, sens: pos < T / 2 ? 1 : -1 };
      }
      case "periscope": return {};
      case "bouclier": case "mine": {
        // la case secrète est choisie à part (voir defenseOk)
        return defenseOk ? {} : null;
      }
      default: return null;
    }
  }

  /* ------------------------------------------------------------------
     Ce que l'ordinateur dit dans la discussion
     ------------------------------------------------------------------ */
  const PHRASES = {
    bonjour: ["Bienvenue à bord, capitaine. Que le meilleur gagne ! ⚓", "Prêt à perdre ta flotte ? 😏", "Bonne chance… tu vas en avoir besoin 🌊"],
    reponse: ["Concentre-toi sur la partie 😄", "Je calcule ton prochain naufrage…", "Bip boup. Ta flotte est en danger 🤖", "Tu parles beaucoup pour quelqu'un qui va couler !", "Bien reçu, capitaine 🫡", "Haha ! On verra à la fin 😎"],
    jeCoule: ["Et un de moins ! 💥", "Glouglou… 🫧", "Coulé ! Tu l'avais mal caché 😎"],
    ilCoule: ["Aïe… bien vu 😤", "Joli tir ! 👏", "Pas mal… mais ce n'est pas fini !"],
    competence: ["Tu vas voir ce que tu vas voir ✨", "Petit cadeau pour toi 🎁", "Compétence spéciale ! 😏"],
    jeGagne: ["Victoire ! Une revanche ? 🔁", "La mer est à moi 🌊👑"],
    ilGagne: ["Bravo capitaine, bien joué ! 👏", "Je m'incline… pour cette fois 😤"],
  };

  /* ------------------------------------------------------------------
     L'adversaire virtuel. Il joue le rôle de l'invité.
     options = { niveau, envoyer(msg), lire(), ecrire(etat), rapide }
     ------------------------------------------------------------------ */
  const MOI = "invite", LUI = "hote";

  function Ordinateur(options) {
    const niveau = NIVEAUX[options.niveau] ? options.niveau : "moyen";
    const nom = NIVEAUX[niveau].nom;
    const rapide = !!options.rapide; // tests automatiques : on ne fait pas attendre
    let E = options.lire() || null;   // l'état de l'ordinateur (gardé en mémoire)
    if (E && !Array.isArray(E.journal)) E = null; // ancienne version : on repart de zéro
    let minuteur = null;
    let arrete = false;

    function nouvelEtat(partieId, premier, regles) {
      const ancien = E || {};
      const r = R.normaliser(regles);
      E = {
        partieId, premier, regles: r,
        navires: R.placementAleatoire(r),
        defense: [], main: [], offresVues: 0,
        pret: false, adversairePret: false,
        journal: [], fin: false, revanche: false, flotteVue: false,
        chat: ancien.chat || [], chatEnvoyes: ancien.chatEnvoyes || 0, chatRecus: ancien.chatRecus || 0, chatConfirmes: ancien.chatConfirmes || 0,
        salue: !!ancien.salue,
      };
      D.initialiser(E);
      sauver();
    }
    function sauver() { if (E) options.ecrire(E); }
    function envoyer(msg) { if (!arrete) options.envoyer(msg); }
    function attendre(ms, fn) { return setTimeout(() => { if (!arrete) fn(); }, rapide ? 15 : ms); }
    const auHasardDe = (l) => l[Math.floor(Math.random() * l.length)];

    function etat() {
      return { t: "etat", partieId: E ? E.partieId : null, pret: !!(E && E.pret), nom, id: "ordinateur-" + niveau, aSaFlotte: !!(E && E.flotteVue), chatRecus: E ? E.chatRecus : 0 };
    }
    function bonjour() { return { t: "bonjour", jeton: "ordinateur-" + niveau, id: "ordinateur-" + niveau, nom, partieId: E ? E.partieId : null }; }
    function dire(texte) { if (!E) return; const m = D.ecrire(E, texte); if (m) { sauver(); envoyer(m); } }
    function direParfois(cle, chance) { if (Math.random() < chance) attendre(900, () => dire(auHasardDe(PHRASES[cle]))); }

    const enJeu = () => E && E.pret && E.adversairePret && !E.fin;
    const enAttente = () => E.journal.some((a) => !a.res);

    // Nouvelles compétences gagnées : l'ordinateur choisit tout de suite
    function ramasserCompetences() {
      if (!E.regles.competences) return;
      const s = M.stock(E.journal, MOI);
      while (E.offresVues < s.gagnees) {
        E.offresVues++;
        const coules = M.connaissance(E.journal, LUI, E.regles.taille).coules.map((c) => c.id); // mes navires coulés par lui
        const offre = M.tirage(M.reserve(E.regles, coules), 3);
        E.main.push(choisirCompetence(offre, niveau));
      }
    }

    function jouerSiBesoin() {
      if (!enJeu() || arrete) return;
      // Une action sans réponse (page rechargée…) : on la redemande.
      E.journal.forEach((a) => { if (a.qui === MOI && !a.res) envoyer({ t: "action", partieId: E.partieId, g: a.g, qui: a.qui, type: a.type, p: a.p }); });
      if (minuteur || enAttente() || M.quiJoue(E.journal, E.premier) !== MOI) return;
      minuteur = attendre(900 + Math.random() * 900, () => {
        minuteur = null;
        if (!enJeu() || enAttente() || M.quiJoue(E.journal, E.premier) !== MOI) return;
        agir();
      });
    }

    function agir() {
      const r = E.regles;
      let type = "tir", p = null, defense = null;
      const dispo = r.competences ? M.stock(E.journal, MOI).dispo : 0;
      const envie = niveau === "facile" ? Math.random() < 0.5 : true;
      if (dispo > 0 && E.main.length && envie) {
        const choisie = E.main[0];
        if (choisie === "bouclier" || choisie === "mine") {
          const e = M.etatDefense(E.navires, E.defense, E.journal, MOI, r);
          const candidates = [];
          for (let y = 0; y < r.taille; y++) for (let x = 0; x < r.taille; x++) if (e.defensePossible(choisie, x, y)) candidates.push({ x, y });
          if (candidates.length) defense = Object.assign({ type: choisie }, auHasardDe(candidates));
        }
        const params = preparerAction(choisie, niveau, E.journal, MOI, r, Math.random, !!defense);
        const propres = params && M.normaliserParams(choisie, params, r.taille);
        if (propres) { type = choisie; p = propres; E.main.shift(); }
        else defense = null;
      }
      if (!p) {
        p = preparerAction("tir", niveau, E.journal, MOI, r, Math.random);
        type = "tir";
      }
      const g = E.journal.length;
      if (defense) E.defense.push(Object.assign(defense, { g }));
      E.journal.push({ g, qui: MOI, type, p, res: null });
      sauver();
      if (type !== "tir") direParfois("competence", 0.3);
      envoyer({ t: "action", partieId: E.partieId, g, qui: MOI, type, p });
    }

    function finir(jeGagne) {
      if (E.fin) return;
      E.fin = true; sauver();
      envoyer({ t: "flotte", partieId: E.partieId, navires: E.navires, defense: E.defense });
      direParfois(jeGagne ? "jeGagne" : "ilGagne", 0.9);
    }

    function recevoir(msg) {
      if (arrete || !msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "bienvenue":
        case "nouvelle":
          if (!E || msg.partieId !== E.partieId || msg.t === "nouvelle") {
            clearTimeout(minuteur); minuteur = null;
            nouvelEtat(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", msg.regles);
          }
          envoyer(etat());
          devenirPret();
          if (!E.salue) { E.salue = true; sauver(); attendre(1500, () => dire(auHasardDe(PHRASES.bonjour))); }
          break;

        case "etat":
          if (!E || msg.partieId !== E.partieId) { envoyer(bonjour()); return; }
          D.aRenvoyer(E, msg.chatRecus).forEach(envoyer);
          if (Number.isInteger(msg.chatRecus) && msg.chatRecus <= E.chatEnvoyes) E.chatConfirmes = Math.max(E.chatConfirmes, msg.chatRecus);
          E.adversairePret = !!msg.pret;
          if (E.fin && !msg.aSaFlotte) envoyer({ t: "flotte", partieId: E.partieId, navires: E.navires, defense: E.defense });
          if (E.revanche) envoyer({ t: "revanche", partieId: E.partieId });
          sauver();
          devenirPret();
          jouerSiBesoin();
          break;

        case "action": {
          if (!E || msg.partieId !== E.partieId) return;
          const deja = E.journal[msg.g];
          if (deja && deja.qui === LUI && deja.res) { envoyer({ t: "reponse", partieId: E.partieId, g: deja.g, res: deja.res }); return; }
          if (!enJeu() || enAttente()) return;
          const a = M.actionValide(E.journal, E.regles, E.premier, msg);
          if (!a || a.qui !== LUI) return;
          const e = M.etatDefense(E.navires, E.defense, E.journal, MOI, E.regles);
          a.res = e.resoudre(a);
          E.journal.push(a);
          sauver();
          envoyer({ t: "reponse", partieId: E.partieId, g: a.g, res: a.res });
          if (a.res.fin) finir(false);
          else { if (a.res.cases.some((c) => c.res === "coule")) direParfois("ilCoule", 0.35); jouerSiBesoin(); }
          break;
        }

        case "reponse": {
          if (!E || msg.partieId !== E.partieId) return;
          const a = E.journal[msg.g];
          if (!a || a.qui !== MOI || a.res) return;
          const res = M.nettoyerRes(msg.res, E.regles.taille);
          if (!res) return;
          a.res = res;
          ramasserCompetences();
          sauver();
          if (res.fin) finir(true);
          else if (res.cases.some((c) => c.res === "coule")) direParfois("jeCoule", 0.4);
          jouerSiBesoin();
          break;
        }

        case "flotte":
          if (E && msg.partieId === E.partieId) { E.flotteVue = true; sauver(); }
          break;

        case "revanche":
          if (!E || msg.partieId !== E.partieId || !E.fin) return;
          E.revanche = true; sauver();
          attendre(700, () => envoyer({ t: "revanche", partieId: E.partieId }));
          break;

        case "chat": {
          if (!E) return;
          const m = D.recevoir(E, msg);
          if (!m) return;
          sauver();
          envoyer(etat());
          if (Math.random() < 0.6) attendre(1400 + Math.random() * 1200, () => dire(auHasardDe(PHRASES.reponse)));
          break;
        }

        case "emoji":
          if (Math.random() < 0.3) attendre(800, () => envoyer({ t: "emoji", e: auHasardDe(["😂", "😤", "🔥"]) }));
          break;

        default:
          break;
      }
    }

    function devenirPret() {
      if (!E || E.pret) return;
      attendre(1200, () => {
        if (!E || E.pret) return;
        E.pret = true; sauver();
        envoyer(etat());
        jouerSiBesoin();
      });
    }

    return {
      demarrer() { envoyer(bonjour()); },
      recevoir,
      arreter() { arrete = true; clearTimeout(minuteur); },
      nom,
    };
  }

  /* ------------------------------------------------------------------
     LiaisonSolo : même « prise » que Reseau.Liaison, mais l'autre bout
     du fil est l'ordinateur, dans le même téléphone.
     ------------------------------------------------------------------ */
  function LiaisonSolo(options) {
    let fini = false;
    const file = (fn) => setTimeout(() => { if (!fini) fn(); }, 0); // comme un vrai réseau : jamais instantané
    const ordi = Ordinateur({
      niveau: options.niveau,
      rapide: options.rapide,
      lire: options.lireOrdinateur,
      ecrire: options.ecrireOrdinateur,
      envoyer: (msg) => file(() => options.surMessage(JSON.parse(JSON.stringify(msg)))),
    });
    file(() => { options.surEtat("connecte"); ordi.demarrer(); });
    const minuteur = setInterval(() => { if (!fini && options.battement) options.battement(); }, 3000);

    return {
      envoyer(msg) { if (fini) return false; const copie = JSON.parse(JSON.stringify(msg)); file(() => ordi.recevoir(copie)); return true; },
      fermer() { fini = true; clearInterval(minuteur); ordi.arreter(); },
      verifier() {},
      etat: () => "connecte",
      connecte: () => !fini,
    };
  }

  const api = { NIVEAUX, choisirTir, carteProbabilites, savoir, choisirCompetence, preparerAction, Ordinateur, LiaisonSolo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.IA = api;
})(typeof window !== "undefined" ? window : this);
