/* ==========================================================================
   Escadre — la DISCUSSION (logique seulement, sans affichage)
   --------------------------------------------------------------------------
   Problème : sur un téléphone, un message peut se perdre en route.
   Solution : chaque message envoyé porte un numéro (0, 1, 2…).
   - Celui qui reçoit n'accepte que le numéro qu'il attend : pas de doublon,
     et les messages restent dans l'ordre.
   - Toutes les 3 s, chaque joueur dit à l'autre « j'ai reçu N de tes
     messages ». L'autre renvoie alors ceux qui manquent.
   La discussion est gardée d'une manche à l'autre (revanches comprises).
   ========================================================================== */
(function (racine) {
  "use strict";

  const LONGUEUR_MAX = 200;   // caractères par message
  const HISTORIQUE_MAX = 200; // messages gardés en mémoire

  // Ajoute les champs de discussion à une partie (aussi pour les parties
  // enregistrées par une ancienne version de l'appli).
  function initialiser(P) {
    if (!Array.isArray(P.chat)) P.chat = [];
    if (!Number.isInteger(P.chatEnvoyes)) P.chatEnvoyes = 0;
    if (!Number.isInteger(P.chatRecus)) P.chatRecus = 0;
    if (!Number.isInteger(P.chatConfirmes)) P.chatConfirmes = 0; // combien de mes messages l'ami a reçus
    return P;
  }

  // Remet tout à zéro (quand un nouvel ami prend la place de l'invité)
  function vider(P) {
    P.chat = []; P.chatEnvoyes = 0; P.chatRecus = 0; P.chatConfirmes = 0;
  }

  function nettoyer(texte) {
    if (typeof texte !== "string") return "";
    return texte.replace(/\s+/g, " ").trim().slice(0, LONGUEUR_MAX);
  }

  function limiter(P) {
    // On ne retire que des messages déjà confirmés, jamais un message encore à livrer.
    while (P.chat.length > HISTORIQUE_MAX) P.chat.shift();
  }

  /* J'écris un message : on le range et on renvoie ce qu'il faut envoyer
     (ou null si le message est vide). */
  function ecrire(P, texte, maintenant) {
    const t = nettoyer(texte);
    if (!t) return null;
    const n = P.chatEnvoyes++;
    P.chat.push({ de: "moi", n, texte: t, h: maintenant || Date.now() });
    limiter(P);
    return { t: "chat", n, texte: t };
  }

  /* Un message arrive. Renvoie le message ajouté, ou null (doublon, désordre, invalide). */
  function recevoir(P, msg, maintenant) {
    if (!msg || !Number.isInteger(msg.n) || msg.n !== P.chatRecus) return null;
    const t = nettoyer(msg.texte);
    if (!t) return null;
    P.chatRecus++;
    const ajoute = { de: "lui", n: msg.n, texte: t, h: maintenant || Date.now() };
    P.chat.push(ajoute);
    limiter(P);
    return ajoute;
  }

  /* L'ami dit avoir reçu « recusParLui » de mes messages : lesquels renvoyer ? */
  function aRenvoyer(P, recusParLui, maximum) {
    if (!Number.isInteger(recusParLui) || recusParLui >= P.chatEnvoyes) return [];
    return P.chat
      .filter((m) => m.de === "moi" && m.n >= recusParLui)
      .slice(0, maximum || 5)
      .map((m) => ({ t: "chat", n: m.n, texte: m.texte }));
  }

  const api = { initialiser, vider, ecrire, recevoir, aRenvoyer, LONGUEUR_MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.Discussion = api;
})(this);
