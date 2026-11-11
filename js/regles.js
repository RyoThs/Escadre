/* ==========================================================================
   Escadre — les RÈGLES du jeu (aucun affichage ici, seulement la logique)
   --------------------------------------------------------------------------
   Ce fichier ne touche pas à l'écran : il sait seulement dire
   « quelle flotte pour ces réglages ? », « ce placement est-il valide ? »…
   Comme il est séparé, on peut le tester tout seul (voir tests/regles.test.js).

   Version 2 :
   - la carte peut faire 8, 10, 12 ou 14 cases de côté ;
   - les grands navires sont LARGES (porte-avions 5 × 2, croiseur 4 × 2) ;
   - on peut ajouter 1 ou 2 navires bonus (frégate, vedette) ;
   - le mode Compétences impose une grande carte (12 ou 14).
   ========================================================================== */
(function (racine) {
  "use strict";

  const TAILLES = [8, 10, 12, 14];
  const TAILLES_COMPETENCES = [12, 14];
  const LETTRES = "ABCDEFGHIJKLMNOP";

  // Chaque navire : longueur × largeur (en cases)
  const NAVIRES = {
    pa: { id: "pa", nom: "Porte-avions",      long: 5, larg: 2 },
    cr: { id: "cr", nom: "Croiseur",          long: 4, larg: 2 },
    sm: { id: "sm", nom: "Sous-marin",        long: 4, larg: 1 },
    ct: { id: "ct", nom: "Contre-torpilleur", long: 3, larg: 1 },
    to: { id: "to", nom: "Torpilleur",        long: 2, larg: 1 },
    fr: { id: "fr", nom: "Frégate",           long: 3, larg: 1 }, // bonus +1
    ve: { id: "ve", nom: "Vedette",           long: 2, larg: 1 }, // bonus +2
  };
  const BASE = ["pa", "cr", "sm", "ct", "to"];
  const BONUS = ["fr", "ve"];

  /* Réglages d'une partie, toujours « propres » (valeurs sûres).
     { taille, bonus, competences, colles } */
  function normaliser(regles) {
    const r = regles || {};
    const competences = r.competences === true;
    let taille = TAILLES.includes(r.taille) ? r.taille : 10;
    if (competences && !TAILLES_COMPETENCES.includes(taille)) taille = 12; // taille imposée
    const bonus = Number.isInteger(r.bonus) ? Math.max(0, Math.min(2, r.bonus)) : 0;
    return { taille, bonus, competences, colles: r.colles !== false };
  }

  // La flotte pour ces réglages : les 5 navires de base + les bonus
  function flotteDe(regles) {
    const r = normaliser(regles);
    return BASE.concat(BONUS.slice(0, r.bonus)).map((id) => NAVIRES[id]);
  }

  function infoNavire(id) { return NAVIRES[id]; }
  const casesNavire = (info) => info.long * info.larg;
  function totalCases(regles) { return flotteDe(regles).reduce((s, n) => s + casesNavire(n), 0); }

  // "B7" pour la colonne 1 (B) et la ligne 6 (7e ligne)
  function nomCase(x, y) { return LETTRES[x] + (y + 1); }

  /* Cases occupées par un navire { id, x, y, h } (h = horizontal).
     (x, y) est le coin en haut à gauche. Horizontal : la longueur va vers la
     droite et la largeur vers le bas ; vertical : l'inverse. */
  function casesDe(navire) {
    const info = NAVIRES[navire.id];
    const cases = [];
    for (let i = 0; i < info.long; i++) {
      for (let j = 0; j < info.larg; j++) {
        cases.push(navire.h ? { x: navire.x + i, y: navire.y + j } : { x: navire.x + j, y: navire.y + i });
      }
    }
    return cases;
  }

  // Encombrement du navire : { l: largeur à l'écran, ht: hauteur à l'écran }
  function encombrement(navire) {
    const info = NAVIRES[navire.id];
    return navire.h ? { l: info.long, ht: info.larg } : { l: info.larg, ht: info.long };
  }

  function dansLaGrille(c, taille) {
    return c.x >= 0 && c.x < taille && c.y >= 0 && c.y < taille;
  }

  // Décale un navire pour qu'il rentre dans la grille (pratique au doigt).
  function recadrer(navire, taille) {
    const e = encombrement(navire);
    return { ...navire, x: Math.min(Math.max(navire.x, 0), taille - e.l), y: Math.min(Math.max(navire.y, 0), taille - e.ht) };
  }

  /* Vérifie qu'un navire peut être posé.
     - il doit être entièrement dans la grille,
     - il ne doit pas chevaucher un autre navire,
     - si la règle « navires collés » est désactivée, il ne doit pas
       toucher un autre navire (même en diagonale).
     Renvoie { ok: true } ou { ok: false, raison: "..." }. */
  function placementValide(navires, candidat, regles) {
    const r = normaliser(regles);
    const cases = casesDe(candidat);
    if (!cases.every((c) => dansLaGrille(c, r.taille))) return { ok: false, raison: "Le navire dépasse de la grille." };

    const occupees = new Set();
    navires.filter((n) => n.id !== candidat.id).forEach((n) => casesDe(n).forEach((c) => occupees.add(c.x + "," + c.y)));

    for (const c of cases) {
      if (occupees.has(c.x + "," + c.y)) return { ok: false, raison: "Il y a déjà un navire ici." };
      if (!r.colles) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (occupees.has(c.x + dx + "," + (c.y + dy))) return { ok: false, raison: "Les navires ne doivent pas se toucher." };
          }
        }
      }
    }
    return { ok: true };
  }

  // La flotte est-elle complète et valide ? (les bons navires, chacun bien placé)
  function flotteValide(navires, regles) {
    const attendus = flotteDe(regles).map((n) => n.id);
    if (!Array.isArray(navires) || navires.length !== attendus.length) return false;
    const ids = new Set(navires.map((n) => n && n.id));
    if (ids.size !== attendus.length || !attendus.every((id) => ids.has(id))) return false;
    return navires.every((n) => Number.isInteger(n.x) && Number.isInteger(n.y) && placementValide(navires, n, regles).ok);
  }

  // Placement automatique au hasard (bouton « Aléatoire »), du plus grand au plus petit
  function placementAleatoire(regles, hasard) {
    const rnd = hasard || Math.random;
    const r = normaliser(regles);
    const flotte = flotteDe(r).slice().sort((a, b) => casesNavire(b) - casesNavire(a));
    for (let essai = 0; essai < 500; essai++) {
      const navires = [];
      let reussi = true;
      for (const f of flotte) {
        let pose = false;
        for (let t = 0; t < 400 && !pose; t++) {
          const n = { id: f.id, h: rnd() < 0.5, x: Math.floor(rnd() * r.taille), y: Math.floor(rnd() * r.taille) };
          if (placementValide(navires, n, r).ok) { navires.push(n); pose = true; }
        }
        if (!pose) { reussi = false; break; }
      }
      if (reussi) return navires;
    }
    throw new Error("Placement aléatoire impossible");
  }

  // Ces réglages permettent-ils de placer la flotte ? (8 × 8 + navires séparés + bonus : trop serré)
  function reglesJouables(regles) {
    const r = normaliser(regles);
    if (r.colles) return true;
    return r.taille >= 10 || r.bonus === 0;
  }

  const api = {
    TAILLES, TAILLES_COMPETENCES, LETTRES, NAVIRES, BASE, BONUS,
    normaliser, flotteDe, infoNavire, casesNavire, totalCases, nomCase, casesDe, encombrement,
    dansLaGrille, recadrer, placementValide, flotteValide, placementAleatoire, reglesJouables,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // pour les tests
  else racine.Regles = api;                                                   // pour le navigateur
})(this);
