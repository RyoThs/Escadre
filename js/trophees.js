/* ==========================================================================
   Escadre — SCORES et TROPHÉES (logique seulement, testable)
   --------------------------------------------------------------------------
   - Le score « face à face » est rangé par adversaire (chaque téléphone a un
     identifiant public permanent, envoyé à l'ami au début de la partie).
   - Les trophées se débloquent une seule fois, à la fin d'une partie.
   ========================================================================== */
(function (racine) {
  "use strict";

  const LISTE = [
    { id: "premiere",  icone: "🎖️", nom: "Premier sang",      desc: "Gagner une première partie." },
    { id: "elite",     icone: "🎯", nom: "Tireur d'élite",    desc: "Gagner avec au moins 60 % de tirs réussis." },
    { id: "eclair",    icone: "⚡", nom: "Coup de maître",    desc: "Gagner en tirant moins de 2 fois le nombre de cases de la flotte." },
    { id: "intouchable", icone: "🛡️", nom: "Intouchable",     desc: "Gagner sans perdre un seul navire." },
    { id: "fil",       icone: "🪢", nom: "Sur le fil",        desc: "Gagner avec un seul navire encore à flot." },
    { id: "serie3",    icone: "🔥", nom: "En feu",            desc: "Gagner 3 parties d'affilée." },
    { id: "amiral",    icone: "👑", nom: "Plus fort que l'Amiral", desc: "Battre l'ordinateur en difficile." },
    { id: "beau",      icone: "🤝", nom: "Beau joueur",       desc: "Demander la revanche après une défaite." },
    { id: "fidele",    icone: "⚓", nom: "Compagnons d'armes", desc: "Jouer 5 parties contre le même ami." },
    { id: "loup",      icone: "🧭", nom: "Vieux loup de mer", desc: "Jouer 20 parties." },
  ];
  const parId = (id) => LISTE.find((t) => t.id === id);

  // Ajoute les champs manquants au profil (anciennes versions de l'appli)
  function initialiser(profil) {
    if (!profil.duels || typeof profil.duels !== "object") profil.duels = {};
    if (!profil.trophees || typeof profil.trophees !== "object") profil.trophees = {};
    if (!Number.isInteger(profil.serie)) profil.serie = 0;
    if (!Number.isInteger(profil.meilleureSerie)) profil.meilleureSerie = 0;
    if (!Number.isInteger(profil.parties)) profil.parties = (profil.victoires || 0) + (profil.defaites || 0);
    return profil;
  }

  /* Enregistre une partie terminée et renvoie la liste des trophées gagnés.
     resume = {
       gagne: bool, tirs: nb de tirs, reussis: nb de touchés,
       mesCoules: nb de mes navires coulés, nbNavires, totalCases,
       idAdverse, nomAdverse,
       solo: bool, niveau: "facile" | "moyen" | "difficile"
     } */
  function enregistrerPartie(profil, resume, maintenant) {
    initialiser(profil);
    const date = maintenant || Date.now();
    profil.parties++;
    if (resume.gagne) { profil.victoires = (profil.victoires || 0) + 1; profil.serie++; }
    else { profil.defaites = (profil.defaites || 0) + 1; profil.serie = 0; }
    profil.meilleureSerie = Math.max(profil.meilleureSerie, profil.serie);

    let duel = null;
    if (resume.idAdverse) {
      duel = profil.duels[resume.idAdverse] || { nom: "", v: 0, d: 0, solo: !!resume.solo };
      duel.nom = resume.nomAdverse || duel.nom;
      if (resume.gagne) duel.v++; else duel.d++;
      duel.derniere = date;
      profil.duels[resume.idAdverse] = duel;
    }

    const gagnes = [];
    const gagner = (id) => { if (!profil.trophees[id]) { profil.trophees[id] = date; gagnes.push(id); } };
    const precision = resume.tirs ? resume.reussis / resume.tirs : 0;
    if (resume.gagne) {
      gagner("premiere");
      if (precision >= 0.6) gagner("elite");
      if (resume.tirs <= 2 * (resume.totalCases || 17)) gagner("eclair");
      if (resume.mesCoules === 0) gagner("intouchable");
      if (resume.mesCoules === (resume.nbNavires || 5) - 1) gagner("fil");
      if (profil.serie >= 3) gagner("serie3");
      if (resume.solo && resume.niveau === "difficile") gagner("amiral");
    }
    if (duel && !resume.solo && duel.v + duel.d >= 5) gagner("fidele");
    if (profil.parties >= 20) gagner("loup");
    return gagnes;
  }

  // Trophée « Beau joueur » : demandé à part (au clic sur Revanche après une défaite)
  function beauJoueur(profil, maintenant) {
    initialiser(profil);
    if (profil.trophees.beau) return [];
    profil.trophees.beau = maintenant || Date.now();
    return ["beau"];
  }

  // Score face à un adversaire : { v, d } (victoires / défaites de MOI contre LUI)
  function score(profil, idAdverse) {
    const d = profil.duels && idAdverse ? profil.duels[idAdverse] : null;
    return d ? { v: d.v, d: d.d } : { v: 0, d: 0 };
  }

  // Adversaires triés du plus récent au plus ancien
  function duels(profil) {
    return Object.entries(profil.duels || {})
      .map(([id, d]) => Object.assign({ id }, d))
      .sort((a, b) => (b.derniere || 0) - (a.derniere || 0));
  }

  const api = { LISTE, parId, initialiser, enregistrerPartie, beauJoueur, score, duels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.Trophees = api;
})(this);
