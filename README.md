# ⚓ Escadre — la bataille navale revisitée

Jeu de bataille navale à deux, **chacun sur son téléphone** (iPhone ou Android).
Application web installable (PWA), sans compte, sans serveur à payer.

👉 **Jouer :** https://ryoths.github.io/Escadre/

## Règles
Carte de 8, 10, 12 ou 14 cases de côté · flotte : porte-avions 5×2, croiseur 4×2, sous-marin 4×1, contre-torpilleur 3×1, torpilleur 2×1
(+ frégate 3×1 et vedette 2×1 en option) · horizontaux ou verticaux, sans chevauchement · premier joueur tiré au sort ·
un tir par tour · « à l'eau », « touché », « coulé » · le premier qui coule toute la flotte adverse gagne.
Option : autoriser ou non les navires qui se touchent.

### Mode Compétences (carte 12 ou 14)
Deux tirs à l'eau d'affilée = une compétence, à choisir parmi 3 tirées au sort (2 en réserve au maximum). Utiliser une compétence remplace le tir du tour.
- Communes : 🔊 Sonar (zone 3×3), 🎯 Salve (2 tirs), 🚀 Torpille (file sur une ligne), 🛡️ Bouclier (bloque un tir).
- Par navire (dans le tirage tant qu'il est à flot) : ✈️ Raid aérien (porte-avions), 💣 Bombardement 2×2 (croiseur), 🔭 Périscope (sous-marin),
  📡 Grenadage (contre-torpilleur), ⚡ Éclair (torpilleur), 📶 Radar (frégate), 💥 Mine (vedette).

## Ce que propose le jeu
- **À deux**, chacun sur son téléphone, avec discussion intégrée et réactions.
- **Réglages** avant chaque partie : mode Classique ou Compétences, taille de la carte, navires bonus.
- **Seul contre l'ordinateur**, 3 niveaux : Matelot Robin (facile), Capitaine Hugo (moyen), Amiral Vega (difficile, calcule les cases les plus probables).
- **Score face à face** gardé d'une partie à l'autre (« Toi 3 – 2 Léa ») et **10 trophées** à débloquer.
- **Replay** de la partie coup par coup à la fin, les deux flottes visibles.
- **Anti-triche** : à la fin, chaque flotte est révélée et toutes les réponses sont revérifiées.

## Installer sur le téléphone
- **iPhone** : ouvrir le lien dans Safari → Partager → « Sur l'écran d'accueil »
- **Android** : Chrome → menu ⋮ → « Installer l'application »

## Organisation du code
| Fichier | Rôle |
|---|---|
| `index.html` | les écrans |
| `style.css` | le style « carte marine » (thème clair) |
| `js/regles.js` | les règles : tailles de carte, flotte large, placement (testées) |
| `js/reseau.js` | la connexion entre téléphones (PeerJS / WebRTC) et la reconnexion |
| `js/navires.js` | dessin des navires (vue de dessus, SVG) |
| `js/discussion.js` | la discussion entre amis (messages numérotés et renvoyés s'ils se perdent) |
| `js/moteur.js` | le journal des actions : tours, compétences, résultats, anti-triche (testé) |
| `js/ia.js` | le mode solo : l'ordinateur joue comme un ami connecté (mêmes messages, compétences comprises) |
| `js/trophees.js` | scores face à face et trophées (testés) |
| `js/sons.js` | sons et vibrations |
| `js/app.js` | le déroulé de la partie et l'affichage |
| `sw.js`, `manifest.json`, `icons/` | ce qui rend l'appli installable et utilisable hors ligne |
| `vendor/peerjs-1.5.5.min.js` | bibliothèque réseau officielle (npm `peerjs`, licence MIT) |
| `tests/regles.test.js` | tests rapides (règles, discussion, ordinateur, trophées) : `node tests/regles.test.js` |
| `tests/e2e/escadre.e2e.js` | parties complètes jouées dans un vrai navigateur : `node tests/e2e/escadre.e2e.js` |
| `.github/workflows/deploy.yml` | tests + publication automatiques à chaque push sur `main` |

## Tester sur l'ordinateur
```bash
python -m http.server 8000
```
Puis ouvrir **deux onglets** sur `http://localhost:8000/?local=1` : l'un crée la partie, l'autre la rejoint avec le code.
Options de test à ajouter à l'adresse :
- `&perte=0.3` : 30 % des messages sont perdus au hasard (4G faible) ; la partie doit quand même aller jusqu'au bout ;
- `&bloque=1` : les deux onglets n'arrivent jamais à se connecter (pour voir l'aide « Ça ne se connecte pas ? ») ;
- `&vite=1` : l'ordinateur du mode solo joue sans attendre.

Tests en navigateur (il faut Playwright) :
```bash
npm install --no-save playwright && npx playwright install chromium
node tests/e2e/escadre.e2e.js
```

## Connexion
Les téléphones se trouvent grâce au serveur gratuit de PeerJS puis se parlent en direct (WebRTC).
Plusieurs serveurs STUN (Google, Cloudflare) et les relais TURN de PeerJS aident à traverser les box et la 4G.
Si une connexion ne s'ouvre pas en 15 s, elle est relancée, et une aide s'affiche si ça dure.
Pour ajouter un relais personnel (par exemple un compte gratuit Metered), remplir `RELAIS_PERSO` dans `js/reseau.js`.

## Publier une mise à jour
Il suffit de pousser sur `main` : GitHub lance les tests (règles, puis vraies parties dans un navigateur), puis publie le site.
Le numéro de version du cache (`sw.js`) est changé automatiquement à chaque publication.
