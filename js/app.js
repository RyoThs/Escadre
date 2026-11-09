/* ==========================================================================
   Escadre — l'APPLICATION (écrans, boutons, déroulé de la partie)
   --------------------------------------------------------------------------
   Idée générale :
   - Toute la partie est rangée dans un seul objet « P » (la Partie).
   - Chaque fois que P change : on l'enregistre (sauver) puis on redessine
     l'écran (afficher). Si le téléphone recharge la page, on reprend P.
   - Chaque joueur garde SA flotte secrète. Quand l'ami tire, c'est MON
     téléphone qui calcule « à l'eau / touché / coulé » et lui répond.
   ========================================================================== */
(function () {
  "use strict";
  const R = window.Regles;
  const CLE_PARTIE = "escadre.partie.v1";
  const CLE_PROFIL = "escadre.profil.v1";
  const CLE_ORDI = "escadre.ordinateur.v1";   // mémoire de l'ordinateur (mode solo)
  const DUREE_REPRISE = 3 * 24 * 3600 * 1000; // une partie se reprend jusqu'à 3 jours

  const $ = (s) => document.querySelector(s);
  const ecrans = { accueil: $("#ecran-accueil"), jeu: $("#ecran-jeu") };

  /* ------------------------------------------------------------------
     Mémoire du téléphone (localStorage)
     ------------------------------------------------------------------ */
  // En mode test (?local=1), chaque onglet a sa propre mémoire, comme deux vrais téléphones.
  const memoire = (() => {
    try { return new URLSearchParams(location.search).has("local") ? sessionStorage : localStorage; }
    catch (e) { return null; }
  })();
  function lire(cle) { try { return JSON.parse(memoire.getItem(cle)); } catch (e) { return null; } }
  function ecrire(cle, v) { try { memoire.setItem(cle, JSON.stringify(v)); } catch (e) {} }
  function effacer(cle) { try { memoire.removeItem(cle); } catch (e) {} }

  function aleatoire(n) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans O/0 ni I/1 (on les confond)
    const tab = new Uint32Array(n);
    crypto.getRandomValues(tab);
    return Array.from(tab, (v) => alphabet[v % alphabet.length]).join("");
  }

  // jeton : secret qui permet de revenir dans sa partie ; id : identifiant public
  // (sert à tenir le score face à chaque ami).
  const profil = Object.assign({ nom: "", son: true, victoires: 0, defaites: 0, jeton: aleatoire(16), id: aleatoire(10), niveau: "moyen" }, lire(CLE_PROFIL) || {});
  Trophees.initialiser(profil);
  ecrire(CLE_PROFIL, profil);
  Sons.regler(profil.son);

  let P = lire(CLE_PARTIE);
  if (P && Date.now() - (P.maj || 0) > DUREE_REPRISE) { P = null; effacer(CLE_PARTIE); }

  let liaison = null;
  const ui = { selection: null, horizontal: true, visee: null, reseau: "connexion", detailReseau: "", accueil: false, nonLus: 0, depuisCoupure: Date.now() };

  function sauver() {
    if (!P) return;
    P.maj = Date.now();
    ecrire(CLE_PARTIE, P);
  }
  function sauverProfil() { ecrire(CLE_PROFIL, profil); }

  /* ------------------------------------------------------------------
     Créer / rejoindre / quitter
     ------------------------------------------------------------------ */
  function champsDePartie(partieId, premier, regles) {
    return {
      partieId, premier, regles,
      phase: "placement",       // placement → jeu → fin
      navires: [], pret: false, adversairePret: false,
      tirsEnvoyes: [],          // mes tirs : {x, y, res, navire}
      tirsRecus: [],            // ses tirs sur moi : {x, y, res, navire, cases, fin}
      coulesAdverses: [],       // navires ennemis coulés : {id, cases}
      flotteAdverse: null,      // révélée à la fin
      gagnant: null, compte: false,
      veuxRevanche: false, ilVeutRevanche: false,
    };
  }

  function nomJoueur() { return ($("#champ-nom").value.trim() || "Capitaine").slice(0, 16); }

  // Si une autre partie était en cours, on prévient l'ami qu'on la quitte.
  function abandonner() {
    const ancienne = liaison;
    liaison = null;
    if (ancienne) { ancienne.envoyer({ t: "quitte" }); setTimeout(() => ancienne.fermer(), 300); }
  }

  function creerPartie() {
    abandonner();
    profil.nom = nomJoueur(); sauverProfil();
    P = Object.assign(
      { role: "hote", code: aleatoire(5), jetonInvite: null, nomAdverse: "", adversaireParti: false },
      champsDePartie(aleatoire(8), Math.random() < 0.5 ? "hote" : "invite", { colles: $("#opt-colles").checked })
    );
    sauver();
    lancer();
  }

  // Mode solo : l'ordinateur prend la place de l'ami (voir js/ia.js)
  function creerPartieSolo() {
    abandonner();
    profil.nom = nomJoueur(); sauverProfil();
    const niveau = IA.NIVEAUX[profil.niveau] ? profil.niveau : "moyen";
    effacer(CLE_ORDI);
    P = Object.assign(
      { role: "hote", code: "SOLO", solo: { niveau }, jetonInvite: "ordinateur-" + niveau, nomAdverse: IA.NIVEAUX[niveau].nom, adversaireParti: false },
      champsDePartie(aleatoire(8), Math.random() < 0.5 ? "hote" : "invite", { colles: true })
    );
    sauver();
    lancer();
  }

  function rejoindrePartie(code) {
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 5) { toast("Le code fait 5 caractères."); return; }
    abandonner();
    profil.nom = nomJoueur(); sauverProfil();
    P = Object.assign({ role: "invite", code, nomAdverse: "", adversaireParti: false }, champsDePartie(null, null, null));
    P.phase = "arrivee"; // on attend que l'hôte nous accueille
    sauver();
    lancer();
  }

  function lancer() {
    if (liaison) liaison.fermer();
    Discussion.initialiser(P);
    ui.selection = null; ui.visee = null; ui.accueil = false; ui.depuisCoupure = Date.now();
    const surEtat = (etat, detail) => {
      ui.reseau = etat; ui.detailReseau = detail || "";
      if (etat === "connecte") ui.depuisCoupure = null; else if (!ui.depuisCoupure) ui.depuisCoupure = Date.now();
      afficher();
    };
    if (P.solo) {
      liaison = IA.LiaisonSolo({
        niveau: P.solo.niveau,
        rapide: estLocal() && new URLSearchParams(location.search).has("vite"), // tests automatiques
        lireOrdinateur: () => lire(CLE_ORDI),
        ecrireOrdinateur: (e) => ecrire(CLE_ORDI, e),
        surMessage: recevoir,
        battement: () => { if (P) envoyerEtat(); },
        surEtat,
      });
      afficher();
      return;
    }
    liaison = Reseau.Liaison({
      role: P.role,
      code: P.code,
      bonjour: () => ({ t: "bonjour", jeton: profil.jeton, id: profil.id, nom: profil.nom, partieId: P.partieId }),
      accepter: (msg) => {
        if (typeof msg.jeton !== "string") return false;
        if (!P.jetonInvite || P.jetonInvite === msg.jeton) return true; // le même ami revient
        // Un autre téléphone (ou le même ami après avoir installé l'appli, qui a
        // alors une mémoire neuve) : accepté tant que la bataille n'a pas commencé.
        if (P.phase === "placement" && !P.tirsEnvoyes.length && !P.tirsRecus.length) {
          P.adversairePret = false; P.nomAdverse = "";
          Discussion.vider(P); ui.nonLus = 0;
          return true;
        }
        return false;
      },
      surMessage: recevoir,
      battement: () => { if (P) envoyerEtat(); }, // toutes les 3 s : rattrape les messages perdus
      surEtat,
    });
    if (P.role === "invite" && history.replaceState) history.replaceState(null, "", location.pathname + (estLocal() ? "?local=1" : ""));
    afficher();
  }

  function quitter() {
    abandonner();
    P = null;
    effacer(CLE_PARTIE); effacer(CLE_ORDI);
    fermerFenetres();
    afficher();
  }

  /* ------------------------------------------------------------------
     Messages envoyés à l'ami
     ------------------------------------------------------------------ */
  function envoyer(msg) { if (liaison) liaison.envoyer(msg); }

  function envoyerEtat() {
    envoyer({ t: "etat", partieId: P.partieId, pret: P.pret, nom: profil.nom, id: profil.id, aSaFlotte: !!P.flotteAdverse, chatRecus: P.chatRecus });
  }

  function envoyerFlotte() {
    envoyer({ t: "flotte", partieId: P.partieId, navires: P.navires });
  }

  /* ------------------------------------------------------------------
     Messages reçus de l'ami (tout est vérifié : on ne fait pas confiance)
     ------------------------------------------------------------------ */
  const entier = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const texte = (v) => (typeof v === "string" ? v.slice(0, 16) : "");
  const identifiant = (v) => (typeof v === "string" && /^[\w-]{4,24}$/.test(v) ? v : null);

  function recevoir(msg) {
    if (!P) return;
    switch (msg.t) {
      case "bonjour": // (hôte) l'ami vient d'arriver ou revient
        P.jetonInvite = msg.jeton;
        if (!P.nomAdverse) toast(texte(msg.nom) + " a rejoint la partie !");
        P.nomAdverse = texte(msg.nom) || "Ton ami";
        if (identifiant(msg.id)) P.idAdverse = identifiant(msg.id);
        P.adversaireParti = false;
        envoyer({ t: "bienvenue", partieId: P.partieId, premier: P.premier, regles: P.regles, nom: profil.nom, id: profil.id });
        envoyerEtat();
        break;

      case "bienvenue": // (invité) l'hôte nous donne les infos de la partie
        P.nomAdverse = texte(msg.nom) || "Ton ami";
        if (identifiant(msg.id)) P.idAdverse = identifiant(msg.id);
        P.adversaireParti = false;
        if (msg.partieId !== P.partieId) {
          Object.assign(P, champsDePartie(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", { colles: !(msg.regles && msg.regles.colles === false) }));
        }
        envoyerEtat();
        break;

      case "nouvelle": // (invité) revanche lancée par l'hôte
        if (P.role !== "invite") return;
        Object.assign(P, champsDePartie(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", { colles: !(msg.regles && msg.regles.colles === false) }));
        fermerFenetres();
        toast("Revanche ! Place ta flotte.");
        envoyerEtat();
        break;

      case "etat": {
        // Discussion : on renvoie les messages que l'ami n'a pas encore reçus
        Discussion.aRenvoyer(P, msg.chatRecus).forEach(envoyer);
        if (Number.isInteger(msg.chatRecus) && msg.chatRecus > (P.chatConfirmes || 0) && msg.chatRecus <= P.chatEnvoyes) {
          P.chatConfirmes = msg.chatRecus;
          if ($("#fenetre-chat").open) afficherChat(false);
        }
        if (msg.partieId !== P.partieId) {
          // Pas la même partie des deux côtés (un message s'est perdu) : on resynchronise.
          if (P.role === "hote") {
            envoyer({ t: "bienvenue", partieId: P.partieId, premier: P.premier, regles: P.regles, nom: profil.nom, id: profil.id });
            envoyerEtat();
          } else {
            envoyer({ t: "bonjour", jeton: profil.jeton, id: profil.id, nom: profil.nom, partieId: P.partieId });
          }
          return;
        }
        if (msg.nom) P.nomAdverse = texte(msg.nom);
        if (identifiant(msg.id)) P.idAdverse = identifiant(msg.id);
        const avant = P.adversairePret, phaseAvant = P.phase;
        if (msg.pret && !P.adversairePret && P.phase === "placement") toast(P.nomAdverse + " est prêt !");
        P.adversairePret = !!msg.pret;
        verifierDebut();
        // Rattrapage : on renvoie ce qui a pu se perdre (tout est sans risque en double)
        renvoyerTirEnAttente();
        if (P.phase === "fin" && !msg.aSaFlotte) envoyerFlotte();
        if (P.veuxRevanche) envoyer({ t: "revanche", partieId: P.partieId });
        if (avant === P.adversairePret && phaseAvant === P.phase) { sauver(); return; } // rien de neuf : pas besoin de redessiner
        break;
      }

      case "tir": recevoirTir(msg); break;
      case "resultat": recevoirResultat(msg); break;

      case "flotte":
        if (msg.partieId !== P.partieId || P.phase !== "fin" || P.flotteAdverse) return;
        if (Array.isArray(msg.navires) && R.flotteValide(msg.navires, P.regles)) {
          P.flotteAdverse = msg.navires.map((n) => ({ id: n.id, x: n.x, y: n.y, h: !!n.h }));
        } else {
          P.flotteAdverse = [];
        }
        break;

      case "revanche":
        if (msg.partieId !== P.partieId) return;
        if (!P.ilVeutRevanche) toast(P.nomAdverse + " veut une revanche !");
        P.ilVeutRevanche = true;
        if (P.role === "hote" && P.veuxRevanche) lancerRevanche();
        break;

      case "chat": {
        const m = Discussion.recevoir(P, msg);
        if (!m) return;
        if ($("#fenetre-chat").open) afficherChat(true);
        else {
          ui.nonLus++;
          toast((P.nomAdverse || "Ton ami") + " : " + (m.texte.length > 60 ? m.texte.slice(0, 60) + "…" : m.texte));
        }
        Sons.message();
        sauver(); afficherBadge();
        return;
      }

      case "emoji":
        if (["😂", "😱", "🔥", "👏", "😤"].includes(msg.e)) bulle(msg.e);
        return;

      case "quitte":
        P.adversaireParti = true;
        toast(P.nomAdverse + " a quitté la partie.");
        break;

      case "refus":
        toast(typeof msg.raison === "string" ? msg.raison : "Partie refusée.");
        P = null; effacer(CLE_PARTIE);
        if (liaison) liaison.fermer();
        liaison = null;
        break;

      default:
        return;
    }
    sauver();
    afficher();
  }

  /* ------------------------------------------------------------------
     Déroulé de la bataille
     ------------------------------------------------------------------ */
  const jeSuisPremier = () => P.premier === P.role;
  const monTour = () => P.phase === "jeu" && R.estMonTour(jeSuisPremier(), P.tirsEnvoyes.length, P.tirsRecus.length);
  const sonTour = () => P.phase === "jeu" && R.estMonTour(!jeSuisPremier(), P.tirsRecus.length, P.tirsEnvoyes.length);

  function verifierDebut() {
    if (P.phase === "placement" && P.pret && P.adversairePret) {
      P.phase = "jeu";
      sauver();
      setTimeout(() => {
        annonce(monTour() ? "À toi !" : "C'est parti", monTour() ? "Le sort t'a désigné pour tirer en premier" : P.nomAdverse + " tire en premier", "");
        if (monTour()) Sons.tonTour();
      }, 150);
    }
  }

  function tirer(x, y) {
    if (!monTour()) return;
    if (P.tirsEnvoyes.some((t) => t.x === x && t.y === y)) return;
    const n = P.tirsEnvoyes.length;
    P.tirsEnvoyes.push({ x, y, res: null });
    ui.visee = null;
    Sons.tir();
    envoyer({ t: "tir", partieId: P.partieId, n, x, y });
    sauver();
    afficher();
  }

  // Tous les tirs dont la réponse n'est pas (encore) arrivée sont redemandés.
  // Sans risque : l'ami renvoie simplement la même réponse s'il l'avait déjà donnée.
  function renvoyerTirEnAttente() {
    let renvoyes = 0;
    P.tirsEnvoyes.forEach((t, n) => {
      if (t.res === null && renvoyes < 10) {
        envoyer({ t: "tir", partieId: P.partieId, n, x: t.x, y: t.y });
        renvoyes++;
      }
    });
  }

  function recevoirTir(msg) {
    if (msg.partieId !== P.partieId || !entier(msg.n, 0, 99) || !entier(msg.x, 0, 9) || !entier(msg.y, 0, 9)) return;

    // Tir déjà traité (message renvoyé après une coupure) : on renvoie la même réponse.
    if (msg.n < P.tirsRecus.length) {
      const deja = P.tirsRecus[msg.n];
      envoyer(Object.assign({ t: "resultat", partieId: P.partieId, n: msg.n }, deja));
      return;
    }
    if (msg.n !== P.tirsRecus.length || !sonTour()) return;                 // pas son tour : refusé
    if (P.tirsRecus.some((t) => t.x === msg.x && t.y === msg.y)) return;    // case déjà visée

    const r = R.resoudreTir(P.navires, P.tirsRecus, msg.x, msg.y);
    const enregistre = Object.assign({ x: msg.x, y: msg.y }, r);
    P.tirsRecus.push(enregistre);
    envoyer(Object.assign({ t: "resultat", partieId: P.partieId, n: msg.n }, enregistre));

    const lieu = R.nomCase(msg.x, msg.y);
    ui.impactMoi = msg.n;
    setTimeout(() => {
      effet(caseMoi(msg.x, msg.y), r.res === "eau" ? "gerbe" : "explosion");
      if (r.res !== "eau") secouer($("#grille-moi"));
      if (r.res === "coule") r.cases.forEach((c, i) => setTimeout(() => effet(caseMoi(c.x, c.y), "explosion"), 120 * (i + 1)));
    }, 0);
    if (r.fin) {
      terminer("lui");
    } else if (r.res === "coule") {
      Sons.coule(); annonce("Coulé…", P.nomAdverse + " a coulé ton " + R.infoNavire(r.navire).nom.toLowerCase(), "coule");
    } else if (r.res === "touche") {
      Sons.touche(); annonce("Touché…", P.nomAdverse + " t'a touché en " + lieu, "touche");
    } else {
      Sons.eau(); toast(P.nomAdverse + " tire en " + lieu + " : à l'eau. À toi !");
      setTimeout(Sons.tonTour, 500);
    }
    sauver(); afficher();
    // (la fonction appelante « recevoir » ne sauve pas ici car on a déjà sauvé)
  }

  function recevoirResultat(msg) {
    if (msg.partieId !== P.partieId || !entier(msg.n, 0, 99)) return;
    const t = P.tirsEnvoyes[msg.n];
    if (!t || t.res !== null || t.x !== msg.x || t.y !== msg.y) return;     // déjà reçu, ou incohérent
    if (!["eau", "touche", "coule"].includes(msg.res)) return;

    t.res = msg.res;
    ui.impactAdverse = msg.n;
    setTimeout(() => {
      effet(caseAdverse(t.x, t.y), msg.res === "eau" ? "gerbe" : "explosion");
      if (msg.res === "coule" && Array.isArray(msg.cases)) msg.cases.forEach((c, i) => {
        if (c && entier(c.x, 0, 9) && entier(c.y, 0, 9)) setTimeout(() => effet(caseAdverse(c.x, c.y), "explosion"), 120 * (i + 1));
      });
    }, 0);
    if (msg.res === "coule" && R.infoNavire(msg.navire) && Array.isArray(msg.cases)) {
      t.navire = msg.navire;
      const cases = msg.cases.filter((c) => c && entier(c.x, 0, 9) && entier(c.y, 0, 9)).map((c) => ({ x: c.x, y: c.y }));
      if (!P.coulesAdverses.some((c) => c.id === msg.navire)) P.coulesAdverses.push({ id: msg.navire, cases });
    }
    if (msg.fin) {
      terminer("moi");
    } else if (msg.res === "coule") {
      Sons.coule(); annonce("Coulé !", "Tu as coulé son " + R.infoNavire(msg.navire).nom.toLowerCase(), "coule");
    } else if (msg.res === "touche") {
      Sons.touche(); annonce("Touché !", R.nomCase(t.x, t.y), "touche");
    } else {
      Sons.eau(); annonce("À l'eau", R.nomCase(t.x, t.y), "eau");
    }
    sauver(); afficher();
  }

  function terminer(gagnant) {
    if (P.phase === "fin") return;
    P.phase = "fin";
    P.gagnant = gagnant;
    if (!P.compte) {
      P.compte = true;
      const tirs = P.tirsEnvoyes.filter((t) => t.res !== null);
      P.nouveauxTrophees = Trophees.enregistrerPartie(profil, {
        gagne: gagnant === "moi",
        tirs: tirs.length,
        reussis: tirs.filter((t) => t.res !== "eau").length,
        mesCoules: P.tirsRecus.filter((t) => t.res === "coule").length,
        idAdverse: idDuel(),
        nomAdverse: P.nomAdverse,
        solo: !!P.solo,
        niveau: P.solo ? P.solo.niveau : null,
      });
      sauverProfil();
    }
    envoyerFlotte();
    sauver();
    if (gagnant === "moi") { Sons.victoire(); annonce("Victoire !", "Toute la flotte ennemie est au fond", "coule"); }
    else { Sons.defaite(); annonce("Défaite", P.nomAdverse + " a coulé toute ta flotte", "eau"); }
    setTimeout(ouvrirFin, 1600);
  }

  // Clé du score face à face : l'identifiant de l'ami (ou son nom pour une ancienne version)
  function idDuel() {
    if (P.solo) return "ordinateur-" + P.solo.niveau;
    return P.idAdverse || (P.nomAdverse ? "nom-" + P.nomAdverse.toLowerCase() : null);
  }

  function demanderRevanche() {
    if (P.gagnant === "lui" && !P.veuxRevanche) {
      const gagnes = Trophees.beauJoueur(profil);
      if (gagnes.length) { sauverProfil(); toast("Trophée débloqué : " + Trophees.parId("beau").icone + " " + Trophees.parId("beau").nom); }
    }
    P.veuxRevanche = true;
    envoyer({ t: "revanche", partieId: P.partieId });
    if (P.role === "hote" && P.ilVeutRevanche) lancerRevanche();
    sauver(); afficher();
  }

  function lancerRevanche() {
    // Le joueur qui n'a pas commencé la dernière fois commence celle-ci.
    const premier = P.premier === "hote" ? "invite" : "hote";
    Object.assign(P, champsDePartie(aleatoire(8), premier, P.regles));
    envoyer({ t: "nouvelle", partieId: P.partieId, premier, regles: P.regles });
    envoyerEtat();
    fermerFenetres();
    toast("Revanche ! Place ta flotte.");
    sauver(); afficher();
  }

  /* Vérification d'honnêteté : à la fin, on rejoue tous nos tirs sur la flotte
     révélée de l'ami et on vérifie que ses réponses étaient exactes. */
  function verifierHonnetete() {
    if (!P.flotteAdverse) return "En attente de la flotte de " + P.nomAdverse + "…";
    if (!P.flotteAdverse.length) return "⚠️ La flotte reçue n'est pas valide.";
    const deja = [];
    for (const t of P.tirsEnvoyes) {
      const r = R.resoudreTir(P.flotteAdverse, deja, t.x, t.y);
      deja.push({ x: t.x, y: t.y });
      if (t.res === null) continue; // réponse pas encore reçue : rien à comparer
      if (r.res !== t.res) return "⚠️ Certaines réponses ne correspondent pas à la flotte révélée.";
    }
    return "✅ Flotte de " + P.nomAdverse + " vérifiée : partie loyale.";
  }

  /* ------------------------------------------------------------------
     Placement de la flotte
     ------------------------------------------------------------------ */
  function navireEn(x, y) {
    return P.navires.find((n) => R.casesDe(n).some((c) => c.x === x && c.y === y));
  }

  function prochainNavireAPlacer() {
    const f = R.FLOTTE.find((f) => !P.navires.some((n) => n.id === f.id));
    return f ? f.id : null;
  }

  function toucherMaGrille(x, y) {
    if (P.phase !== "placement" || P.pret) return;
    const sous = navireEn(x, y);
    if (sous && sous.id === ui.selection) { pivoter(); return; }       // 2e toucher = pivoter
    if (sous) { ui.selection = sous.id; Sons.clic(); afficher(); return; } // toucher un navire = le prendre
    if (!ui.selection) { ui.selection = prochainNavireAPlacer(); if (!ui.selection) return; }

    const existant = P.navires.find((n) => n.id === ui.selection);
    const candidat = R.recadrer({ id: ui.selection, x, y, h: existant ? existant.h : ui.horizontal });
    const verdict = R.placementValide(P.navires, candidat, P.regles);
    if (!verdict.ok) { refuser(verdict.raison); return; }
    P.navires = P.navires.filter((n) => n.id !== candidat.id).concat([candidat]);
    Sons.clic();
    ui.selection = existant ? null : prochainNavireAPlacer();
    sauver(); afficher();
  }

  function pivoter() {
    const n = P.navires.find((v) => v.id === ui.selection);
    if (!n) { ui.horizontal = !ui.horizontal; toast(ui.horizontal ? "Navires à l'horizontale" : "Navires à la verticale"); afficher(); return; }
    const candidat = R.recadrer({ ...n, h: !n.h });
    const verdict = R.placementValide(P.navires, candidat, P.regles);
    if (!verdict.ok) { refuser("Pas la place de le tourner ici."); return; }
    P.navires = P.navires.map((v) => (v.id === n.id ? candidat : v));
    Sons.clic();
    sauver(); afficher();
  }

  function placerAuHasard() {
    P.navires = R.placementAleatoire(P.regles);
    ui.selection = null;
    Sons.clic();
    sauver(); afficher();
  }

  function seDeclarerPret() {
    if (!R.flotteValide(P.navires, P.regles)) { refuser("Place tes 5 navires d'abord."); return; }
    P.pret = true;
    ui.selection = null;
    envoyerEtat();
    verifierDebut();
    sauver(); afficher();
  }

  function refuser(texteMsg) {
    toast(texteMsg);
    const g = $("#grille-moi");
    g.classList.remove("secoue"); void g.offsetWidth; g.classList.add("secoue");
    if (navigator.vibrate && profil.son) navigator.vibrate(80);
  }

  /* ------------------------------------------------------------------
     Construction des grilles (une seule fois)
     ------------------------------------------------------------------ */
  function construireGrille(el, auToucher) {
    // Chaque élément reçoit sa place exacte (colonne, ligne) : ainsi les dessins
    // de navires peuvent se poser par-dessus sans décaler les cases.
    const placer = (e, col, lig) => { e.style.gridColumn = col; e.style.gridRow = lig; el.appendChild(e); };
    el.innerHTML = "";
    placer(document.createElement("span"), 1, 1);
    for (let x = 0; x < R.TAILLE; x++) {
      const s = document.createElement("span"); s.className = "repere"; s.textContent = R.LETTRES[x]; placer(s, x + 2, 1);
    }
    const cases = [];
    for (let y = 0; y < R.TAILLE; y++) {
      const s = document.createElement("span"); s.className = "repere"; s.textContent = y + 1; placer(s, 1, y + 2);
      for (let x = 0; x < R.TAILLE; x++) {
        // Grille juste pour regarder (replay) : de simples cases, pas des boutons
        const b = document.createElement(auToucher ? "button" : "span");
        b.style.gridColumn = x + 2; b.style.gridRow = y + 2;
        b.className = "case";
        b.setAttribute("aria-label", R.nomCase(x, y));
        if (auToucher) { b.type = "button"; b.addEventListener("click", () => { Sons.debloquer(); auToucher(x, y); }); }
        el.appendChild(b);
        cases.push(b);
      }
    }
    return (x, y) => cases[y * R.TAILLE + x];
  }

  const caseMoi = construireGrille($("#grille-moi"), toucherMaGrille);
  const caseAdverse = construireGrille($("#grille-adverse"), (x, y) => {
    if (!P || P.phase !== "jeu") return;
    if (P.tirsEnvoyes.some((t) => t.x === x && t.y === y)) { toast("Tu as déjà tiré en " + R.nomCase(x, y) + "."); return; }
    if (!monTour()) { toast("Patience, c'est au tour de " + P.nomAdverse + "."); return; }
    if (ui.visee && ui.visee.x === x && ui.visee.y === y) { tirer(x, y); return; } // 2e toucher = feu
    ui.visee = { x, y };
    Sons.clic();
    afficher();
  });

  /* ------------------------------------------------------------------
     AFFICHAGE : redessine tout l'écran à partir de P
     ------------------------------------------------------------------ */
  function afficher() {
    if (!P || ui.accueil) {
      ecrans.accueil.hidden = false; ecrans.jeu.hidden = true;
      document.title = "Escadre — Bataille navale";
      afficherAccueil();
      return;
    }
    ecrans.accueil.hidden = true; ecrans.jeu.hidden = false;
    afficherReseau();
    afficherBandeau();
    afficherMaGrille();
    afficherGrilleAdverse();
    afficherOutils();
    document.title = monTour() ? "🎯 À toi ! — Escadre" : "Escadre — Bataille navale";
    if ($("#fenetre-fin").open) $("#fin-honnetete").textContent = verifierHonnetete();
    afficherBadge();
  }

  function afficherAccueil() {
    $("#bloc-reprendre").hidden = !P;
    const v = profil.victoires, d = profil.defaites;
    $("#stats").textContent = v + d > 0 ? `Ton palmarès : ${v} victoire${v > 1 ? "s" : ""}, ${d} défaite${d > 1 ? "s" : ""}` : "";
    const nbTrophees = Object.keys(profil.trophees).length;
    $("#btn-palmares").textContent = "🏆 Palmarès et trophées" + (nbTrophees ? ` (${nbTrophees}/${Trophees.LISTE.length})` : "");
    document.querySelectorAll("#choix-niveau button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.niveau === profil.niveau)));
    $("#hors-ligne").hidden = navigator.onLine;
  }

  function afficherReseau() {
    const pastille = $("#pastille");
    let txt;
    pastille.className = "pastille";
    if (P.solo) {
      pastille.classList.add("ok");
      $("#texte-reseau").textContent = "Partie solo · " + IA.NIVEAUX[P.solo.niveau].titre;
      $("#bloc-invitation").hidden = true;
      $("#aide-connexion").hidden = true;
      return;
    }
    if (P.adversaireParti) { txt = P.nomAdverse + " a quitté la partie"; pastille.classList.add("ko"); }
    else if (ui.reseau === "connecte") { txt = "En ligne avec " + (P.nomAdverse || "ton ami"); pastille.classList.add("ok"); }
    else if (ui.reseau === "attente") txt = P.nomAdverse ? "En attente du retour de " + P.nomAdverse + "…" : "En attente de ton ami…";
    else if (ui.reseau === "coupe") { txt = ui.detailReseau || "Connexion perdue, on réessaie…"; pastille.classList.add("ko"); }
    else if (ui.reseau === "erreur") { txt = ui.detailReseau || "Erreur réseau"; pastille.classList.add("ko"); }
    else txt = ui.detailReseau || "Connexion…";
    $("#texte-reseau").textContent = txt + "  ·  " + P.code;

    const invitation = P.role === "hote" && !P.jetonInvite;
    $("#bloc-invitation").hidden = !invitation;
    $("#code-partie").textContent = P.code;

    // Aide : la connexion avec l'ami ne revient pas depuis plus de 20 s
    const bloque = !invitation && !P.adversaireParti && P.phase !== "fin" && ui.reseau !== "connecte" &&
      ui.depuisCoupure && Date.now() - ui.depuisCoupure > 20000;
    $("#aide-connexion").hidden = !bloque;
    if (bloque) $("#aide-detail").textContent = ui.detailReseau || "On réessaie automatiquement…";
  }

  // « Toi 3 – 2 Lucas » : le score face à face, gardé d'une partie à l'autre
  function texteScore() {
    const id = idDuel();
    if (!id) return "";
    const sc = Trophees.score(profil, id);
    if (sc.v + sc.d === 0) return "";
    return `Toi ${sc.v} – ${sc.d} ${P.nomAdverse || "ton ami"}`;
  }

  function afficherBandeau() {
    const titre = $("#bandeau-titre"), detail = $("#bandeau-detail"), bandeau = $("#bandeau");
    const score = texteScore();
    $("#score-duel").hidden = !score || P.phase === "jeu";
    $("#score-duel").textContent = score;
    bandeau.classList.toggle("mon-tour", monTour());
    const autre = P.nomAdverse || "ton ami";
    if (P.phase === "arrivee") { titre.textContent = "Connexion à la partie"; detail.textContent = "Code " + P.code; }
    else if (P.phase === "placement" && !P.pret) {
      titre.textContent = "Place ta flotte";
      detail.textContent = P.adversairePret ? autre + " est prêt et t'attend." : (P.regles && P.regles.colles === false ? "Règle : les navires ne se touchent pas." : "");
    } else if (P.phase === "placement") {
      titre.textContent = "Flotte prête";
      detail.textContent = P.nomAdverse ? autre + " place sa flotte…" : "On attend ton ami…";
    } else if (P.phase === "jeu") {
      if (monTour()) { titre.textContent = "À toi de tirer"; detail.textContent = ui.visee ? "Cible : " + R.nomCase(ui.visee.x, ui.visee.y) + " — touche encore pour tirer" : "Choisis une case dans les eaux ennemies"; }
      else if (P.tirsEnvoyes.some((t) => t.res === null)) { titre.textContent = "Tir en cours…"; detail.textContent = ""; }
      else { titre.textContent = "Tour de " + autre; detail.textContent = autre + " cherche ta flotte…"; }
    } else if (P.phase === "fin") {
      titre.textContent = P.gagnant === "moi" ? "Victoire !" : "Défaite";
      detail.textContent = P.veuxRevanche && !P.ilVeutRevanche ? "En attente de " + autre + " pour la revanche…" : "";
    }
  }

  function afficherMaGrille() {
    const bataille = P.phase === "jeu" || P.phase === "fin";
    ecrans.jeu.classList.toggle("mode-bataille", bataille);
    $("#titre-ma-grille").textContent = bataille ? "Ta flotte" : "Ta grille";
    $("#grille-moi").classList.toggle("verrouillee", P.pret && P.phase === "placement");
    const touches = P.tirsRecus.filter((t) => t.res !== "eau").length;
    $("#mes-degats").textContent = bataille ? `${touches}/${R.TOTAL_CASES}` : "";

    for (let y = 0; y < R.TAILLE; y++) for (let x = 0; x < R.TAILLE; x++) caseMoi(x, y).className = "case";
    const grille = $("#grille-moi");
    grille.querySelectorAll(".silhouette").forEach((e) => e.remove());
    const coules = new Set(P.tirsRecus.filter((t) => t.res === "coule").map((t) => t.navire));
    P.navires.forEach((n) => {
      R.casesDe(n).forEach((c) => caseMoi(c.x, c.y).classList.add("nav"));
      const classes = (n.id === ui.selection ? "choisi " : "") + (coules.has(n.id) ? "coule" : "");
      grille.appendChild(Navires.element(n, R.infoNavire(n.id).taille, classes));
    });
    P.tirsRecus.forEach((t, i) => {
      const el = caseMoi(t.x, t.y);
      el.classList.add(t.res === "eau" ? "eau" : "touche");
      if (i === P.tirsRecus.length - 1) el.classList.add("dernier");
      if (ui.impactMoi === i) { el.classList.add("impact"); }
    });
    P.tirsRecus.filter((t) => t.res === "coule").forEach((t) => (t.cases || []).forEach((c) => caseMoi(c.x, c.y).classList.add("coule")));
    ui.impactMoi = null;
  }

  function afficherGrilleAdverse() {
    const bataille = P.phase === "jeu" || P.phase === "fin";
    $("#zone-adverse").hidden = !bataille;
    $("#zone-suivi").hidden = !bataille;
    if (!bataille) return;
    for (let y = 0; y < R.TAILLE; y++) for (let x = 0; x < R.TAILLE; x++) caseAdverse(x, y).className = "case";
    const grille = $("#grille-adverse");
    grille.querySelectorAll(".silhouette").forEach((e) => e.remove());

    // Navires ennemis coulés : on dessine leur épave
    P.coulesAdverses.forEach((c) => {
      if (!c.cases.length) return;
      const xs = c.cases.map((k) => k.x), ys = c.cases.map((k) => k.y);
      const navire = { id: c.id, x: Math.min(...xs), y: Math.min(...ys), h: new Set(ys).size === 1 };
      grille.appendChild(Navires.element(navire, R.infoNavire(c.id).taille, "coule"));
      c.cases.forEach((k) => caseAdverse(k.x, k.y).classList.add("nav"));
    });
    // Fin de partie : les navires ennemis rescapés apparaissent en transparence
    if (P.phase === "fin" && P.flotteAdverse) {
      P.flotteAdverse.filter((n) => !P.coulesAdverses.some((c) => c.id === n.id)).forEach((n) => {
        grille.appendChild(Navires.element(n, R.infoNavire(n.id).taille, "revele"));
        R.casesDe(n).forEach((c) => caseAdverse(c.x, c.y).classList.add("nav"));
      });
    }
    P.tirsEnvoyes.forEach((t, i) => {
      const el = caseAdverse(t.x, t.y);
      el.classList.add(t.res === null ? "attente" : t.res === "eau" ? "eau" : "touche");
      if (i === P.tirsEnvoyes.length - 1) el.classList.add("dernier");
      if (ui.impactAdverse === i) el.classList.add("impact");
    });
    P.coulesAdverses.forEach((c) => c.cases.forEach((k) => caseAdverse(k.x, k.y).classList.add("coule")));
    if (ui.visee) caseAdverse(ui.visee.x, ui.visee.y).classList.add("vise");
    ui.impactAdverse = null;

    const nb = P.tirsEnvoyes.length;
    $("#compteur-tirs").textContent = nb ? nb + " tir" + (nb > 1 ? "s" : "") : "";

    const suivi = $("#suivi-flotte");
    suivi.innerHTML = "";
    R.FLOTTE.forEach((f) => {
      const li = document.createElement("li");
      if (P.coulesAdverses.some((c) => c.id === f.id)) li.className = "coule";
      li.appendChild(Navires.icone(f.id, f.taille));
      li.appendChild(document.createTextNode(f.nom));
      suivi.appendChild(li);
    });
  }


  function afficherOutils() {
    const placement = P.phase === "placement" && !P.pret;
    $("#outils-placement").hidden = !placement;
    $("#duo").hidden = P.phase === "arrivee";
    if (placement) {
      const quai = $("#quai");
      quai.innerHTML = "";
      R.FLOTTE.forEach((f) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        if (P.navires.some((n) => n.id === f.id)) b.classList.add("pose");
        if (ui.selection === f.id) b.classList.add("choisi");
        b.appendChild(Navires.icone(f.id, f.taille));
        b.appendChild(document.createTextNode(f.nom));
        b.addEventListener("click", () => { ui.selection = ui.selection === f.id ? null : f.id; Sons.debloquer(); afficher(); });
        li.appendChild(b);
        quai.appendChild(li);
      });
      $("#btn-pret").disabled = !R.flotteValide(P.navires, P.regles);
    }

    const bataille = P.phase === "jeu";
    $("#barre-tir").hidden = !(bataille || P.phase === "fin");
    const feu = $("#btn-feu");
    if (P.phase === "fin") {
      feu.disabled = false; feu.textContent = "Voir le résultat";
    } else if (monTour()) {
      feu.disabled = !ui.visee;
      feu.textContent = ui.visee ? "Feu sur " + R.nomCase(ui.visee.x, ui.visee.y) + " !" : "Choisis une case";
    } else {
      feu.disabled = true; feu.textContent = "Tour de " + (P.nomAdverse || "ton ami");
    }
  }

  /* ------------------------------------------------------------------
     Fenêtres, annonces, petits messages
     ------------------------------------------------------------------ */
  function ouvrirFin() {
    if (!P || P.phase !== "fin") return;
    const gagne = P.gagnant === "moi";
    const tirs = P.tirsEnvoyes.filter((t) => t.res !== null);
    const reussis = tirs.filter((t) => t.res !== "eau").length;
    $("#fin-icone").textContent = gagne ? "🏆" : "⚓";
    $("#fin-titre").textContent = gagne ? "Victoire !" : "Défaite";
    $("#fin-texte").textContent = gagne ? "Tu as coulé toute la flotte de " + P.nomAdverse + "." : P.nomAdverse + " a coulé toute ta flotte.";
    $("#fin-tirs").textContent = tirs.length;
    $("#fin-precision").textContent = (tirs.length ? Math.round((100 * reussis) / tirs.length) : 0) + " %";
    $("#fin-coules").textContent = P.coulesAdverses.length + "/5";
    $("#fin-honnetete").textContent = verifierHonnetete();
    $("#fin-score").textContent = texteScore();
    const liste = $("#fin-trophees");
    liste.innerHTML = "";
    (P.nouveauxTrophees || []).forEach((id) => {
      const t = Trophees.parId(id);
      if (!t) return;
      const li = document.createElement("li");
      li.innerHTML = `<span class="trophee-icone"></span><span><strong></strong><small></small></span>`;
      li.querySelector(".trophee-icone").textContent = t.icone;
      li.querySelector("strong").textContent = "Trophée débloqué : " + t.nom;
      li.querySelector("small").textContent = t.desc;
      liste.appendChild(li);
    });
    liste.hidden = !liste.children.length;
    const btn = $("#btn-revanche");
    btn.disabled = P.veuxRevanche || P.adversaireParti;
    btn.textContent = P.veuxRevanche ? "En attente de " + P.nomAdverse + "…" : P.ilVeutRevanche ? "Accepter la revanche" : "Revanche";
    const f = $("#fenetre-fin");
    if (!f.open) f.showModal();
  }

  function fermerFenetres() { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }

  /* ------------------------------------------------------------------
     Discussion
     ------------------------------------------------------------------ */
  function afficherBadge() {
    const badge = $("#badge-chat");
    badge.hidden = ui.nonLus === 0;
    badge.textContent = ui.nonLus > 9 ? "9+" : String(ui.nonLus);
  }

  const heure = (h) => new Date(h).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  function afficherChat(defilerEnBas) {
    $("#chat-titre").textContent = "Discussion avec " + (P.nomAdverse || "ton ami");
    const fil = $("#fil-chat");
    fil.innerHTML = "";
    if (!P.chat.length) {
      const vide = document.createElement("li");
      vide.className = "chat-vide";
      vide.textContent = P.nomAdverse ? "Dis bonjour à " + P.nomAdverse + " 👋" : "Tes messages partiront dès que ton ami aura rejoint.";
      fil.appendChild(vide);
    }
    let jourPrecedent = "";
    P.chat.forEach((m) => {
      const li = document.createElement("li");
      li.className = "msg " + m.de;
      const bulle = document.createElement("p");
      bulle.textContent = m.texte;            // textContent : le texte de l'ami ne peut pas injecter de code
      const info = document.createElement("time");
      // Message pas encore confirmé par l'ami : petite horloge
      const suivi = m.de !== "moi" ? "" : m.n < (P.chatConfirmes || 0) ? " · ✓ reçu" : " · ⏳";
      info.textContent = heure(m.h) + suivi;
      li.append(bulle, info);
      fil.appendChild(li);
    });
    if (defilerEnBas) fil.scrollTop = fil.scrollHeight;
  }

  function ouvrirChat() {
    fermerFenetres();
    ui.nonLus = 0;
    afficherBadge();
    afficherChat(true);
    $("#fenetre-chat").showModal();
    $("#fil-chat").scrollTop = $("#fil-chat").scrollHeight;
  }

  function envoyerChat(texte) {
    const msg = Discussion.ecrire(P, texte);
    if (!msg) return;
    envoyer(msg);
    Sons.clic();
    sauver();
    afficherChat(true);
  }

  /* ------------------------------------------------------------------
     Effets de tir : gerbe d'eau (raté) ou explosion (touché)
     ------------------------------------------------------------------ */
  function effet(el, type) {
    if (!el) return;
    const s = document.createElement("span");
    s.className = "effet " + type;
    el.style.zIndex = 4; // au-dessus des cases voisines le temps de l'animation
    el.appendChild(s);
    setTimeout(() => { s.remove(); if (!el.querySelector(".effet")) el.style.zIndex = ""; }, 900);
  }
  function secouer(el) { el.classList.remove("choc"); void el.offsetWidth; el.classList.add("choc"); }

  /* ------------------------------------------------------------------
     Replay : on rejoue la partie coup par coup, les deux flottes visibles
     ------------------------------------------------------------------ */
  const caseReplayMoi = construireGrille($("#replay-moi"), null);
  const caseReplayLui = construireGrille($("#replay-lui"), null);
  const replay = { seq: [], pos: 0, minuteur: null };

  // Ordre réel des tirs : le premier joueur tire, puis l'autre, et ainsi de suite.
  function sequenceReplay() {
    const seq = [];
    const n = Math.max(P.tirsEnvoyes.length, P.tirsRecus.length);
    for (let i = 0; i < n; i++) {
      const a = { qui: "moi", t: P.tirsEnvoyes[i] }, b = { qui: "lui", t: P.tirsRecus[i] };
      (jeSuisPremier() ? [a, b] : [b, a]).forEach((e) => { if (e.t && e.t.res) seq.push(e); });
    }
    return seq;
  }

  function dessinerReplay() {
    const k = replay.pos, seq = replay.seq.slice(0, k);
    const grilles = [
      { el: $("#replay-moi"), c: caseReplayMoi, qui: "lui", flotte: P.navires },
      { el: $("#replay-lui"), c: caseReplayLui, qui: "moi", flotte: P.flotteAdverse && P.flotteAdverse.length ? P.flotteAdverse : null },
    ];
    grilles.forEach((g) => {
      for (let y = 0; y < R.TAILLE; y++) for (let x = 0; x < R.TAILLE; x++) g.c(x, y).className = "case";
      g.el.querySelectorAll(".silhouette").forEach((e) => e.remove());
      const tirs = seq.filter((e) => e.qui === g.qui).map((e) => e.t);
      const coules = new Set(tirs.filter((t) => t.res === "coule").map((t) => t.navire));
      if (g.flotte) {
        g.flotte.forEach((n) => {
          g.el.appendChild(Navires.element(n, R.infoNavire(n.id).taille, coules.has(n.id) ? "coule" : g.qui === "moi" ? "revele" : ""));
          R.casesDe(n).forEach((c) => {
            g.c(c.x, c.y).classList.add("nav");
            if (coules.has(n.id)) g.c(c.x, c.y).classList.add("coule");
          });
        });
      } else {
        // Flotte de l'ami inconnue : seulement ses épaves
        P.coulesAdverses.filter((c) => coules.has(c.id) && c.cases.length).forEach((c) => {
          const xs = c.cases.map((q) => q.x), ys = c.cases.map((q) => q.y);
          g.el.appendChild(Navires.element({ id: c.id, x: Math.min(...xs), y: Math.min(...ys), h: new Set(ys).size === 1 }, R.infoNavire(c.id).taille, "coule"));
          c.cases.forEach((q) => g.c(q.x, q.y).classList.add("nav", "coule"));
        });
      }
      tirs.forEach((t) => g.c(t.x, t.y).classList.add(t.res === "eau" ? "eau" : "touche"));
    });
    const dernier = seq[k - 1];
    let legende = "Début de la partie";
    if (dernier) {
      const cible = (dernier.qui === "moi" ? caseReplayLui : caseReplayMoi)(dernier.t.x, dernier.t.y);
      cible.classList.add("dernier");
      effet(cible, dernier.t.res === "eau" ? "gerbe" : "explosion");
      const res = { eau: "à l'eau", touche: "touché", coule: "coulé !" }[dernier.t.res];
      legende = (dernier.qui === "moi" ? "Toi" : P.nomAdverse) + " tire en " + R.nomCase(dernier.t.x, dernier.t.y) + " : " + res;
    }
    $("#replay-compteur").textContent = `Coup ${k} / ${replay.seq.length}`;
    $("#replay-legende").textContent = legende;
    $("#replay-curseur").max = replay.seq.length;
    $("#replay-curseur").value = k;
    $("#replay-lecture").textContent = replay.minuteur ? "⏸ Pause" : k >= replay.seq.length ? "↺ Revoir" : "▶ Lecture";
  }

  function allerReplay(pos) {
    replay.pos = Math.max(0, Math.min(replay.seq.length, pos));
    if (replay.pos >= replay.seq.length) arreterReplay();
    dessinerReplay();
  }
  function arreterReplay() { clearInterval(replay.minuteur); replay.minuteur = null; }
  function lectureReplay() {
    if (replay.minuteur) { arreterReplay(); dessinerReplay(); return; }
    if (replay.pos >= replay.seq.length) replay.pos = 0;
    replay.minuteur = setInterval(() => allerReplay(replay.pos + 1), 650);
    allerReplay(replay.pos + 1);
  }
  function ouvrirReplay() {
    fermerFenetres();
    replay.seq = sequenceReplay();
    replay.pos = 0;
    $("#replay-titre-lui").textContent = "Flotte de " + (P.nomAdverse || "ton ami");
    $("#fenetre-replay").showModal();
    dessinerReplay();
    lectureReplay();
  }

  /* ------------------------------------------------------------------
     Palmarès : scores face à face et trophées
     ------------------------------------------------------------------ */
  function ouvrirPalmares() {
    $("#pal-parties").textContent = profil.parties;
    $("#pal-victoires").textContent = profil.victoires;
    $("#pal-serie").textContent = profil.meilleureSerie;
    const duels = $("#liste-duels");
    duels.innerHTML = "";
    const liste = Trophees.duels(profil);
    if (!liste.length) {
      const li = document.createElement("li"); li.className = "vide"; li.textContent = "Aucune partie terminée pour l'instant.";
      duels.appendChild(li);
    }
    liste.forEach((d) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="duel-nom"></span><span class="duel-score"></span>`;
      li.querySelector(".duel-nom").textContent = (d.id.startsWith("ordinateur-") ? "🤖 " : "") + (d.nom || "Ami");
      li.querySelector(".duel-score").textContent = `${d.v} – ${d.d}`;
      if (d.v > d.d) li.classList.add("devant"); else if (d.v < d.d) li.classList.add("derriere");
      duels.appendChild(li);
    });
    const tr = $("#liste-trophees");
    tr.innerHTML = "";
    Trophees.LISTE.forEach((t) => {
      const li = document.createElement("li");
      const obtenu = profil.trophees[t.id];
      li.className = obtenu ? "obtenu" : "verrouille";
      li.innerHTML = `<span class="trophee-icone"></span><span><strong></strong><small></small></span>`;
      li.querySelector(".trophee-icone").textContent = obtenu ? t.icone : "🔒";
      li.querySelector("strong").textContent = t.nom;
      li.querySelector("small").textContent = t.desc + (obtenu ? " · " + new Date(obtenu).toLocaleDateString("fr-FR") : "");
      tr.appendChild(li);
    });
    $("#compte-trophees").textContent = `${Object.keys(profil.trophees).length}/${Trophees.LISTE.length}`;
    $("#fenetre-palmares").showModal();
    $("#fenetre-palmares").scrollTop = 0; // on commence en haut de la liste
  }

  let minuteurAnnonce;
  function annonce(titre, sousTitre, classe) {
    const a = $("#annonce");
    a.className = "annonce " + (classe || "");
    a.textContent = "";
    const bloc = document.createElement("div");
    bloc.textContent = titre;
    if (sousTitre) { const s = document.createElement("small"); s.textContent = sousTitre; bloc.appendChild(s); }
    a.appendChild(bloc);
    void a.offsetWidth;
    a.classList.add("visible");
    clearTimeout(minuteurAnnonce);
    minuteurAnnonce = setTimeout(() => a.classList.remove("visible"), 1500);
  }

  let minuteurToast;
  function toast(t) {
    const el = $("#toast");
    el.textContent = t;
    el.classList.add("visible");
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => el.classList.remove("visible"), 2600);
  }

  function bulle(e) {
    const b = $("#bulle");
    b.textContent = e;
    b.classList.remove("visible"); void b.offsetWidth; b.classList.add("visible");
    if (navigator.vibrate && profil.son) navigator.vibrate(20);
  }

  const estLocal = () => new URLSearchParams(location.search).has("local");
  function lienInvitation() {
    return location.origin + location.pathname + "?salle=" + P.code + (estLocal() ? "&local=1" : "");
  }

  async function partager() {
    const lien = lienInvitation();
    const message = `${profil.nom || "Ton ami"} te défie à la bataille navale sur Escadre ! Code : ${P.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Escadre", text: message, url: lien }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copier(message + "\n" + lien);
  }

  async function copier(t) {
    try { await navigator.clipboard.writeText(t); toast("Copié !"); }
    catch (e) { toast("Code : " + P.code); }
  }

  /* ------------------------------------------------------------------
     Branchement des boutons
     ------------------------------------------------------------------ */
  $("#champ-nom").value = profil.nom;
  $("#champ-nom").addEventListener("change", () => { profil.nom = nomJoueur(); sauverProfil(); });
  $("#btn-creer").addEventListener("click", () => { Sons.debloquer(); creerPartie(); });
  $("#btn-solo").addEventListener("click", () => { Sons.debloquer(); creerPartieSolo(); });
  $("#choix-niveau").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-niveau]");
    if (!b) return;
    profil.niveau = b.dataset.niveau; sauverProfil(); afficherAccueil();
  });
  $("#btn-palmares").addEventListener("click", ouvrirPalmares);
  $("#btn-rejoindre").addEventListener("click", () => { Sons.debloquer(); rejoindrePartie($("#champ-code").value); });
  $("#champ-code").addEventListener("keydown", (e) => { if (e.key === "Enter") rejoindrePartie(e.target.value); });
  $("#champ-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

  $("#btn-partager").addEventListener("click", partager);
  $("#btn-copier").addEventListener("click", () => copier(lienInvitation()));
  $("#btn-pivoter").addEventListener("click", pivoter);
  $("#btn-hasard").addEventListener("click", placerAuHasard);
  $("#btn-pret").addEventListener("click", seDeclarerPret);
  $("#btn-feu").addEventListener("click", () => {
    if (P && P.phase === "fin") { ouvrirFin(); return; }
    if (ui.visee) tirer(ui.visee.x, ui.visee.y);
  });
  $("#reactions").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-emoji]");
    if (!b) return;
    envoyer({ t: "emoji", e: b.dataset.emoji });
    bulle(b.dataset.emoji);
  });

  $("#btn-chat").addEventListener("click", () => { Sons.debloquer(); ouvrirChat(); });
  $("#form-chat").addEventListener("submit", (e) => {
    e.preventDefault();
    const champ = $("#champ-chat");
    envoyerChat(champ.value);
    champ.value = "";
    champ.focus();
  });
  $("#reponses-rapides").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) envoyerChat(b.textContent);
  });
  $("#btn-menu").addEventListener("click", () => { $("#opt-son").checked = profil.son; $("#fenetre-menu").showModal(); });
  $("#opt-son").addEventListener("change", (e) => { profil.son = e.target.checked; Sons.regler(profil.son); sauverProfil(); });
  $("#btn-quitter").addEventListener("click", () => { fermerFenetres(); $("#fenetre-confirmer").showModal(); });
  $("#btn-quitter-oui").addEventListener("click", quitter);
  $("#btn-revanche").addEventListener("click", demanderRevanche);
  $("#btn-voir").addEventListener("click", () => $("#fenetre-fin").close());
  $("#btn-replay").addEventListener("click", ouvrirReplay);
  $("#replay-lecture").addEventListener("click", lectureReplay);
  $("#replay-debut").addEventListener("click", () => { arreterReplay(); allerReplay(0); });
  $("#replay-precedent").addEventListener("click", () => { arreterReplay(); allerReplay(replay.pos - 1); });
  $("#replay-suivant").addEventListener("click", () => { arreterReplay(); allerReplay(replay.pos + 1); });
  $("#replay-curseur").addEventListener("input", (e) => { arreterReplay(); allerReplay(Number(e.target.value)); });
  $("#fenetre-replay").addEventListener("close", arreterReplay);
  $("#btn-accueil").addEventListener("click", quitter);

  document.querySelectorAll("[data-ouvrir]").forEach((b) => b.addEventListener("click", () => {
    fermerFenetres(); document.getElementById(b.dataset.ouvrir).showModal();
  }));
  document.querySelectorAll("[data-fermer]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  // Retour au premier plan (iPhone qui « endort » l'appli) : on vérifie la connexion.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && liaison) liaison.verifier(); });
  window.addEventListener("online", () => { if (liaison) liaison.verifier(); afficher(); });
  window.addEventListener("offline", afficher);
  // Toutes les 5 s, si l'ami est injoignable, on met à jour le statut (et l'aide si ça dure)
  setInterval(() => { if (P && !ui.accueil && !P.solo && ui.reseau !== "connecte") afficherReseau(); }, 5000);

  /* ------------------------------------------------------------------
     Démarrage
     ------------------------------------------------------------------ */
  const salle = new URLSearchParams(location.search).get("salle");
  if (salle && (!P || P.code !== salle.toUpperCase())) {
    // Lien d'invitation : on pré-remplit le code. Si une autre partie existe,
    // elle reste proposée avec le bouton « Reprendre ».
    ui.accueil = true;
    $("#champ-code").value = salle.toUpperCase().slice(0, 5);
    if (!profil.nom) $("#champ-nom").focus();
    toast("Entre ton nom puis touche « Rejoindre ».");
  }
  $("#btn-reprendre").addEventListener("click", () => { ui.accueil = false; lancer(); });
  if (P && !ui.accueil) lancer(); else afficher();

  // Service worker : rend l'appli installable et utilisable hors ligne
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
