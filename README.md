# PeakMonsters Deck Analyzer

![Version](https://img.shields.io/badge/version-0.5.0-blue)
![Plateforme](https://img.shields.io/badge/plateforme-Chrome/Firefox-orange)

Une extension de navigateur puissante pour analyser votre collection et le marché Splinterlands sur PeakMonsters avec des KPIs avancés et des recommandations tactiques.

## 🚀 Fonctionnalités

- **Analyse automatique** des cartes depuis la vue Liste ou le Marché
- **KPIs avancés** pour prendre de meilleures décisions :
  - 💪 **Power Score (PS)** : `(Attaque × Santé × Vitesse) / Mana` - Évalue l'efficacité globale
  - ⚡ **Efficacité** : `(Attaque + Santé) / Mana` - Mesure le rapport stats/coût
  - 💲/PS : `Prix marché ÷ Power Score` - Indicateur de rapport qualité/prix
  - 💰 **ROI** : `(DEC/match × Winrate) / Prix` - Retour sur investissement
  - 📅 **ROI locatif** : `(DEC/jour) / Prix location` - Pour les cartes en location
  - 🏆 **Winrate** : % de victoires quand la carte est jouée
  - 🛡️ **Survie** : `Santé ÷ Dégâts moyens` - Durabilité des tanks en tours

- **Recommandations automatiques** :
  - 🛒 **Acheter** - Cartes avec ROI élevé que vous ne possédez pas
  - 💸 **Vendre** - Cartes avec ROI faible et prix intéressant
  - 🔼 **Améliorer** - Cartes avec bon potentiel mais stats faibles
  - 🪑 **Bench** - Cartes peu utiles à garder en réserve
  - ✅ **Garder** - Cartes avec bon équilibre valeur/performance

- **Interface intuitive** :
  - Boutons de tri interactifs pour comparer les cartes selon différents critères
  - Infobulles explicatives pour comprendre chaque KPI
  - Résumé des meilleures cartes à acheter/vendre

- **Fonctionnalités v0.4.0** :
  - 📊 **Analyse de méta** - Visualisez les tendances actuelles du jeu
  - 📂 **Export JSON** - Sauvegardez et partagez vos analyses complètes
  - 🔄 **Comparaison de cartes** - Comparez jusqu'à 4 cartes côte à côte
  - 🔍 **Diagnostic avancé** - Outil de dépannage pour les sélecteurs DOM
  - 🎮 **Analyse de deck par élément** - Créez les meilleurs decks par couleur (Feu, Eau, Terre, etc.)

- **Nouvelles fonctionnalités (v0.5.0)** :
  - ⚡ **Générateur de deck optimal** - Création automatique du meilleur deck possible selon votre collection
  - 🔄 **Système de synergies** - Détection automatique des combinaisons de cartes puissantes
  - 🎚️ **Ajustement de mana** - Adaptez vos decks à différentes limites de mana
  - 🏆 **Meilleur deck global** - Trouve la meilleure combinaison toutes couleurs confondues

## 📊 Seuils utilisés

| KPI | Seuil | Interprétation |
|-----|-------|----------------|
| Power Score | > 15 | Excellent |
| ROI | > 5% | À acheter |
| ROI | < 2% | À vendre si prix > 0.20$ |
| Mana Efficiency | > 3.0 | Très efficace |
| Prix/PS | < 0.15 | Bon investissement |
| Survie | ≥ 3 tours | Tank efficace |
| Winrate | > 55% | Performant |

## 💻 Installation

1. Téléchargez le code source
2. Dans Chrome, ouvrez `chrome://extensions`
3. Activez le "Mode développeur"
4. Cliquez sur "Charger l'extension non empaquetée"
5. Sélectionnez le dossier contenant les fichiers de l'extension

## 📷 Captures d'écran

*(Ajoutez des captures d'écran ici)*

## 🔧 Utilisation

1. Naviguez sur [PeakMonsters](https://peakmonsters.com)
2. Parcourez votre collection ou le marché
3. Cliquez sur le bouton "Analyser le deck" qui apparaît en bas à droite
4. Triez et filtrez les cartes selon les KPIs qui vous intéressent
5. Suivez les recommandations pour optimiser votre collection
6. Utilisez le bouton "Analyse Méta" pour voir les tendances actuelles du jeu
7. Cliquez sur "Analyse de Deck" pour obtenir des recommandations par élément
8. Ajustez la limite de mana selon vos besoins et cliquez sur "Régénérer"
9. Exportez vos analyses en CSV ou JSON pour les sauvegarder

## 🌈 Stratégies par élément

| Élément | Forces | Faiblesses | Stratégie |
|---------|--------|------------|-----------|
| 🔥 Feu | Attaque élevée, Dégâts de zone | Santé faible | Offensive agressive |
| 💧 Eau | Heal, Debuffs, Magic | Faible contre la terre | Contrôle et affaiblissement |
| 🌿 Terre | Santé élevée, Poison | Vitesse faible | Défensive, tanks solides |
| ✨ Vie | Heal, Buffs, Resurrect | Vulnérable à la mort | Support et guérison |
| 💀 Mort | Afflictions, Drain, Sneak | Santé faible | Affaiblissement, vol de vie |
| 🐉 Dragon | Stats équilibrées, Polyvalence | Coût élevé | Flexibilité tactique |
| ⚪ Neutre | Utilisable partout | Pas de bonus d'élément | Complément pour tous decks |

## 🤝 Synergies puissantes

| Synergie | Bonus | Description |
|----------|-------|-------------|
| Tank + Healer | +150% | Le healer prolonge la survie du tank |
| Sniper + Tank | +100% | Le tank protège le sniper pendant qu'il élimine les cibles |
| Magic + Magic | +80% | Les attaques magiques ignorent l'armure ennemie |
| Poison + Slow | +120% | Ralentir l'ennemi tout en appliquant du poison |
| Thorns + Taunt | +130% | Forcer l'ennemi à attaquer et subir des dégâts en retour |
| Flying + Ranged | +70% | Attaques à distance depuis les airs |
| Même élément | +30% | Bonus pour cartes de même type |

## 📝 Licence

MIT - Utilisez, modifiez et partagez librement !

## 🙏 Contributions

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

---

*Développé avec ❤️ pour la communauté Splinterlands* 