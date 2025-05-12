# PeakMonsters Deck Analyzer

![Version](https://img.shields.io/badge/version-0.3.0-blue)
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

## 📝 Licence

MIT - Utilisez, modifiez et partagez librement !

## 🙏 Contributions

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

---

*Développé avec ❤️ pour la communauté Splinterlands* 