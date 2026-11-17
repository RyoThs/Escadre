# Instructions pour Claude (Escadre)

Yoann est débutant : réponds en français, simplement, code complet d'abord puis explications.
Mémoire longue et décisions : coffre `RyoThs/MonCerveau` (fiche `02 - Projets/ESCADRE/Escadre.md`).

## Méthode TDD : priorité pour tout le code
Toute demande qui touche au code suit le TDD (détails : fiche `14 - TDD (tests d'abord)` du coffre MonCerveau).
1. 🔴 Écrire d'abord UN test pour UN comportement, le lancer, le voir échouer pour la bonne raison.
2. 🟢 Écrire le code le plus simple qui le fait passer, puis lancer TOUTE la suite.
3. 🔧 Ranger le code ; les tests restent verts.
- Un bug = d'abord un test qui le reproduit, puis la correction.
- Ne jamais modifier ni supprimer un test pour obtenir le vert (si un test semble faux : l'expliquer à Yoann et attendre son accord).
- Montrer à Yoann chaque cycle en une ligne et la preuve finale (commande + résultat).
- Exceptions : maquette jetable, pur style CSS (capture avant/après).

## Tests de ce projet
- Règles, discussion, ordinateur, trophées : `node tests/regles.test.js` (rapide, à lancer à chaque cycle). La logique pure va dans `js/regles.js`, `js/moteur.js`, `js/trophees.js`… pour être testable sans navigateur.
- Parties complètes dans un vrai navigateur : `node tests/e2e/escadre.e2e.js` (Playwright ; à lancer avant de proposer une fusion).
- GitHub lance les deux à chaque push sur `main` et ne publie que si tout est vert.

## Règles
- Code de l'appli : toujours une demande de fusion, et attendre l'accord de Yoann et les tests verts avant de fusionner.
- JavaScript sans framework : attention, deux fonctions du même nom s'écrasent sans erreur.
- Jamais de mot de passe ni de clé d'API dans le dépôt.
