/* ==========================================================================
   Escadre — le MOTEUR des actions (tirs et compétences), sans affichage
   --------------------------------------------------------------------------
   Toute la partie est un JOURNAL : la liste des actions dans l'ordre,
   numérotées 0, 1, 2… (« g »). Chaque action dit qui l'a faite (hôte ou
   invité), ce qu'il a fait (tir, sonar, salve…) et, une fois résolue, le
   résultat calculé par le téléphone de l'adversaire (le seul qui connaît
   sa flotte).

   À partir du journal, ce fichier sait tout recalculer de la même façon sur
   les deux téléphones :
   - à qui c'est le tour (un « Éclair » réussi fait rejouer, une mine fait
     perdre un tour) ;
   - combien de compétences chacun a gagnées (2 tirs à l'eau d'affilée) ;
   - le résultat d'une action sur une flotte (avec boucliers et mines) ;
   - et, à la fin, si toutes les réponses de l'adversaire étaient honnêtes.
   ========================================================================== */
(function (racine) {
  "use strict";
  const R = racine.Regles || (typeof require !== "undefined" ? require("./regles.js") : null);

  const STOCK_MAX = 2; // compétences gardées en réserve au maximum

  /* Les compétences. « cible » dit ce qu'il faut viser :
     case (1 case) · deux (2 cases) · raid (3 cases en ligne) · carre2 (2 × 2)
     zone3 (3 × 3, sans tirer) · axe (ligne ou colonne, sans tirer)
     torpille (ligne ou colonne depuis un bord) · aucune · maNavire · maCaseVide */
  const COMPETENCES = {
    sonar:        { id: "sonar",        icone: "🔊", nom: "Sonar",        cible: "zone3",      desc: "Sonde une zone de 3 × 3 : combien de cases de navire intactes s'y cachent." },
    salve:        { id: "salve",        icone: "🎯", nom: "Salve",        cible: "deux",       desc: "Tire sur 2 cases dans le même tour." },
    torpille:     { id: "torpille",     icone: "🚀", nom: "Torpille",     cible: "torpille",   desc: "Part d'un bord et file sur une ligne jusqu'au premier navire intact." },
    bouclier:     { id: "bouclier",     icone: "🛡️", nom: "Bouclier",     cible: "maNavire",   desc: "Protège une case de ta flotte : le prochain tir dessus est bloqué." },
    raid:         { id: "raid",         icone: "✈️", nom: "Raid aérien",  cible: "raid",       navire: "pa", desc: "Frappe 3 cases d'affilée (en ligne ou en colonne)." },
    bombardement: { id: "bombardement", icone: "💣", nom: "Bombardement", cible: "carre2",     navire: "cr", desc: "Frappe un carré de 2 × 2 cases." },
    periscope:    { id: "periscope",    icone: "🔭", nom: "Périscope",    cible: "aucune",     navire: "sm", desc: "Révèle une case d'un navire ennemi, sans la toucher." },
    grenadage:    { id: "grenadage",    icone: "📡", nom: "Grenadage",    cible: "case",       navire: "ct", desc: "Tire ; si c'est raté, dit combien de cases de navire entourent ce point." },
    eclair:       { id: "eclair",       icone: "⚡", nom: "Éclair",       cible: "case",       navire: "to", desc: "Tire ; si ça touche, tu rejoues tout de suite." },
    radar:        { id: "radar",        icone: "📶", nom: "Radar",        cible: "axe",        navire: "fr", desc: "Dit combien de cases de navire intactes contient une ligne ou une colonne." },
    mine:         { id: "mine",         icone: "💥", nom: "Mine",         cible: "maCaseVide", navire: "ve", desc: "Piège une case vide de ta grille : l'ami qui tire dessus perd son tour suivant." },
  };
  const COMMUNES = ["sonar", "salve", "torpille", "bouclier"];

  const autre = (qui) => (qui === "hote" ? "invite" : "hote");
  const cle = (x, y) => x + "," + y;
  const entier = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const borne = (v, min, max) => Math.min(Math.max(v, min), max);

  /* ------------------------------------------------------------------
     Paramètres d'une action : on les vérifie et on les « nettoie ».
     Renvoie les paramètres propres, ou null si l'action est invalide.
     ------------------------------------------------------------------ */
  function normaliserParams(type, p, taille) {
    p = p || {};
    const caseOk = (c) => c && entier(c.x, 0, taille - 1) && entier(c.y, 0, taille - 1);
    switch (type) {
      case "tir": case "eclair": case "grenadage": case "sonar": case "raid": case "bombardement":
        if (!caseOk(p)) return null;
        return type === "raid" ? { x: p.x, y: p.y, h: !!p.h } : { x: p.x, y: p.y };
      case "salve": {
        if (!Array.isArray(p.cases) || p.cases.length !== 2 || !p.cases.every(caseOk)) return null;
        const [a, b] = p.cases;
        if (a.x === b.x && a.y === b.y) return null;
        return { cases: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] };
      }
      case "radar":
        if (!["ligne", "colonne"].includes(p.axe) || !entier(p.index, 0, taille - 1)) return null;
        return { axe: p.axe, index: p.index };
      case "torpille":
        if (!["ligne", "colonne"].includes(p.axe) || !entier(p.index, 0, taille - 1) || ![1, -1].includes(p.sens)) return null;
        return { axe: p.axe, index: p.index, sens: p.sens };
      case "periscope": case "bouclier": case "mine":
        return {}; // la case du bouclier ou de la mine reste SECRÈTE sur mon téléphone
      default:
        return null;
    }
  }

  // Cases visées par une action (avant de connaître la flotte)
  function casesVisees(type, p, taille) {
    switch (type) {
      case "tir": case "eclair": case "grenadage": return [{ x: p.x, y: p.y }];
      case "salve": return p.cases.slice();
      case "raid": {
        const l = [];
        if (p.h) { const x0 = borne(p.x, 0, taille - 3); for (let i = 0; i < 3; i++) l.push({ x: x0 + i, y: p.y }); }
        else { const y0 = borne(p.y, 0, taille - 3); for (let i = 0; i < 3; i++) l.push({ x: p.x, y: y0 + i }); }
        return l;
      }
      case "bombardement": {
        const x0 = borne(p.x, 0, taille - 2), y0 = borne(p.y, 0, taille - 2);
        return [{ x: x0, y: y0 }, { x: x0 + 1, y: y0 }, { x: x0, y: y0 + 1 }, { x: x0 + 1, y: y0 + 1 }];
      }
      default: return [];
    }
  }

  // Zone examinée (sans tirer) par le sonar ou le radar ; trajet de la torpille
  function zoneExaminee(type, p, taille) {
    const l = [];
    if (type === "sonar") {
      const cx = borne(p.x, 1, taille - 2), cy = borne(p.y, 1, taille - 2);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) l.push({ x: cx + dx, y: cy + dy });
    } else if (type === "radar" || type === "torpille") {
      for (let i = 0; i < taille; i++) l.push(p.axe === "ligne" ? { x: i, y: p.index } : { x: p.index, y: i });
      if (type === "torpille" && p.sens === -1) l.reverse();
    }
    return l;
  }

  /* ------------------------------------------------------------------
     L'état d'une flotte attaquée : cases touchées, boucliers, mines.
     ------------------------------------------------------------------ */
  function EtatDefense(navires, regles) {
    const taille = R.normaliser(regles).taille;
    const parCase = new Map();
    navires.forEach((n) => R.casesDe(n).forEach((c) => parCase.set(cle(c.x, c.y), n)));
    const touchees = new Set();
    const tirees = new Set();     // toutes les cases déjà visées par un tir
    const boucliers = new Set();
    const mines = new Set();

    const intacte = (x, y) => parCase.has(cle(x, y)) && !touchees.has(cle(x, y));
    const compterIntactes = (cases) => cases.filter((c) => intacte(c.x, c.y)).length;

    function tirerCase(x, y) {
      const k = cle(x, y);
      tirees.add(k);
      if (touchees.has(k)) return { x, y, res: "deja" };
      if (boucliers.has(k)) { boucliers.delete(k); return { x, y, res: "bouclier" }; }
      const n = parCase.get(k);
      if (n) {
        touchees.add(k);
        const cases = R.casesDe(n);
        if (cases.every((c) => touchees.has(cle(c.x, c.y)))) return { x, y, res: "coule", navire: n.id, cases };
        return { x, y, res: "touche" };
      }
      if (mines.has(k)) { mines.delete(k); return { x, y, res: "eau", mine: true }; }
      return { x, y, res: "eau" };
    }

    function fin() { return [...parCase.keys()].every((k) => touchees.has(k)); }

    // Une défense (bouclier, mine) peut-elle être posée là ?
    function defensePossible(type, x, y) {
      if (!entier(x, 0, taille - 1) || !entier(y, 0, taille - 1)) return false;
      const k = cle(x, y);
      if (type === "bouclier") return intacte(x, y) && !boucliers.has(k);
      if (type === "mine") return !parCase.has(k) && !tirees.has(k) && !mines.has(k);
      return false;
    }
    function activer(d) {
      if (!d || !defensePossible(d.type, d.x, d.y)) return false;
      (d.type === "bouclier" ? boucliers : mines).add(cle(d.x, d.y));
      return true;
    }

    /* Résout une action de l'adversaire. choixPeriscope : la case déjà
       choisie (pour revérifier), sinon on en tire une au hasard. */
    function resoudre(action, rnd, choixPeriscope) {
      const t = action.type, p = action.p;
      const res = { cases: [], fin: false, rejoue: false, perdTour: false, info: null };
      if (["tir", "salve", "raid", "bombardement", "eclair", "grenadage"].includes(t)) {
        casesVisees(t, p, taille).forEach((c) => res.cases.push(tirerCase(c.x, c.y)));
      } else if (t === "torpille") {
        // La torpille file jusqu'au premier navire intact ; elle passe au-dessus des mines.
        for (const c of zoneExaminee(t, p, taille)) {
          const k = cle(c.x, c.y);
          if (parCase.has(k) && touchees.has(k)) continue;
          if (parCase.has(k) || boucliers.has(k)) { res.cases.push(tirerCase(c.x, c.y)); break; }
          tirees.add(k);
          res.cases.push({ x: c.x, y: c.y, res: "eau" });
        }
      } else if (t === "sonar" || t === "radar") {
        res.info = { n: compterIntactes(zoneExaminee(t, p, taille)) };
      } else if (t === "periscope") {
        const libres = [...parCase.keys()].filter((k) => !touchees.has(k)).map((k) => ({ x: +k.split(",")[0], y: +k.split(",")[1] }));
        let c = null;
        if (choixPeriscope && intacte(choixPeriscope.x, choixPeriscope.y)) c = { x: choixPeriscope.x, y: choixPeriscope.y };
        else if (!choixPeriscope && libres.length) c = libres[Math.floor((rnd || Math.random)() * libres.length)];
        res.info = c ? { x: c.x, y: c.y } : { aucun: true };
      }
      if (t === "grenadage" && res.cases[0] && res.cases[0].res === "eau") {
        const { x, y } = res.cases[0], voisins = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && entier(x + dx, 0, taille - 1) && entier(y + dy, 0, taille - 1)) voisins.push({ x: x + dx, y: y + dy });
        }
        res.info = { n: compterIntactes(voisins) };
      }
      if (t === "eclair") res.rejoue = res.cases.some((c) => c.res === "touche" || c.res === "coule");
      res.perdTour = res.cases.some((c) => c.mine);
      res.fin = fin();
      return res;
    }

    return { resoudre, activer, defensePossible, intacte, touchees, boucliers, mines, tirees, parCase };
  }

  /* Rejoue le journal sur MA flotte jusqu'à l'action g (non comprise) et
     renvoie l'état. defense = mes boucliers / mines secrets [{type, x, y, g}]. */
  function etatDefense(navires, defense, journal, defenseur, regles, jusqua) {
    const e = EtatDefense(navires, regles);
    for (const a of journal) {
      if (jusqua != null && a.g >= jusqua) break;
      if (a.qui === defenseur) {
        if (a.type === "bouclier" || a.type === "mine") e.activer((defense || []).find((d) => d.g === a.g && d.type === a.type));
      } else if (a.res) {
        e.resoudre(a, null, a.type === "periscope" ? a.res.info : null);
      }
    }
    return e;
  }

  /* ------------------------------------------------------------------
     À qui le tour ? (null si une action attend encore sa réponse)
     ------------------------------------------------------------------ */
  function quiJoue(journal, premier) {
    let joueur = premier;
    const saute = { hote: 0, invite: 0 };
    for (const a of journal) {
      if (!a.res) return null;
      let suivant = a.res.rejoue ? a.qui : autre(a.qui);
      if (a.res.perdTour) saute[a.qui]++;
      for (let garde = 0; saute[suivant] > 0 && garde < 4; garde++) { saute[suivant]--; suivant = autre(suivant); }
      joueur = suivant;
    }
    return joueur;
  }

  /* Compétences gagnées / utilisées par un joueur : 2 actions de tir
     entièrement « à l'eau » d'affilée = 1 compétence (2 en réserve au maximum). */
  function stock(journal, qui) {
    let gagnees = 0, utilisees = 0, serie = 0;
    for (const a of journal) {
      if (a.qui !== qui || !a.res) continue;
      if (a.type !== "tir") utilisees++;
      const tirs = (a.res.cases || []).filter((c) => c.res !== "deja");
      if (!tirs.length) continue;
      if (tirs.every((c) => c.res === "eau")) {
        serie++;
        if (serie >= 2) { serie = 0; if (gagnees - utilisees < STOCK_MAX) gagnees++; }
      } else serie = 0;
    }
    return { gagnees, utilisees, dispo: gagnees - utilisees, serie };
  }

  // Compétences proposées au tirage : les communes + celles de mes navires encore à flot
  function reserve(regles, coulesParLui) {
    const ids = R.flotteDe(regles).map((n) => n.id).filter((id) => !(coulesParLui || []).includes(id));
    return COMMUNES.concat(Object.values(COMPETENCES).filter((c) => c.navire && ids.includes(c.navire)).map((c) => c.id));
  }
  function tirage(liste, nombre, hasard) {
    const rnd = hasard || Math.random;
    const copie = liste.slice(), choix = [];
    while (copie.length && choix.length < nombre) choix.push(copie.splice(Math.floor(rnd() * copie.length), 1)[0]);
    return choix;
  }

  /* Une action reçue est-elle autorisée ? Renvoie l'action propre ou null. */
  function actionValide(journal, regles, premier, msg) {
    const r = R.normaliser(regles);
    if (!msg || msg.g !== journal.length || !["hote", "invite"].includes(msg.qui)) return null;
    if (quiJoue(journal, premier) !== msg.qui) return null;
    if (msg.type !== "tir") {
      if (!r.competences || !COMPETENCES[msg.type]) return null;
      if (stock(journal, msg.qui).dispo < 1) return null;
    }
    const p = normaliserParams(msg.type, msg.p, r.taille);
    if (!p) return null;
    return { g: msg.g, qui: msg.qui, type: msg.type, p, res: null };
  }

  /* ------------------------------------------------------------------
     Ce que l'attaquant sait de la grille adverse (pour l'affichage et l'IA)
     ------------------------------------------------------------------ */
  function connaissance(journal, attaquant, taille) {
    const grille = new Array(taille * taille).fill(null);
    const coules = [], indices = [], infos = [];
    for (const a of journal) {
      if (a.qui !== attaquant || !a.res) continue;
      (a.res.cases || []).forEach((c) => {
        const i = c.y * taille + c.x;
        if (c.res === "eau") grille[i] = grille[i] || "eau";
        else if (c.res === "touche") grille[i] = "touche";
        else if (c.res === "coule") { grille[i] = "touche"; coules.push({ id: c.navire, cases: c.cases || [] }); }
        else if (c.res === "bouclier") { if (!grille[i]) grille[i] = "bouclier"; }
        if (c.mine) infos.push({ type: "mine", x: c.x, y: c.y });
      });
      if (a.res.info) {
        if (a.type === "periscope" && Number.isInteger(a.res.info.x)) indices.push({ x: a.res.info.x, y: a.res.info.y });
        else if (Number.isInteger(a.res.info.n)) {
          const zone = a.type === "grenadage" ? [{ x: a.p.x, y: a.p.y }] : zoneExaminee(a.type, a.p, taille);
          infos.push({ type: a.type, n: a.res.info.n, zone, g: a.g });
        }
      }
    }
    coules.forEach((c) => c.cases.forEach((k) => { if (k && entier(k.x, 0, taille - 1) && entier(k.y, 0, taille - 1)) grille[k.y * taille + k.x] = "coule"; }));
    return {
      grille, coules, infos,
      // indices encore utiles : une case de navire révélée (périscope ou bouclier) pas encore touchée
      indices: indices.concat(grille.map((v, i) => (v === "bouclier" ? { x: i % taille, y: Math.floor(i / taille) } : null)).filter(Boolean))
        .filter((c) => !["touche", "coule"].includes(grille[c.y * taille + c.x])),
    };
  }

  /* ------------------------------------------------------------------
     Anti-triche : à la fin, l'adversaire révèle sa flotte et ses défenses.
     On rejoue toutes MES actions sur sa flotte et on compare avec ses réponses.
     ------------------------------------------------------------------ */
  function memesCases(a, b) {
    if (a.length !== b.length) return false;
    return a.every((c, i) => b[i] && c.x === b[i].x && c.y === b[i].y && c.res === b[i].res && !!c.mine === !!b[i].mine &&
      (c.res !== "coule" || c.navire === b[i].navire));
  }
  function verifierDefense(navires, defense, journal, defenseur, regles) {
    if (!R.flotteValide(navires, regles)) return { ok: false, raison: "La flotte révélée n'est pas valide." };
    defense = Array.isArray(defense) ? defense : [];
    // Chaque défense révélée doit correspondre à une action « bouclier » / « mine » du journal
    const actionsDefense = journal.filter((a) => a.qui === defenseur && (a.type === "bouclier" || a.type === "mine"));
    for (const a of actionsDefense) {
      if (defense.filter((d) => d.g === a.g && d.type === a.type).length !== 1) return { ok: false, raison: "Défense manquante." };
    }
    const e = EtatDefense(navires, regles);
    for (const a of journal) {
      if (a.qui === defenseur) {
        if (a.type === "bouclier" || a.type === "mine") {
          if (!e.activer(defense.find((d) => d.g === a.g && d.type === a.type))) return { ok: false, raison: "Défense posée au mauvais endroit." };
        }
        continue;
      }
      if (!a.res) continue; // réponse pas encore reçue : rien à comparer
      const choix = a.type === "periscope" ? a.res.info : null;
      if (a.type === "periscope" && choix && Number.isInteger(choix.x) && !e.intacte(choix.x, choix.y)) {
        return { ok: false, raison: "Le périscope a montré une case vide." };
      }
      const attendu = e.resoudre(a, null, choix && Number.isInteger(choix.x) ? choix : null);
      if (a.type === "periscope" && choix && choix.aucun && !attendu.info.aucun) return { ok: false, raison: "Périscope faussé." };
      const infoOk = !attendu.info || attendu.info.n === undefined || (a.res.info && a.res.info.n === attendu.info.n);
      if (!memesCases(attendu.cases, a.res.cases || []) || !infoOk || !!attendu.rejoue !== !!a.res.rejoue ||
          !!attendu.perdTour !== !!a.res.perdTour || !!attendu.fin !== !!a.res.fin) {
        return { ok: false, raison: "Certaines réponses ne correspondent pas à la flotte révélée." };
      }
    }
    return { ok: true };
  }

  /* Une réponse arrive du réseau : on garde seulement ce qui est valide
     (un message abîmé ou trafiqué ne doit jamais faire planter l'appli). */
  function nettoyerRes(res, taille) {
    if (!res || typeof res !== "object" || !Array.isArray(res.cases) || res.cases.length > 40) return null;
    const caseOk = (c) => c && entier(c.x, 0, taille - 1) && entier(c.y, 0, taille - 1);
    const cases = [];
    for (const c of res.cases) {
      if (!caseOk(c) || !["eau", "touche", "coule", "bouclier", "deja"].includes(c.res)) return null;
      const propre = { x: c.x, y: c.y, res: c.res };
      if (c.mine === true && c.res === "eau") propre.mine = true;
      if (c.res === "coule") {
        if (!R.infoNavire(c.navire) || !Array.isArray(c.cases)) return null;
        propre.navire = c.navire;
        propre.cases = c.cases.filter(caseOk).slice(0, 10).map((k) => ({ x: k.x, y: k.y }));
      }
      cases.push(propre);
    }
    let info = null;
    if (res.info && typeof res.info === "object") {
      if (entier(res.info.n, 0, taille * taille)) info = { n: res.info.n };
      else if (caseOk(res.info)) info = { x: res.info.x, y: res.info.y };
      else if (res.info.aucun === true) info = { aucun: true };
    }
    return { cases, info, fin: res.fin === true, rejoue: res.rejoue === true, perdTour: res.perdTour === true };
  }

  // Résumé lisible d'un résultat (annonces, replay)
  function resume(res) {
    const cases = (res && res.cases) || [];
    const coule = cases.find((c) => c.res === "coule");
    if (coule) return { mot: "coule", navire: coule.navire };
    if (cases.some((c) => c.res === "touche")) return { mot: "touche", nb: cases.filter((c) => c.res === "touche").length };
    if (cases.some((c) => c.res === "bouclier")) return { mot: "bouclier" };
    if (cases.length) return { mot: "eau", mine: cases.some((c) => c.mine) };
    return { mot: "info" };
  }

  const api = {
    COMPETENCES, COMMUNES, STOCK_MAX, autre,
    normaliserParams, casesVisees, zoneExaminee, EtatDefense, etatDefense,
    quiJoue, stock, reserve, tirage, actionValide, connaissance, verifierDefense, nettoyerRes, resume,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.Moteur = api;
})(typeof window !== "undefined" ? window : this);
