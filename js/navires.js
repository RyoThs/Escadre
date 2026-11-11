/* ==========================================================================
   Escadre — DESSIN DES NAVIRES (vue de dessus, en SVG)
   --------------------------------------------------------------------------
   Chaque navire est dessiné à l'horizontale, proue (l'avant) à droite,
   dans une boîte de (longueur × 100) sur (largeur × 100). Pour un navire
   vertical, on fait simplement pivoter le dessin d'un quart de tour.
   Les couleurs viennent du CSS (classes .n-coque, .n-pont…), ce qui permet
   d'avoir une version « coulé » (rouge) ou « révélé » (pâle) sans redessiner.
   ========================================================================== */
(function (racine) {
  "use strict";

  // Coque fine classique (1 case de large) : arrière arrondi, proue en pointe
  function coque(W) {
    return `<path class="n-coque" d="M10 30 Q10 16 26 15 L${W - 95} 15 Q${W - 22} 18 ${W - 5} 50 Q${W - 22} 82 ${W - 95} 85 L26 85 Q10 84 10 70 Z"/>` +
      `<path class="n-pont" d="M22 36 Q22 27 32 27 L${W - 100} 27 Q${W - 42} 31 ${W - 27} 50 Q${W - 42} 69 ${W - 100} 73 L32 73 Q22 73 22 64 Z"/>`;
  }

  // Tourelle de canon : un rond et deux tubes vers l'avant (sens 1) ou l'arrière (-1)
  function tourelle(x, y, sens, r) {
    r = r || 15;
    const bout = x + sens * r * 2.3;
    return `<line class="n-canon" x1="${x}" y1="${y - r / 3}" x2="${bout}" y2="${y - r / 3}"/>` +
      `<line class="n-canon" x1="${x}" y1="${y + r / 3}" x2="${bout}" y2="${y + r / 3}"/>` +
      `<circle class="n-detail" cx="${x}" cy="${y}" r="${r}"/>` +
      `<circle class="n-ombre" cx="${x}" cy="${y}" r="${r / 3}"/>`;
  }

  // Petit avion vu de dessus (pour le porte-avions)
  function avion(x, y, e) {
    e = e || 1.6;
    return `<path class="n-marque" transform="translate(${x} ${y}) scale(${e}) rotate(90)" d="M0 -9 L3 -2 L12 0 L3 2 L0 9 L-2 2 L-8 3 L-8 -3 L-2 -2 Z"/>`;
  }

  const DESSINS = {
    // Porte-avions (5 × 2) : immense pont plat, piste oblique, îlot, avions alignés
    pa(W, H) {
      return `<path class="n-coque" d="M8 ${H * 0.16} L${W - 130} 8 Q${W - 20} 20 ${W - 6} ${H / 2} Q${W - 20} ${H - 20} ${W - 130} ${H - 8} L8 ${H * 0.84} Q2 ${H / 2} 8 ${H * 0.16} Z"/>` +
        `<path class="n-pont" d="M22 ${H * 0.22} L${W - 135} 22 Q${W - 40} 34 ${W - 24} ${H / 2} Q${W - 40} ${H - 34} ${W - 135} ${H - 22} L22 ${H * 0.78} Z"/>` +
        `<line class="n-piste" x1="40" y1="${H * 0.62}" x2="${W - 70}" y2="${H * 0.62}"/>` +
        `<line class="n-piste fine" x1="60" y1="${H * 0.78}" x2="${W * 0.55}" y2="${H * 0.3}"/>` +
        `<rect class="n-detail" x="${W * 0.58}" y="20" width="110" height="34" rx="8"/>` +
        `<rect class="n-ombre" x="${W * 0.58 + 26}" y="28" width="30" height="18" rx="3"/>` +
        `<circle class="n-marque" cx="${W * 0.58 + 85}" cy="37" r="7"/>` +
        avion(70, H * 0.38) + avion(130, H * 0.38) + avion(190, H * 0.38) + avion(W - 120, H * 0.78, 1.4) + avion(110, H * 0.82, 1.4);
    },
    // Croiseur (4 × 2) : coque large, 4 tourelles, grande superstructure, mâts
    cr(W, H) {
      return `<path class="n-coque" d="M10 ${H * 0.25} Q10 12 40 12 L${W - 120} 12 Q${W - 20} 22 ${W - 6} ${H / 2} Q${W - 20} ${H - 22} ${W - 120} ${H - 12} L40 ${H - 12} Q10 ${H - 12} 10 ${H * 0.75} Z"/>` +
        `<path class="n-pont" d="M26 ${H * 0.3} Q26 30 50 30 L${W - 125} 30 Q${W - 45} 40 ${W - 30} ${H / 2} Q${W - 45} ${H - 40} ${W - 125} ${H - 30} L50 ${H - 30} Q26 ${H - 30} 26 ${H * 0.7} Z"/>` +
        tourelle(W - 120, H * 0.36, 1, 20) + tourelle(W - 120, H * 0.64, 1, 20) +
        tourelle(80, H * 0.36, -1, 20) + tourelle(80, H * 0.64, -1, 20) +
        `<rect class="n-detail" x="${W / 2 - 90}" y="${H / 2 - 42}" width="170" height="84" rx="14"/>` +
        `<rect class="n-ombre" x="${W / 2 - 60}" y="${H / 2 - 24}" width="50" height="48" rx="6"/>` +
        `<circle class="n-marque" cx="${W / 2 + 40}" cy="${H / 2}" r="12"/>`;
    },
    // Contre-torpilleur (3 × 1) : une tourelle avant, passerelle, cheminée
    ct(W) {
      return coque(W) +
        tourelle(W - 88, 50, 1) +
        `<rect class="n-detail" x="${W / 2 - 50}" y="35" width="84" height="30" rx="7"/>` +
        `<ellipse class="n-ombre" cx="${W / 2 - 22}" cy="50" rx="13" ry="9"/>` +
        `<rect class="n-marque" x="40" y="44" width="34" height="12" rx="6"/>`;
    },
    // Sous-marin (4 × 1) : long cigare, kiosque, gouvernails
    sm(W) {
      return `<path class="n-coque sous-marin" d="M14 50 Q14 24 70 22 L${W - 70} 22 Q${W - 6} 28 ${W - 6} 50 Q${W - 6} 72 ${W - 70} 78 L70 78 Q14 76 14 50 Z"/>` +
        `<path class="n-detail" d="M6 50 L22 36 L22 64 Z"/>` +
        `<line class="n-marque" x1="60" y1="50" x2="${W - 60}" y2="50" stroke-dasharray="10 12"/>` +
        `<rect class="n-detail" x="${W * 0.5}" y="38" width="70" height="24" rx="12"/>` +
        `<circle class="n-ombre" cx="${W * 0.5 + 54}" cy="50" r="4"/>`;
    },
    // Torpilleur (2 × 1) : petit et rapide, une cabine, deux tubes lance-torpilles
    to(W) {
      return coque(W) +
        `<rect class="n-detail" x="52" y="36" width="58" height="28" rx="8"/>` +
        `<rect class="n-ombre" x="88" y="41" width="14" height="18" rx="3"/>` +
        `<line class="n-canon" x1="${W - 70}" y1="50" x2="${W - 38}" y2="50"/>` +
        `<circle class="n-detail" cx="${W - 70}" cy="50" r="9"/>`;
    },
    // Frégate (3 × 1, bonus) : antenne radar tournante bien visible
    fr(W) {
      return coque(W) +
        tourelle(W - 70, 50, 1, 11) +
        `<rect class="n-detail" x="${W / 2 - 60}" y="34" width="90" height="32" rx="8"/>` +
        `<circle class="n-marque" cx="${W / 2 - 15}" cy="50" r="12"/>` +
        `<line class="n-canon" x1="${W / 2 - 27}" y1="50" x2="${W / 2 - 3}" y2="50" style="stroke-width:4"/>` +
        `<rect class="n-ombre" x="40" y="42" width="30" height="16" rx="4"/>`;
    },
    // Vedette (2 × 1, bonus) : coque pointue, poste de pilotage, mines à l'arrière
    ve(W) {
      return coque(W) +
        `<path class="n-detail" d="M${W - 95} 36 L${W - 60} 50 L${W - 95} 64 Z"/>` +
        `<circle class="n-ombre" cx="45" cy="40" r="7"/><circle class="n-ombre" cx="45" cy="60" r="7"/>` +
        `<rect class="n-marque" x="72" y="45" width="26" height="10" rx="5"/>`;
    },
  };

  const DIMENSIONS = { pa: [5, 2], cr: [4, 2], sm: [4, 1], ct: [3, 1], to: [2, 1], fr: [3, 1], ve: [2, 1] };

  /* Renvoie le code SVG d'un navire. vertical = true → proue vers le bas. */
  function svg(id, vertical) {
    const [l, h] = DIMENSIONS[id];
    const W = l * 100, H = h * 100;
    const contenu = DESSINS[id](W, H);
    if (!vertical) return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${contenu}</svg>`;
    return `<svg viewBox="0 0 ${H} ${W}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(${H} 0) rotate(90)">${contenu}</g></svg>`;
  }

  /* Crée l'élément à poser sur la grille, par-dessus les cases du navire.
     La grille a une colonne et une ligne de repères (A…, 1…), d'où le « + 2 ». */
  function element(navire, classes) {
    const [l, h] = DIMENSIONS[navire.id];
    const larg = navire.h ? l : h, haut = navire.h ? h : l;
    const div = document.createElement("div");
    div.className = "silhouette " + (classes || "");
    div.style.gridColumn = `${navire.x + 2} / span ${larg}`;
    div.style.gridRow = `${navire.y + 2} / span ${haut}`;
    div.innerHTML = svg(navire.id, !navire.h);
    return div;
  }

  // Petite icône pour les listes (quai de placement, suivi des cibles)
  function icone(id) {
    const [l, h] = DIMENSIONS[id];
    const span = document.createElement("span");
    span.className = "icone-navire" + (h > 1 ? " large" : "");
    span.style.width = l * 11 + "px";
    span.innerHTML = svg(id, false);
    return span;
  }

  racine.Navires = { svg, element, icone, DIMENSIONS };
})(this);
