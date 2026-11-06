/* ==========================================================================
   Escadre — le RÉSEAU (relier deux téléphones)
   --------------------------------------------------------------------------
   Comment ça marche, en simple :
   - Le joueur qui crée la partie (l'« hôte ») réserve un nom unique
     « escadre-v1-CODE » sur le serveur gratuit de PeerJS.
   - Son ami tape le CODE : son téléphone demande au serveur où est l'hôte,
     puis les deux téléphones se parlent DIRECTEMENT (technologie WebRTC).
   - Le serveur sert seulement à se trouver : il ne voit pas la partie.

   Ce fichier gère aussi les coupures (métro, appli mise en arrière-plan) :
   un « battement de cœur » (ping) toutes les 4 s détecte une connexion morte,
   puis l'invité se reconnecte tout seul.

   Astuce test : ajoute « ?local=1 » à l'adresse pour jouer dans deux onglets
   du même ordinateur, sans Internet (BroadcastChannel au lieu de PeerJS).
   ========================================================================== */
(function (racine) {
  "use strict";

  const PREFIXE = "escadre-v1-";
  const PING_MS = 4000;          // envoi d'un ping toutes les 4 secondes
  const SILENCE_MAX_MS = 15000;  // sans nouvelles depuis 15 s = connexion morte

  /* --- Petit outil : un objet qui peut émettre des événements --- */
  function Emetteur() {
    const ecouteurs = {};
    return {
      on(nom, fn) { (ecouteurs[nom] = ecouteurs[nom] || []).push(fn); return this; },
      emit(nom, ...args) { (ecouteurs[nom] || []).forEach((fn) => fn(...args)); },
    };
  }

  /* --- Faux PeerJS pour tester dans deux onglets (mode ?local=1) --- */
  function FauxPeer(id) {
    const moi = Object.assign(Emetteur(), { id: id || "local-" + Math.random().toString(36).slice(2, 9), open: false });
    const canal = new BroadcastChannel("escadre-local");
    const connexions = {};

    function nouvelleConn(cid, distant) {
      const c = Object.assign(Emetteur(), {
        open: false, peer: distant,
        send(data) { if (c.open) canal.postMessage({ type: "data", cid, de: moi.id, a: distant, data }); },
        close() {
          if (!connexions[cid]) return;
          delete connexions[cid];
          canal.postMessage({ type: "close", cid, de: moi.id, a: distant });
          c.open = false; c.emit("close");
        },
      });
      connexions[cid] = c;
      return c;
    }

    canal.onmessage = (e) => {
      const m = e.data;
      if (m.a !== moi.id) return;
      const c = connexions[m.cid];
      if (m.type === "connect") {
        const conn = nouvelleConn(m.cid, m.de);
        moi.emit("connection", conn);
        conn.open = true;
        canal.postMessage({ type: "connect-ok", cid: m.cid, de: moi.id, a: m.de });
        setTimeout(() => conn.emit("open"), 0);
      } else if (m.type === "connect-ok" && c) {
        c.open = true; c.emit("open");
      } else if (m.type === "data" && c) {
        c.emit("data", m.data);
      } else if (m.type === "close" && c) {
        delete connexions[m.cid]; c.open = false; c.emit("close");
      }
    };

    moi.connect = (distant) => {
      const cid = Math.random().toString(36).slice(2);
      const c = nouvelleConn(cid, distant);
      canal.postMessage({ type: "connect", cid, de: moi.id, a: distant });
      setTimeout(() => { if (!c.open && connexions[cid]) { delete connexions[cid]; moi.emit("error", { type: "peer-unavailable" }); } }, 2500);
      return c;
    };
    moi.reconnect = () => {};
    moi.disconnected = false;
    moi.destroyed = false;
    moi.destroy = () => { Object.values(connexions).forEach((c) => c.close()); canal.close(); moi.destroyed = true; };
    setTimeout(() => { moi.open = true; moi.emit("open", moi.id); }, 50);
    return moi;
  }

  function creerPeer(id) {
    const local = new URLSearchParams(location.search).has("local");
    if (local) return FauxPeer(id);
    if (typeof Peer === "undefined") throw new Error("La bibliothèque réseau n'est pas chargée.");
    return id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
  }

  /* ========================================================================
     Liaison : l'objet utilisé par l'appli.
     options = {
       role: "hote" | "invite",
       code: "ABCDE",
       accepter(bonjour) -> bool   (hôte : accepte-t-on ce joueur ?)
       bonjour() -> objet          (invité : message envoyé à la connexion)
       surMessage(msg)             (un message de jeu arrive)
       surEtat(etat, detail)       (« connexion », « attente », « connecte », « coupe », « erreur »)
     }
     ======================================================================== */
  function Liaison(options) {
    const role = options.role;
    const idHote = PREFIXE + options.code;
    let peer = null;
    let conn = null;            // la connexion validée avec l'autre joueur
    let dernierSignal = 0;      // dernier message reçu (pour le ping)
    let minuteurPing = null;
    let minuteurReco = null;
    let essais = 0;
    let fini = false;
    let etatActuel = "";

    function etat(e, detail) {
      etatActuel = e;
      options.surEtat(e, detail);
    }

    function envoyer(msg) {
      if (conn && conn.open) {
        try { conn.send(msg); return true; } catch (e) { return false; }
      }
      return false;
    }

    function surveiller() {
      clearInterval(minuteurPing);
      minuteurPing = setInterval(() => {
        if (!conn) return;
        envoyer({ t: "ping" });
        if (Date.now() - dernierSignal > SILENCE_MAX_MS) {
          perdre(conn); // plus de nouvelles : on considère la connexion morte
        }
      }, PING_MS);
    }

    function brancher(c, validee) {
      c.on("data", (msg) => {
        if (!msg || typeof msg !== "object") return;
        dernierSignal = Date.now();
        if (c !== conn && !validee.ok) {
          // Hôte : le tout premier message d'un nouvel arrivant doit être « bonjour »
          if (role === "hote" && msg.t === "bonjour") {
            if (options.accepter(msg)) {
              const ancienne = conn;
              conn = c; validee.ok = true;
              if (ancienne && ancienne !== c) { try { ancienne.close(); } catch (e) {} }
              surveiller();
              etat("connecte");
              options.surMessage(msg);
            } else {
              try { c.send({ t: "refus", raison: "Cette partie est déjà complète." }); } catch (e) {}
              setTimeout(() => { try { c.close(); } catch (e) {} }, 500);
            }
          }
          return;
        }
        if (c !== conn) return;
        if (msg.t === "ping") return;
        options.surMessage(msg);
      });
      c.on("close", () => perdre(c));
      c.on("error", () => perdre(c));
    }

    function perdre(c) {
      if (c !== conn) return;
      conn = null;
      clearInterval(minuteurPing);
      try { c.close(); } catch (e) {}
      if (fini) return;
      etat("coupe");
      if (role === "invite") planifierReconnexion();
    }

    function planifierReconnexion(delai) {
      clearTimeout(minuteurReco);
      if (fini) return;
      const attente = delai != null ? delai : Math.min(1000 * Math.pow(2, essais), 8000);
      essais++;
      minuteurReco = setTimeout(demarrer, attente);
    }

    /* ---------- Côté hôte ---------- */
    function demarrerHote() {
      etat("connexion");
      peer = creerPeer(idHote);
      peer.on("open", () => { essais = 0; if (!conn) etat("attente"); });
      peer.on("connection", (c) => {
        const validee = { ok: false };
        brancher(c, validee);
      });
      peer.on("disconnected", () => {
        // Le serveur de rendez-vous a décroché : la partie continue, on se réinscrit.
        if (!fini && peer && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 2000);
      });
      peer.on("error", (err) => {
        if (fini) return;
        if (err.type === "unavailable-id") {
          // Le code est encore réservé (par exemple l'ancienne page qui vient de se fermer).
          if (essais < 20) { etat("connexion", "Le code se libère…"); detruirePeer(); planifierReconnexion(3000); }
          else etat("erreur", "Ce code de partie est déjà utilisé par quelqu'un d'autre.");
        } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
          etat("connexion", "Pas de réseau, nouvel essai…");
          detruirePeer(); planifierReconnexion();
        } else if (err.type === "browser-incompatible") {
          etat("erreur", "Ce navigateur ne permet pas le jeu en ligne.");
        }
      });
    }

    /* ---------- Côté invité ---------- */
    function demarrerInvite() {
      etat("connexion");
      peer = creerPeer(null);
      peer.on("open", () => {
        const c = peer.connect(idHote, { reliable: true });
        const validee = { ok: true };
        c.on("open", () => {
          conn = c; essais = 0; dernierSignal = Date.now();
          surveiller();
          c.send(options.bonjour());
          etat("connecte");
        });
        brancher(c, validee);
      });
      peer.on("error", (err) => {
        if (fini) return;
        if (err.type === "peer-unavailable") etat("coupe", "Ton ami n'est pas joignable pour l'instant…");
        else if (err.type === "browser-incompatible") { etat("erreur", "Ce navigateur ne permet pas le jeu en ligne."); return; }
        else etat("coupe", "Réseau instable, nouvel essai…");
        detruirePeer(); planifierReconnexion();
      });
      peer.on("disconnected", () => {
        if (!conn && !fini) { detruirePeer(); planifierReconnexion(); }
      });
    }

    function detruirePeer() {
      if (peer) { try { peer.destroy(); } catch (e) {} }
      peer = null;
    }

    function demarrer() {
      if (fini) return;
      detruirePeer();
      try {
        if (role === "hote") demarrerHote(); else demarrerInvite();
      } catch (e) {
        etat("erreur", e.message);
      }
    }

    // Appelé quand l'appli revient au premier plan : on relance tout de suite si besoin.
    function verifier() {
      if (fini) return;
      if (role === "invite" && !conn) { essais = 0; planifierReconnexion(0); }
      if (role === "hote" && (!peer || peer.destroyed)) { essais = 0; planifierReconnexion(0); }
      else if (role === "hote" && peer && peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
      if (conn) envoyer({ t: "ping" });
    }

    function fermer() {
      fini = true;
      clearInterval(minuteurPing); clearTimeout(minuteurReco);
      if (conn) { try { conn.close(); } catch (e) {} }
      conn = null;
      detruirePeer();
    }

    demarrer();
    return { envoyer, fermer, verifier, etat: () => etatActuel, connecte: () => !!(conn && conn.open) };
  }

  racine.Reseau = { Liaison };
})(this);
