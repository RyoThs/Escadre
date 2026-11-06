/* ==========================================================================
   Escadre — les RÈGLES du jeu (aucun affichage ici, seulement la logique)
   --------------------------------------------------------------------------
   Ce fichier ne touche pas à l'écran : il sait seulement dire
   « ce placement est-il valide ? », « ce tir touche-t-il ? », etc.
   Comme il est séparé, on peut le tester tout seul (voir tests/regles.test.js).
   ========================================================================== */
(function (racine) {
  "use strict";

  const TAILLE = 10;                         // grille de 10 × 10 cases
  const LETTRES = "ABCDEFGHIJ";              // colonnes A à J, lignes 1 à 10

  // La flotte officielle (règles françaises classiques) : 5 navires, 17 cases.
  const FLOTTE = [
    { id: "pa", nom: "Porte-avions",      taille: 5 },
    { id: "cr", nom: "Croiseur",          taille: 4 },
    { id: "ct", nom: "Contre-torpilleur", taille: 3 },
    { id: "sm", nom: "Sous-marin",        taille: 3 },
    { id: "to", nom: "Torpilleur",        taille: 2 },
  ];
  const TOTAL_CASES = FLOTTE.reduce((s, n) => s + n.taille, 0); // 17

  function infoNavire(id) {
    return FLOTTE.find((n) => n.id === id);
  }

  // "B7" pour la colonne 1 (B) et la ligne 6 (7e ligne)
  function nomCase(x, y) {
    return LETTRES[x] + (y + 1);
  }

  // Liste des cases occupées par un navire { id, x, y, h } (h = horizontal)
  function casesDe(navire) {
    const taille = infoNavire(navire.id).taille;
    const cases = [];
    for (let i = 0; i < taille; i++) {
      cases.push(navire.h ? { x: navire.x + i, y: navire.y } : { x: navire.x, y: navire.y + i });
    }
    return cases;
  }

  function dansLaGrille(c) {
    return c.x >= 0 && c.x < TAILLE && c.y >= 0 && c.y < TAILLE;
  }

  // Décale un navire pour qu'il rentre dans la grille (pratique au doigt).
  function recadrer(navire) {
    const taille = infoNavire(navire.id).taille;
    const maxX = navire.h ? TAILLE - taille : TAILLE - 1;
    const maxY = navire.h ? TAILLE - 1 : TAILLE - taille;
    return { ...navire, x: Math.min(Math.max(navire.x, 0), maxX), y: Math.min(Math.max(navire.y, 0), maxY) };
  }

  /* Vérifie qu'un navire peut être posé.
     - il doit être entièrement dans la grille,
     - il ne doit pas chevaucher un autre navire,
     - si la règle « navires collés » est désactivée, il ne doit pas
       toucher un autre navire (même en diagonale).
     Renvoie { ok: true } ou { ok: false, raison: "..." }. */
  function placementValide(navires, candidat, regles) {
    const autorise = !regles || regles.colles !== false;
    const cases = casesDe(candidat);
    if (!cases.every(dansLaGrille)) return { ok: false, raison: "Le navire dépasse de la grille." };

    const autres = navires.filter((n) => n.id !== candidat.id);
    const occupees = new Set();
    autres.forEach((n) => casesDe(n).forEach((c) => occupees.add(c.x + "," + c.y)));

    for (const c of cases) {
      if (occupees.has(c.x + "," + c.y)) return { ok: false, raison: "Il y a déjà un navire ici." };
      if (!autorise) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (occupees.has(c.x + dx + "," + (c.y + dy))) {
              return { ok: false, raison: "Les navires ne doivent pas se toucher." };
            }
          }
        }
      }
    }
    return { ok: true };
  }

  // La flotte est-elle complète et valide ? (5 navires, chacun bien placé)
  function flotteValide(navires, regles) {
    if (!Array.isArray(navires) || navires.length !== FLOTTE.length) return false;
    const ids = new Set(navires.map((n) => n.id));
    if (!FLOTTE.every((f) => ids.has(f.id))) return false;
    return navires.every((n) => placementValide(navires, n, regles).ok);
  }

  // Placement automatique au hasard (bouton « Aléatoire »)
  function placementAleatoire(regles, hasard) {
    const rnd = hasard || Math.random;
    for (let essai = 0; essai < 200; essai++) {
      const navires = [];
      let reussi = true;
      for (const f of FLOTTE) {
        let pose = false;
        for (let t = 0; t < 300 && !pose; t++) {
          const n = { id: f.id, h: rnd() < 0.5, x: Math.floor(rnd() * TAILLE), y: Math.floor(rnd() * TAILLE) };
          if (placementValide(navires, n, regles).ok) { navires.push(n); pose = true; }
        }
        if (!pose) { reussi = false; break; }
      }
      if (reussi) return navires;
    }
    throw new Error("Placement aléatoire impossible");
  }

  /* Calcule le résultat d'un tir reçu sur MA flotte.
     tirsRecus = tirs déjà reçus avant celui-ci ([{x,y}, ...]).
     Renvoie { res: "eau" | "touche" | "coule", navire, cases, fin }. */
  function resoudreTir(navires, tirsRecus, x, y) {
    const touche = navires.find((n) => casesDe(n).some((c) => c.x === x && c.y === y));
    if (!touche) return { res: "eau", fin: false };

    const tous = tirsRecus.concat([{ x, y }]);
    const estTouchee = (c) => tous.some((t) => t.x === c.x && t.y === c.y);
    const cases = casesDe(touche);
    const coule = cases.every(estTouchee);
    const fin = navires.every((n) => casesDe(n).every(estTouchee));
    return coule
      ? { res: "coule", navire: touche.id, cases, fin }
      : { res: "touche", fin: false };
  }

  /* Qui doit tirer ? On le déduit simplement du nombre de tirs :
     le premier joueur tire quand les deux ont tiré autant de fois,
     l'autre tire quand il a reçu un tir de plus qu'il n'en a envoyé.
     (Règle officielle : un seul tir par tour, même si on touche.) */
  function estMonTour(jeSuisPremier, nbEnvoyes, nbRecus) {
    return jeSuisPremier ? nbEnvoyes === nbRecus : nbRecus === nbEnvoyes + 1;
  }

  const api = {
    TAILLE, LETTRES, FLOTTE, TOTAL_CASES,
    infoNavire, nomCase, casesDe, dansLaGrille, recadrer,
    placementValide, flotteValide, placementAleatoire, resoudreTir, estMonTour,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // pour les tests
  else racine.Regles = api;                                                   // pour le navigateur
})(this);
