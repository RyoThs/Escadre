/* ==========================================================================
   Escadre — SONS et VIBRATIONS
   Les sons sont fabriqués par le navigateur (Web Audio) : aucun fichier
   audio à télécharger, donc l'appli reste légère et marche hors ligne.
   ========================================================================== */
(function (racine) {
  "use strict";
  let ctx = null;
  let actif = true;

  function contexte() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Bruit blanc filtré : sert pour l'éclaboussure et l'explosion
  function bruit(duree, frequence, volume, type) {
    const c = contexte(); if (!c) return;
    const n = Math.floor(c.sampleRate * duree);
    const buffer = c.createBuffer(1, n, c.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = c.createBufferSource(); src.buffer = buffer;
    const filtre = c.createBiquadFilter(); filtre.type = type || "lowpass"; filtre.frequency.value = frequence;
    const g = c.createGain(); g.gain.value = volume;
    src.connect(filtre).connect(g).connect(c.destination);
    src.start();
  }

  function note(freq, debut, duree, volume, forme) {
    const c = contexte(); if (!c) return;
    const t = c.currentTime + debut;
    const o = c.createOscillator(); o.type = forme || "sine"; o.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + duree + 0.05);
    return o;
  }

  function vibrer(motif) {
    if (actif && navigator.vibrate) { try { navigator.vibrate(motif); } catch (e) {} }
  }

  const Sons = {
    regler(oui) { actif = oui; },
    debloquer() { contexte(); },            // à appeler après un premier toucher (règle des navigateurs)
    tir() { if (actif) { note(900, 0, 0.12, 0.08, "triangle"); } },
    eau() { if (actif) bruit(0.6, 900, 0.35, "bandpass"); vibrer(30); },
    touche() { if (actif) { bruit(0.5, 500, 0.6); note(110, 0, 0.35, 0.25, "square"); } vibrer([60, 40, 60]); },
    coule() {
      if (actif) { bruit(1.1, 300, 0.7); [330, 262, 196].forEach((f, i) => note(f, 0.15 + i * 0.16, 0.3, 0.12, "triangle")); }
      vibrer([120, 60, 120, 60, 200]);
    },
    tonTour() { if (actif) { note(660, 0, 0.18, 0.08); note(990, 0.12, 0.25, 0.08); } vibrer(40); },
    victoire() { if (actif) [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.14, 0.4, 0.1, "triangle")); vibrer([80, 50, 80, 50, 300]); },
    defaite() { if (actif) [392, 330, 262, 196].forEach((f, i) => note(f, i * 0.2, 0.45, 0.1, "sine")); vibrer(400); },
    message() { if (actif) { note(880, 0, 0.12, 0.06); note(1320, 0.09, 0.18, 0.05); } vibrer(25); },
    clic() { if (actif) note(520, 0, 0.06, 0.05, "sine"); },
  };

  racine.Sons = Sons;
})(this);
