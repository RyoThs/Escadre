/* ==========================================================================
   Escadre — DESSIN DES NAVIRES (vue de dessus, en SVG)
   --------------------------------------------------------------------------
   Chaque navire est dessiné à l'horizontale, proue (l'avant) à droite,
   dans une boîte de (taille × 100) sur 100. Pour un navire vertical, on
   fait simplement pivoter le dessin d'un quart de tour.
   Les couleurs viennent du CSS (classes .n-coque, .n-pont…), ce qui permet
   d'avoir une version « coulé » (rouge) ou « révélé » (pâle) sans redessiner.
   ========================================================================== */
(function (racine) {
  "use strict";

  // Coque classique : arrière arrondi, proue en pointe
  function coque(W) {
    return `<path class="n-coque" d="M10 30 Q10 16 26 15 L${W - 95} 15 Q${W - 22} 18 ${W - 5} 50 Q${W - 22} 82 ${W - 95} 85 L26 85 Q10 84 10 70 Z"/>` +
      `<path class="n-pont" d="M22 36 Q22 27 32 27 L${W - 100} 27 Q${W - 42} 31 ${W - 27} 50 Q${W - 42} 69 ${W - 100} 73 L32 73 Q22 73 22 64 Z"/>`;
  }

  // Tourelle de canon : un rond et deux tubes vers l'avant (ou l'arrière)
  function tourelle(x, sens) {
    const bout = x + sens * 34;
    return `<line class="n-canon" x1="${x}" y1="45" x2="${bout}" y2="45"/>` +
      `<line class="n-canon" x1="${x}" y1="55" x2="${bout}" y2="55"/>` +
      `<circle class="n-detail" cx="${x}" cy="50" r="15"/>` +
      `<circle class="n-ombre" cx="${x}" cy="50" r="5"/>`;
  }

  // Petit avion vu de dessus (pour le porte-avions)
  function avion(x, y) {
    return `<path class="n-marque" d="M${x} ${y - 9} L${x + 3} ${y - 2} L${x + 12} ${y} L${x + 3} ${y + 2} L${x} ${y + 9} L${x - 2} ${y + 2} L${x - 8} ${y + 3} L${x - 8} ${y - 3} L${x - 2} ${y - 2} Z" transform="rotate(90 ${x} ${y})"/>`;
  }

  const DESSINS = {
    // Porte-avions : grand pont plat, piste, îlot de commandement, avions
    pa(W) {
      return `<path class="n-coque" d="M6 22 L${W - 90} 10 Q${W - 12} 16 ${W - 4} 50 Q${W - 12} 84 ${W - 90} 90 L6 78 Q2 50 6 22 Z"/>` +
        `<path class="n-pont" d="M16 28 L${W - 95} 20 Q${W - 30} 26 ${W - 18} 50 Q${W - 30} 74 ${W - 95} 80 L16 72 Z"/>` +
        `<line class="n-piste" x1="30" y1="50" x2="${W - 50}" y2="50"/>` +
        `<line class="n-piste fine" x1="40" y1="64" x2="${W * 0.5}" y2="34"/>` +
        `<rect class="n-detail" x="${W * 0.56}" y="14" width="74" height="17" rx="5"/>` +
        `<rect class="n-ombre" x="${W * 0.56 + 18}" y="18" width="20" height="9" rx="2"/>` +
        avion(70, 38) + avion(120, 62) + avion(W - 110, 62);
    },
    // Croiseur : deux tourelles, superstructure centrale, mât
    cr(W) {
      return coque(W) +
        tourelle(W - 115, 1) + tourelle(85, -1) +
        `<rect class="n-detail" x="${W / 2 - 62}" y="34" width="118" height="32" rx="8"/>` +
        `<rect class="n-ombre" x="${W / 2 - 40}" y="41" width="30" height="18" rx="4"/>` +
        `<circle class="n-marque" cx="${W / 2 + 28}" cy="50" r="6"/>`;
    },
    // Contre-torpilleur : une tourelle avant, passerelle, cheminée
    ct(W) {
      return coque(W) +
        tourelle(W - 88, 1) +
        `<rect class="n-detail" x="${W / 2 - 50}" y="35" width="84" height="30" rx="7"/>` +
        `<ellipse class="n-ombre" cx="${W / 2 - 22}" cy="50" rx="13" ry="9"/>` +
        `<rect class="n-marque" x="40" y="44" width="34" height="12" rx="6"/>`;
    },
    // Sous-marin : coque en cigare, kiosque, gouvernails
    sm(W) {
      return `<path class="n-coque sous-marin" d="M14 50 Q14 24 70 22 L${W - 70} 22 Q${W - 6} 28 ${W - 6} 50 Q${W - 6} 72 ${W - 70} 78 L70 78 Q14 76 14 50 Z"/>` +
        `<path class="n-detail" d="M6 50 L22 36 L22 64 Z"/>` +
        `<line class="n-marque" x1="60" y1="50" x2="${W - 60}" y2="50" stroke-dasharray="10 12"/>` +
        `<rect class="n-detail" x="${W * 0.5}" y="38" width="58" height="24" rx="12"/>` +
        `<circle class="n-ombre" cx="${W * 0.5 + 44}" cy="50" r="4"/>`;
    },
    // Torpilleur : petit et rapide, une cabine, deux tubes lance-torpilles
    to(W) {
      return coque(W) +
        `<rect class="n-detail" x="52" y="36" width="58" height="28" rx="8"/>` +
        `<rect class="n-ombre" x="88" y="41" width="14" height="18" rx="3"/>` +
        `<line class="n-canon" x1="${W - 70}" y1="50" x2="${W - 38}" y2="50"/>` +
        `<circle class="n-detail" cx="${W - 70}" cy="50" r="9"/>`;
    },
  };

  /* Renvoie le code SVG d'un navire. vertical = true → proue vers le bas. */
  function svg(id, taille, vertical) {
    const W = taille * 100;
    const contenu = DESSINS[id](W);
    if (!vertical) {
      return `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">${contenu}</svg>`;
    }
    return `<svg viewBox="0 0 100 ${W}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(100 0) rotate(90)">${contenu}</g></svg>`;
  }

  /* Crée l'élément à poser sur la grille, par-dessus les cases du navire.
     La grille a une colonne et une ligne de repères (A…J, 1…10), d'où le « + 2 ». */
  function element(navire, taille, classes) {
    const div = document.createElement("div");
    div.className = "silhouette " + (classes || "");
    if (navire.h) {
      div.style.gridColumn = `${navire.x + 2} / span ${taille}`;
      div.style.gridRow = `${navire.y + 2} / span 1`;
    } else {
      div.style.gridColumn = `${navire.x + 2} / span 1`;
      div.style.gridRow = `${navire.y + 2} / span ${taille}`;
    }
    div.innerHTML = svg(navire.id, taille, !navire.h);
    return div;
  }

  // Petite icône pour les listes (quai de placement, suivi des cibles)
  function icone(id, taille) {
    const span = document.createElement("span");
    span.className = "icone-navire";
    span.style.width = taille * 11 + "px";
    span.innerHTML = svg(id, taille, false);
    return span;
  }

  racine.Navires = { svg, element, icone };
})(this);
