# ⚓ Escadre — la bataille navale revisitée

Jeu de bataille navale à deux, **chacun sur son téléphone** (iPhone ou Android).
Application web installable (PWA), sans compte, sans serveur à payer.

👉 **Jouer :** `https://ryoths.github.io/Escadre/` (une fois GitHub Pages activé)

## Règles
Grille 10 × 10 · 5 navires (5, 4, 3, 3, 2 cases) · horizontaux ou verticaux, sans chevauchement ·
premier joueur tiré au sort · un tir par tour · « à l'eau », « touché », « coulé » · le premier qui coule toute la flotte adverse gagne.
Option : autoriser ou non les navires qui se touchent.

## Installer sur le téléphone
- **iPhone** : ouvrir le lien dans Safari → Partager → « Sur l'écran d'accueil »
- **Android** : Chrome → menu ⋮ → « Installer l'application »

## Organisation du code
| Fichier | Rôle |
|---|---|
| `index.html` | les écrans |
| `style.css` | le style « carte marine » (thème clair) |
| `js/regles.js` | les règles du jeu (testées) |
| `js/reseau.js` | la connexion entre téléphones (PeerJS / WebRTC) et la reconnexion |
| `js/navires.js` | dessin des navires (vue de dessus, SVG) |
| `js/discussion.js` | la discussion entre amis (messages numérotés et renvoyés s'ils se perdent) |
| `js/sons.js` | sons et vibrations |
| `js/app.js` | le déroulé de la partie et l'affichage |
| `sw.js`, `manifest.json`, `icons/` | ce qui rend l'appli installable et utilisable hors ligne |
| `vendor/peerjs-1.5.5.min.js` | bibliothèque réseau officielle (npm `peerjs`, licence MIT) |
| `tests/regles.test.js` | tests : `node tests/regles.test.js` |
| `.github/workflows/deploy.yml` | tests + publication automatiques à chaque push sur `main` |

## Tester sur l'ordinateur
```bash
python -m http.server 8000
```
Puis ouvrir **deux onglets** sur `http://localhost:8000/?local=1` : l'un crée la partie, l'autre la rejoint avec le code.
Pour simuler un mauvais réseau (4G faible), ajoute `&perte=0.3` : 30 % des messages sont perdus au hasard, et la partie doit quand même aller jusqu'au bout.

## Publier une mise à jour
Il suffit de pousser sur `main` : GitHub lance les tests, puis publie le site.
Le numéro de version du cache (`sw.js`) est changé automatiquement à chaque publication.
