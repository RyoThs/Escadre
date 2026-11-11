/* ==========================================================================
   Escadre — l'APPLICATION (écrans, boutons, déroulé de la partie)
   --------------------------------------------------------------------------
   Idée générale :
   - Toute la partie est rangée dans un seul objet « P » (la Partie).
   - Chaque fois que P change : on l'enregistre (sauver) puis on redessine
     l'écran (afficher). Si le téléphone recharge la page, on reprend P.
   - Chaque joueur garde SA flotte secrète. Quand l'ami agit (tir ou
     compétence), c'est MON téléphone qui calcule le résultat et lui répond.
   - La partie est un JOURNAL d'actions numérotées (voir js/moteur.js) :
     à partir de lui, on sait à qui c'est le tour, qui a gagné quelles
     compétences, et on peut tout revérifier à la fin.
   ========================================================================== */
(function () {
  "use strict";
  const R = window.Regles;
  const M = window.Moteur;
  const CLE_PARTIE = "escadre.partie.v2";
  const CLE_PROFIL = "escadre.profil.v1";
  const CLE_ORDI = "escadre.ordinateur.v2";   // mémoire de l'ordinateur (mode solo)
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
  effacer("escadre.partie.v1"); effacer("escadre.ordinateur.v1"); // parties de l'ancienne version (règles différentes)

  function aleatoire(n) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans O/0 ni I/1 (on les confond)
    const tab = new Uint32Array(n);
    crypto.getRandomValues(tab);
    return Array.from(tab, (v) => alphabet[v % alphabet.length]).join("");
  }

  // jeton : secret qui permet de revenir dans sa partie ; id : identifiant public
  // (sert à tenir le score face à chaque ami).
  const profil = Object.assign({ nom: "", son: true, victoires: 0, defaites: 0, jeton: aleatoire(16), id: aleatoire(10), niveau: "moyen" }, lire(CLE_PROFIL) || {});
  profil.reglages = R.normaliser(profil.reglages || {});
  Trophees.initialiser(profil);
  ecrire(CLE_PROFIL, profil);
  Sons.regler(profil.son);

  let P = lire(CLE_PARTIE);
  if (P && (Date.now() - (P.maj || 0) > DUREE_REPRISE || !Array.isArray(P.journal))) { P = null; effacer(CLE_PARTIE); }

  let liaison = null;
  const ui = {
    selection: null, horizontal: true, reseau: "connexion", detailReseau: "", accueil: false, nonLus: 0, depuisCoupure: Date.now(),
    mode: null,          // compétence choisie pour ce tour (null = tir normal)
    cible: null,         // ce que le joueur est en train de viser
    defense: null,       // case choisie pour un bouclier / une mine
    effets: [],          // effets de tir à jouer au prochain affichage
  };

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
      partieId, premier, regles: R.normaliser(regles),
      phase: "placement",       // placement → jeu → fin
      navires: [], pret: false, adversairePret: false,
      journal: [],              // toutes les actions des deux joueurs, dans l'ordre
      defense: [],              // mes boucliers et mines (secrets) : {type, x, y, g}
      main: [],                 // mes compétences prêtes à l'emploi
      offres: [],               // tirages de 3 compétences en attente de mon choix
      offresVues: 0,            // compétences gagnées déjà proposées
      flotteAdverse: null, defenseAdverse: null, // révélées à la fin
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
      champsDePartie(aleatoire(8), Math.random() < 0.5 ? "hote" : "invite", profil.reglages)
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
      champsDePartie(aleatoire(8), Math.random() < 0.5 ? "hote" : "invite", profil.reglages)
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
    ui.selection = null; ui.mode = null; ui.cible = null; ui.accueil = false; ui.depuisCoupure = Date.now();
    construireGrilles();
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
        if (P.phase === "placement" && !P.journal.length) {
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
     Petits raccourcis
     ------------------------------------------------------------------ */
  const moi = () => P.role;
  const lui = () => M.autre(P.role);
  const taille = () => P.regles.taille;
  const enAttente = () => P.journal.some((a) => !a.res);
  const monTour = () => P.phase === "jeu" && !enAttente() && M.quiJoue(P.journal, P.premier) === moi();
  const nomAutre = () => P.nomAdverse || "ton ami";
  const deLe = (nom) => (/^[aeiouyhéèêàâîïôöûü]/i.test(nom) ? "d'" : "de ") + nom; // « de Léa », « d'Amiral Vega »

  function texteRegles(r) {
    r = R.normaliser(r);
    const morceaux = [`Carte ${r.taille}×${r.taille}`];
    if (r.competences) morceaux.push("Compétences");
    if (r.bonus) morceaux.push(r.bonus === 1 ? "+1 navire" : "+2 navires");
    if (!r.colles) morceaux.push("navires séparés");
    return morceaux.join(" · ");
  }

  /* ------------------------------------------------------------------
     Messages envoyés à l'ami
     ------------------------------------------------------------------ */
  function envoyer(msg) { if (liaison) liaison.envoyer(msg); }

  function envoyerEtat() {
    envoyer({ t: "etat", partieId: P.partieId, pret: P.pret, nom: profil.nom, id: profil.id, aSaFlotte: !!P.flotteAdverse, chatRecus: P.chatRecus });
  }
  function envoyerFlotte() {
    envoyer({ t: "flotte", partieId: P.partieId, navires: P.navires, defense: P.defense });
  }
  function bienvenue() {
    return { t: "bienvenue", partieId: P.partieId, premier: P.premier, regles: P.regles, nom: profil.nom, id: profil.id };
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
        envoyer(bienvenue());
        envoyerEtat();
        break;

      case "bienvenue": // (invité) l'hôte nous donne les infos de la partie
        P.nomAdverse = texte(msg.nom) || "Ton ami";
        if (identifiant(msg.id)) P.idAdverse = identifiant(msg.id);
        P.adversaireParti = false;
        if (msg.partieId !== P.partieId) {
          Object.assign(P, champsDePartie(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", msg.regles));
          construireGrilles();
        }
        envoyerEtat();
        break;

      case "nouvelle": // (invité) revanche lancée par l'hôte
        if (P.role !== "invite") return;
        Object.assign(P, champsDePartie(String(msg.partieId), msg.premier === "hote" ? "hote" : "invite", msg.regles));
        construireGrilles();
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
          if (P.role === "hote") { envoyer(bienvenue()); envoyerEtat(); }
          else envoyer({ t: "bonjour", jeton: profil.jeton, id: profil.id, nom: profil.nom, partieId: P.partieId });
          return;
        }
        if (msg.nom) P.nomAdverse = texte(msg.nom);
        if (identifiant(msg.id)) P.idAdverse = identifiant(msg.id);
        const avant = P.adversairePret, phaseAvant = P.phase;
        if (msg.pret && !P.adversairePret && P.phase === "placement") toast(P.nomAdverse + " est prêt !");
        P.adversairePret = !!msg.pret;
        verifierDebut();
        // Rattrapage : on renvoie ce qui a pu se perdre (tout est sans risque en double)
        renvoyerEnAttente();
        if (P.phase === "fin" && !msg.aSaFlotte) envoyerFlotte();
        if (P.veuxRevanche) envoyer({ t: "revanche", partieId: P.partieId });
        if (avant === P.adversairePret && phaseAvant === P.phase) { sauver(); return; } // rien de neuf : pas besoin de redessiner
        break;
      }

      case "action": recevoirAction(msg); return;
      case "reponse": recevoirReponse(msg); return;

      case "flotte": {
        if (msg.partieId !== P.partieId || P.phase !== "fin" || P.flotteAdverse) return;
        if (Array.isArray(msg.navires) && R.flotteValide(msg.navires, P.regles)) {
          P.flotteAdverse = msg.navires.map((n) => ({ id: n.id, x: n.x, y: n.y, h: !!n.h }));
          P.defenseAdverse = (Array.isArray(msg.defense) ? msg.defense : []).slice(0, 60)
            .filter((d) => d && ["bouclier", "mine"].includes(d.type) && entier(d.x, 0, taille() - 1) && entier(d.y, 0, taille() - 1) && Number.isInteger(d.g))
            .map((d) => ({ type: d.type, x: d.x, y: d.y, g: d.g }));
        } else {
          P.flotteAdverse = [];
        }
        break;
      }

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
          toast(nomAutre() + " : " + (m.texte.length > 60 ? m.texte.slice(0, 60) + "…" : m.texte));
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

  // J'agis : un tir ou une compétence. defense = case secrète d'un bouclier / d'une mine.
  function envoyerAction(type, p, defense) {
    if (!monTour()) return;
    if (type !== "tir") {
      if (!P.regles.competences || M.stock(P.journal, moi()).dispo < 1) return;
      const i = P.main.indexOf(type);
      if (i < 0) return;
      P.main.splice(i, 1);
    }
    const g = P.journal.length;
    if (defense) P.defense.push({ type: defense.type, x: defense.x, y: defense.y, g });
    P.journal.push({ g, qui: moi(), type, p, res: null });
    ui.mode = null; ui.cible = null;
    Sons.tir();
    envoyer({ t: "action", partieId: P.partieId, g, qui: moi(), type, p });
    // Réseau qui perd un message : on redemande vite, sans attendre le battement de 3 s
    [1200, 2400].forEach((ms) => setTimeout(() => { if (P && P.journal[g] && !P.journal[g].res) renvoyerEnAttente(); }, ms));
    sauver();
    afficher();
  }

  // Toutes mes actions dont la réponse n'est pas (encore) arrivée sont redemandées.
  // Sans risque : l'ami renvoie simplement la même réponse s'il l'avait déjà donnée.
  function renvoyerEnAttente() {
    P.journal.forEach((a) => {
      if (a.qui === moi() && !a.res) envoyer({ t: "action", partieId: P.partieId, g: a.g, qui: a.qui, type: a.type, p: a.p });
    });
  }

  // L'ami agit sur MA flotte : c'est mon téléphone qui calcule le résultat.
  function recevoirAction(msg) {
    if (msg.partieId !== P.partieId) return;
    const deja = P.journal[msg.g];
    if (deja) { // action déjà traitée (message renvoyé après une coupure) : même réponse
      if (deja.qui === lui() && deja.res) envoyer({ t: "reponse", partieId: P.partieId, g: deja.g, res: deja.res });
      return;
    }
    if (P.phase !== "jeu" || enAttente()) return;
    const a = M.actionValide(P.journal, P.regles, P.premier, msg);
    if (!a || a.qui !== lui()) return; // pas son tour, compétence qu'il n'a pas, cible hors carte…
    const e = M.etatDefense(P.navires, P.defense, P.journal, moi(), P.regles);
    a.res = e.resoudre(a);
    P.journal.push(a);
    envoyer({ t: "reponse", partieId: P.partieId, g: a.g, res: a.res });
    raconter(a, false);
    if (a.res.fin) terminer("lui");
    sauver(); afficher();
  }

  // La réponse de l'ami à MON action arrive.
  function recevoirReponse(msg) {
    if (msg.partieId !== P.partieId) return;
    const a = P.journal[msg.g];
    if (!a || a.qui !== moi() || a.res) return; // déjà reçue, ou incohérente
    const res = M.nettoyerRes(msg.res, taille());
    if (!res) return;
    a.res = res;
    const offresAvant = P.offres.length;
    ramasserCompetences();
    raconter(a, true);
    if (res.fin) terminer("moi");
    sauver(); afficher();
    // Nouvelle compétence : on la signale sans ouvrir de fenêtre (pour ne pas couper le joueur en pleine visée)
    if (P.offres.length > offresAvant && P.phase === "jeu") setTimeout(() => { toast("🎁 Nouvelle compétence ! Touche « Choisir » pour la prendre."); Sons.tonTour(); }, 1300);
  }

  // Compétences gagnées (2 tirs à l'eau d'affilée) : on prépare un tirage de 3
  function ramasserCompetences() {
    if (!P.regles.competences) return;
    const s = M.stock(P.journal, moi());
    const mesCoules = M.connaissance(P.journal, lui(), taille()).coules.map((c) => c.id);
    while (P.offresVues < s.gagnees) {
      P.offresVues++;
      P.offres.push(M.tirage(M.reserve(P.regles, mesCoules), 3));
    }
  }

  // Annonces, sons et effets pour une action résolue
  function raconter(a, deMoi) {
    const res = a.res, r = M.resume(res);
    const comp = M.COMPETENCES[a.type];
    const nom = nomAutre();
    res.cases.forEach((c, i) => ui.effets.push({ grille: deMoi ? "adverse" : "moi", x: c.x, y: c.y, type: c.res === "eau" ? "gerbe" : c.res === "bouclier" ? "bloque" : "explosion", delai: 110 * i }));
    if (!deMoi && res.cases.some((c) => c.res === "touche" || c.res === "coule")) ui.secouer = true;
    if (!deMoi && comp) toast(nom + " utilise " + comp.icone + " " + comp.nom + (a.type === "bouclier" ? " quelque part dans sa flotte…" : a.type === "mine" ? " : une case de sa grille est piégée…" : ""));

    if (res.fin) return; // la fin de partie a sa propre annonce
    const lieu = res.cases.length === 1 ? R.nomCase(res.cases[0].x, res.cases[0].y) : "";
    if (r.mot === "coule") {
      Sons.coule();
      annonce(deMoi ? "Coulé !" : "Coulé…", deMoi ? "Tu as coulé son " + R.infoNavire(r.navire).nom.toLowerCase() : nom + " a coulé ton " + R.infoNavire(r.navire).nom.toLowerCase(), "coule");
    } else if (r.mot === "touche") {
      Sons.touche();
      annonce(deMoi ? "Touché !" : "Touché…", (r.nb > 1 ? r.nb + " cases touchées" : deMoi ? lieu : nom + " t'a touché" + (lieu ? " en " + lieu : "")), "touche");
    } else if (r.mot === "bouclier") {
      Sons.eau();
      annonce("Bloqué !", deMoi ? "Un bouclier protège ce navire" : "Ton bouclier a arrêté le tir", "eau");
    } else if (r.mot === "eau") {
      Sons.eau();
      if (r.mine) annonce("Mine !", deMoi ? "Tu perds ton prochain tour" : nom + " a sauté sur ta mine : il passe son tour", "touche");
      else if (deMoi) annonce("À l'eau", lieu || "Rien de touché", "eau");
      else if (!comp) toast(nom + " tire en " + lieu + " : à l'eau.");
    }
    // Informations des compétences de détection
    if (deMoi && res.info) {
      if (a.type === "sonar") toast(`🔊 Sonar : ${res.info.n} case${res.info.n > 1 ? "s" : ""} de navire dans la zone`);
      if (a.type === "radar") toast(`📶 Radar : ${res.info.n} case${res.info.n > 1 ? "s" : ""} de navire sur cette ${a.p.axe}`);
      if (a.type === "grenadage" && Number.isInteger(res.info.n)) toast(`📡 Grenadage : ${res.info.n} case${res.info.n > 1 ? "s" : ""} de navire autour`);
      if (a.type === "periscope") toast(res.info.aucun ? "🔭 Périscope : rien à voir" : "🔭 Périscope : un navire en " + R.nomCase(res.info.x, res.info.y));
    }
    if (deMoi && a.type === "bouclier") toast("🛡️ Bouclier posé : le prochain tir sur cette case sera bloqué.");
    if (deMoi && a.type === "mine") toast("💥 Mine posée. Si " + nom + " tire dessus, il passe son tour.");
    if (res.rejoue) toast(deMoi ? "⚡ Éclair : tu rejoues !" : "⚡ " + nom + " rejoue !");
    if (monTour()) setTimeout(Sons.tonTour, 500);
  }

  function terminer(gagnant) {
    if (P.phase === "fin") return;
    P.phase = "fin";
    P.gagnant = gagnant;
    if (!P.compte) {
      P.compte = true;
      const mesCases = P.journal.filter((a) => a.qui === moi() && a.res).flatMap((a) => a.res.cases.filter((c) => c.res !== "deja"));
      P.nouveauxTrophees = Trophees.enregistrerPartie(profil, {
        gagne: gagnant === "moi",
        tirs: mesCases.length,
        reussis: mesCases.filter((c) => c.res === "touche" || c.res === "coule").length,
        mesCoules: M.connaissance(P.journal, lui(), taille()).coules.length,
        nbNavires: R.flotteDe(P.regles).length,
        totalCases: R.totalCases(P.regles),
        idAdverse: idDuel(),
        nomAdverse: P.nomAdverse,
        solo: !!P.solo,
        niveau: P.solo ? P.solo.niveau : null,
      });
      sauverProfil();
    }
    ui.mode = null; ui.cible = null;
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
    construireGrilles();
    fermerFenetres();
    toast("Revanche ! Place ta flotte.");
    sauver(); afficher();
  }

  /* Vérification d'honnêteté : à la fin, on rejoue toutes nos actions sur la
     flotte révélée de l'ami (avec ses boucliers et mines) et on compare. */
  function verifierHonnetete() {
    if (!P.flotteAdverse) return "En attente de la flotte " + deLe(nomAutre()) + "…";
    if (!P.flotteAdverse.length) return "⚠️ La flotte reçue n'est pas valide.";
    const v = M.verifierDefense(P.flotteAdverse, P.defenseAdverse, P.journal, lui(), P.regles);
    return v.ok ? "✅ Flotte " + deLe(nomAutre()) + " vérifiée : partie loyale." : "⚠️ " + v.raison;
  }

  /* ------------------------------------------------------------------
     Placement de la flotte
     ------------------------------------------------------------------ */
  function navireEn(x, y) {
    return P.navires.find((n) => R.casesDe(n).some((c) => c.x === x && c.y === y));
  }
  function prochainNavireAPlacer() {
    const f = R.flotteDe(P.regles).find((f) => !P.navires.some((n) => n.id === f.id));
    return f ? f.id : null;
  }

  function toucherMaGrille(x, y) {
    if (P.phase !== "placement" || P.pret) return;
    const sous = navireEn(x, y);
    if (sous && sous.id === ui.selection) { pivoter(); return; }       // 2e toucher = pivoter
    if (sous) { ui.selection = sous.id; Sons.clic(); afficher(); return; } // toucher un navire = le prendre
    if (!ui.selection) { ui.selection = prochainNavireAPlacer(); if (!ui.selection) return; }

    const existant = P.navires.find((n) => n.id === ui.selection);
    const candidat = R.recadrer({ id: ui.selection, x, y, h: existant ? existant.h : ui.horizontal }, taille());
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
    const candidat = R.recadrer({ ...n, h: !n.h }, taille());
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
    if (!R.flotteValide(P.navires, P.regles)) { refuser("Place tous tes navires d'abord."); return; }
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
     Construction des grilles (à chaque nouvelle taille de carte)
     ------------------------------------------------------------------ */
  function construireGrille(el, n, auToucher) {
    // Chaque élément reçoit sa place exacte (colonne, ligne) : ainsi les dessins
    // de navires peuvent se poser par-dessus sans décaler les cases.
    const placer = (e, col, lig) => { e.style.gridColumn = col; e.style.gridRow = lig; el.appendChild(e); };
    el.innerHTML = "";
    el.style.setProperty("--n", n);
    el.dataset.taille = n;
    placer(document.createElement("span"), 1, 1);
    for (let x = 0; x < n; x++) {
      const s = document.createElement("span"); s.className = "repere"; s.textContent = R.LETTRES[x]; placer(s, x + 2, 1);
    }
    const cases = [];
    for (let y = 0; y < n; y++) {
      const s = document.createElement("span"); s.className = "repere"; s.textContent = y + 1; placer(s, 1, y + 2);
      for (let x = 0; x < n; x++) {
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
    return (x, y) => cases[y * n + x];
  }

  let caseMoi = () => null, caseAdverse = () => null, caseDefense = () => null;
  let tailleConstruite = 0;
  function construireGrilles() {
    if (!P) return;
    const n = taille();
    if (n === tailleConstruite) return;
    tailleConstruite = n;
    caseMoi = construireGrille($("#grille-moi"), n, toucherMaGrille);
    caseAdverse = construireGrille($("#grille-adverse"), n, toucherGrilleAdverse);
    caseDefense = construireGrille($("#grille-defense"), n, toucherGrilleDefense);
  }

  /* ------------------------------------------------------------------
     Viser : tir normal ou compétence
     ------------------------------------------------------------------ */
  const DIRECTIONS_TORPILLE = [
    { axe: "ligne", sens: 1, texte: "depuis la gauche →" },
    { axe: "ligne", sens: -1, texte: "depuis la droite ←" },
    { axe: "colonne", sens: 1, texte: "depuis le haut ↓" },
    { axe: "colonne", sens: -1, texte: "depuis le bas ↑" },
  ];
  const typeCible = () => (ui.mode ? M.COMPETENCES[ui.mode].cible : "case");

  // Paramètres de l'action à partir de ce que le joueur a visé (ou null si incomplet)
  function paramsVises() {
    const c = ui.cible;
    if (typeCible() === "aucune") return {};
    if (!c) return null;
    switch (typeCible()) {
      case "case": case "zone3": case "carre2": return c.x != null ? { x: c.x, y: c.y } : null;
      case "raid": return c.x != null ? { x: c.x, y: c.y, h: c.h !== false } : null;
      case "deux": return c.cases && c.cases.length === 2 ? { cases: c.cases } : null;
      case "axe": return c.x != null ? { axe: c.axe || "ligne", index: (c.axe || "ligne") === "ligne" ? c.y : c.x } : null;
      case "torpille": {
        if (c.x == null) return null;
        const d = DIRECTIONS_TORPILLE[c.dir || 0];
        return { axe: d.axe, index: d.axe === "ligne" ? c.y : c.x, sens: d.sens };
      }
      default: return null;
    }
  }

  // Cases à surligner pendant la visée
  function casesApercu() {
    const t = ui.mode || "tir", n = taille();
    const p = paramsVises();
    if (!p) return ui.cible && ui.cible.cases ? ui.cible.cases : [];
    const propres = M.normaliserParams(t, p, n);
    if (!propres) return [];
    if (["sonar", "radar", "torpille"].includes(t)) return M.zoneExaminee(t, propres, n);
    return M.casesVisees(t, propres, n);
  }

  function toucherGrilleAdverse(x, y) {
    if (!P || P.phase !== "jeu") return;
    if (!monTour()) { toast(enAttente() ? "Résultat en cours…" : "Patience, c'est au tour de " + nomAutre() + "."); return; }
    const etat = M.connaissance(P.journal, moi(), taille()).grille[y * taille() + x];
    const dejaVisee = etat === "eau" || etat === "touche" || etat === "coule";
    const cible = typeCible();
    const meme = ui.cible && ui.cible.x === x && ui.cible.y === y;
    if (cible === "case") {
      if (dejaVisee) { toast("Tu as déjà tiré en " + R.nomCase(x, y) + "."); return; }
      if (meme) { tirerVisee(); return; } // 2e toucher = feu
      ui.cible = Object.assign(ui.cible || {}, { x, y });
    } else if (cible === "deux") {
      if (dejaVisee) { toast("Tu as déjà tiré en " + R.nomCase(x, y) + "."); return; }
      const liste = (ui.cible && ui.cible.cases) || [];
      const i = liste.findIndex((c) => c.x === x && c.y === y);
      if (i >= 0) liste.splice(i, 1); else { liste.push({ x, y }); if (liste.length > 2) liste.shift(); }
      ui.cible = { cases: liste };
    } else if (cible === "aucune") {
      return;
    } else {
      if (meme) { tirerVisee(); return; }
      ui.cible = Object.assign(ui.cible || {}, { x, y });
    }
    Sons.clic();
    afficher();
  }

  function tirerVisee() {
    const type = ui.mode || "tir";
    const p = M.normaliserParams(type, paramsVises(), taille());
    if (!p) { toast("Choisis d'abord ta cible."); return; }
    envoyerAction(type, p);
  }

  function choisirCompetence(id) {
    if (!monTour()) { toast("Tu pourras l'utiliser à ton tour."); return; }
    const comp = M.COMPETENCES[id];
    if (ui.mode === id) { ui.mode = null; ui.cible = null; afficher(); return; } // 2e toucher = annuler
    if (comp.cible === "maNavire" || comp.cible === "maCaseVide") { ouvrirDefense(id); return; }
    ui.mode = id;
    ui.cible = { h: true, axe: "ligne", dir: 0, cases: [] };
    Sons.clic();
    afficher();
  }

  function changerSens() {
    if (!ui.cible) ui.cible = {};
    const t = typeCible();
    if (t === "raid") ui.cible.h = ui.cible.h === false;
    else if (t === "axe") ui.cible.axe = ui.cible.axe === "colonne" ? "ligne" : "colonne";
    else if (t === "torpille") ui.cible.dir = ((ui.cible.dir || 0) + 1) % 4;
    Sons.clic();
    afficher();
  }

  // Bouclier et mine : on choisit une case de SA grille, dans une fenêtre
  function ouvrirDefense(type) {
    ui.defense = { type, x: null, y: null };
    const comp = M.COMPETENCES[type];
    $("#defense-titre").textContent = comp.icone + " " + comp.nom;
    $("#defense-aide").textContent = type === "bouclier" ? "Touche une case intacte d'un de tes navires." : "Touche une case vide de ta grille (où l'ami n'a pas encore tiré).";
    fermerFenetres();
    $("#fenetre-defense").showModal();
    dessinerDefense();
  }
  function toucherGrilleDefense(x, y) {
    if (!ui.defense) return;
    const e = M.etatDefense(P.navires, P.defense, P.journal, moi(), P.regles);
    if (!e.defensePossible(ui.defense.type, x, y)) {
      toast(ui.defense.type === "bouclier" ? "Choisis une case intacte d'un de tes navires." : "Choisis une case vide, pas encore visée.");
      return;
    }
    ui.defense.x = x; ui.defense.y = y;
    Sons.clic();
    dessinerDefense();
  }
  function dessinerDefense() {
    const d = ui.defense;
    peindreMaFlotte($("#grille-defense"), caseDefense, P.journal, { sansDernier: true });
    if (d && d.x != null) caseDefense(d.x, d.y).classList.add("vise");
    $("#btn-defense-ok").disabled = !(d && d.x != null);
  }
  function confirmerDefense() {
    const d = ui.defense;
    if (!d || d.x == null) return;
    $("#fenetre-defense").close();
    envoyerAction(d.type, {}, d);
  }

  // Le tirage de 3 compétences : on en garde une
  function ouvrirOffre() {
    if (!P || !P.offres.length || P.phase === "fin") return;
    if (document.querySelector("dialog[open]")) return; // on ne coupe pas une autre fenêtre
    const liste = $("#liste-offre");
    liste.innerHTML = "";
    P.offres[0].forEach((id) => {
      const c = M.COMPETENCES[id];
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "carte-competence";
      b.dataset.competence = id;
      b.innerHTML = `<span class="trophee-icone"></span><span><strong></strong><small></small></span>`;
      b.querySelector(".trophee-icone").textContent = c.icone;
      b.querySelector("strong").textContent = c.nom + (c.navire ? " · " + R.infoNavire(c.navire).nom : "");
      b.querySelector("small").textContent = c.desc;
      b.addEventListener("click", () => {
        P.offres.shift();
        P.main.push(id);
        Sons.clic();
        $("#fenetre-offre").close();
        toast(c.icone + " " + c.nom + " ajouté à tes compétences.");
        sauver(); afficher();
        if (P.offres.length) setTimeout(ouvrirOffre, 400);
      });
      li.appendChild(b);
      liste.appendChild(li);
    });
    $("#fenetre-offre").showModal();
    Sons.tonTour();
  }

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
    construireGrilles();
    ecrans.accueil.hidden = true; ecrans.jeu.hidden = false;
    afficherReseau();
    afficherBandeau();
    afficherMaGrille();
    afficherGrilleAdverse();
    afficherOutils();
    afficherCompetences();
    jouerEffets();
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
    afficherReglages();
    $("#hors-ligne").hidden = navigator.onLine;
  }

  // Réglages de la nouvelle partie (mode, carte, navires bonus, navires collés)
  function afficherReglages() {
    const r = profil.reglages;
    document.querySelectorAll("#choix-mode button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mode === "competences") === r.competences)));
    document.querySelectorAll("#choix-carte button").forEach((b) => {
      const n = Number(b.dataset.taille);
      b.setAttribute("aria-pressed", String(n === r.taille));
      b.disabled = r.competences && !R.TAILLES_COMPETENCES.includes(n);
    });
    document.querySelectorAll("#choix-bonus button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.bonus) === r.bonus)));
    const colles = $("#opt-colles");
    const forcer = !R.reglesJouables(Object.assign({}, r, { colles: false }));
    colles.checked = r.colles || forcer;
    colles.disabled = forcer;
    $("#note-reglages").textContent = r.competences
      ? "Mode Compétences : carte de 12 ou 14. Deux tirs à l'eau d'affilée = une compétence à choisir."
      : forcer ? "Sur une carte de 8 avec des navires bonus, les navires peuvent se toucher (sinon ils ne rentrent pas)." : "";
    $("#resume-flotte").textContent = "Flotte : " + R.flotteDe(r).map((n) => `${n.nom} ${n.long}×${n.larg}`).join(" · ") + ` (${R.totalCases(r)} cases)`;
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
    else if (ui.reseau === "connecte") { txt = "En ligne avec " + nomAutre(); pastille.classList.add("ok"); }
    else if (ui.reseau === "attente") txt = P.nomAdverse ? "En attente du retour de " + P.nomAdverse + "…" : "En attente de ton ami…";
    else if (ui.reseau === "coupe") { txt = ui.detailReseau || "Connexion perdue, on réessaie…"; pastille.classList.add("ko"); }
    else if (ui.reseau === "erreur") { txt = ui.detailReseau || "Erreur réseau"; pastille.classList.add("ko"); }
    else txt = ui.detailReseau || "Connexion…";
    $("#texte-reseau").textContent = txt + "  ·  " + P.code;

    const invitation = P.role === "hote" && !P.jetonInvite;
    $("#bloc-invitation").hidden = !invitation;
    $("#code-partie").textContent = P.code;
    $("#regles-invitation").textContent = texteRegles(P.regles);

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
    return `Toi ${sc.v} – ${sc.d} ${nomAutre()}`;
  }

  function afficherBandeau() {
    const titre = $("#bandeau-titre"), detail = $("#bandeau-detail"), bandeau = $("#bandeau");
    const score = texteScore();
    $("#score-duel").hidden = !score || P.phase === "jeu";
    $("#score-duel").textContent = score;
    bandeau.classList.toggle("mon-tour", monTour());
    const autre = nomAutre();
    if (P.phase === "arrivee") { titre.textContent = "Connexion à la partie"; detail.textContent = "Code " + P.code; }
    else if (P.phase === "placement" && !P.pret) {
      titre.textContent = "Place ta flotte";
      detail.textContent = P.adversairePret ? autre + " est prêt et t'attend." : texteRegles(P.regles);
    } else if (P.phase === "placement") {
      titre.textContent = "Flotte prête";
      detail.textContent = P.nomAdverse ? autre + " place sa flotte…" : "On attend ton ami…";
    } else if (P.phase === "jeu") {
      if (monTour()) {
        titre.textContent = ui.mode ? M.COMPETENCES[ui.mode].icone + " " + M.COMPETENCES[ui.mode].nom : "À toi de tirer";
        detail.textContent = aideVisee();
      } else if (enAttente()) { titre.textContent = "Tir en cours…"; detail.textContent = ""; }
      else { titre.textContent = "Tour de " + autre; detail.textContent = autre + " cherche ta flotte…"; }
    } else if (P.phase === "fin") {
      titre.textContent = P.gagnant === "moi" ? "Victoire !" : "Défaite";
      detail.textContent = P.veuxRevanche && !P.ilVeutRevanche ? "En attente de " + autre + " pour la revanche…" : "";
    }
  }

  function aideVisee() {
    const t = typeCible(), c = ui.cible || {};
    const nom = (x, y) => R.nomCase(x, y);
    switch (t) {
      case "case": return c.x != null ? "Cible : " + nom(c.x, c.y) + " — touche encore pour tirer" : "Choisis une case dans les eaux ennemies";
      case "deux": return `Choisis 2 cases (${(c.cases || []).length}/2)`;
      case "raid": return c.x != null ? "3 cases " + (c.h === false ? "en colonne" : "en ligne") + " — « Sens » pour tourner" : "Touche la case de départ du raid";
      case "carre2": return c.x != null ? "Carré de 2 × 2 à partir de " + nom(c.x, c.y) : "Touche le coin du carré à bombarder";
      case "zone3": return c.x != null ? "Zone de 3 × 3 autour de " + nom(c.x, c.y) : "Touche le centre de la zone à sonder";
      case "axe": return c.x != null ? "Radar sur la " + (c.axe === "colonne" ? "colonne " + R.LETTRES[c.x] : "ligne " + (c.y + 1)) + " — « Sens » pour changer" : "Touche une case de la ligne à scanner";
      case "torpille": return c.x != null ? "Torpille " + DIRECTIONS_TORPILLE[c.dir || 0].texte + " — « Sens » pour changer" : "Touche une case de la ligne visée";
      case "aucune": return "Touche « Lancer » pour utiliser le périscope";
      default: return "";
    }
  }

  // Petite marque (chiffre, icône) posée sur une case
  function marque(caseEl, texteMarque, classe) {
    if (!caseEl) return;
    const s = document.createElement("span");
    s.className = "marque-case " + (classe || "");
    s.textContent = texteMarque;
    caseEl.appendChild(s);
  }

  /* Dessine MA flotte sur une grille (jeu, fenêtre bouclier/mine, replay) */
  function peindreMaFlotte(el, acces, journal, options) {
    const n = taille(), opts = options || {};
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) acces(x, y).className = "case";
    el.querySelectorAll(".silhouette, .marque-case").forEach((e) => e.remove());
    const etat = M.connaissance(journal, lui(), n);
    const coules = new Set(etat.coules.map((c) => c.id));
    P.navires.forEach((nav) => {
      R.casesDe(nav).forEach((c) => acces(c.x, c.y).classList.add("nav"));
      const classes = (nav.id === ui.selection && P.phase === "placement" ? "choisi " : "") + (coules.has(nav.id) ? "coule" : "");
      el.appendChild(Navires.element(nav, classes));
    });
    etat.grille.forEach((v, i) => {
      if (!v) return;
      const c = acces(i % n, Math.floor(i / n));
      c.classList.add(v === "eau" ? "eau" : v === "bouclier" ? "bloque" : "touche");
      if (v === "coule") c.classList.add("coule");
    });
    etat.infos.filter((f) => f.type === "mine").forEach((f) => marque(acces(f.x, f.y), "💥", "mine-sautee"));
    // Mes défenses encore actives
    if (!opts.sansDefense) {
      const e = M.etatDefense(P.navires, P.defense, journal, moi(), P.regles);
      e.boucliers.forEach((k) => { const [x, y] = k.split(",").map(Number); acces(x, y).classList.add("protege"); });
      e.mines.forEach((k) => { const [x, y] = k.split(",").map(Number); marque(acces(x, y), "💣", "mine-posee"); });
    }
    // Dernière action de l'ami
    const derniere = [...journal].reverse().find((a) => a.qui === lui() && a.res);
    if (derniere && !opts.sansDernier) derniere.res.cases.forEach((c) => acces(c.x, c.y).classList.add("dernier"));
    return etat;
  }

  /* Dessine ce que je sais de la grille de l'ami */
  function peindreGrilleAdverse(el, acces, journal, options) {
    const n = taille(), opts = options || {};
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) acces(x, y).className = "case";
    el.querySelectorAll(".silhouette, .marque-case").forEach((e) => e.remove());
    const etat = M.connaissance(journal, moi(), n);
    const coulesIds = new Set();
    etat.coules.forEach((c) => {
      if (!c.cases.length || coulesIds.has(c.id)) return;
      coulesIds.add(c.id);
      const xs = c.cases.map((k) => k.x), ys = c.cases.map((k) => k.y);
      const larg = Math.max(...xs) - Math.min(...xs) + 1, haut = Math.max(...ys) - Math.min(...ys) + 1;
      el.appendChild(Navires.element({ id: c.id, x: Math.min(...xs), y: Math.min(...ys), h: larg >= haut }, "coule"));
      c.cases.forEach((k) => acces(k.x, k.y).classList.add("nav"));
    });
    // Fin de partie : les navires ennemis rescapés apparaissent en transparence
    if (opts.flotte) {
      opts.flotte.filter((nav) => !coulesIds.has(nav.id)).forEach((nav) => {
        el.appendChild(Navires.element(nav, "revele"));
        R.casesDe(nav).forEach((c) => acces(c.x, c.y).classList.add("nav"));
      });
    }
    etat.grille.forEach((v, i) => {
      if (!v) return;
      const c = acces(i % n, Math.floor(i / n));
      c.classList.add(v === "eau" ? "eau" : v === "bouclier" ? "bloque" : "touche");
      if (v === "coule") c.classList.add("coule");
    });
    etat.indices.forEach((c) => acces(c.x, c.y).classList.add("indice"));
    etat.infos.forEach((f) => {
      if (f.type === "mine") marque(acces(f.x, f.y), "💥", "mine-sautee");
      else if (f.type === "sonar") marque(acces(f.zone[4].x, f.zone[4].y), f.n, "info-sonar");
      else if (f.type === "grenadage") marque(acces(f.zone[0].x, f.zone[0].y), f.n, "info-grenade");
      else if (f.type === "radar") marque(acces(f.zone[0].x, f.zone[0].y), f.n, "info-radar");
    });
    // Actions qui attendent leur réponse
    journal.filter((a) => a.qui === moi() && !a.res).forEach((a) => M.casesVisees(a.type, a.p, n).forEach((c) => acces(c.x, c.y).classList.add("attente")));
    const derniere = [...journal].reverse().find((a) => a.qui === moi() && a.res);
    if (derniere && !opts.sansDernier) derniere.res.cases.forEach((c) => acces(c.x, c.y).classList.add("dernier"));
    return etat;
  }

  function afficherMaGrille() {
    const bataille = P.phase === "jeu" || P.phase === "fin";
    ecrans.jeu.classList.toggle("mode-bataille", bataille);
    $("#titre-ma-grille").textContent = bataille ? "Ta flotte" : "Ta grille";
    $("#grille-moi").classList.toggle("verrouillee", P.pret && P.phase === "placement");
    const etat = peindreMaFlotte($("#grille-moi"), caseMoi, P.journal, { sansDernier: !bataille });
    const touches = etat.grille.filter((v) => v === "touche" || v === "coule").length;
    $("#mes-degats").textContent = bataille ? `${touches}/${R.totalCases(P.regles)}` : "";
    if (ui.secouer) { ui.secouer = false; secouer($("#grille-moi")); }
  }

  function afficherGrilleAdverse() {
    const bataille = P.phase === "jeu" || P.phase === "fin";
    $("#zone-adverse").hidden = !bataille;
    $("#zone-suivi").hidden = !bataille;
    if (!bataille) return;
    const flotte = P.phase === "fin" && P.flotteAdverse && P.flotteAdverse.length ? P.flotteAdverse : null;
    const etat = peindreGrilleAdverse($("#grille-adverse"), caseAdverse, P.journal, { flotte });
    if (monTour()) casesApercu().forEach((c) => { const el = caseAdverse(c.x, c.y); if (el) el.classList.add("vise"); });

    const nb = P.journal.filter((a) => a.qui === moi()).length;
    $("#compteur-tirs").textContent = nb ? nb + " tour" + (nb > 1 ? "s" : "") : "";

    const suivi = $("#suivi-flotte");
    suivi.innerHTML = "";
    const coules = new Set(etat.coules.map((c) => c.id));
    R.flotteDe(P.regles).forEach((f) => {
      const li = document.createElement("li");
      if (coules.has(f.id)) li.className = "coule";
      li.appendChild(Navires.icone(f.id));
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
      R.flotteDe(P.regles).forEach((f) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        if (P.navires.some((n) => n.id === f.id)) b.classList.add("pose");
        if (ui.selection === f.id) b.classList.add("choisi");
        b.appendChild(Navires.icone(f.id));
        b.appendChild(document.createTextNode(`${f.nom} ${f.long}×${f.larg}`));
        b.addEventListener("click", () => { ui.selection = ui.selection === f.id ? null : f.id; Sons.debloquer(); afficher(); });
        li.appendChild(b);
        quai.appendChild(li);
      });
      $("#btn-pret").disabled = !R.flotteValide(P.navires, P.regles);
    }

    $("#barre-tir").hidden = !(P.phase === "jeu" || P.phase === "fin");
    const feu = $("#btn-feu");
    if (P.phase === "fin") {
      feu.disabled = false; feu.textContent = "Voir le résultat";
    } else if (monTour()) {
      const p = M.normaliserParams(ui.mode || "tir", paramsVises(), taille());
      feu.disabled = !p;
      if (ui.mode) feu.textContent = p ? "Lancer " + M.COMPETENCES[ui.mode].nom + " !" : "Choisis ta cible";
      else feu.textContent = p ? "Feu sur " + R.nomCase(p.x, p.y) + " !" : "Choisis une case";
    } else {
      feu.disabled = true; feu.textContent = enAttente() ? "Tir en cours…" : "Tour de " + nomAutre();
    }
  }

  // La barre des compétences (mode Compétences seulement)
  function afficherCompetences() {
    const barre = $("#barre-competences");
    const actif = P.regles.competences && P.phase === "jeu";
    barre.hidden = !actif;
    if (!actif) return;
    const zone = $("#main-competences");
    zone.innerHTML = "";
    const s = M.stock(P.journal, moi());
    P.main.forEach((id) => {
      const c = M.COMPETENCES[id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "jeton-competence" + (ui.mode === id ? " actif" : "");
      b.dataset.competence = id;
      b.textContent = c.icone + " " + c.nom;
      b.title = c.desc;
      b.disabled = !monTour();
      b.addEventListener("click", () => choisirCompetence(id));
      zone.appendChild(b);
    });
    if (P.offres.length) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "jeton-competence cadeau";
      b.id = "btn-offre";
      b.textContent = "🎁 Choisir" + (P.offres.length > 1 ? " (" + P.offres.length + ")" : "");
      b.addEventListener("click", ouvrirOffre);
      zone.appendChild(b);
    }
    const jauge = document.createElement("span");
    jauge.className = "jauge-eau";
    const plein = P.main.length + P.offres.length >= M.STOCK_MAX;
    jauge.textContent = plein ? "Réserve pleine (2/2)" : "💧 " + s.serie + "/2 à l'eau";
    jauge.title = "Deux tirs à l'eau d'affilée = une compétence";
    zone.appendChild(jauge);
    const t = typeCible();
    $("#outils-competence").hidden = !ui.mode;
    $("#btn-sens").hidden = !["raid", "axe", "torpille"].includes(t);
    $("#aide-competence").textContent = ui.mode ? M.COMPETENCES[ui.mode].desc : "";
    $("#aide-competence").hidden = !ui.mode;
  }

  // Effets de tir en attente : on les joue une fois la grille redessinée
  function jouerEffets() {
    const liste = ui.effets.splice(0);
    liste.forEach((f) => setTimeout(() => effet((f.grille === "moi" ? caseMoi : caseAdverse)(f.x, f.y), f.type), f.delai));
  }

  /* ------------------------------------------------------------------
     Fenêtres, annonces, petits messages
     ------------------------------------------------------------------ */
  function ouvrirFin() {
    if (!P || P.phase !== "fin") return;
    const gagne = P.gagnant === "moi";
    const mesCases = P.journal.filter((a) => a.qui === moi() && a.res).flatMap((a) => a.res.cases.filter((c) => c.res !== "deja"));
    const reussis = mesCases.filter((c) => c.res === "touche" || c.res === "coule").length;
    $("#fin-icone").textContent = gagne ? "🏆" : "⚓";
    $("#fin-titre").textContent = gagne ? "Victoire !" : "Défaite";
    $("#fin-texte").textContent = gagne ? "Tu as coulé toute la flotte " + deLe(nomAutre()) + "." : P.nomAdverse + " a coulé toute ta flotte.";
    $("#fin-tirs").textContent = mesCases.length;
    $("#fin-precision").textContent = (mesCases.length ? Math.round((100 * reussis) / mesCases.length) : 0) + " %";
    $("#fin-coules").textContent = M.connaissance(P.journal, moi(), taille()).coules.length + "/" + R.flotteDe(P.regles).length;
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
    if (!f.open) { fermerFenetres(); f.showModal(); }
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
    $("#chat-titre").textContent = "Discussion avec " + nomAutre();
    const fil = $("#fil-chat");
    fil.innerHTML = "";
    if (!P.chat.length) {
      const vide = document.createElement("li");
      vide.className = "chat-vide";
      vide.textContent = P.nomAdverse ? "Dis bonjour à " + P.nomAdverse + " 👋" : "Tes messages partiront dès que ton ami aura rejoint.";
      fil.appendChild(vide);
    }
    P.chat.forEach((m) => {
      const li = document.createElement("li");
      li.className = "msg " + m.de;
      const bulleTexte = document.createElement("p");
      bulleTexte.textContent = m.texte;            // textContent : le texte de l'ami ne peut pas injecter de code
      const info = document.createElement("time");
      const suivi = m.de !== "moi" ? "" : m.n < (P.chatConfirmes || 0) ? " · ✓ reçu" : " · ⏳";
      info.textContent = heure(m.h) + suivi;
      li.append(bulleTexte, info);
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

  function envoyerChat(texteMsg) {
    const msg = Discussion.ecrire(P, texteMsg);
    if (!msg) return;
    envoyer(msg);
    Sons.clic();
    sauver();
    afficherChat(true);
  }

  /* ------------------------------------------------------------------
     Effets de tir : gerbe d'eau (raté), explosion (touché), bouclier
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
     Replay : on rejoue la partie action par action, les deux flottes visibles
     ------------------------------------------------------------------ */
  let caseReplayMoi = () => null, caseReplayLui = () => null;
  const replay = { seq: [], pos: 0, minuteur: null };

  function dessinerReplay() {
    const k = replay.pos;
    const journal = replay.seq.slice(0, k);
    peindreMaFlotte($("#replay-moi"), caseReplayMoi, journal, { sansDefense: true });
    const flotte = P.flotteAdverse && P.flotteAdverse.length ? P.flotteAdverse : null;
    peindreGrilleAdverse($("#replay-lui"), caseReplayLui, journal, { flotte });
    const dernier = journal[k - 1];
    let legende = "Début de la partie";
    if (dernier) {
      const acces = dernier.qui === moi() ? caseReplayLui : caseReplayMoi;
      dernier.res.cases.forEach((c, i) => setTimeout(() => effet(acces(c.x, c.y), c.res === "eau" ? "gerbe" : c.res === "bouclier" ? "bloque" : "explosion"), 80 * i));
      const qui = dernier.qui === moi() ? "Toi" : nomAutre();
      const comp = M.COMPETENCES[dernier.type];
      const r = M.resume(dernier.res);
      const mots = { coule: "coulé !", touche: "touché", eau: "à l'eau", bouclier: "bloqué par un bouclier", info: "" };
      const ou = dernier.res.cases.length === 1 ? " en " + R.nomCase(dernier.res.cases[0].x, dernier.res.cases[0].y) : "";
      legende = comp ? `${qui} : ${comp.icone} ${comp.nom}${r.mot !== "info" ? " — " + mots[r.mot] : ""}` : `${qui} tire${ou} : ${mots[r.mot]}`;
      if (r.mine) legende += " (mine !)";
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
    caseReplayMoi = construireGrille($("#replay-moi"), taille(), null);
    caseReplayLui = construireGrille($("#replay-lui"), taille(), null);
    replay.seq = P.journal.filter((a) => a.res);
    replay.pos = 0;
    $("#replay-titre-lui").textContent = "Flotte " + deLe(nomAutre());
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
    minuteurToast = setTimeout(() => el.classList.remove("visible"), 2800);
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
    const message = `${profil.nom || "Ton ami"} te défie à la bataille navale sur Escadre (${texteRegles(P.regles)}) ! Code : ${P.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Escadre", text: message, url: lien }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copier(message + "\n" + lien);
  }

  async function copier(t) {
    try { await navigator.clipboard.writeText(t); toast("Copié !"); }
    catch (e) { toast("Code : " + P.code); }
  }

  // Règles : la liste des compétences, générée à partir du moteur
  function remplirRegles() {
    const ul = $("#liste-competences-regles");
    ul.innerHTML = "";
    Object.values(M.COMPETENCES).forEach((c) => {
      const li = document.createElement("li");
      const b = document.createElement("strong");
      b.textContent = c.icone + " " + c.nom + (c.navire ? " (" + R.infoNavire(c.navire).nom.toLowerCase() + ")" : "") + " : ";
      li.append(b, document.createTextNode(c.desc));
      ul.appendChild(li);
    });
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
  // Réglages de la partie
  function reglerPartie(changement) {
    profil.reglages = R.normaliser(Object.assign({}, profil.reglages, changement));
    if (!R.reglesJouables(profil.reglages)) profil.reglages.colles = true;
    sauverProfil(); afficherReglages();
  }
  $("#choix-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b) reglerPartie({ competences: b.dataset.mode === "competences" });
  });
  $("#choix-carte").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-taille]");
    if (b && !b.disabled) reglerPartie({ taille: Number(b.dataset.taille) });
  });
  $("#choix-bonus").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bonus]");
    if (b) reglerPartie({ bonus: Number(b.dataset.bonus) });
  });
  $("#opt-colles").addEventListener("change", (e) => reglerPartie({ colles: e.target.checked }));
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
    tirerVisee();
  });
  $("#btn-sens").addEventListener("click", changerSens);
  $("#btn-annuler-comp").addEventListener("click", () => { ui.mode = null; ui.cible = null; afficher(); });
  $("#btn-defense-ok").addEventListener("click", confirmerDefense);
  $("#fenetre-defense").addEventListener("close", () => { ui.defense = null; });
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
  remplirRegles();
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
