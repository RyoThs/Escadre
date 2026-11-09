/* ==========================================================================
   Escadre — le MODE SOLO (jouer contre l'ordinateur)
   --------------------------------------------------------------------------
   Astuce d'architecture : l'ordinateur se comporte EXACTEMENT comme un ami
   qui aurait rejoint la partie. Il reçoit et envoie les mêmes messages
   (« bonjour », « tir », « resultat », « flotte »…). Ainsi tout le reste de
   l'appli (tours, annonces, anti-triche, revanche, discussion) marche sans
   rien changer, et le mode solo ne peut pas « tricher » non plus.

   Trois niveaux :
   - facile    : tire surtout au hasard ;
   - moyen     : chasse (une case sur deux), puis achève le navire touché ;
   - difficile : calcule pour chaque case combien de navires pourraient s'y
                 cacher, et tire là où c'est le plus probable.
   ========================================================================== */
(function (racine) {
  "use strict";
  const R = racine.Regles || (typeof require !== "undefined" ? require("./regles.js") : null);
  const D = racine.Discussion || (typeof require !== "undefined" ? require("./discussion.js") : null);

  const NIVEAUX = {
    facile:    { nom: "Matelot Robin",  titre: "Facile" },
    moyen:     { nom: "Capitaine Hugo", titre: "Moyen" },
    difficile: { nom: "Amiral Vega",    titre: "Difficile" },
  };

  /* ------------------------------------------------------------------
     Choix du tir (logique pure, testable)
     connu : tableau de 100 valeurs : null (inconnu), "eau", "touche", "coule"
     restants : tailles des navires pas encore coulés, ex. [5, 3, 2]
     regles : { colles } (si les navires ne se touchent pas, les cases autour
              d'une épave sont forcément vides)
     ------------------------------------------------------------------ */
  const T = 10;
  const idx = (x, y) => y * T + x;
  const dedans = (x, y) => x >= 0 && x < T && y >= 0 && y < T;
  const VOISINS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function preparer(connu, regles) {
    const k = connu.slice();
    if (regles && regles.colles === false) {
      // Autour d'un navire coulé, il ne peut rien y avoir : on les marque « eau ».
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (connu[idx(x, y)] !== "coule") continue;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (dedans(x + dx, y + dy) && k[idx(x + dx, y + dy)] === null) k[idx(x + dx, y + dy)] = "eau";
        }
      }
    }
    return k;
  }

  function libres(k) {
    const l = [];
    for (let i = 0; i < T * T; i++) if (k[i] === null) l.push(i);
    return l;
  }

  function auHasard(liste, rnd) { return liste[Math.floor(rnd() * liste.length)]; }
  const versCase = (i) => ({ x: i % T, y: Math.floor(i / T) });

  // Cases inconnues voisines d'un « touché » pas encore coulé (en priorité dans l'alignement)
  function ciblesAutourDesTouches(k) {
    const touches = [];
    for (let i = 0; i < T * T; i++) if (k[i] === "touche") touches.push(versCase(i));
    if (!touches.length) return [];
    // Deux touchés alignés : on prolonge la ligne
    const alignees = [];
    for (const a of touches) {
      for (const [dx, dy] of VOISINS) {
        if (!dedans(a.x + dx, a.y + dy) || k[idx(a.x + dx, a.y + dy)] !== "touche") continue;
        // on avance dans les deux sens jusqu'à une case inconnue
        for (const s of [1, -1]) {
          let x = a.x, y = a.y;
          while (dedans(x, y) && k[idx(x, y)] === "touche") { x += dx * s; y += dy * s; }
          if (dedans(x, y) && k[idx(x, y)] === null) alignees.push(idx(x, y));
        }
      }
    }
    if (alignees.length) return Array.from(new Set(alignees));
    const autour = [];
    for (const a of touches) for (const [dx, dy] of VOISINS) {
      if (dedans(a.x + dx, a.y + dy) && k[idx(a.x + dx, a.y + dy)] === null) autour.push(idx(a.x + dx, a.y + dy));
    }
    return Array.from(new Set(autour));
  }

  // Carte des probabilités : pour chaque navire restant, on essaie toutes les
  // positions possibles et on compte combien passent par chaque case.
  function carteProbabilites(k, restants) {
    const poids = new Array(T * T).fill(0);
    const chasse = k.includes("touche");
    for (const taille of restants) {
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        for (const h of [true, false]) {
          const cases = [];
          let ok = true, nbTouches = 0;
          for (let i = 0; i < taille; i++) {
            const cx = h ? x + i : x, cy = h ? y : y + i;
            if (!dedans(cx, cy)) { ok = false; break; }
            const v = k[idx(cx, cy)];
            if (v === "eau" || v === "coule") { ok = false; break; }
            if (v === "touche") nbTouches++;
            cases.push(idx(cx, cy));
          }
          if (!ok) continue;
          if (chasse && nbTouches === 0) continue;     // on se concentre sur le navire blessé
          const p = chasse ? Math.pow(20, nbTouches) : 1;
          for (const c of cases) if (k[c] === null) poids[c] += p;
        }
      }
    }
    return poids;
  }

  function choisirTir(niveau, connu, restants, regles, hasard) {
    const rnd = hasard || Math.random;
    const k = preparer(connu, regles);
    const tous = libres(k);
    if (!tous.length) {
      const brut = libres(connu); // ne devrait pas arriver, mais on ne bloque jamais
      return versCase(auHasard(brut.length ? brut : [0], rnd));
    }

    if (niveau === "facile") {
      const cibles = ciblesAutourDesTouches(k);
      if (cibles.length && rnd() < 0.2) return versCase(auHasard(cibles, rnd));
      return versCase(auHasard(tous, rnd));
    }

    if (niveau === "moyen") {
      const cibles = ciblesAutourDesTouches(k);
      if (cibles.length) return versCase(auHasard(cibles, rnd));
      const damier = tous.filter((i) => ((i % T) + Math.floor(i / T)) % 2 === 0);
      return versCase(auHasard(damier.length ? damier : tous, rnd));
    }

    // difficile
    const poids = carteProbabilites(k, restants.length ? restants : [2]);
    let max = -1, meilleures = [];
    for (const i of tous) {
      if (poids[i] > max) { max = poids[i]; meilleures = [i]; }
      else if (poids[i] === max) meilleures.push(i);
    }
    return versCase(auHasard(meilleures, rnd));
  }

  /* ------------------------------------------------------------------
     Ce que l'ordinateur dit dans la discussion
     ------------------------------------------------------------------ */
  const PHRASES = {
    bonjour: ["Bienvenue à bord, capitaine. Que le meilleur gagne ! ⚓", "Prêt à perdre ta flotte ? 😏", "Bonne chance… tu vas en avoir besoin 🌊"],
    reponse: ["Concentre-toi sur la partie 😄", "Je calcule ton prochain naufrage…", "Bip boup. Ta flotte est en danger 🤖", "Tu parles beaucoup pour quelqu'un qui va couler !", "Bien reçu, capitaine 🫡", "Haha ! On verra à la fin 😎"],
    jeCoule: ["Et un de moins ! 💥", "Glouglou… 🫧", "Coulé ! Tu l'avais mal caché 😎"],
    ilCoule: ["Aïe… bien vu 😤", "Joli tir ! 👏", "Pas mal… mais ce n'est pas fini !"],
    jeGagne: ["Victoire ! Une revanche ? 🔁", "La mer est à moi 🌊👑"],
    ilGagne: ["Bravo capitaine, bien joué ! 👏", "Je m'incline… pour cette fois 😤"],
  };

  /* ------------------------------------------------------------------
     L'adversaire virtuel. Il joue le rôle de l'invité.
     options = { niveau, envoyer(msg), lire(), ecrire(etat), delai(ms) }
     ------------------------------------------------------------------ */
  function Ordinateur(options) {
    const niveau = NIVEAUX[options.niveau] ? options.niveau : "moyen";
    const nom = NIVEAUX[niveau].nom;
    const rapide = !!options.rapide; // tests automatiques : on ne fait pas attendre
    let E = options.lire() || null;   // l'état de l'ordinateur (gardé en mémoire)
    let minuteurTir = null;
    let arrete = false;

    function nouvelEtat(partieId, premier, regles) {
      const ancien = E || {};
      E = {
        partieId, premier, regles,
        navires: R.placementAleatoire(regles),
        pret: false, adversairePret: false,
        tirsEnvoyes: [], tirsRecus: [],
        fin: false, revanche: false,
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
      return { t: "etat", partieId: E ? E.partieId : null, pret: !!(E && E.pret), nom, aSaFlotte: !!(E && E.flotteVue), chatRecus: E ? E.chatRecus : 0 };
    }
    function bonjour() { return { t: "bonjour", jeton: "ordinateur-" + niveau, id: "ordinateur-" + niveau, nom, partieId: E ? E.partieId : null }; }

    function dire(texte) {
      if (!E) return;
      const m = D.ecrire(E, texte);
      if (m) { sauver(); envoyer(m); }
    }
    function direParfois(cle, chance) { if (Math.random() < chance) attendre(900, () => dire(auHasardDe(PHRASES[cle]))); }

    const premierEstMoi = () => E.premier === "invite";
    const monTour = () => !E.fin && E.pret && E.adversairePret && R.estMonTour(premierEstMoi(), E.tirsEnvoyes.length, E.tirsRecus.length);

    // Ce que je sais de la grille du joueur
    function connaissance() {
      const k = new Array(100).fill(null);
      const coules = [];
      E.tirsEnvoyes.forEach((t) => {
        if (t.res === null) return;
        k[t.y * 10 + t.x] = t.res === "eau" ? "eau" : "touche";
        if (t.res === "coule") coules.push(t);
      });
      coules.forEach((t) => (t.cases || []).forEach((c) => (k[c.y * 10 + c.x] = "coule")));
      const restants = R.FLOTTE.filter((f) => !coules.some((t) => t.navire === f.id)).map((f) => f.taille);
      return { k, restants };
    }

    function jouerSiBesoin() {
      if (!E || arrete) return;
      // Un tir sans réponse (page rechargée…) : on le redemande.
      E.tirsEnvoyes.forEach((t, n) => { if (t.res === null) envoyer({ t: "tir", partieId: E.partieId, n, x: t.x, y: t.y }); });
      if (!monTour() || minuteurTir || E.tirsEnvoyes.some((t) => t.res === null)) return;
      minuteurTir = attendre(900 + Math.random() * 900, () => {
        minuteurTir = null;
        if (!monTour()) return;
        const { k, restants } = connaissance();
        const c = choisirTir(niveau, k, restants, E.regles);
        const n = E.tirsEnvoyes.length;
        E.tirsEnvoyes.push({ x: c.x, y: c.y, res: null });
        sauver();
        envoyer({ t: "tir", partieId: E.partieId, n, x: c.x, y: c.y });
      });
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

    function finir(jeGagne) {
      if (E.fin) return;
      E.fin = true; sauver();
      envoyer({ t: "flotte", partieId: E.partieId, navires: E.navires });
      direParfois(jeGagne ? "jeGagne" : "ilGagne", 0.9);
    }

    function recevoir(msg) {
      if (arrete || !msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "bienvenue":
        case "nouvelle":
          if (!E || msg.partieId !== E.partieId || msg.t === "nouvelle") {
            clearTimeout(minuteurTir); minuteurTir = null;
            nouvelEtat(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", { colles: !(msg.regles && msg.regles.colles === false) });
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
          if (E.fin && !msg.aSaFlotte) envoyer({ t: "flotte", partieId: E.partieId, navires: E.navires });
          if (E.revanche) envoyer({ t: "revanche", partieId: E.partieId });
          sauver();
          devenirPret();
          jouerSiBesoin();
          break;

        case "tir": {
          if (!E || msg.partieId !== E.partieId || !Number.isInteger(msg.n)) return;
          if (msg.n < E.tirsRecus.length) { // déjà traité : même réponse
            envoyer(Object.assign({ t: "resultat", partieId: E.partieId, n: msg.n }, E.tirsRecus[msg.n]));
            return;
          }
          const sonTour = E.pret && E.adversairePret && !E.fin && R.estMonTour(!premierEstMoi(), E.tirsRecus.length, E.tirsEnvoyes.length);
          if (msg.n !== E.tirsRecus.length || !sonTour) return;
          if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y) || E.tirsRecus.some((t) => t.x === msg.x && t.y === msg.y)) return;
          const r = R.resoudreTir(E.navires, E.tirsRecus, msg.x, msg.y);
          const enregistre = Object.assign({ x: msg.x, y: msg.y }, r);
          E.tirsRecus.push(enregistre);
          sauver();
          envoyer(Object.assign({ t: "resultat", partieId: E.partieId, n: msg.n }, enregistre));
          if (r.fin) finir(false);
          else { if (r.res === "coule") direParfois("ilCoule", 0.35); jouerSiBesoin(); }
          break;
        }

        case "resultat": {
          if (!E || msg.partieId !== E.partieId || !Number.isInteger(msg.n)) return;
          const t = E.tirsEnvoyes[msg.n];
          if (!t || t.res !== null || t.x !== msg.x || t.y !== msg.y) return;
          if (!["eau", "touche", "coule"].includes(msg.res)) return;
          t.res = msg.res;
          if (msg.res === "coule") { t.navire = msg.navire; t.cases = Array.isArray(msg.cases) ? msg.cases : []; }
          sauver();
          if (msg.fin) finir(true);
          else if (msg.res === "coule") direParfois("jeCoule", 0.4);
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
          envoyer(etat()); // accusé de réception tout de suite
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

    return {
      demarrer() { envoyer(bonjour()); },
      recevoir,
      arreter() { arrete = true; clearTimeout(minuteurTir); },
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

  const api = { NIVEAUX, choisirTir, carteProbabilites, Ordinateur, LiaisonSolo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.IA = api;
})(typeof window !== "undefined" ? window : this);
