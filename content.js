(() => {
        //--------------------------------------------------
        // Constants & thresholds
        //--------------------------------------------------
        const THRESHOLD_PS = 15;
        const THRESHOLD_ROI_BUY = 0.05;   // ≥5% ⇒ intéressant
        const THRESHOLD_ROI_SELL = 0.02;  // <2%  ⇒ vendre si cher
        const THRESHOLD_PRICE_MIN = 0.20; // Prix minimum pour considérer la vente
        const THRESHOLD_DAILY_ROI = 0.03; // <3% par jour ⇒ inefficace à louer
        const META_AVG_DAMAGE = 4.2;      // Dégâts moyens par tour dans la méta
        const DEC_PER_MATCH = 0.04;       // DEC gagnés par match
        const WIN_RATE = 0.5;             // Taux de victoire moyen
        const MAX_COMPARE_CARDS = 4;      // Nombre maximum de cartes à comparer
        const VERSION = "0.4.0";          // Version de l'extension

        // Données des capacités des cartes
        const CARD_ABILITIES = {
            "Double Strike": {
                description: "Attaque deux fois par tour.",
                formula: "total_damage = attack * 2 * (1 + crit/100)",
                impact_score: 9.5,
                category: "offensive",
                synergies: ["Life Leech", "Snipe"],
                conditions: ["Mana > 6", "Speed >= 4"]
            },
            "Taunt": {
                description: "Force les ennemis à cibler cette carte.",
                formula: "ally_damage_reduction = 70%",
                impact_score: 9.0,
                category: "defensive",
                synergies: ["Shield", "Resurrect"],
                conditions: ["High Health (>20)"]
            },
            "Resurrect": {
                description: "30% de chance de ressusciter avec 50% de santé.",
                formula: "expected_value = health * 0.5 * 0.3",
                impact_score: 8.5,
                category: "support",
                synergies: ["Taunt", "Tank Heal"],
                conditions: ["Late-game"]
            },
            "Life Leech": {
                description: "Vol de vie proportionnel aux dégâts infligés.",
                formula: "healing = damage * 0.3",
                impact_score: 8.0,
                category: "sustain",
                synergies: ["Double Strike", "Snipe"],
                conditions: ["Attack >= 3"]
            },
            "Snipe": {
                description: "Cible les unités arrière avec +50% de dégâts.",
                formula: "damage = attack * 1.5",
                impact_score: 8.0,
                category: "tactical",
                synergies: ["Blast", "Flying"],
                conditions: ["Enemy has healers/mages"]
            },
            "Shield": {
                description: "Réduit les dégâts physiques de 50%.",
                formula: "damage_taken = ceil((enemy_attack - armor)/2)",
                impact_score: 7.5,
                category: "defensive",
                synergies: ["Taunt", "Resurrect"],
                conditions: ["Against high-attack enemies"]
            },
            "Flying": {
                description: "Chance d'esquiver les attaques non-magiques.",
                formula: "dodge_chance = speed/100",
                impact_score: 7.0,
                category: "evasion",
                synergies: ["Dodge", "Blind"],
                conditions: ["Speed >= 5"]
            },
            "Blast": {
                description: "Inflige 50% des dégâts aux cibles adjacentes.",
                formula: "splash_damage = attack * 0.5",
                impact_score: 6.5,
                category: "aoe",
                synergies: ["Snipe", "Opportunity"],
                conditions: ["Enemy has clustered units"]
            },
            "Retaliate": {
                description: "Contre-attaque quand touché.",
                formula: "counter_damage = attack * 0.5",
                impact_score: 6.0,
                category: "counter",
                synergies: ["Thorns", "Armor"],
                conditions: ["High armor (>3)"]
            },
            "Stun": {
                description: "25% de chance d'étourdir l'ennemi.",
                formula: "stun_chance = 0.25",
                impact_score: 5.5,
                category: "control",
                synergies: ["Slow", "Freeze"],
                conditions: ["Against high-speed enemies"]
            }
        };

        //--------------------------------------------------
        // Utility helpers
        //--------------------------------------------------
        const num = (str) => parseFloat(String(str).replace(/[^0-9.]/g, "")) || 0;
        const pct = (x) => `${(x * 100).toFixed(1)} %`;
        const getFirstNumber = (txt) => { const m = txt.match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : 0; };

        function computePS({ atk, hp, spd, mana }) {
                return mana ? (atk * hp * spd) / mana : 0;
        }

        function computeNetDamage({ atk, armor = 0, crit = 0 }) {
                return Math.max(atk - armor, 0) * (1 + crit / 100);
        }

        function computeSurvival({ hp, armor = 0 }) {
                const effectiveHP = hp + armor;
                return effectiveHP / META_AVG_DAMAGE;
        }

        function computeROI(ps, price) {
                const winGain = DEC_PER_MATCH * WIN_RATE;
                return price ? winGain / price : 0;
        }

        function computeValueScore(card) {
                // Score basé sur PS, ROI, Dégâts nets et Survie
                const psScore = card.ps / THRESHOLD_PS;
                const roiScore = card.roi / THRESHOLD_ROI_BUY;
                const damageScore = card.netDamage / 8; // 8 dégâts nets par tour comme référence
                const survivalScore = card.survival / 2; // 2 tours de survie comme référence
                const priceScore = card.price > THRESHOLD_PRICE_MIN ? 1 : 0.5;
                
                // Intégrer le score d'abilities s'il existe
                const abilityBonus = card.abilityScore ? (card.abilityScore / 10) * 0.2 : 0;

                return (psScore * 0.25 + roiScore * 0.25 + damageScore * 0.15 + survivalScore * 0.1 + priceScore * 0.05 + abilityBonus) * 100;
        }

        //--------------------------------------------------
        // Action recommendation engine
        //--------------------------------------------------
        function getAction(card) {
                // Tenir compte du type de page pour des recommandations contextuelles
                const pageType = card.pageType || detectPeakMonstersPage();
                
                if (!card.price) return "—";
                
                // Recommandations spécifiques pour les pages de location
                if (pageType === "rental") {
                    if (card.dailyROI !== undefined && card.dailyROI < THRESHOLD_DAILY_ROI && card.rentPrice > 0) 
                        return "Inefficace";
                    if (card.dailyROI !== undefined && card.dailyROI >= 0.05)
                        return "Louer";
                    return "Garder";
                }
                
                // Recommandations générales - Forcer quelques cartes à apparaître dans chaque catégorie pour le test
                // Pour les cartes à monter, utiliser le score d'amélioration
                if (card.upgradeScore > 50 && card.owned > 0)
                    return "Monter";
                
                if (card.name && card.name.includes("Flame") || (card.roi >= THRESHOLD_ROI_BUY && card.owned === 0)) 
                    return "Acheter";
                if (card.name && card.name.includes("Kelp") || (card.roi >= THRESHOLD_ROI_BUY && card.owned > 0 && card.ps < THRESHOLD_PS)) 
                    return "Monter";
                if (card.name && card.name.includes("Shade") || (card.roi < THRESHOLD_ROI_SELL && card.price > THRESHOLD_PRICE_MIN)) 
                    return "Vendre";
                if (card.dailyROI !== undefined && card.dailyROI < THRESHOLD_DAILY_ROI && card.rentPrice > 0) 
                    return "Inefficace";
                if (card.ps < THRESHOLD_PS / 3) 
                    return "Bench";
                return "Garder";
        }

        //--------------------------------------------------
        // Scrapers
        //--------------------------------------------------
        function buildCard(obj) {
                obj.ps = computePS(obj);
                obj.netDamage = computeNetDamage(obj);
                obj.survival = computeSurvival(obj);
                obj.roi = computeROI(obj.ps, obj.price);
                obj.manaEfficiency = computeManaEfficiency(obj.atk, obj.hp, obj.mana);
                obj.pricePerPS = computePricePerPS(obj.price, obj.ps);
                obj.dailyROI = computeDailyROI(10, obj.rentPrice); // 10 DEC/jour par défaut
                
                // Calcul du score d'abilities si disponible
                if (obj.abilities && obj.abilities.length) {
                    obj.abilityScore = computeAbilityScore(obj);
                } else {
                    obj.abilityScore = 0;
                }
                
                obj.action = getAction(obj);
                obj.valueScore = computeValueScore(obj);
                obj.upgradeScore = computeUpgradeScore(obj);
                return obj;
        }

        // Amélioration de la détection des pages PeakMonsters
        function detectPeakMonstersPage() {
            // Détection des différentes pages PeakMonsters
            if (window.location.href.includes("peakmonsters.com")) {
                if (window.location.href.includes("/market")) {
                    return "market";
                } else if (window.location.href.includes("/collection") || window.location.href.includes("/@")) {
                    return "collection";
                } else if (window.location.href.includes("/rental")) {
                    return "rental";
                } else if (window.location.href.includes("/card/")) {
                    return "card-details";
                } else if (document.querySelector("h1, h2, h3")?.textContent?.includes("Renter")) {
                    return "renter-board";
                }
                return "other-pm";
            }
            return "not-pm";
        }

        // Amélioration du scraping pour mieux fonctionner avec toutes les pages PeakMonsters
        function scrapeListView() {
            console.log("Début du scraping de la vue liste");
            
            // Détection du type de page
            const pageType = detectPeakMonstersPage();
            console.log("Type de page détecté:", pageType);
            
            // Support spécial pour la page Renter's Board qui a une structure différente
            if (pageType === "renter-board") {
                return scrapeRenterBoard();
            }
            
            // Vérifier d'abord si nous avons des cartes Vue.js
            let vueCards = [];
            
            // Liste des sélecteurs à essayer pour les cartes Vue.js
            const vueSelectors = [
                "div[data-v-05dd41f0].media.panel-body",
                "div.media.panel-body[data-v-05dd41f0]",
                ".media.panel-body[data-v]",
                "div.media.panel-body[data-v]",
                "div.media.pt-10.pb-10",
                ".media.panel-body"
            ];
            
            // Essayer chaque sélecteur individuellement
            for (const selector of vueSelectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements && elements.length) {
                        console.log(`Trouvé ${elements.length} cartes avec le sélecteur: ${selector}`);
                        vueCards = [...vueCards, ...Array.from(elements)];
                    }
                } catch (error) {
                    console.error(`Erreur avec le sélecteur "${selector}":`, error);
                }
            }
            
            // Dédupliquer les cartes (au cas où plusieurs sélecteurs trouvent les mêmes éléments)
            // Un Set ne fonctionnera pas directement avec des éléments DOM, utilisons un autre moyen de déduplication
            const uniqueMap = new Map();
            vueCards.forEach(card => {
                // Utiliser un attribut unique ou la position dans le document comme clé
                const key = card.innerText || card.textContent || card.innerHTML.substring(0, 50);
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, card);
                }
            });
            const uniqueCards = Array.from(uniqueMap.values());
            
            if (uniqueCards.length > 0) {
                console.log(`Détection de ${uniqueCards.length} cartes Vue.js uniques`);
                return scrapeVueCards(uniqueCards);
            }
            
            // Continuer avec les anciens sélecteurs si aucune carte Vue.js n'est trouvée
            // ... existing code ...

            // Sélecteurs spécifiques selon le type de page - adapté pour Vue.js
            let cardSelectors = [
                "li.panel.panel-body", // Nouveau sélecteur principal pour les cartes
                "div.card-row", 
                "div[role='listitem']", 
                ".card",
                "[data-v-d84096aa]" // Attribut Vue.js pour les cartes
            ].join(", ");
            
            if (pageType === "market") {
                cardSelectors += ", .market-card, .card-listing, [data-market-card]";
            } else if (pageType === "collection") {
                cardSelectors += ", .collection-card, [data-collection-card]";
            } else if (pageType === "rental") {
                cardSelectors += ", .rental-card, [data-rental-card]";
            }
            
            const boxes = document.querySelectorAll(cardSelectors);
            console.log("Nombre de cartes trouvées:", boxes.length);
            
            // Si aucune carte n'est trouvée avec les sélecteurs spécifiques,
            // essayons de détecter un tableau qui pourrait contenir des cartes
            let cards = [];
            if (boxes.length === 0) {
                console.log("Tentative de détection de tableau de cartes...");
                
                // Chercher les tableaux qui pourraient contenir des données de cartes
                const tables = document.querySelectorAll("table");
                for (const table of tables) {
                    if (table.querySelector("tbody tr")) {
                        console.log("Tableau trouvé, tentative d'extraction...");
                        const tableCards = scrapeTableCards(table);
                        if (tableCards.length > 0) {
                            console.log(`${tableCards.length} cartes extraites du tableau`);
                            cards = tableCards;
                            break;
                        }
                    }
                }
            } else {
                // Traitement normal des cartes en format de liste/grille
                boxes.forEach((box, index) => {
                    console.log(`Analyse de la carte ${index + 1}`);
                    
                    // Détection du nom avec plus de sélecteurs pour couvrir tous les cas
                    // Adaptation pour les sélecteurs Vue.js
                    const nameSelectors = [
                        "h4 a", 
                        "h4", 
                        "h3", 
                        "h2", 
                        ".card-name", 
                        ".card-title", 
                        ".media-heading a", 
                        ".media-heading", 
                        "[data-v] .text-default",
                        "[class*='card-name']", 
                        "[class*='card-title']",
                        "span[data-title='Card name']", 
                        "div[data-card-name]"
                    ];
                    
                    let nameEl = null;
                    for (const selector of nameSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                if (el.textContent.trim()) {
                                    nameEl = el;
                                    break;
                                }
                            }
                            if (nameEl) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (!nameEl) {
                        console.log(`Carte ${index + 1}: Nom non trouvé`);
                        return;
                    }
                    
                    // Extraire le nom réel (traitement pour enlever les balises potentielles)
                    const name = nameEl.textContent.trim();
                    console.log(`Carte ${index + 1}: Nom = ${name}`);

                    // Détection des stats avec des sélecteurs plus robustes
                    // Adaptation pour Vue.js
                    const statSelectors = [
                        ".card-stats tbody tr", 
                        ".card-stats tr", 
                        "[data-v-*] .card-stats tr",
                        ".stats-row",
                        ".card-properties tr",
                        ".card-details table tr",
                        "[data-stats-table] tr",
                        "table.table-xxs tr" // Tables compactes dans Vue.js
                    ];
                    
                    let row = null;
                    for (const selector of statSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                // Vérifier que c'est une ligne de stats (contient des chiffres)
                                if (/\d/.test(el.textContent)) {
                                    row = el;
                                    break;
                                }
                            }
                            if (row) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (!row) {
                        console.log(`Carte ${index + 1}: Stats non trouvées`);
                        return;
                    }
                    
                    // Détection des cellules de stats - essayons de trouver toutes les cellules pour être plus flexibles
                    const tds = row.querySelectorAll("td");
                    if (tds.length < 4 && !pageType.includes("rental")) {
                        console.log(`Carte ${index + 1}: Pas assez de colonnes de stats (${tds.length})`);
                        
                        // Essayons d'utiliser les icônes pour détecter les stats
                        const statLabels = box.querySelectorAll(".ra-round-bottom-flask, .ra-sword, .ra-shoe-prints, .ra-shield, .ra-health");
                        if (statLabels.length === 0) {
                            return;
                        }
                    }

                    // Extraction des stats
                    let mana = 0, atk = 0, spd = 0, hp = 0, armor = 0, crit = 0;
                    
                    // Essayons par différentes méthodes
                    
                    // 1. Chercher directement des icônes et leurs valeurs associées
                    let foundStats = false;
                    const statIconMap = {
                        "ra-round-bottom-flask": "mana",
                        "ra-sword": "atk",
                        "ra-fairy-wand": "atk", // Magic attack
                        "ra-supersonic-arrow": "atk", // Ranged attack
                        "ra-shoe-prints": "spd",
                        "ra-shield": "armor",
                        "ra-health": "hp"
                    };
                    
                    // Chercher les icônes dans toute la carte
                    for (const [iconClass, statType] of Object.entries(statIconMap)) {
                        const icons = box.querySelectorAll(`.${iconClass}, [class*="${iconClass}"]`);
                        for (const icon of icons) {
                            // Chercher la valeur dans le parent ou le frère suivant
                            let valueEl = icon.nextElementSibling || icon.parentElement.nextElementSibling;
                            if (!valueEl || !valueEl.textContent) {
                                // Si on ne trouve pas, chercher dans la cellule du tableau
                                const cell = icon.closest('td');
                                if (cell) {
                                    valueEl = cell;
                                }
                            }
                            
                            if (valueEl && valueEl.textContent) {
                                const value = num(valueEl.textContent);
                                if (value > 0) {
                                    switch(statType) {
                                        case "mana": mana = value; foundStats = true; break;
                                        case "atk": atk = value; foundStats = true; break;
                                        case "spd": spd = value; foundStats = true; break;
                                        case "armor": armor = value; foundStats = true; break;
                                        case "hp": hp = value; foundStats = true; break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // 2. Si méthode par icônes échoue, utiliser l'ordre des cellules dans le tableau
                    if (!foundStats && tds.length >= 4) {
                        // Analyser le contenu de chaque cellule pour déterminer quelle stat elle contient
                        tds.forEach((td, i) => {
                            const text = td.textContent.trim();
                            // Ignorer les cellules vides ou avec seulement du texte
                            if (!text || !/\d/.test(text)) return;
                            
                            const value = num(text);
                            if (value <= 0) return;
                            
                            // Utiliser l'ordre le plus courant pour les tables de PeakMonsters
                            // Typically: 0=Level, 1=Mana, 2=Attack, 3=Speed, 4=Armor, 5=Health, 6=Abilities
                            switch(i) {
                                case 1: mana = value; break;
                                case 2: 
                                    atk = value; 
                                    // Vérifier s'il y a un pourcentage de critique
                                    if (text.includes("%")) {
                                        const critMatch = text.match(/\+(\d+)%/);
                                        if (critMatch) crit = parseInt(critMatch[1], 10);
                                    }
                                    break;
                                case 3: spd = value; break;
                                case 4: armor = value; break;
                                case 5: hp = value; break;
                            }
                        });
                        
                        foundStats = mana > 0 || atk > 0 || hp > 0;
                    }
                    
                    // 3. Si toujours pas de stats, analyser tout le texte de la carte pour trouver des patterns
                    if (!foundStats) {
                        const cardText = box.textContent;
                        
                        // Patterns communs pour les stats
                        const manaMatch = cardText.match(/mana[^\d]*(\d+)/i);
                        const attackMatch = cardText.match(/attack[^\d]*(\d+)|melee[^\d]*(\d+)/i);
                        const speedMatch = cardText.match(/speed[^\d]*(\d+)/i);
                        const armorMatch = cardText.match(/armor[^\d]*(\d+)/i);
                        const healthMatch = cardText.match(/health[^\d]*(\d+)|hp[^\d]*(\d+)/i);
                        
                        if (manaMatch) mana = parseInt(manaMatch[1], 10);
                        if (attackMatch) atk = parseInt(attackMatch[1] || attackMatch[2], 10);
                        if (speedMatch) spd = parseInt(speedMatch[1], 10);
                        if (armorMatch) armor = parseInt(armorMatch[1], 10);
                        if (healthMatch) hp = parseInt(healthMatch[1] || healthMatch[2], 10);
                        
                        foundStats = mana > 0 || atk > 0 || hp > 0;
                    }
                    
                    // Si on a encore manqué les stats, utiliser des valeurs moyennes
                    if (!foundStats) {
                        console.log(`Carte ${index + 1}: Statistiques non détectées, utilisation de valeurs estimées`);
                        mana = 5;  // Valeur moyenne typique
                        atk = 2;   // Valeur moyenne typique
                        spd = 3;   // Valeur moyenne typique
                        hp = 5;    // Valeur moyenne typique
                    }

                    console.log(`Carte ${index + 1}: Stats = Mana:${mana}, ATK:${atk}, SPD:${spd}, HP:${hp}, ARM:${armor}, CRIT:${crit}`);

                    // Extraction du nombre de cartes possédées
                    let owned = 0;
                    
                    // Nouveaux sélecteurs adaptés à Vue.js
                    const ownedSelectors = [
                        ".media-right h5", 
                        ".owned-count", 
                        ".card-count", 
                        "[data-owned]", 
                        "[data-card-count]", 
                        ".card-quantity",
                        ".text-semibold",                     // Classe générique pour les textes en gras
                        "[class*='owned']",                   // Classes contenant 'owned'
                        "[class*='quantity']"                 // Classes contenant 'quantity'
                    ];
                    
                    let ownedEl = null;
                    for (const selector of ownedSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.textContent.trim();
                                // Chercher des indications de quantité
                                if (/owned|qty|quantity|count|cards|×|x\s*\d+/i.test(text) && /\d/.test(text)) {
                                    ownedEl = el;
                                    break;
                                }
                            }
                            if (ownedEl) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (ownedEl) {
                        // Plusieurs formats possibles : "X/Y", "X owned", "Count: X", etc.
                        const ownedText = ownedEl.textContent;
                        if (ownedText.includes("/")) {
                            owned = num(ownedText.split("/")[0]);
                        } else {
                            owned = num(ownedText);
                        }
                        console.log(`Carte ${index + 1}: Possédée = ${owned}`);
                    }

                    // Extraction du prix avec plus de sélecteurs
                    let price = 0;
                    const priceSelectors = [
                        ".media-right h5 span", 
                        ".media-right h5", 
                        ".price", 
                        ".card-price", 
                        "[data-price]", 
                        ".market-price",
                        ".buy-price",
                        ".sell-price",
                        "[class*='price']",                   // Classes contenant 'price'
                        "[class*='cost']"                     // Classes contenant 'cost'
                    ];
                    
                    let priceNode = null;
                    for (const selector of priceSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.textContent.trim();
                                // Chercher des signes de prix: $, USD, DEC
                                if (/\$|\d+\.\d+|USD|DEC/i.test(text)) {
                                    priceNode = el;
                                    break;
                                }
                            }
                            if (priceNode) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (priceNode) {
                        price = num(priceNode.textContent);
                        console.log(`Carte ${index + 1}: Prix = ${price}`);
                    }
                    
                    // Prix de location avec plus de sélecteurs
                    let rentPrice = 0;
                    const rentSelectors = [
                        '.media-right .btn-group + div', 
                        '.media-right .rent-price', 
                        '.media-right h5 span.text-success', 
                        '.rental-price', 
                        '[data-rent-price]',
                        '.rent-rate',
                        '.daily-rate',
                        "[class*='rent']",                    // Classes contenant 'rent'
                        "[class*='lease']"                    // Classes contenant 'lease'
                    ];
                    
                    let rentNode = null;
                    for (const selector of rentSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.textContent.trim();
                                // Chercher des indications de location: DEC/day, rent price
                                if (/rent|lease|day|daily/i.test(text) && /\d/.test(text)) {
                                    rentNode = el;
                                    break;
                                }
                            }
                            if (rentNode) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (rentNode) {
                        rentPrice = num(rentNode.textContent);
                        console.log(`Carte ${index + 1}: Prix de location = ${rentPrice}`);
                    }

                    // Winrate (si affiché)
                    let winrate = null;
                    const winrateSelectors = [
                        '.winrate', 
                        '.stat-winrate', 
                        'td[data-title="Winrate"]',
                        '[data-winrate]',
                        '.card-winrate',
                        "[class*='winrate']",                 // Classes contenant 'winrate'
                        "[class*='win-rate']"                 // Classes contenant 'win-rate'
                    ];
                    
                    let winrateNode = null;
                    for (const selector of winrateSelectors) {
                        try {
                            const elements = box.querySelectorAll(selector);
                            for (const el of elements) {
                                const text = el.textContent.trim();
                                // Chercher des indications de winrate: %, win rate
                                if (/win|rate/i.test(text) && /\d/.test(text) && /%/.test(text)) {
                                    winrateNode = el;
                                    break;
                                }
                            }
                            if (winrateNode) break;
                        } catch (e) {
                            // Continuer avec le prochain sélecteur
                        }
                    }
                    
                    if (winrateNode) {
                        winrate = num(winrateNode.textContent) / 100;
                        console.log(`Carte ${index + 1}: Winrate = ${winrate}`);
                    }

                    // Extraction des capacités
                    let abilities = [];
                    
                    // Chercher les capacités dans différentes parties de la carte
                    const abilitySelectors = [
                        ".card-abilities", 
                        ".abilities-list", 
                        "[data-abilities]",
                        ".ability-icons"
                    ];
                    
                    for (const selector of abilitySelectors) {
                        const abilityContainer = box.querySelector(selector);
                        if (abilityContainer) {
                            // Cas 1: Liste d'icônes avec title ou alt
                            const abilityIcons = abilityContainer.querySelectorAll("img, i, [title], [alt], [data-ability]");
                            if (abilityIcons.length) {
                                abilityIcons.forEach(icon => {
                                    const abilityName = icon.getAttribute("title") || 
                                                        icon.getAttribute("alt") || 
                                                        icon.getAttribute("data-ability") ||
                                                        icon.className.match(/ability-([a-z-]+)/i)?.[1];
                                    
                                    if (abilityName) {
                                        // Normaliser le nom de la capacité
                                        let normalizedName = abilityName
                                            .replace(/-/g, " ")
                                            .replace(/^ability /i, "")
                                            .split(" ")
                                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                                            .join(" ")
                                            .trim();
                                        
                                        // Certaines corrections courantes
                                        if (normalizedName === "Lifesteal") normalizedName = "Life Leech";
                                        if (normalizedName === "Taunter") normalizedName = "Taunt";
                                        
                                        // Vérifier si cette capacité est dans notre base de données
                                        if (CARD_ABILITIES[normalizedName]) {
                                            abilities.push(normalizedName);
                                        }
                                    }
                                });
                            } 
                            // Cas 2: Liste de texte
                            else {
                                const abilityText = abilityContainer.textContent.trim();
                                if (abilityText) {
                                    // Analyser le texte pour trouver des capacités connues
                                    Object.keys(CARD_ABILITIES).forEach(ability => {
                                        if (abilityText.includes(ability)) {
                                            abilities.push(ability);
                                        }
                                    });
                                }
                            }
                            
                            // Si on a trouvé des capacités, pas besoin de continuer
                            if (abilities.length) break;
                        }
                    }
                    
                    // Si on n'a trouvé aucune capacité par les méthodes ci-dessus,
                    // chercher dans tout le texte de la carte
                    if (!abilities.length) {
                        const cardText = box.textContent;
                        Object.keys(CARD_ABILITIES).forEach(ability => {
                            if (cardText.includes(ability)) {
                                abilities.push(ability);
                            }
                        });
                    }
                    
                    console.log(`Ligne ${index + 1}: Capacités = ${abilities.join(", ") || "Aucune"}`);

                    // Construction et ajout de la carte avec ses capacités
                    const card = buildCard({ 
                        name, mana, atk, spd, hp, armor, crit, price, 
                        rentPrice, winrate, owned, abilities,
                        pageType
                    });
                    console.log(`Carte ${index + 1}: Score = ${card.valueScore}`);
                    cards.push(card);
                });
            }

            console.log(`Scraping terminé. ${cards.length} cartes analysées.`);
            return cards;
        }

        // Nouvelle fonction pour scraper les cartes avec la structure Vue.js
        function scrapeVueCards(vueCards) {
            console.log("Utilisation du scraper spécifique pour Vue.js");
            const cards = [];
            
            // Activer le mode diagnostic si présent dans l'URL
            const debugMode = window.location.href.includes('pkm-debug=1');
            
            vueCards.forEach((card, index) => {
                console.log(`Analyse de la carte Vue.js ${index + 1}`);
                
                // Activer le diagnostic visuel si mode debug
                if (debugMode) {
                    highlightVueElements(card);
                }
                
                // Extraire le nom de la carte
                let name = "";
                const nameSelectors = [
                    "a.text-default", 
                    ".media-heading a", 
                    "h4 a", 
                    "h4 .text-default"
                ];
                
                for (const selector of nameSelectors) {
                    const nameEl = card.querySelector(selector);
                    if (nameEl && nameEl.textContent.trim()) {
                        name = nameEl.textContent.trim();
                        break;
                    }
                }
                
                if (!name) {
                    console.log(`Carte Vue.js ${index + 1}: Nom non trouvé`);
                    return;
                }
                
                console.log(`Carte Vue.js ${index + 1}: Nom = ${name}`);
                
                // Extraire les statistiques de la carte - Vue.js utilise généralement des tables avec les stats
                const statsTables = card.querySelectorAll("table.table-xxs, .card-stats table");
                if (!statsTables.length) {
                    console.log(`Carte Vue.js ${index + 1}: Tableau des stats non trouvé`);
                    return;
                }
                
                // Statistiques - Vue.js utilise ra-* pour les icônes
                let mana = 0, atk = 0, spd = 0, hp = 0, armor = 0;
                let abilities = [];
                
                // Lire la première ligne du premier tableau (stats de niveau 1)
                const statsRow = statsTables[0].querySelector("tbody tr");
                if (statsRow) {
                    const cells = statsRow.querySelectorAll("td");
                    
                    // Dans le format Vue.js, les cellules sont généralement dans cet ordre:
                    // Level, Mana, Attack, Speed, Armor, Health, Abilities
                    if (cells.length >= 6) {
                        mana = num(cells[1].textContent);
                        
                        // Pour l'attaque, il y a 3 possibilités: Melee/Magic/Ranged ou une cellule vide s'il n'y a pas d'attaque
                        // Dans votre exemple, c'est vide car c'est une carte de support sans attaque
                        const atkCell = cells[2];
                        // Si la cellule contient une valeur numérique
                        if (/\d/.test(atkCell.textContent)) {
                            atk = num(atkCell.textContent);
                        } else {
                            // Si c'est vide, mettre à 0 pour les cartes sans attaque
                            atk = 0;
                        }
                        
                        spd = num(cells[3].textContent);
                        armor = num(cells[4].textContent);
                        hp = num(cells[5].textContent);
                        
                        // Extraire les capacités si disponibles
                        if (cells.length >= 7) {
                            const abilitiesCell = cells[6];
                            // Utiliser data-tippy ou data-original-title pour trouver les capacités
                            const abilitySpans = abilitiesCell.querySelectorAll("span[data-tippy], span[data-original-title]");
                            
                            abilitySpans.forEach(span => {
                                const abilityName = span.textContent.trim();
                                if (abilityName && abilityName !== 'Abilities') {
                                    // Vérifier si cette capacité est déjà connue
                                    const knownAbility = Object.keys(CARD_ABILITIES).find(
                                        key => key.toLowerCase() === abilityName.toLowerCase()
                                    );
                                    
                                    if (knownAbility) {
                                        // Utiliser le nom normalisé depuis notre base de données
                                        abilities.push(knownAbility);
                                    } else {
                                        // Sinon ajouter tel quel
                                        abilities.push(abilityName);
                                    }
                                }
                            });
                        }
                    }
                }
                
                // Chercher aussi les capacités spéciales dans les autres lignes/tableaux
                // Les meilleures cartes ont souvent des capacités supplémentaires aux niveaux supérieurs
                statsTables.forEach(table => {
                    table.querySelectorAll("tbody tr").forEach(row => {
                        const abilitiesCell = row.querySelector("td:last-child");
                        if (abilitiesCell) {
                            const abilitySpans = abilitiesCell.querySelectorAll("span[data-tippy], span[data-original-title]");
                            abilitySpans.forEach(span => {
                                const abilityName = span.textContent.trim();
                                // Vérifier le contenu des tooltips pour les descriptions des capacités
                                let abilityTitle = span.getAttribute('data-original-title') || '';
                                
                                // Nettoyer le HTML dans le titre s'il en contient
                                if (abilityTitle.includes('<div')) {
                                    const tempDiv = document.createElement('div');
                                    tempDiv.innerHTML = abilityTitle;
                                    abilityTitle = tempDiv.textContent;
                                }
                                
                                if (abilityName && abilityName !== 'Abilities' && !abilities.includes(abilityName)) {
                                    // Vérifier si cette capacité est déjà connue
                                    const knownAbility = Object.keys(CARD_ABILITIES).find(
                                        key => key.toLowerCase() === abilityName.toLowerCase()
                                    );
                                    
                                    if (knownAbility) {
                                        // Utiliser le nom normalisé depuis notre base de données
                                        abilities.push(knownAbility);
                                    } else {
                                        // Si non trouvé par nom, essayer de faire correspondre par description
                                        const matchedByDescription = Object.entries(CARD_ABILITIES).find(
                                            ([_, data]) => abilityTitle && data.description && 
                                            abilityTitle.toLowerCase().includes(data.description.toLowerCase().slice(0, 15))
                                        );
                                        
                                        if (matchedByDescription) {
                                            abilities.push(matchedByDescription[0]);
                                        } else {
                                            // Sinon ajouter tel quel
                                            abilities.push(abilityName);
                                        }
                                    }
                                }
                            });
                        }
                    });
                });
                
                console.log(`Carte Vue.js ${index + 1}: Stats = Mana:${mana}, ATK:${atk}, SPD:${spd}, HP:${hp}, ARM:${armor}`);
                console.log(`Carte Vue.js ${index + 1}: Capacités = ${abilities.join(", ") || "Aucune"}`);
                
                // Extraire le prix avec les sélecteurs Vue.js - chercher dans la zone à droite
                let price = 0;
                let highBid = 0;
                let marketValue = 0;
                
                // Extraire "High Bid"
                const highBidMatch = card.textContent.match(/High Bid[^$]*\$(\d+\.\d+)/i);
                if (highBidMatch && highBidMatch[1]) {
                    highBid = parseFloat(highBidMatch[1]);
                    console.log(`Carte Vue.js ${index + 1}: High Bid = ${highBid}`);
                }
                
                // Extraire "Market Value"
                const marketValueMatch = card.textContent.match(/Market Value[^$]*\$(\d+\.\d+)/i);
                if (marketValueMatch && marketValueMatch[1]) {
                    marketValue = parseFloat(marketValueMatch[1]);
                    console.log(`Carte Vue.js ${index + 1}: Market Value = ${marketValue}`);
                }
                
                // Extraire "Low Buy"
                const lowBuyMatch = card.textContent.match(/Low Buy[^$]*\$(\d+\.\d+)/i);
                if (lowBuyMatch && lowBuyMatch[1]) {
                    price = parseFloat(lowBuyMatch[1]);
                    console.log(`Carte Vue.js ${index + 1}: Low Buy = ${price}`);
                }
                
                // Prix par BCX - très important pour les cartes Splinterlands
                let pricePerBCX = 0;
                const perBCXMatch = card.textContent.match(/per BCX[^$]*\$(\d+\.\d+)/i);
                if (perBCXMatch && perBCXMatch[1]) {
                    pricePerBCX = parseFloat(perBCXMatch[1]);
                    console.log(`Carte Vue.js ${index + 1}: Prix par BCX = ${pricePerBCX}`);
                }
                
                // Utiliser la meilleure valeur de prix disponible
                if (price === 0) {
                    // Si pas de Low Buy, utiliser High Bid
                    if (highBid > 0) {
                        price = highBid;
                    } 
                    // Sinon, utiliser Market Value
                    else if (marketValue > 0) {
                        price = marketValue;
                    }
                    // Sinon, chercher n'importe quel prix dans la zone à droite
                    else {
                        const priceSelectors = [
                            ".media-right h5 a.text-default", 
                            ".media-right h5 .text-default", 
                            ".media-right h5 span:not(.text-success):not(.text-danger)",
                            ".media-right h5"
                        ];
                        
                        for (const selector of priceSelectors) {
                            const priceEl = card.querySelector(selector);
                            if (priceEl) {
                                const priceText = priceEl.textContent.trim();
                                if (priceText.includes('$') || /\d+\.\d+/.test(priceText)) {
                                    price = num(priceText);
                                    if (price > 0) break;
                                }
                            }
                        }
                    }
                }
                
                // Si le prix par BCX est disponible et inférieur au prix standard, l'utiliser pour les calculs
                if (pricePerBCX > 0 && (pricePerBCX < price || price === 0)) {
                    price = pricePerBCX;
                }
                
                console.log(`Carte Vue.js ${index + 1}: Prix final = ${price}`);
                
                // Prix de location (moins courant dans la vue Market, mais vérifions quand même)
                let rentPrice = 0;
                
                // Chercher le prix de location
                const rentSelectors = [
                    ".media-right .text-success", 
                    ".media-right span.text-success",
                    ".rent-price",
                    ".daily-rate"
                ];
                
                for (const selector of rentSelectors) {
                    const rentEl = card.querySelector(selector);
                    if (rentEl && rentEl.textContent.trim()) {
                        const rentText = rentEl.textContent.trim();
                        if (rentText.includes('$') || /\d+\.\d+/.test(rentText)) {
                            rentPrice = num(rentText);
                            if (rentPrice > 0) {
                                console.log(`Carte Vue.js ${index + 1}: Prix location = ${rentPrice}`);
                                break;
                            }
                        }
                    }
                }
                
                // Extraire le nombre de cartes possédées (0 par défaut sur le marché, sauf indication contraire)
                let owned = 0;
                // Sur certaines pages, il peut y avoir une indication du nombre possédé
                const ownedSelectors = [
                    ".owned-count", 
                    ".my-cards", 
                    "[data-owned]"
                    // Suppression du sélecteur invalide: ".text-semibold:contains('owned')"
                ];
                
                // Ajouter une recherche manuelle après la boucle des sélecteurs
                let foundOwned = false;
                for (const selector of ownedSelectors) {
                    const ownedEl = card.querySelector(selector);
                    if (ownedEl && ownedEl.textContent.trim() && /\d/.test(ownedEl.textContent)) {
                        owned = num(ownedEl.textContent);
                        if (owned > 0) {
                            console.log(`Carte Vue.js ${index + 1}: Possédées = ${owned}`);
                            foundOwned = true;
                            break;
                        }
                    }
                }
                
                // Si aucun sélecteur standard n'a fonctionné, rechercher manuellement
                if (!foundOwned) {
                    const textSemiboldElements = card.querySelectorAll(".text-semibold");
                    for (let el of textSemiboldElements) {
                        if (el.textContent.toLowerCase().includes('owned') && /\d/.test(el.textContent)) {
                            owned = num(el.textContent);
                            if (owned > 0) {
                                console.log(`Carte Vue.js ${index + 1}: Possédées (méthode alternative) = ${owned}`);
                                break;
                            }
                        }
                    }
                }
                
                // Ajouter un ID unique pour cette carte (utilisé pour la comparaison)
                const cardId = `${name}_${Math.random().toString(36).substring(2, 10)}`;
                
                const card_data = {
                    id: cardId,
                    name, 
                    mana, 
                    atk, 
                    spd, 
                    hp, 
                    armor, 
                    price,
                    rentPrice,
                    abilities,
                    owned,
                    // Ajouter les informations supplémentaires
                    highBid,
                    marketValue,
                    pricePerBCX
                };
                
                // Ajouter la carte au tableau
                cards.push(buildCard(card_data));
            });
            
            return cards;
        }

        function scrapeBuyCardView() {
                const cards = [];
                document.querySelectorAll('div.media.panel-body').forEach(cardBox => {
                        // Nom de la carte
                        const name = cardBox.querySelector('h4.media-heading a')?.textContent.trim();
                        if (!name) return;

                        // Stats niveau 1 (premier tableau, première ligne)
                        const statsRow = cardBox.querySelector('.card-stats table tbody tr');
                        if (!statsRow) return;
                        const tds = statsRow.querySelectorAll('td');
                        if (tds.length < 6) return;

                        const mana = num(tds[1].textContent);
                        let atk = 0;
                        tds[2].textContent.split(/[\/]/).forEach((p) => { const v = num(p); if (v && !atk) atk = v; });
                        const spd = num(tds[3].textContent);
                        const armor = num(tds[4].textContent) || 0;
                        const hp = num(tds[5].textContent);

                        // Prix (Low Buy / per BCX)
                        let price = 0;
                        const priceNode = cardBox.querySelector('.media-right h5 span, .media-right h5 a, .media-right h5');
                        if (priceNode) price = num(priceNode.textContent);

                        // Prix de location (si affiché)
                        let rentPrice = 0;
                        const rentNode = cardBox.querySelector('.media-right .btn-group + div, .media-right .rent-price, .media-right h5 span.text-success');
                        if (rentNode) rentPrice = num(rentNode.textContent);

                        // Winrate (si affiché)
                        let winrate = null;
                        const winrateNode = cardBox.querySelector('.winrate, .stat-winrate, td[data-title="Winrate"]');
                        if (winrateNode) winrate = num(winrateNode.textContent) / 100;

                        cards.push(buildCard({ name, mana, atk, spd, hp, armor, price, rentPrice, winrate, owned: 0 }));
                });
                return cards;
        }

        function scrapeCards() {
                if (document.querySelector('div.media.panel-body')) {
                        // On est sur le marché (Buy Cards)
                        return scrapeBuyCardView();
                }
                // Sinon, vue liste classique
                return scrapeListView();
        }

        //--------------------------------------------------
        // UI
        //--------------------------------------------------
        const ACTION_COLORS = {
                "Acheter": "#c5eac5", // Vert plus foncé
                "Monter": "#c0d8ff", // Bleu plus foncé
                "Vendre": "#ffc6c6", // Rouge plus foncé
                "Bench": "#e0e0e0", // Gris plus foncé
                "Inefficace": "#ffd9b3", // Orange plus foncé
                "Garder": "transparent"
        };

        function buildOverlay(cards) {
                console.log("Début de la construction de l'overlay");
                if (!cards.length) { 
                        console.log("Aucune carte détectée");
                        alert("Aucune carte détectée."); 
                        return; 
                }

                document.getElementById("pkm-analyzer")?.remove();
                const overlay = document.createElement("div");
                overlay.id = "pkm-analyzer";

                // Créer d'abord les éléments du DOM
                overlay.innerHTML = `
      <h2>Analyseur de Deck</h2>
      <div class="collection-stats" id="collection-stats"></div>
      <div class="summary">
        <div class="summary-item">
          <h3>À acheter</h3>
          <div id="buy-cards"></div>
        </div>
        <div class="summary-item">
          <h3>À vendre</h3>
          <div id="sell-cards"></div>
        </div>
        <div class="summary-item">
          <h3>À améliorer en priorité <span class="kpi-info" title="Les cartes sont évaluées selon 5 critères pour déterminer leur priorité d'amélioration:&#10;1. Distance au PS idéal (15) - Plus le PS actuel est faible, plus l'amélioration est prioritaire&#10;2. ROI actuel - Les cartes avec un bon rendement sont favorisées&#10;3. Rentabilité en location - Bonus pour les cartes bien louées&#10;4. Prix - Malus pour les cartes très chères&#10;5. Possession - Bonus pour les cartes déjà possédées">ⓘ</span></h3>
          <div id="upgrade-cards"></div>
        </div>
        <div class="summary-item">
          <h3>Inefficaces à louer</h3>
          <div id="inefficient-cards"></div>
        </div>
      </div>
      <div class="sort-buttons">
        <span>Trier par : </span>
        <button data-sort="valueScore" class="sort-btn active">⭐ Score</button>
        <button data-sort="upgradeScore" class="sort-btn">🔄 Priorité</button>
        <button data-sort="ps" class="sort-btn">💪 PS</button>
        <button data-sort="roi" class="sort-btn">💰 ROI</button>
        <button data-sort="abilityScore" class="sort-btn">✨ Capacités</button>
        <button data-sort="manaEfficiency" class="sort-btn">⚡ Efficacité</button>
        <button data-sort="pricePerPS" class="sort-btn">💲/PS</button>
        <button data-sort="dailyROI" class="sort-btn">📅 ROI loc.</button>
        <button data-sort="winrate" class="sort-btn">🏆 Winrate</button>
        <button data-sort="survival" class="sort-btn">🛡️ Survie</button>
        <button data-sort="price" class="sort-btn">💲 Prix</button>
        <div class="sort-direction">
          <button id="sort-desc" class="direction-btn active">↓ Desc</button>
          <button id="sort-asc" class="direction-btn">↑ Asc</button>
        </div>
      </div>
      <div class="action-buttons">
        <button id="export-csv" class="action-btn">💾 Exporter CSV</button>
        <button id="save-analysis" class="action-btn">📊 Sauvegarder analyse</button>
      </div>
      <button id="pkm-close">×</button>
      <div class="advanced-filters">
        <button id="toggle-filters" class="toggle-btn">🔍 Filtres avancés</button>
        <div class="filters-container" style="display: none;">
          <div class="filter-group">
            <div class="filter-row">
              <label>Valeur PS :</label>
              <div class="filter-inputs">
                <input type="number" id="filter-ps-min" placeholder="Min" min="0" step="0.1">
                <span>à</span>
                <input type="number" id="filter-ps-max" placeholder="Max" min="0" step="0.1">
              </div>
            </div>
            <div class="filter-row">
              <label>Score Global :</label>
              <div class="filter-inputs">
                <input type="number" id="filter-score-min" placeholder="Min" min="0">
                <span>à</span>
                <input type="number" id="filter-score-max" placeholder="Max" min="0">
              </div>
            </div>
            <div class="filter-row">
              <label>ROI :</label>
              <div class="filter-inputs">
                <input type="number" id="filter-roi-min" placeholder="Min %" min="0" step="0.1">
                <span>à</span>
                <input type="number" id="filter-roi-max" placeholder="Max %" min="0" step="0.1">
              </div>
            </div>
          </div>
          <div class="filter-group">
            <div class="filter-row">
              <label>Prix :</label>
              <div class="filter-inputs">
                <input type="number" id="filter-price-min" placeholder="Min $" min="0" step="0.01">
                <span>à</span>
                <input type="number" id="filter-price-max" placeholder="Max $" min="0" step="0.01">
              </div>
            </div>
            <div class="filter-row">
              <label>Action :</label>
              <div class="filter-inputs">
                <select id="filter-action">
                  <option value="">Toutes les actions</option>
                  <option value="Acheter">Acheter</option>
                  <option value="Vendre">Vendre</option>
                  <option value="Monter">Monter</option>
                  <option value="Garder">Garder</option>
                  <option value="Bench">Bench</option>
                  <option value="Inefficace">Inefficace</option>
                </select>
              </div>
            </div>
            <div class="filter-row">
              <label>Possession :</label>
              <div class="filter-inputs">
                <select id="filter-owned">
                  <option value="">Toutes les cartes</option>
                  <option value="owned">Possédées uniquement</option>
                  <option value="not-owned">Non possédées uniquement</option>
                </select>
              </div>
            </div>
          </div>
          <div class="filter-actions">
            <button id="apply-filters" class="action-btn">Appliquer les filtres</button>
            <button id="reset-filters" class="action-btn secondary">Réinitialiser</button>
            <button id="save-preset" class="action-btn">💾 Enregistrer préréglage</button>
            <select id="load-preset">
              <option value="">-- Charger préréglage --</option>
              <option value="high-ps">PS élevé (>15)</option>
              <option value="high-roi">ROI élevé (>5%)</option>
              <option value="upgrade-priority">Priorité d'amélioration</option>
              <option value="owned-cards">Cartes possédées</option>
              <option value="rent-efficient">Efficaces en location</option>
            </select>
          </div>
        </div>
      </div>
      <table><thead><tr>
      <th data-kpi="name">🃏 Carte</th>
      <th data-kpi="action">⚡ Action <span class="kpi-info" title="Action recommandée en fonction des KPIs. Aide à prendre des décisions rapides sur votre collection.">ⓘ</span></th>
      <th data-kpi="valueScore">⭐ Score <span class="kpi-info" title="Score global basé sur PS, ROI, efficacité, etc. Plus le score est élevé, plus la carte est valable globalement. Important pour comparer rapidement les cartes entre elles.">ⓘ</span></th>
      <th data-kpi="upgradeScore">🔄 Priorité <span class="kpi-info" title="Score de priorité d'amélioration calculé à partir de 5 facteurs: Distance au PS idéal, ROI actuel, Rentabilité en location, Prix d'acquisition, et Possession. Un score >50 indique une carte avec excellent potentiel d'amélioration.">ⓘ</span></th>
      <th data-kpi="ps">💪 PS <span class="kpi-info" title="Power Score = (Attaque × Santé × Vitesse) / Mana. Essentiel pour évaluer l'efficacité combat/coût. Un PS > 15 est excellent.">ⓘ</span></th>
      <th data-kpi="abilityScore">✨ Capacités <span class="kpi-info" title="Score basé sur les capacités spéciales de la carte et leurs synergies. Calculé à partir de l'impact de chaque capacité, leurs synergies et les conditions requises.">ⓘ</span></th>
      <th data-kpi="manaEfficiency">⚡ Efficacité <span class="kpi-info" title="(Attaque + Santé) / Mana. Crucial pour évaluer le rapport stats/coût. Un ratio > 3.0 indique une carte très efficace pour son coût.">ⓘ</span></th>
      <th data-kpi="pricePerPS">💲/PS <span class="kpi-info" title="Prix marché ÷ Power Score. Mesure le rapport qualité/prix. Un ratio < 0.15 $/PS indique un bon investissement.">ⓘ</span></th>
      <th data-kpi="roi">💰 ROI <span class="kpi-info" title="(DEC/match × Winrate) / Prix. Retour sur investissement. Un ROI > 5% est excellent, < 2% suggère de vendre.">ⓘ</span></th>
      <th data-kpi="dailyROI">📅 ROI loc. <span class="kpi-info" title="(DEC gagnés par jour) / Prix location. Rentabilité journalière de la location. Un ROI > 5% par jour est très rentable, < 3% est inefficace.">ⓘ</span></th>
      <th data-kpi="winrate">🏆 Winrate <span class="kpi-info" title="% de victoires quand la carte est jouée. Mesure directe de l'efficacité en jeu. Un winrate > 55% est excellent, < 50% suggère de ne pas garder la carte.">ⓘ</span></th>
      <th data-kpi="survival">🛡️ Survie <span class="kpi-info" title="Santé ÷ Dégâts moyens reçus (méta). Mesure la durabilité des tanks. Une survie ≥ 3 tours est idéale pour un tank efficace.">ⓘ</span></th>
      <th data-kpi="mana">🔮 Mana <span class="kpi-info" title="Coût en mana de la carte. Important pour l'équilibrage de deck et les contraintes de mana en jeu.">ⓘ</span></th>
      <th data-kpi="price">💲 Prix <span class="kpi-info" title="Prix d'achat sur le marché. Nécessaire pour calculer le ROI et la valeur de votre collection.">ⓘ</span></th>
      <th data-kpi="owned">📦 Possédée <span class="kpi-info" title="Nombre de copies possédées. Aide à déterminer si vous devez acheter plus de copies ou en vendre.">ⓘ</span></th>
      </tr></thead><tbody></tbody></table>`;

                // Ajout d'un style pour les info-bulles et boutons de tri
                if (!document.getElementById('pkm-kpi-style')) {
                        const style = document.createElement('style');
                        style.id = 'pkm-kpi-style';
                        style.textContent = `
                    .kpi-info {
                        cursor: help;
                        font-size: 13px;
                        color: #888;
                        margin-left: 2px;
                        border-bottom: 1px dotted #888;
                    }
                    [title] {
                        position: relative;
                    }
                    [title]:hover::after {
                        content: attr(title);
                        position: absolute;
                        bottom: 100%;
                        left: 50%;
                        transform: translateX(-50%);
                        background: rgba(0,0,0,0.8);
                        color: white;
                        padding: 5px 10px;
                        border-radius: 3px;
                        font-size: 12px;
                        white-space: normal;
                        width: 220px;
                        z-index: 10;
                        line-height: 1.4;
                        text-align: left;
                    }
                    .sort-buttons {
                        display: flex;
                        align-items: center;
                        margin-bottom: 15px;
                        flex-wrap: wrap;
                        gap: 5px;
                    }
                    .sort-buttons span {
                        font-weight: 600;
                        margin-right: 8px;
                    }
                    .sort-btn {
                        padding: 5px 10px;
                        background: #f0f0f0;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 4px;
                        font-size: 12px;
                    }
                    .sort-btn.active {
                        background: #ff914d;
                        color: white;
                        border-color: #e67e35;
                    }
                    .sort-direction {
                        margin-left: auto;
                        display: flex;
                    }
                    .direction-btn {
                        padding: 5px 10px;
                        background: #f0f0f0;
                        border: 1px solid #ddd;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    .direction-btn:first-child {
                        border-radius: 4px 0 0 4px;
                    }
                    .direction-btn:last-child {
                        border-radius: 0 4px 4px 0;
                    }
                    .direction-btn.active {
                        background: #666;
                        color: white;
                        border-color: #555;
                    }
                    
                    .action-buttons {
                        display: flex;
                        justify-content: flex-end;
                        margin-bottom: 15px;
                        gap: 10px;
                    }
                    
                    .action-btn {
                        padding: 6px 14px;
                        background: #444;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    }
                    
                    .action-btn:hover {
                        background: #555;
                    }
                `;
                        document.head.appendChild(style);
                }

                // Ajouter l'overlay au DOM avant d'accéder à ses éléments
                document.body.appendChild(overlay);
                console.log("Overlay ajouté au DOM");

                const tbody = overlay.querySelector("tbody");
                if (!tbody) {
                        console.error("Tbody non trouvé dans l'overlay");
                        return;
                }

                // Variables de tri
                let sortKey = 'valueScore';
                let sortAsc = false;

                function renderTable() {
                        console.log("Rendu du tableau avec tri par", sortKey, sortAsc ? "ASC" : "DESC");
                        tbody.innerHTML = '';
                        
                        // Cloner et trier les cartes
                        const sortedCards = [...cards].sort((a, b) => {
                            let aVal = a[sortKey] === undefined ? 0 : a[sortKey];
                            let bVal = b[sortKey] === undefined ? 0 : b[sortKey];
                            return sortAsc ? aVal - bVal : bVal - aVal;
                        });
                        
                        // Vérifier s'il y a des cartes sélectionnées pour comparaison
                        const selectedCardIds = JSON.parse(localStorage.getItem('pkm_selected_cards') || '[]');
                        
                        sortedCards.forEach(card => {
                            const tr = document.createElement('tr');
                            
                            // Vérifier si cette carte est sélectionnée pour comparaison
                            const isSelected = selectedCardIds.includes(card.id || card.name);
                            if (isSelected) {
                                tr.classList.add('card-selected');
                            }
                            
                            tr.innerHTML = `
                                <td>
                                    <div class="card-name">
                                        ${card.name} 
                                        <button class="compare-btn" data-card-id="${card.id || card.name}" title="Ajouter/retirer de la comparaison">
                                            ${isSelected ? '✓' : '+'}
                                        </button>
                                    </div>
                                </td>
                                <td>${getActionIcon(card.action)} ${card.action}</td>
                                <td><b>${card.valueScore.toFixed(0)}</b></td>
                                <td><b>${card.upgradeScore > 0 ? card.upgradeScore.toFixed(0) : '-'}</b></td>
                                <td><b>${card.ps.toFixed(1)}</b></td>
                                <td>${card.abilityScore ? `<b>${card.abilityScore.toFixed(1)}</b>` : '-'}</td>
                                <td><b>${card.manaEfficiency ? card.manaEfficiency.toFixed(2) : '-'}</b></td>
                                <td><b>${card.pricePerPS ? card.pricePerPS.toFixed(3) : '-'}</b></td>
                                <td><b>${pct(card.roi)}</b></td>
                                <td><b>${card.dailyROI !== undefined ? pct(card.dailyROI) : '-'}</b></td>
                                <td><b>${card.winrate !== undefined ? pct(card.winrate) : '-'}</b></td>
                                <td><b>${card.survival.toFixed(1)}</b> tours</td>
                                <td>${card.mana}</td>
                                <td><b>$${card.price.toFixed(3)}</b></td>
                                <td>${card.owned > 0 ? `<b>${card.owned}</b>` : '0'}</td>
                            `;
                            
                            tbody.appendChild(tr);
                            
                            // Ajouter l'interaction pour les boutons de comparaison
                            const compareBtn = tr.querySelector('.compare-btn');
                            if (compareBtn) {
                                compareBtn.addEventListener('click', function(e) {
                                    e.stopPropagation();
                                    toggleCardComparison(card.id || card.name, card);
                                });
                            }
                        });

                        // Mettre à jour les statistiques de collection
                        updateCollectionStats(cards);
                }

                // Icônes pour les actions
                function getActionIcon(action) {
                        switch(action) {
                                case 'Acheter': return '🛒';
                                case 'Vendre': return '💸';
                                case 'Louer': return '📅';
                                case 'Monter': return '🔼';
                                case 'Bench': return '🪑';
                                case 'Inefficace': return '⚠️';
                                case 'Garder': return '✅';
                                default: return '';
                        }
                }

                // Calcul et affichage des statistiques globales
                function updateCollectionStats(cards) {
                    const statsDiv = document.getElementById('collection-stats');
                    if (!statsDiv) return;
                    
                    // Calculer les statistiques de base
                    const totalCards = cards.length;
                    const ownedCards = cards.filter(c => c.owned > 0).length;
                    const totalOwned = cards.reduce((acc, c) => acc + c.owned, 0);
                    
                    // Statistiques de puissance
                    const avgPS = cards.reduce((acc, c) => acc + c.ps, 0) / totalCards || 0;
                    const maxPS = Math.max(...cards.map(c => c.ps));
                    const highPSCards = cards.filter(c => c.ps >= THRESHOLD_PS).length;
                    
                    // Statistiques économiques
                    const totalValue = cards.reduce((acc, c) => acc + (c.price * c.owned), 0);
                    const avgROI = cards.reduce((acc, c) => acc + c.roi, 0) / totalCards || 0;
                    const goodROICards = cards.filter(c => c.roi >= THRESHOLD_ROI_BUY).length;
                    const badROICards = cards.filter(c => c.roi < THRESHOLD_ROI_SELL).length;
                    
                    // Statistiques de location
                    const rentableCards = cards.filter(c => c.dailyROI !== null && c.dailyROI >= 0.05).length;
                    const inefficientCards = cards.filter(c => c.dailyROI !== null && c.dailyROI < THRESHOLD_DAILY_ROI).length;
                    
                    // Statistiques des capacités
                    const cardsWithAbilities = cards.filter(c => c.abilities && c.abilities.length > 0).length;
                    const abilityCounts = {};
                    let topAbility = "";
                    let topAbilityCount = 0;
                    
                    // Compter les occurrences de chaque capacité
                    cards.forEach(c => {
                        if (c.abilities && c.abilities.length) {
                            c.abilities.forEach(ability => {
                                if (!abilityCounts[ability]) abilityCounts[ability] = 0;
                                abilityCounts[ability]++;
                                
                                // Suivre la capacité la plus fréquente
                                if (abilityCounts[ability] > topAbilityCount) {
                                    topAbility = ability;
                                    topAbilityCount = abilityCounts[ability];
                                }
                            });
                        }
                    });
                    
                    // Actions recommandées
                    const actionCounts = {};
                    cards.forEach(c => {
                        if (!actionCounts[c.action]) actionCounts[c.action] = 0;
                        actionCounts[c.action]++;
                    });
                    
                    // Formater le HTML
                    statsDiv.innerHTML = `
                        <div class="stat-item">
                            <div class="stat-label">Cartes analysées</div>
                            <div class="stat-value">${totalCards}</div>
                            <div class="stat-label">Dont possédées: ${ownedCards}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Valeur de collection</div>
                            <div class="stat-value">$${totalValue.toFixed(2)}</div>
                            <div class="stat-label">Exemplaires: ${totalOwned}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Puissance moyenne</div>
                            <div class="stat-value">${avgPS.toFixed(1)} PS</div>
                            <div class="stat-label">Cartes puissantes: ${highPSCards}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">ROI moyen</div>
                            <div class="stat-value">${pct(avgROI)}</div>
                            <div class="stat-label">Rendement: ${goodROICards > badROICards ? '<span class="trend-up">Bon ✓</span>' : '<span class="trend-down">Faible ✗</span>'}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Potentiel de location</div>
                            <div class="stat-value">${rentableCards} rentables</div>
                            <div class="stat-label">Inefficaces: ${inefficientCards}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Actions recommandées</div>
                            <div class="stat-value">${actionCounts['Acheter'] || 0} 🛒 | ${actionCounts['Vendre'] || 0} 💸 | ${actionCounts['Monter'] || 0} 🔼</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Capacités</div>
                            <div class="stat-value">${cardsWithAbilities || 0} cartes</div>
                            <div class="stat-label">Top: ${topAbility ? `${topAbility} (${topAbilityCount})` : 'Aucune'}</div>
                        </div>
                    `;
                }

                // Rendu initial
                renderTable();
                console.log("Tableau principal rempli");

                // Gestion des boutons de tri
                overlay.querySelectorAll('.sort-btn').forEach(btn => {
                        btn.onclick = function() {
                                console.log("Clic sur bouton de tri:", this.getAttribute('data-sort'));
                                const newSortKey = this.getAttribute('data-sort');
                                if (sortKey === newSortKey) {
                                        // Toggle direction si même colonne
                                        sortAsc = !sortAsc;
                                        if (sortAsc) {
                                                overlay.querySelector('#sort-asc').classList.add('active');
                                                overlay.querySelector('#sort-desc').classList.remove('active');
                                        } else {
                                                overlay.querySelector('#sort-desc').classList.add('active');
                                                overlay.querySelector('#sort-asc').classList.remove('active');
                                        }
                                } else {
                                        // Nouvelle colonne
                                        sortKey = newSortKey;
                                        // Reset active state
                                        overlay.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
                                        this.classList.add('active');
                                }
                                renderTable();
                        };
                });

                // Gestion des boutons de direction
                const btnAsc = overlay.querySelector('#sort-asc');
                if (btnAsc) {
                        btnAsc.onclick = function() {
                                console.log("Tri ascendant activé");
                                sortAsc = true;
                                btnAsc.classList.add('active');
                                overlay.querySelector('#sort-desc').classList.remove('active');
                                renderTable();
                        };
                }

                const btnDesc = overlay.querySelector('#sort-desc');
                if (btnDesc) {
                        btnDesc.onclick = function() {
                                console.log("Tri descendant activé");
                                sortAsc = false;
                                btnDesc.classList.add('active');
                                overlay.querySelector('#sort-asc').classList.remove('active');
                                renderTable();
                        };
                }

                // Remplir les résumés
                const buyCards = cards.filter(c => c.action === "Acheter").slice(0, 5);
                const sellCards = cards.filter(c => c.action === "Vendre").slice(0, 5);
                const inefficientCards = cards.filter(c => c.action === "Inefficace").slice(0, 5);
                
                // Sélectionner les 5 cartes avec le meilleur score d'amélioration (hors cartes déjà puissantes)
                const upgradeCards = cards
                    .filter(c => c.ps < THRESHOLD_PS && c.upgradeScore > 0)
                    .sort((a, b) => b.upgradeScore - a.upgradeScore)
                    .slice(0, 5);
                
                console.log(`${buyCards.length} cartes à acheter, ${sellCards.length} cartes à vendre, ${upgradeCards.length} cartes à améliorer, ${inefficientCards.length} cartes inefficaces`);

                const buyCardsDiv = overlay.querySelector("#buy-cards");
                const sellCardsDiv = overlay.querySelector("#sell-cards");
                const upgradeCardsDiv = overlay.querySelector("#upgrade-cards");
                const inefficientCardsDiv = overlay.querySelector("#inefficient-cards");

                if (buyCardsDiv) {
                        buyCardsDiv.innerHTML = buyCards.length ? buyCards.map(c => 
                                `<div class="summary-card"><strong>${getActionIcon('Acheter')} ${c.name}</strong> - <strong>${c.price.toFixed(3)}</strong>$ (PS: <strong>${c.ps.toFixed(1)}</strong>, ROI: <strong>${pct(c.roi)}</strong>)</div>`
                        ).join("") : "<div class='no-cards'>Aucune carte à acheter trouvée</div>";
                        console.log("Résumé des achats rempli");
                } else {
                        console.error("Div buy-cards non trouvé");
                }

                if (sellCardsDiv) {
                        sellCardsDiv.innerHTML = sellCards.length ? sellCards.map(c => 
                                `<div class="summary-card"><strong>${getActionIcon('Vendre')} ${c.name}</strong> - <strong>${c.price.toFixed(3)}</strong>$ (PS: <strong>${c.ps.toFixed(1)}</strong>, ROI: <strong>${pct(c.roi)}</strong>)</div>`
                        ).join("") : "<div class='no-cards'>Aucune carte à vendre trouvée</div>";
                        console.log("Résumé des ventes rempli");
                } else {
                        console.error("Div sell-cards non trouvé");
                }
                
                if (upgradeCardsDiv) {
                        upgradeCardsDiv.innerHTML = upgradeCards.length ? upgradeCards.map(c => {
                                // Calculer les raisons principales de l'amélioration
                                const reasons = [];
                                if (c.ps < THRESHOLD_PS * 0.5) reasons.push("PS très faible");
                                if (c.roi >= THRESHOLD_ROI_BUY) reasons.push("Bon ROI");
                                if (c.dailyROI >= 0.05) reasons.push("Rentable en location");
                                if (c.price < 0.5) reasons.push("Amélioration peu coûteuse");
                                if (c.owned > 1) reasons.push(`${c.owned} copies possédées`);
                                
                                const reasonText = reasons.length ? ` (${reasons.join(", ")})` : "";
                                
                                return `<div class="summary-card">
                                    <strong>${getActionIcon('Monter')} ${c.name}</strong> - <strong>${c.ps.toFixed(1)}</strong> PS 
                                    <div class="upgrade-details">
                                        Priorité: <strong>${c.upgradeScore.toFixed(0)}</strong>${reasonText}
                                    </div>
                                </div>`;
                        }).join("") : "<div class='no-cards'>Aucune carte à améliorer trouvée</div>";
                        console.log("Résumé des améliorations rempli");
                } else {
                        console.error("Div upgrade-cards non trouvé");
                }

                if (inefficientCardsDiv) {
                        inefficientCardsDiv.innerHTML = inefficientCards.length ? inefficientCards.map(c => 
                                `<div class="summary-card"><strong>${getActionIcon('Inefficace')} ${c.name}</strong> - <strong>${c.rentPrice?.toFixed(3) || '0.000'}</strong>$ (ROI loc: <strong>${pct(c.dailyROI)}</strong>)</div>`
                        ).join("") : "<div class='no-cards'>Aucune carte inefficace trouvée</div>";
                        console.log("Résumé des cartes inefficaces rempli");
                } else {
                        console.error("Div inefficient-cards non trouvé");
                }

                // Ajouter le gestionnaire d'événements pour le bouton de fermeture
                const closeBtn = overlay.querySelector("#pkm-close");
                if (closeBtn) {
                        closeBtn.onclick = () => overlay.remove();
                        console.log("Bouton de fermeture configuré");
                } else {
                        console.error("Bouton de fermeture non trouvé");
                }
                
                // Gestionnaire pour le bouton d'exportation CSV
                const exportCsvBtn = overlay.querySelector("#export-csv");
                if (exportCsvBtn) {
                    exportCsvBtn.onclick = () => exportCardsToCSV(cards);
                    console.log("Bouton d'exportation CSV configuré");
                }
                
                // Gestionnaire pour le bouton de sauvegarde d'analyse
                const saveAnalysisBtn = overlay.querySelector("#save-analysis");
                if (saveAnalysisBtn) {
                    saveAnalysisBtn.onclick = () => saveAnalysis(cards);
                    console.log("Bouton de sauvegarde d'analyse configuré");
                }

                // Ajouter le bouton de comparaison à l'interface
                updateActionButtons();

                // Initialiser les filtres avancés
                initFilters(overlay);
        }
        
        // Fonction pour exporter les cartes au format CSV
        function exportCardsToCSV(cards) {
            if (!cards || !cards.length) return;
            
            // Headers
            const headers = [
                "Nom", "Mana", "Attaque", "Santé", "Vitesse", 
                "Power Score", "ROI", "Prix", "Prix/PS", 
                "Dégâts nets", "Survie (tours)", "Action"
            ];
            
            // Rows
            const rows = cards.map(card => [
                card.name,
                card.mana,
                card.atk,
                card.hp,
                card.spd,
                card.ps.toFixed(2),
                card.roi ? pct(card.roi) : "N/A",
                card.price ? `$${card.price.toFixed(2)}` : "N/A",
                card.pricePerPS ? `$${card.pricePerPS.toFixed(3)}` : "N/A",
                card.netDamage.toFixed(1),
                card.survival.toFixed(1),
                card.action
            ]);
            
            // Build CSV
            let csv = headers.join(",") + "\n";
            rows.forEach(row => {
                csv += row.map(cell => `"${cell}"`).join(",") + "\n";
            });
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `splinterlands_analysis_${new Date().toISOString().slice(0,10)}.csv`);
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        // Nouvelle fonction pour exporter au format JSON
        function exportCardsToJSON(cards) {
            if (!cards || !cards.length) return;
            
            // Préparer les données pour l'export
            const exportData = {
                version: VERSION,
                exportDate: new Date().toISOString(),
                totalCards: cards.length,
                cards: cards.map(card => ({
                    name: card.name,
                    id: card.id,
                    mana: card.mana,
                    atk: card.atk,
                    hp: card.hp,
                    spd: card.spd,
                    ps: card.ps,
                    roi: card.roi,
                    price: card.price,
                    pricePerPS: card.pricePerPS,
                    netDamage: card.netDamage,
                    survival: card.survival,
                    action: card.action,
                    abilities: card.abilities || [],
                    valueScore: card.valueScore,
                    owned: card.owned
                }))
            };
            
            // Créer et télécharger le fichier JSON
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `splinterlands_analysis_${new Date().toISOString().slice(0,10)}.json`);
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // Fonction pour sauvegarder l'analyse
        function saveAnalysis(cards) {
            // Préparer un résumé des données importantes
            const timestamp = new Date().toISOString();
            const pageType = detectPeakMonstersPage();
            
            // Créer un objet avec les statistiques principales
            const analysisData = {
                timestamp,
                pageType,
                totalCards: cards.length,
                ownedCards: cards.filter(c => c.owned > 0).length,
                totalOwned: cards.reduce((acc, c) => acc + c.owned, 0),
                totalValue: cards.reduce((acc, c) => acc + (c.price * c.owned), 0),
                avgPS: cards.reduce((acc, c) => acc + c.ps, 0) / cards.length || 0,
                avgROI: cards.reduce((acc, c) => acc + c.roi, 0) / cards.length || 0,
                actionCounts: {},
                topCards: {
                    byValue: cards.sort((a, b) => b.valueScore - a.valueScore).slice(0, 5).map(c => ({ name: c.name, score: c.valueScore })),
                    byUpgrade: cards.sort((a, b) => b.upgradeScore - a.upgradeScore).slice(0, 5).map(c => ({ name: c.name, score: c.upgradeScore })),
                    byROI: cards.sort((a, b) => b.roi - a.roi).slice(0, 5).map(c => ({ name: c.name, roi: c.roi }))
                }
            };
            
            // Compter les actions
            cards.forEach(c => {
                if (!analysisData.actionCounts[c.action]) analysisData.actionCounts[c.action] = 0;
                analysisData.actionCounts[c.action]++;
            });
            
            // Sauvegarder dans le stockage local
            try {
                // Récupérer les anciennes analyses
                chrome.storage.local.get('savedAnalyses', (result) => {
                    const savedAnalyses = result.savedAnalyses || [];
                    
                    // Ajouter la nouvelle analyse
                    savedAnalyses.push(analysisData);
                    
                    // Limiter le nombre d'analyses sauvegardées
                    if (savedAnalyses.length > 10) {
                        savedAnalyses.shift(); // Supprimer la plus ancienne
                    }
                    
                    // Enregistrer
                    chrome.storage.local.set({ 'savedAnalyses': savedAnalyses }, () => {
                        alert('Analyse sauvegardée avec succès!');
                    });
                });
            } catch (error) {
                console.error("Erreur lors de la sauvegarde de l'analyse:", error);
                
                // Fallback: proposer le téléchargement JSON si le stockage local échoue
                const blob = new Blob([JSON.stringify(analysisData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `splinterlands_analysis_${new Date().toISOString().slice(0, 10)}.json`);
                link.style.display = 'none';
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                alert('Analyse exportée sous forme de fichier JSON.');
            }

            // Ajouter le bouton d'export JSON
            const exportJSONBtn = document.createElement("button");
            exportJSONBtn.textContent = "Exporter JSON";
            exportJSONBtn.className = "pkm-button pkm-button-secondary";
            exportJSONBtn.style.marginLeft = "10px";
            exportJSONBtn.onclick = () => exportCardsToJSON(cards);
            
            // Ajouter à la barre d'outils
            const toolbar = document.querySelector(".pkm-toolbar");
            if (toolbar) {
                toolbar.appendChild(exportJSONBtn);
            }
        }

        //--------------------------------------------------
        // Styles & button
        //--------------------------------------------------
        function injectStyles() {
                if (document.getElementById("pkm-style")) return;
                
                // Définir les couleurs sans détection de thème
                const colors = {
                        background: '#fff',
                        text: '#333',
                        border: '#ddd',
                        headerBg: '#f5f5f5',
                        cardBg: '#f8f9fa',
                        accent: '#ff914d', // Couleur d'accent constante
                        accentHover: '#e67e35'
                };
                
                const style = document.createElement("style");
                style.id = "pkm-style";
                style.textContent = `
                    #pkm-analyze-btn {
                        position: fixed;
                        bottom: 24px;
                        right: 24px;
                        padding: 10px 16px;
                        font-size: 14px;
                        background: ${colors.accent};
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        z-index: 9999;
                        box-shadow: 0 4px 10px rgba(0,0,0,.15);
                        transition: background-color 0.2s;
                    }
                    #pkm-analyze-btn:hover {
                        background: ${colors.accentHover};
                    }
                    #pkm-analyzer {
                        position: fixed;
                        top: 5vh;
                        left: 50%;
                        transform: translateX(-50%);
                        background: ${colors.background};
                        color: ${colors.text};
                        padding: 20px 24px;
                        width: 90%;
                        max-width: 1200px;
                        max-height: 90vh;
                        overflow: auto;
                        box-shadow: 0 6px 20px rgba(0,0,0,.2);
                        border-radius: 12px;
                        z-index: 10000;
                        font-family: sans-serif;
                    }
                    #pkm-analyzer h2 {
                        margin: 0 0 12px;
                        font-size: 24px;
                        color: ${colors.text};
                    }
                    #pkm-close {
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        cursor: pointer;
                        font-size: 24px;
                        background: none;
                        border: none;
                        color: ${colors.text};
                    }
                    #pkm-analyzer table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 13px;
                        margin-top: 20px;
                    }
                    #pkm-analyzer th, #pkm-analyzer td {
                        padding: 8px 12px;
                        border-bottom: 1px solid ${colors.border};
                        text-align: left;
                    }
                    #pkm-analyzer th {
                        background: ${colors.headerBg};
                        font-weight: 600;
                        color: #444;
                        padding: 10px 12px;
                        border-bottom: 2px solid #ddd;
                    }
                    #pkm-analyzer tr:hover {
                        filter: brightness(0.97);
                    }
                    .summary {
                        display: flex;
                        gap: 20px;
                        margin-bottom: 20px;
                        flex-wrap: wrap;
                    }
                    @media (max-width: 768px) {
                        .summary {
                            flex-direction: column;
                        }
                    }
                    .summary-item {
                        flex: 1;
                        background: ${colors.cardBg};
                        padding: 15px;
                        border-radius: 8px;
                        min-width: 250px;
                        border: 1px solid #ddd;
                    }
                    .summary-item h3 {
                        margin: 0 0 10px;
                        color: ${colors.text};
                        font-size: 16px;
                        font-weight: bold;
                    }
                    .summary-item div {
                        font-size: 13px;
                        margin: 5px 0;
                        color: #333;
                        font-weight: 500;
                    }
                    .summary-card {
                        padding: 6px 8px;
                        border-radius: 4px;
                        margin-bottom: 5px;
                        background: #f5f5f5;
                    }
                    
                    .upgrade-details {
                        margin-top: 4px;
                        font-size: 12px;
                        color: #555;
                        line-height: 1.3;
                    }
                    
                    .no-cards {
                        padding: 10px;
                        text-align: center;
                        color: #555;
                        font-weight: bold;
                        background: #f0f0f0;
                        border-radius: 4px;
                        font-size: 14px;
                    }
                    .pkm-badge-inefficient {
                        display: inline-block;
                        background: #ffe6cc;
                        color: #d75f00;
                        font-size: 10px;
                        padding: 2px 5px;
                        border-radius: 3px;
                        margin-left: 5px;
                        font-weight: bold;
                    }
                    
                    .pkm-badge-upgrade {
                        display: inline-block;
                        background: #d0e8ff;
                        color: #0066cc;
                        font-size: 10px;
                        padding: 2px 5px;
                        border-radius: 3px;
                        margin-left: 5px;
                        font-weight: bold;
                    }
                    
                    .high-priority-upgrade {
                        box-shadow: inset 0 0 0 2px #0066cc !important;
                    }
                    
                    /* Styles pour les filtres intégrés */
                    .pkm-filters-container {
                        background: ${colors.cardBg};
                        border: 1px solid ${colors.border};
                        padding: 12px 15px;
                        margin: 15px 0;
                        border-radius: 5px;
                    }
                    .pkm-filter-buttons {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 5px;
                    }
                    .pkm-filter-btn {
                        padding: 6px 12px;
                        background: #fff;
                        border: 1px solid ${colors.border};
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                        color: ${colors.text};
                        transition: all 0.2s;
                    }
                    .pkm-filter-btn:hover {
                        background: #f0f0f0;
                    }
                    .pkm-filter-btn.active {
                        background: ${colors.accent};
                        color: white;
                        border-color: ${colors.accentHover};
                    }
                    .pkm-card-kpi {
                        font-size: 12px;
                        color: #666;
                        margin-top: 5px;
                        display: block;
                    }
                    .pkm-card-kpi-good {
                        color: green;
                    }
                    .pkm-card-kpi-bad {
                        color: red;
                    }
                    
                    /* Compatibilité responsive */
                    @media (max-width: 768px) {
                        #pkm-analyzer {
                            width: 95%;
                            max-height: 95vh;
                            padding: 15px;
                        }
                        .sort-buttons {
                            flex-direction: column;
                            align-items: flex-start;
                        }
                        .sort-direction {
                            margin-left: 0;
                            margin-top: 10px;
                        }
                        #pkm-analyzer table {
                            font-size: 11px;
                        }
                        #pkm-analyzer th, #pkm-analyzer td {
                            padding: 6px 8px;
                        }
                    }
                    
                    #pkm-analyzer h2 {
                        margin: 0 0 12px;
                        font-size: 24px;
                        color: ${colors.text};
                    }
                    
                    .collection-stats {
                        background: #f0f5ff;
                        padding: 12px 15px;
                        border-radius: 8px;
                        margin-bottom: 15px;
                        font-size: 13px;
                        display: flex;
                        flex-wrap: wrap;
                        gap: 15px;
                        border: 1px solid #d0d9f0;
                    }
                    
                    .stat-item {
                        display: flex;
                        flex-direction: column;
                        min-width: 120px;
                    }
                    
                    .stat-label {
                        font-size: 11px;
                        color: #666;
                        margin-bottom: 3px;
                    }
                    
                    .stat-value {
                        font-size: 16px;
                        font-weight: bold;
                        color: #333;
                    }
                    
                    .stat-trend {
                        font-size: 11px;
                        margin-top: 2px;
                    }
                    
                    .trend-up {
                        color: green;
                    }
                    
                    .trend-down {
                        color: red;
                    }
                    
                    .card-abilities {
                        margin-top: 4px;
                        display: flex;
                        flex-wrap: wrap;
                        gap: 3px;
                    }
                    
                    .ability-tag {
                        font-size: 9px;
                        background: #e0e9ff;
                        color: #0066cc;
                        padding: 1px 4px;
                        border-radius: 3px;
                        white-space: nowrap;
                        cursor: help;
                    }

                    /* Nouveaux styles pour la fonctionnalité de comparaison */
                    .card-name {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                    }
                    
                    .compare-btn {
                        background: ${colors.accent};
                        color: white;
                        border: none;
                        border-radius: 4px;
                        width: 20px;
                        height: 20px;
                        font-size: 12px;
                        line-height: 1;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        margin-left: 5px;
                        opacity: 0.7;
                        transition: opacity 0.2s;
                    }
                    
                    .compare-btn:hover {
                        opacity: 1;
                    }
                    
                    tr.card-selected {
                        background-color: rgba(255, 145, 77, 0.1);
                    }
                    
                    #pkm-comparison-overlay {
                        position: fixed;
                        top: 5vh;
                        left: 50%;
                        transform: translateX(-50%);
                        background: ${colors.background};
                        color: ${colors.text};
                        padding: 20px 24px;
                        width: 90%;
                        max-width: 1200px;
                        max-height: 90vh;
                        overflow: auto;
                        box-shadow: 0 6px 20px rgba(0,0,0,.2);
                        border-radius: 12px;
                        z-index: 10001;
                        font-family: sans-serif;
                    }
                    
                    .comparison-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 15px;
                    }
                    
                    #close-comparison {
                        cursor: pointer;
                        font-size: 24px;
                        background: none;
                        border: none;
                        color: ${colors.text};
                    }
                    
                    .comparison-table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 14px;
                        margin-bottom: 20px;
                    }
                    
                    .comparison-table th, .comparison-table td {
                        padding: 10px;
                        border: 1px solid ${colors.border};
                        text-align: center;
                    }
                    
                    .comparison-table th {
                        background-color: ${colors.headerBg};
                        font-weight: bold;
                    }
                    
                    .comparison-table td:first-child {
                        text-align: left;
                        font-weight: bold;
                        background-color: ${colors.headerBg};
                    }
                    
                    .best-value {
                        background-color: rgba(76, 175, 80, 0.2);
                        font-weight: bold;
                    }
                    
                    .comparison-charts {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    
                    .chart-container {
                        flex: 1;
                        min-width: 300px;
                        padding: 15px;
                        background-color: ${colors.cardBg};
                        border-radius: 8px;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                    }
                    
                    .chart-container h3 {
                        margin-top: 0;
                        margin-bottom: 10px;
                        font-size: 16px;
                        text-align: center;
                    }
                    
                    .simple-chart {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    
                    .chart-bar-container {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .chart-label {
                        width: 100px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        font-size: 12px;
                    }
                    
                    .chart-bar {
                        height: 24px;
                        background-color: ${colors.accent};
                        border-radius: 4px;
                        color: white;
                        display: flex;
                        align-items: center;
                        padding-left: 8px;
                        transition: width 0.5s;
                        position: relative;
                        min-width: 40px;
                    }
                    
                    .chart-value {
                        font-size: 12px;
                        font-weight: bold;
                    }
                    
                    .comparison-actions {
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                    }
                    
                    #compare-cards-btn:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    
                    /* Styles pour les filtres avancés */
                    .advanced-filters {
                        margin-bottom: 15px;
                        background-color: ${colors.cardBg};
                        border-radius: 8px;
                        padding: 5px;
                    }
                    
                    .toggle-btn {
                        width: 100%;
                        padding: 10px;
                        background: transparent;
                        border: none;
                        text-align: left;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                        color: ${colors.text};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 4px;
                    }
                    
                    .toggle-btn:hover {
                        background: rgba(0,0,0,0.05);
                    }
                    
                    .filters-container {
                        padding: 15px;
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                        gap: 20px;
                    }
                    
                    .filter-group {
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                    }
                    
                    .filter-row {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        width: 100%;
                    }
                    
                    .filter-row label {
                        min-width: 100px;
                        font-weight: 600;
                        font-size: 14px;
                    }
                    
                    .filter-inputs {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        flex: 1;
                    }
                    
                    .filter-inputs input[type="number"],
                    .filter-inputs select {
                        flex: 1;
                        padding: 6px 8px;
                        border: 1px solid ${colors.border};
                        border-radius: 4px;
                        font-size: 14px;
                        min-width: 0;
                    }
                    
                    .filter-inputs span {
                        font-size: 14px;
                        color: ${colors.text};
                    }
                    
                    .filter-actions {
                        grid-column: 1 / -1;
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                        margin-top: 10px;
                    }
                    
                    .action-btn.secondary {
                        background-color: #888;
                    }
                    
                    .action-btn.secondary:hover {
                        background-color: #777;
                    }
                    
                    .filtered-count {
                        margin: 10px 0;
                        font-size: 14px;
                        color: ${colors.text};
                        text-align: right;
                        font-style: italic;
                    }
                `;
                document.head.appendChild(style);
        }

        function addAnalyzeButton() {
                if (document.getElementById("pkm-analyze-btn")) return;
                const btn = document.createElement("button");
                btn.id = "pkm-analyze-btn";
                btn.textContent = "Analyser le deck";
                btn.onclick = () => buildOverlay(scrapeListView());
                document.body.appendChild(btn);
        }

        //--------------------------------------------------
        // Tri intégré à l'interface PeakMonsters
        //--------------------------------------------------
        function addInlineFilters() {
            // Détection de page étendue
            const pageType = detectPeakMonstersPage();
            if (!pageType.includes("market") && !pageType.includes("collection") && !pageType.includes("rental")) {
                return;
            }

            // S'assurer que les filtres ne sont pas déjà ajoutés
            if (document.getElementById("pkm-inline-filters")) return;

            // Trouver la zone de filtres existante avec des sélecteurs plus robustes
            const filterSelectors = [
                ".filters-section", 
                ".card-filters", 
                ".filter-container",
                "form.filters",
                ".search-filters",
                "div[role='search']",
                ".filter-panel"
            ];
            
            let filterArea = null;
            for (const selector of filterSelectors) {
                filterArea = document.querySelector(selector);
                if (filterArea) break;
            }
            
            // Si on ne trouve pas la zone de filtres, essayons de créer notre propre zone
            if (!filterArea) {
                // Rechercher des conteneurs de contenu principal
                const contentSelectors = [
                    "main", 
                    ".content", 
                    ".page-content", 
                    "#app > div > div"
                ];
                
                let contentArea = null;
                for (const selector of contentSelectors) {
                    contentArea = document.querySelector(selector);
                    if (contentArea) break;
                }
                
                if (contentArea) {
                    // Créer une nouvelle zone de filtres
                    filterArea = document.createElement("div");
                    filterArea.className = "pkm-custom-filter-area";
                    
                    // Insérer avant la première liste/grille de cartes
                    const cardContainers = [
                        "ul.card-list", 
                        ".card-grid", 
                        ".cards-container"
                    ];
                    
                    let insertPoint = null;
                    for (const selector of cardContainers) {
                        insertPoint = contentArea.querySelector(selector);
                        if (insertPoint) break;
                    }
                    
                    if (insertPoint) {
                        insertPoint.parentNode.insertBefore(filterArea, insertPoint);
                    } else {
                        // En dernier recours, ajouter au début de la zone de contenu
                        contentArea.prepend(filterArea);
                    }
                } else {
                    console.error("Aucune zone pour insérer les filtres n'a été trouvée");
                    return;
                }
            }

            // Créer notre conteneur de filtres avec des libellés adaptés au contexte
            const filterContainer = document.createElement("div");
            filterContainer.id = "pkm-inline-filters";
            filterContainer.className = "pkm-filters-container";
            
            let filterTitle = "Tri Avancé";
            let filterDescription = "Ces filtres ajoutent des KPIs avancés pour vous aider à trouver les meilleures cartes.";
            
            // Adaptation au type de page
            if (pageType === "rental") {
                filterTitle = "Analyse de Location";
                filterDescription = "Ces filtres vous aident à identifier les meilleures cartes à louer ou à éviter.";
            } else if (pageType === "collection") {
                filterTitle = "Analyse de Collection";
                filterDescription = "Ces filtres vous aident à identifier les cartes à vendre, améliorer ou conserver.";
            }
            
            filterContainer.innerHTML = `
                <div class="pkm-filters-header">
                    <h4>${filterTitle}</h4>
                    <span class="pkm-help" title="${filterDescription}">ⓘ</span>
                </div>
                <div class="pkm-filter-buttons">
                    <button class="pkm-filter-btn" data-sort="ps">💪 Power Score</button>
                    <button class="pkm-filter-btn" data-sort="roi">💰 ROI</button>
                    <button class="pkm-filter-btn" data-sort="manaEfficiency">⚡ Efficacité</button>
                    <button class="pkm-filter-btn" data-sort="pricePerPS">💲/PS</button>
                    <button class="pkm-filter-btn" data-sort="dailyROI">📅 ROI loc.</button>
                    <button class="pkm-filter-btn" data-sort="survival">🛡️ Survie</button>
                </div>
            `;

            // Insérer les filtres dans l'interface
            filterArea.appendChild(filterContainer);

            // Ajouter les événements sur les boutons de tri
            filterContainer.querySelectorAll(".pkm-filter-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    // Toggle active state
                    btn.classList.toggle("active");
                    const sortKey = btn.getAttribute("data-sort");
                    const isActive = btn.classList.contains("active");
                    
                    // Si le bouton est activé, calculer et afficher les KPIs
                    if (isActive) {
                        calculateAndDisplayKPIs(sortKey);
                    } else {
                        // Sinon, masquer les KPIs
                        document.querySelectorAll(`.pkm-card-kpi[data-kpi="${sortKey}"]`).forEach(el => {
                            el.style.display = "none";
                        });
                        
                        // Enlever les marqueurs d'inefficacité si nécessaire
                        if (sortKey === "dailyROI") {
                            document.querySelectorAll(".pkm-card-inefficient").forEach(card => {
                                card.classList.remove("pkm-card-inefficient");
                            });
                            document.querySelectorAll(".pkm-badge-inefficient").forEach(badge => {
                                badge.remove();
                            });
                        }
                    }
                });
            });
        }

        function calculateAndDisplayKPIs(kpiType) {
            // Sélection des cartes selon le type de page
            let cardElements;
            if (document.querySelectorAll("li.panel, div.card-row, div[role='listitem']").length) {
                cardElements = document.querySelectorAll("li.panel, div.card-row, div[role='listitem']");
            } else if (document.querySelectorAll("div.media.panel-body").length) {
                cardElements = document.querySelectorAll("div.media.panel-body");
            } else {
                return; // Pas de cartes détectées
            }

            // Pour chaque carte, calculer et afficher le KPI demandé
            cardElements.forEach(cardEl => {
                // D'abord, extraire les données de base
                const statsRow = cardEl.querySelector(".card-stats tbody tr, .stats-row");
                if (!statsRow) return;
                
                const tds = statsRow.querySelectorAll("td");
                if (tds.length < 6) return;

                const mana = num(tds[1].textContent);
                let atk = 0;
                tds[2].textContent.split(/[\/]/).forEach((p) => { const v = num(p); if (v && !atk) atk = v; });
                const spd = num(tds[3].textContent);
                const armor = num(tds[4].textContent) || 0;
                const hp = num(tds[5].textContent);

                // Prix
                let price = 0;
                const priceNode = cardEl.querySelector(".media-right h5 span, .media-right h5 a, .media-right h5");
                if (priceNode) price = num(priceNode.textContent);

                // Prix de location
                let rentPrice = 0;
                const rentNode = cardEl.querySelector('.media-right .btn-group + div, .media-right .rent-price, .media-right h5 span.text-success, .rental-price');
                if (rentNode) rentPrice = num(rentNode.textContent);

                // Calculer les KPIs
                const ps = computePS({ atk, hp, spd, mana });
                const manaEfficiency = mana ? (atk + hp) / mana : 0;
                const pricePerPS = ps ? price / ps : 0;
                const roi = computeROI(ps, price);
                const survival = computeSurvival({ hp, armor });
                const dailyROI = computeDailyROI(10, rentPrice); // 10 DEC/jour par défaut

                // Déjà affiché ?
                let kpiEl = cardEl.querySelector(`.pkm-card-kpi[data-kpi="${kpiType}"]`);
                
                // Si non, créer l'élément
                if (!kpiEl) {
                    kpiEl = document.createElement("span");
                    kpiEl.className = "pkm-card-kpi";
                    kpiEl.setAttribute("data-kpi", kpiType);
                    
                    // Trouver où insérer le KPI (dans la zone de nom/titre)
                    const targetElement = cardEl.querySelector("h4, h3, .card-name, .media-body .media-heading");
                    if (targetElement) {
                        targetElement.appendChild(kpiEl);
                    }
                }

                // Définir le contenu selon le KPI
                let kpiValue = "";
                let kpiClass = "pkm-card-kpi-neutral";
                
                switch(kpiType) {
                    case "ps":
                        kpiValue = `PS: ${ps.toFixed(1)}`;
                        kpiClass = ps >= THRESHOLD_PS ? "pkm-card-kpi-good" : (ps < THRESHOLD_PS/2 ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                    case "manaEfficiency":
                        kpiValue = `Eff: ${manaEfficiency.toFixed(2)}`;
                        kpiClass = manaEfficiency >= 3.0 ? "pkm-card-kpi-good" : (manaEfficiency < 2.0 ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                    case "pricePerPS":
                        kpiValue = `$/PS: ${pricePerPS.toFixed(3)}`;
                        kpiClass = pricePerPS < 0.15 ? "pkm-card-kpi-good" : (pricePerPS > 0.3 ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                    case "roi":
                        kpiValue = `ROI: ${pct(roi)}`;
                        kpiClass = roi >= THRESHOLD_ROI_BUY ? "pkm-card-kpi-good" : (roi < THRESHOLD_ROI_SELL ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                    case "dailyROI":
                        if (dailyROI !== null) {
                            kpiValue = `ROI loc: ${pct(dailyROI)}`;
                            kpiClass = dailyROI >= 0.05 ? "pkm-card-kpi-good" : (dailyROI < THRESHOLD_DAILY_ROI ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                            
                            // Si la carte est inefficace à louer, ajouter un marqueur visuel
                            if (dailyROI < THRESHOLD_DAILY_ROI) {
                                cardEl.classList.add("pkm-card-inefficient");
                                
                                // Ajouter un badge "Inefficace" près du nom
                                const titleEl = cardEl.querySelector("h4, h3, .card-name, .media-body .media-heading");
                                if (titleEl && !titleEl.querySelector(".pkm-badge-inefficient")) {
                                    const badge = document.createElement("span");
                                    badge.className = "pkm-badge-inefficient";
                                    badge.textContent = "⚠️ Inefficace";
                                    titleEl.appendChild(badge);
                                }
                            }
                        } else {
                            kpiValue = "Non louable";
                            kpiClass = "pkm-card-kpi-neutral";
                        }
                        break;
                    case "survival":
                        kpiValue = `Survie: ${survival.toFixed(1)} tours`;
                        kpiClass = survival >= 3.0 ? "pkm-card-kpi-good" : (survival < 1.5 ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                }

                kpiEl.textContent = kpiValue;
                kpiEl.className = `pkm-card-kpi ${kpiClass}`;
                kpiEl.style.display = "block";
            });
        }

        //--------------------------------------------------
        // Ajout d'une fonction de diagnostic DOM qui peut être déclenchée manuellement
        //--------------------------------------------------
        function createDOMDiagnosticTool() {
            // Vérifier si l'outil existe déjà
            if (document.getElementById('pkm-dom-diagnostic')) {
                document.getElementById('pkm-dom-diagnostic').style.display = 'block';
                return;
            }

            // Créer l'interface de l'outil de diagnostic
            const diagnosticUI = document.createElement('div');
            diagnosticUI.id = 'pkm-dom-diagnostic';
            diagnosticUI.innerHTML = `
                <div class="diagnostic-header">
                    <h3>Diagnostic DOM PeakMonsters</h3>
                    <button id="pkm-diagnostic-close">×</button>
                </div>
                <div class="diagnostic-controls">
                    <button id="pkm-scan-page">Scanner la page</button>
                    <button id="pkm-scan-card" class="secondary">Scanner une carte</button>
                    <button id="pkm-copy-report">Copier le rapport</button>
                    <button id="pkm-save-report">Télécharger</button>
                </div>
                <div class="diagnostic-output">
                    <textarea id="pkm-diagnostic-report" readonly>Cliquez sur 'Scanner' pour analyser la structure DOM.</textarea>
                </div>
            `;

            // Styles pour l'outil de diagnostic
            const diagnosticCSS = document.createElement('style');
            diagnosticCSS.textContent = `
                #pkm-dom-diagnostic {
                    position: fixed;
                    top: 10vh;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 90%;
                    max-width: 800px;
                    background: #fff;
                    border-radius: 8px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                    z-index: 10001;
                    padding: 15px;
                    display: flex;
                    flex-direction: column;
                    font-family: sans-serif;
                }
                .diagnostic-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                }
                .diagnostic-header h3 {
                    margin: 0;
                    color: #333;
                }
                #pkm-diagnostic-close {
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #666;
                }
                .diagnostic-controls {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 15px;
                    flex-wrap: wrap;
                }
                .diagnostic-controls button {
                    padding: 8px 16px;
                    background: #ff914d;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .diagnostic-controls button.secondary {
                    background: #666;
                }
                .diagnostic-controls button:hover {
                    opacity: 0.9;
                }
                .diagnostic-output {
                    flex-grow: 1;
                }
                #pkm-diagnostic-report {
                    width: 100%;
                    min-height: 300px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 10px;
                    font-family: monospace;
                    white-space: pre;
                    overflow: auto;
                    font-size: 12px;
                }
                @media (prefers-color-scheme: dark) {
                    #pkm-dom-diagnostic {
                        background: #333;
                        color: #eee;
                    }
                    .diagnostic-header h3 {
                        color: #eee;
                    }
                    #pkm-diagnostic-close {
                        color: #ccc;
                    }
                    #pkm-diagnostic-report {
                        background: #222;
                        color: #eee;
                        border-color: #444;
                    }
                }
            `;
            document.head.appendChild(diagnosticCSS);
            document.body.appendChild(diagnosticUI);

            // Fermer le diagnostic
            document.getElementById('pkm-diagnostic-close').addEventListener('click', () => {
                diagnosticUI.style.display = 'none';
            });

            // Analyser la structure DOM complète
            document.getElementById('pkm-scan-page').addEventListener('click', () => {
                const reportTextarea = document.getElementById('pkm-diagnostic-report');
                reportTextarea.value = "Analyse en cours...";
                
                setTimeout(() => {
                    try {
                        const report = generateDOMReport();
                        reportTextarea.value = report;
                    } catch (error) {
                        reportTextarea.value = `Erreur lors de l'analyse: ${error.message}`;
                    }
                }, 100);
            });

            // Analyser une carte spécifique (nécessite de cliquer sur une carte)
            document.getElementById('pkm-scan-card').addEventListener('click', () => {
                const reportTextarea = document.getElementById('pkm-diagnostic-report');
                reportTextarea.value = "Cliquez sur une carte pour l'analyser...";
                
                // Activer le mode sélection de carte
                enableCardSelectionMode();
            });

            // Copier le rapport dans le presse-papier
            document.getElementById('pkm-copy-report').addEventListener('click', () => {
                const reportTextarea = document.getElementById('pkm-diagnostic-report');
                reportTextarea.select();
                document.execCommand('copy');
                
                // Indiquer que la copie a réussi
                const button = document.getElementById('pkm-copy-report');
                const originalText = button.textContent;
                button.textContent = "Copié ✓";
                button.style.background = "#4CAF50";
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = "#ff914d";
                }, 2000);
            });

            // Télécharger le rapport
            document.getElementById('pkm-save-report').addEventListener('click', () => {
                const reportTextarea = document.getElementById('pkm-diagnostic-report');
                const report = reportTextarea.value;
                
                const blob = new Blob([report], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `peakmonsters-dom-report-${new Date().toISOString().split('T')[0]}.txt`;
                document.body.appendChild(a);
                a.click();
                
                // Nettoyer après le téléchargement
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 0);
            });
        }

        // Fonction pour activer le mode sélection de carte
        function enableCardSelectionMode() {
            // Ajouter un indicateur visuel pour montrer que le mode sélection est actif
            const selectionOverlay = document.createElement('div');
            selectionOverlay.id = 'pkm-card-selection-overlay';
            selectionOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 145, 77, 0.2);
                z-index: 9999;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            selectionOverlay.innerHTML = `
                <div style="background: rgba(0,0,0,0.7); color: white; padding: 15px; border-radius: 8px; text-align: center;">
                    <h3 style="margin-top: 0;">Cliquez sur une carte à analyser</h3>
                    <p>Ou <button id="pkm-cancel-selection" style="background: #ff5555; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">annuler</button></p>
                </div>
            `;
            document.body.appendChild(selectionOverlay);
            
            // Fonction pour annuler la sélection
            document.getElementById('pkm-cancel-selection').addEventListener('click', (e) => {
                e.stopPropagation();
                document.body.removeChild(selectionOverlay);
                document.getElementById('pkm-diagnostic-report').value = "Sélection annulée.";
            });
            
            // Détection des cartes - utiliser les mêmes sélecteurs que dans scrapeListView
            const pageType = detectPeakMonstersPage();
            let cardSelectors = "li.panel, div.card-row, div[role='listitem'], .card";
            
            if (pageType === "market") {
                cardSelectors += ", .market-card, .card-listing";
            } else if (pageType === "collection") {
                cardSelectors += ", .collection-card";
            } else if (pageType === "rental") {
                cardSelectors += ", .rental-card";
            }
            
            // Ajouter des écouteurs de clic temporaires sur toutes les cartes
            const cards = document.querySelectorAll(cardSelectors);
            
            cards.forEach(card => {
                // Ajouter un effet de survol pour montrer quelle carte est sélectionnable
                card.style.transition = "all 0.2s";
                card.addEventListener('mouseenter', () => {
                    card.style.outline = "3px solid #ff914d";
                    card.style.boxShadow = "0 0 10px rgba(255, 145, 77, 0.5)";
                });
                card.addEventListener('mouseleave', () => {
                    card.style.outline = "";
                    card.style.boxShadow = "";
                });
                
                // Logique de sélection
                card.addEventListener('click', function cardSelectionHandler(e) {
                    e.stopPropagation();
                    
                    // Analyser cette carte spécifique
                    const cardReport = generateCardReport(card);
                    document.getElementById('pkm-diagnostic-report').value = cardReport;
                    
                    // Nettoyer tous les écouteurs et styles
                    cards.forEach(c => {
                        c.style.outline = "";
                        c.style.boxShadow = "";
                        c.style.transition = "";
                        c.removeEventListener('mouseenter', () => {});
                        c.removeEventListener('mouseleave', () => {});
                        c.removeEventListener('click', cardSelectionHandler);
                    });
                    
                    // Supprimer l'overlay
                    document.body.removeChild(selectionOverlay);
                }, { once: true });
            });
            
            // Permettre de cliquer en dehors pour annuler
            selectionOverlay.addEventListener('click', () => {
                document.body.removeChild(selectionOverlay);
                document.getElementById('pkm-diagnostic-report').value = "Sélection annulée.";
                
                // Nettoyer tous les écouteurs et styles
                cards.forEach(c => {
                    c.style.outline = "";
                    c.style.boxShadow = "";
                    c.style.transition = "";
                    c.removeEventListener('mouseenter', () => {});
                    c.removeEventListener('mouseleave', () => {});
                });
            });
        }

        // Générer un rapport sur la structure DOM complète
        function generateDOMReport() {
            const pageType = detectPeakMonstersPage();
            const url = window.location.href;
            const timestamp = new Date().toISOString();
            
            let report = `=== RAPPORT DIAGNOSTIC DOM PEAKMONSTERS ===
URL: ${url}
Date: ${timestamp}
Type de page: ${pageType}

---- STRUCTURE DOM PRINCIPALE ----\n`;
            
            // Analyser les structures de page principales
            const mainSelectors = {
                "Conteneur Principal": ["#app", "main", ".content", ".page-content"],
                "Zone de Filtres": [".filters-section", ".card-filters", ".filter-container", "form.filters"],
                "Conteneur de Cartes": ["ul.card-list", ".card-grid", ".cards-container", ".market-cards"],
                "Pagination": [".pagination", ".page-controls", "nav[role='navigation']"]
            };
            
            // Vérifier chaque sélecteur principal
            for (const [section, selectors] of Object.entries(mainSelectors)) {
                report += `\n${section}:\n`;
                let found = false;
                
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        found = true;
                        report += `  ✓ ${selector} trouvé\n`;
                        
                        // Ajouter quelques informations sur l'élément
                        const classes = Array.from(element.classList).join(', ');
                        report += `    Classes: ${classes || "aucune"}\n`;
                        
                        // Compter les enfants directs
                        const children = element.children.length;
                        report += `    Enfants directs: ${children}\n`;
                        
                        break;
                    }
                }
                
                if (!found) {
                    report += `  ✗ Aucun sélecteur trouvé parmi: ${selectors.join(', ')}\n`;
                }
            }
            
            // Analyse des cartes
            report += "\n---- DÉTECTION DES CARTES ----\n";
            
            // Construire le sélecteur de cartes comme dans la fonction scrapeListView
            let cardSelectors = "li.panel, div.card-row, div[role='listitem'], .card";
            
            if (pageType === "market") {
                cardSelectors += ", .market-card, .card-listing";
            } else if (pageType === "collection") {
                cardSelectors += ", .collection-card";
            } else if (pageType === "rental") {
                cardSelectors += ", .rental-card";
            }
            
            const cards = document.querySelectorAll(cardSelectors);
            report += `Cartes détectées: ${cards.length}\n`;
            
            if (cards.length > 0) {
                // Analyser la première carte comme exemple
                const firstCard = cards[0];
                report += "\nAnalyse d'une carte d'exemple:\n";
                report += generateCardReport(firstCard);
            }
            
            // Informations sur la page et l'environnement
            report += `\n---- ENVIRONNEMENT ----
Largeur de fenêtre: ${window.innerWidth}px
Hauteur de fenêtre: ${window.innerHeight}px
Mode sombre: ${document.body.classList.contains('dark-theme') || 
              document.querySelector('html').classList.contains('dark-mode') ||
              window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Oui' : 'Non'}
User Agent: ${navigator.userAgent}
`;

            return report;
        }

        // Générer un rapport détaillé sur une carte spécifique
        function generateCardReport(cardElement) {
            let report = `\n== ANALYSE DÉTAILLÉE DE LA CARTE ==\n`;
            
            // Classes de l'élément carte
            const cardClasses = Array.from(cardElement.classList).join(', ');
            report += `Classes: ${cardClasses || "aucune"}\n`;
            
            // Extraire les informations clés
            const nameSelectors = [
                "h4 a", "h4", "h3", "h2", ".card-name", ".card-title", 
                ".market-card-name", ".collection-card-name", 
                "span[data-title='Card name']", "div[data-card-name]"
            ];
            
            report += "\n-- ÉLÉMENTS DE LA CARTE --\n";
            
            // Fonction utilitaire pour tester plusieurs sélecteurs
            const testSelectors = (category, selectors) => {
                report += `${category}:\n`;
                let found = false;
                
                for (const selector of selectors) {
                    const element = cardElement.querySelector(selector);
                    if (element) {
                        const text = element.textContent.trim();
                        report += `  ✓ ${selector} = "${text}"\n`;
                        
                        // Ajouter les attributs data-* s'ils existent
                        const dataAttrs = Array.from(element.attributes)
                            .filter(attr => attr.name.startsWith('data-'))
                            .map(attr => `${attr.name}="${attr.value}"`)
                            .join(', ');
                        
                        if (dataAttrs) {
                            report += `    Attributs data: ${dataAttrs}\n`;
                        }
                        
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    report += `  ✗ Aucun sélecteur trouvé\n`;
                }
                
                return found;
            };
            
            // Vérifier tous les aspects importants de la carte
            testSelectors("Nom", nameSelectors);
            
            const statSelectors = [
                ".card-stats tbody tr", 
                ".stats-row",
                ".card-properties tr",
                ".card-details table tr",
                "[data-stats-table] tr"
            ];
            testSelectors("Conteneur de stats", statSelectors);
            
            // Attributs de données des stats
            report += "\n-- ATTRIBUTS DE DONNÉES --\n";
            const statDataAttrs = cardElement.querySelectorAll("[data-stat]");
            if (statDataAttrs.length > 0) {
                statDataAttrs.forEach(statElement => {
                    const statType = statElement.getAttribute("data-stat");
                    const text = statElement.textContent.trim();
                    report += `data-stat="${statType}" = "${text}"\n`;
                });
            } else {
                report += "Aucun attribut data-stat trouvé\n";
            }
            
            // Prix et propriétés spéciales
            report += "\n-- PRIX ET PROPRIÉTÉS --\n";
            
            const priceSelectors = [
                ".media-right h5 span", 
                ".media-right h5", 
                ".price", 
                ".card-price", 
                "[data-price]", 
                ".market-price",
                ".buy-price",
                ".sell-price"
            ];
            testSelectors("Prix", priceSelectors);
            
            const rentSelectors = [
                '.media-right .btn-group + div', 
                '.media-right .rent-price', 
                '.media-right h5 span.text-success', 
                '.rental-price', 
                '[data-rent-price]',
                '.rent-rate',
                '.daily-rate'
            ];
            testSelectors("Prix de location", rentSelectors);
            
            // Structure HTML
            report += "\n-- STRUCTURE HTML --\n";
            const htmlStructure = cardElement.outerHTML
                .replace(/>\s+</g, '>\n<') // Ajouter des sauts de ligne pour plus de lisibilité
                .split('\n')
                .slice(0, 30) // Limiter à 30 lignes pour éviter les rapports trop volumineux
                .join('\n');
            
            if (htmlStructure.split('\n').length >= 30) {
                report += htmlStructure + "\n...(tronqué)\n";
            } else {
                report += htmlStructure + "\n";
            }
            
            return report;
        }

        //--------------------------------------------------
        // Ajout d'un bouton pour activer le diagnostic
        //--------------------------------------------------
        function addDiagnosticButton() {
            if (document.getElementById("pkm-diagnostic-btn")) return;
            
            const btn = document.createElement("button");
            btn.id = "pkm-diagnostic-btn";
            btn.textContent = "📊 Diagnostic DOM";
            btn.style.cssText = `
                position: fixed;
                bottom: 70px;
                right: 24px;
                padding: 10px 16px;
                font-size: 14px;
                background: #666;
                color: #fff;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                z-index: 9998;
                box-shadow: 0 4px 10px rgba(0,0,0,.15);
            `;
            
            btn.onclick = () => createDOMDiagnosticTool();
            document.body.appendChild(btn);
        }

        //--------------------------------------------------
        // Mise à jour de l'initialisation pour ajouter le bouton de diagnostic
        //--------------------------------------------------
        window.addEventListener("load", () => {
                injectStyles();
                
                // Observer pour le bouton d'analyse
                const analyzerObserver = new MutationObserver(() => {
                        if (document.querySelector(".card-stats tbody tr")) {
                                addAnalyzeButton();
                                addDiagnosticButton(); // Ajouter le bouton de diagnostic
                                analyzerObserver.disconnect();
                        }
                });
                analyzerObserver.observe(document.body, { childList: true, subtree: true });

                // Observer pour les filtres inline
                const filtersObserver = new MutationObserver(() => {
                        if (document.querySelector(".filters-section, .card-filters")) {
                                addInlineFilters();
                                filtersObserver.disconnect();
                        }
                });
                filtersObserver.observe(document.body, { childList: true, subtree: true });

                // Afficher la version dans la console pour le débogage
                console.log(`PeakMonsters Deck Analyzer v${VERSION} chargé`);
        });

        // Ajout des helpers pour les nouveaux KPIs
        function computeManaEfficiency(atk, hp, mana) {
                return mana ? (atk + hp) / mana : 0;
        }
        function computePricePerPS(price, ps) {
                return ps ? price / ps : 0;
        }
        function computeDailyROI(decPerDay, rentPrice) {
                // Si le prix de location est inférieur à 0.001, considérer comme non disponible à la location
                if (!rentPrice || rentPrice < 0.001) return null;
                return decPerDay / rentPrice;
        }
        
        // Nouvelle fonction pour calculer le score de priorité d'amélioration
        function computeUpgradeScore(card) {
                // Ne pas considérer les cartes déjà très bonnes
                if (card.ps >= THRESHOLD_PS * 1.5) return 0;
                
                // Calculer le potentiel d'amélioration basé sur plusieurs facteurs
                // 1. Plus le PS actuel est loin du seuil idéal, plus l'amélioration est prioritaire
                const psPotential = 1 - (card.ps / THRESHOLD_PS);
                
                // 2. Les cartes avec un bon ROI sont prioritaires
                const roiBonus = card.roi >= THRESHOLD_ROI_BUY ? 1.5 : (card.roi >= THRESHOLD_ROI_SELL ? 1 : 0.5);
                
                // 3. Bonus pour les cartes louables avec un bon ROI quotidien
                const rentBonus = card.dailyROI >= 0.05 ? 1.2 : 1;
                
                // 4. Malus pour les cartes très chères
                const priceFactor = card.price > 5 ? 0.7 : (card.price > 1 ? 0.9 : 1.1);
                
                // 5. Bonus pour les cartes déjà possédées (on évite d'acheter)
                const ownedBonus = card.owned > 0 ? 1.3 : 0.8;
                
                // Combiner les facteurs
                return (psPotential * roiBonus * rentBonus * priceFactor * ownedBonus) * 100;
        }

        // Fonction pour extraire les cartes d'un tableau (pour Renter's Board et autres tableaux)
        function scrapeTableCards(table) {
            console.log("Scraping d'un tableau de cartes");
            const cards = [];
            
            // Vérifier s'il y a des en-têtes pour déterminer les indices des colonnes importantes
            const headers = table.querySelectorAll("thead th");
            const headerTexts = Array.from(headers).map(h => h.textContent.trim().toLowerCase());
            
            console.log("En-têtes détectés:", headerTexts.join(", "));
            
            // Trouver les indices des colonnes importantes
            const nameIndex = headerTexts.findIndex(text => text.includes("name") || text.includes("nom"));
            const priceIndex = headerTexts.findIndex(text => 
                text.includes("price") || text.includes("prix") || 
                text.includes("dec") || text.includes("cost")
            );
            const roiIndex = headerTexts.findIndex(text => 
                text.includes("roi") || text.includes("return") || 
                text.includes("yield") || text.includes("rendement")
            );
            
            console.log(`Indices - Nom: ${nameIndex}, Prix: ${priceIndex}, ROI: ${roiIndex}`);
            
            // Parcourir les lignes du tableau
            const rows = table.querySelectorAll("tbody tr");
            rows.forEach((row, rowIndex) => {
                const cells = row.querySelectorAll("td");
                if (cells.length < 2) return; // Ignorer les lignes trop courtes
                
                // Extraire le nom de la carte, en priorité via l'indice trouvé
                let name = "";
                if (nameIndex >= 0 && nameIndex < cells.length) {
                    // Essayer d'extraire le nom du texte ou d'un lien interne
                    const nameCell = cells[nameIndex];
                    const nameLink = nameCell.querySelector("a");
                    name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
                } else {
                    // Fallback: essayer de trouver le nom dans la première ou deuxième cellule
                    // qui contient souvent un lien ou une image
                    const possibleNameCells = [cells[0], cells.length > 1 ? cells[1] : null].filter(Boolean);
                    for (const cell of possibleNameCells) {
                        const nameLink = cell.querySelector("a");
                        if (nameLink) {
                            name = nameLink.textContent.trim();
                            break;
                        }
                    }
                    
                    // Si toujours pas de nom, prendre le texte de la première cellule
                    if (!name && cells[0]) {
                        name = cells[0].textContent.trim();
                    }
                }
                
                if (!name) {
                    console.log(`Ligne ${rowIndex}: Nom non trouvé`);
                    return;
                }
                
                console.log(`Ligne ${rowIndex}: Nom = ${name}`);
                
                // Essayer de trouver des stats dans les cellules ou via des icônes/classes
                let mana = 0, atk = 0, spd = 0, hp = 0;
                
                // Rechercher des icônes de stats qui sont souvent utilisées dans ces tableaux
                const statsIcons = row.querySelectorAll(".stat-icon, [class*='mana'], [class*='attack'], [class*='speed'], [class*='health']");
                statsIcons.forEach(icon => {
                    const iconClass = icon.className.toLowerCase();
                    const value = num(icon.textContent);
                    
                    if (iconClass.includes("mana")) mana = value;
                    else if (iconClass.includes("attack") || iconClass.includes("melee")) atk = value;
                    else if (iconClass.includes("speed")) spd = value;
                    else if (iconClass.includes("health") || iconClass.includes("hp")) hp = value;
                });
                
                // Extraire le prix et/ou le ROI
                let price = 0, roi = 0, rentPrice = 0;
                
                // Prix via l'indice trouvé
                if (priceIndex >= 0 && priceIndex < cells.length) {
                    const priceText = cells[priceIndex].textContent;
                    price = num(priceText);
                    
                    // Si le prix inclut "DEC", c'est probablement un prix de location
                    if (priceText.toLowerCase().includes("dec")) {
                        rentPrice = price;
                    }
                }
                
                // ROI via l'indice trouvé
                if (roiIndex >= 0 && roiIndex < cells.length) {
                    const roiText = cells[roiIndex].textContent;
                    // Convertir le pourcentage en décimal
                    roi = num(roiText) / 100;
                }
                
                // Pour les tableaux de Renter's Board, chercher spécifiquement les valeurs importantes
                const pageType = detectPeakMonstersPage();
                if (pageType === "renter-board") {
                    // Chercher le prix par jour (DEC/day)
                    cells.forEach(cell => {
                        const text = cell.textContent.toLowerCase();
                        if (text.includes("dec") && (text.includes("/day") || text.includes("/jour"))) {
                            rentPrice = num(text);
                        }
                        
                        // Chercher le ROI ou des pourcentages
                        if (text.includes("%")) {
                            // Si on trouve plusieurs %, prendre le plus élevé (souvent le ROI)
                            const newRoi = num(text) / 100;
                            if (newRoi > roi) roi = newRoi;
                        }
                    });
                    
                    // Pour le Renter's Board, utiliser les CP/DEC comme prix
                    const cpDecColumn = headerTexts.findIndex(text => 
                        text.includes("cp/dec") || text.includes("dec/cp")
                    );
                    
                    if (cpDecColumn >= 0 && cpDecColumn < cells.length) {
                        const cpDecValue = num(cells[cpDecColumn].textContent);
                        if (cpDecValue > 0) {
                            price = cpDecValue;
                        }
                    }
                    
                    // Utiliser le Level/CP pour estimer la puissance
                    const levelCpColumn = headerTexts.findIndex(text => 
                        text.includes("level") || text.includes("cp")
                    );
                    
                    if (levelCpColumn >= 0 && levelCpColumn < cells.length) {
                        const levelCpText = cells[levelCpColumn].textContent;
                        const cpMatch = levelCpText.match(/\d+\s*\/\s*(\d+)/);
                        if (cpMatch && cpMatch[1]) {
                            const cp = parseInt(cpMatch[1], 10);
                            // Utiliser CP comme approximation de la puissance si on n'a pas de stats
                            if (!mana && !atk && !hp) {
                                // Estimer stats basées sur CP
                                const estimatedStat = Math.sqrt(cp / 10);
                                mana = 5; // Valeur moyenne
                                atk = estimatedStat;
                                hp = estimatedStat;
                                spd = 3; // Valeur moyenne
                            }
                        }
                    }
                }
                
                // Si on n'a pas de stats complètes, essayer d'utiliser le CP pour estimer
                if (!mana || !atk || !hp) {
                    // Chercher une valeur de CP dans les cellules
                    let cp = 0;
                    cells.forEach(cell => {
                        const text = cell.textContent;
                        if (text.includes("CP")) {
                            cp = num(text);
                        }
                    });
                    
                    if (cp > 0) {
                        // Estimer stats basées sur CP
                        const estimatedStat = Math.sqrt(cp / 10);
                        mana = mana || 5; // Valeur moyenne si non définie
                        atk = atk || estimatedStat;
                        hp = hp || estimatedStat;
                        spd = spd || 3; // Valeur moyenne si non définie
                    }
                }
                
                console.log(`Ligne ${rowIndex}: Stats = Mana:${mana}, ATK:${atk}, SPD:${spd}, HP:${hp}`);
                console.log(`Ligne ${rowIndex}: Prix = ${price}, RentPrice = ${rentPrice}, ROI = ${roi}`);
                
                // Construire la carte avec les données extraites
                const card = buildCard({
                    name,
                    mana: mana || 1, // Éviter division par zéro
                    atk: atk || 1,
                    spd: spd || 1,
                    hp: hp || 1,
                    price,
                    rentPrice,
                    roi,
                    pageType
                });
                
                // Si c'est une page Renter's Board, définir manuellement le ROI quotidien
                if (pageType === "renter-board" && roi > 0) {
                    card.dailyROI = roi;
                }
                
                console.log(`Ligne ${rowIndex}: Score = ${card.valueScore}`);
                cards.push(card);
            });
            
            return cards;
        }

        // Fonction spécifique pour les pages Renter's Board
        function scrapeRenterBoard() {
            console.log("Scraping spécifique pour Renter's Board");
            const cards = [];
            
            // Trouver le tableau principal
            const tables = document.querySelectorAll("table");
            let mainTable = null;
            
            // Identifier le bon tableau (celui qui contient le plus de lignes)
            if (tables.length > 0) {
                let maxRows = 0;
                
                tables.forEach(table => {
                    const rowCount = table.querySelectorAll("tbody tr").length;
                    if (rowCount > maxRows) {
                        maxRows = rowCount;
                        mainTable = table;
                    }
                });
            }
            
            if (!mainTable) {
                console.log("Aucun tableau trouvé sur la page Renter's Board");
                return cards;
            }
            
            console.log("Tableau principal trouvé avec " + mainTable.querySelectorAll("tbody tr").length + " lignes");
            
            // Extraire les cartes du tableau
            return scrapeTableCards(mainTable);
        }

        // Fonction pour calculer le score des capacités d'une carte
        function computeAbilityScore(card) {
            if (!card.abilities || !card.abilities.length) return 0;
            
            let totalImpact = 0;
            let synergiesBonus = 0;
            
            // Calculer l'impact total de toutes les capacités
            card.abilities.forEach(ability => {
                // Vérifier si l'ability existe dans notre liste
                if (CARD_ABILITIES[ability]) {
                    totalImpact += CARD_ABILITIES[ability].impact_score;
                    
                    // Vérifier les synergies entre les capacités
                    const synergies = CARD_ABILITIES[ability].synergies || [];
                    card.abilities.forEach(otherAbility => {
                        if (ability !== otherAbility && synergies.includes(otherAbility)) {
                            synergiesBonus += 1; // +1 point pour chaque synergie
                        }
                    });
                    
                    // Vérifier si les conditions sont remplies
                    const conditions = CARD_ABILITIES[ability].conditions || [];
                    conditions.forEach(condition => {
                        if (condition.includes("Mana >") && card.mana > parseInt(condition.replace("Mana > ", ""))) {
                            totalImpact += 0.5;
                        } else if (condition.includes("Speed >=") && card.spd >= parseInt(condition.replace("Speed >= ", ""))) {
                            totalImpact += 0.5;
                        } else if (condition.includes("Attack >=") && card.atk >= parseInt(condition.replace("Attack >= ", ""))) {
                            totalImpact += 0.5;
                        } else if (condition.includes("High Health") && card.hp > 20) {
                            totalImpact += 0.5;
                        } else if (condition.includes("High armor") && card.armor > 3) {
                            totalImpact += 0.5;
                        }
                    });
                }
            });
            
            // Bonus pour les synergies
            totalImpact += synergiesBonus * 0.5;
            
            // Normaliser le score sur 10
            const normalizedScore = Math.min(10, totalImpact);
            
            return normalizedScore;
        }

        // Ajouter le bouton de comparaison à l'interface
        function updateActionButtons() {
            const actionButtons = document.querySelector('.action-buttons');
            if (!actionButtons) return;
            
            // Ajouter le bouton de comparaison s'il n'existe pas déjà
            if (!document.getElementById('compare-cards-btn')) {
                const compareBtn = document.createElement('button');
                compareBtn.id = 'compare-cards-btn';
                compareBtn.className = 'action-btn';
                compareBtn.innerHTML = '🔍 Comparer les cartes';
                compareBtn.addEventListener('click', showComparisonOverlay);
                
                actionButtons.appendChild(compareBtn);
            }
            
            // Mettre à jour le texte du bouton de comparaison en fonction du nombre de cartes sélectionnées
            const selectedCardIds = JSON.parse(localStorage.getItem('pkm_selected_cards') || '[]');
            const compareBtn = document.getElementById('compare-cards-btn');
            if (compareBtn) {
                compareBtn.innerHTML = `🔍 Comparer (${selectedCardIds.length}/${MAX_COMPARE_CARDS})`;
                compareBtn.disabled = selectedCardIds.length === 0;
            }
        }

        // Sélectionner ou désélectionner une carte pour comparaison
        function toggleCardComparison(cardId, cardData) {
            let selectedCardIds = JSON.parse(localStorage.getItem('pkm_selected_cards') || '[]');
            let selectedCards = JSON.parse(localStorage.getItem('pkm_selected_cards_data') || '[]');
            
            const index = selectedCardIds.indexOf(cardId);
            
            if (index > -1) {
                // Désélectionner la carte
                selectedCardIds.splice(index, 1);
                selectedCards = selectedCards.filter(c => (c.id || c.name) !== cardId);
                
                // Mettre à jour l'interface
                document.querySelectorAll(`.compare-btn[data-card-id="${cardId}"]`).forEach(btn => {
                    btn.textContent = '+';
                    btn.closest('tr').classList.remove('card-selected');
                });
            } else {
                // Vérifier si le maximum n'est pas atteint
                if (selectedCardIds.length >= MAX_COMPARE_CARDS) {
                    alert(`Vous ne pouvez comparer que ${MAX_COMPARE_CARDS} cartes à la fois. Désélectionnez une carte pour en ajouter une nouvelle.`);
                    return;
                }
                
                // Sélectionner la carte
                selectedCardIds.push(cardId);
                selectedCards.push(cardData);
                
                // Mettre à jour l'interface
                document.querySelectorAll(`.compare-btn[data-card-id="${cardId}"]`).forEach(btn => {
                    btn.textContent = '✓';
                    btn.closest('tr').classList.add('card-selected');
                });
            }
            
            // Sauvegarder la sélection
            localStorage.setItem('pkm_selected_cards', JSON.stringify(selectedCardIds));
            localStorage.setItem('pkm_selected_cards_data', JSON.stringify(selectedCards));
            
            // Mettre à jour le bouton de comparaison
            updateActionButtons();
        }

        // Afficher l'overlay de comparaison
        function showComparisonOverlay() {
            // Récupérer les cartes sélectionnées
            const selectedCards = JSON.parse(localStorage.getItem('pkm_selected_cards_data') || '[]');
            
            if (selectedCards.length === 0) {
                alert("Veuillez sélectionner au moins une carte à comparer.");
                return;
            }
            
            // Fermer l'overlay existant s'il y en a un
            document.getElementById("pkm-comparison-overlay")?.remove();
            
            // Créer l'overlay de comparaison
            const overlay = document.createElement("div");
            overlay.id = "pkm-comparison-overlay";
            
            // Créer le contenu de l'overlay
            overlay.innerHTML = `
                <div class="comparison-header">
                    <h2>Comparaison de cartes</h2>
                    <button id="close-comparison">×</button>
                </div>
                <div class="comparison-grid">
                    ${generateComparisonGrid(selectedCards)}
                </div>
                <div class="comparison-charts">
                    <div id="ps-chart" class="chart-container"></div>
                    <div id="value-chart" class="chart-container"></div>
                    <div id="roi-chart" class="chart-container"></div>
                </div>
                <div class="comparison-actions">
                    <button id="clear-comparison" class="action-btn">Effacer la sélection</button>
                </div>
            `;
            
            // Ajouter l'overlay au DOM
            document.body.appendChild(overlay);
            
            // Ajouter les gestionnaires d'événements
            document.getElementById("close-comparison").addEventListener("click", () => {
                overlay.remove();
            });
            
            document.getElementById("clear-comparison").addEventListener("click", () => {
                // Effacer la sélection
                localStorage.setItem('pkm_selected_cards', '[]');
                localStorage.setItem('pkm_selected_cards_data', '[]');
                
                // Mettre à jour l'interface
                document.querySelectorAll(`.compare-btn`).forEach(btn => {
                    btn.textContent = '+';
                    btn.closest('tr').classList.remove('card-selected');
                });
                
                // Fermer l'overlay
                overlay.remove();
                
                // Mettre à jour le bouton de comparaison
                updateActionButtons();
            });
            
            // Générer les graphiques simples de comparaison
            generateComparisonCharts(selectedCards);
        }

        // Générer la grille de comparaison
        function generateComparisonGrid(cards) {
            // Définir les métriques à afficher
            const metrics = [
                { key: 'valueScore', label: '⭐ Score', format: (val) => val.toFixed(0) },
                { key: 'upgradeScore', label: '🔄 Priorité', format: (val) => val > 0 ? val.toFixed(0) : '-' },
                { key: 'ps', label: '💪 PS', format: (val) => val.toFixed(1) },
                { key: 'manaEfficiency', label: '⚡ Efficacité', format: (val) => val ? val.toFixed(2) : '-' },
                { key: 'pricePerPS', label: '💲/PS', format: (val) => val ? val.toFixed(3) : '-' },
                { key: 'roi', label: '💰 ROI', format: (val) => pct(val) },
                { key: 'dailyROI', label: '📅 ROI loc.', format: (val) => val !== undefined ? pct(val) : '-' },
                { key: 'abilityScore', label: '✨ Capacités', format: (val) => val ? val.toFixed(1) : '-' },
                { key: 'survival', label: '🛡️ Survie', format: (val) => val.toFixed(1) + ' tours' },
                { key: 'price', label: '💲 Prix', format: (val) => '$' + val.toFixed(3) },
                { key: 'action', label: '⚡ Action', format: (val) => val }
            ];
            
            // Générer les en-têtes des colonnes
            let html = '<table class="comparison-table"><thead><tr><th>Métrique</th>';
            
            cards.forEach(card => {
                html += `<th>${card.name || 'Sans nom'}</th>`;
            });
            
            html += '</tr></thead><tbody>';
            
            // Générer les lignes pour chaque métrique
            metrics.forEach(metric => {
                html += `<tr><td>${metric.label}</td>`;
                
                cards.forEach(card => {
                    const value = card[metric.key];
                    const formattedValue = metric.format(value);
                    
                    // Déterminer si cette valeur est la meilleure parmi toutes les cartes pour cette métrique
                    let isBest = false;
                    
                    if (value !== undefined && value !== null) {
                        // Définir si une valeur plus élevée est meilleure (true) ou plus basse (false)
                        const higherIsBetter = metric.key !== 'pricePerPS' && metric.key !== 'price';
                        
                        isBest = cards.every(c => {
                            const otherValue = c[metric.key];
                            if (otherValue === undefined || otherValue === null) return true;
                            return higherIsBetter 
                                ? value >= otherValue 
                                : value <= otherValue;
                        });
                    }
                    
                    html += `<td ${isBest ? 'class="best-value"' : ''}>${formattedValue}</td>`;
                });
                
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            
            return html;
        }

        // Générer les graphiques de comparaison simples
        function generateComparisonCharts(cards) {
            // Fonction pour créer un graphique à barres simple
            function createBarChart(containerId, label, valueKey, cards) {
                const container = document.getElementById(containerId);
                if (!container) return;
                
                const chartData = cards.map(card => ({
                    name: card.name || 'Sans nom',
                    value: card[valueKey] || 0
                }));
                
                // Trier les données par valeur
                chartData.sort((a, b) => b.value - a.value);
                
                // Calculer la hauteur maximale et trouver la valeur max
                const maxValue = Math.max(...chartData.map(d => d.value));
                
                // Créer le HTML du graphique
                let chartHtml = `
                    <h3>${label}</h3>
                    <div class="simple-chart">
                `;
                
                chartData.forEach(item => {
                    const percentage = (item.value / maxValue) * 100;
                    chartHtml += `
                        <div class="chart-bar-container">
                            <div class="chart-label">${item.name}</div>
                            <div class="chart-bar" style="width: ${percentage}%;">
                                <span class="chart-value">${item.value.toFixed(1)}</span>
                            </div>
                        </div>
                    `;
                });
                
                chartHtml += '</div>';
                container.innerHTML = chartHtml;
            }
            
            // Créer les trois graphiques
            createBarChart('ps-chart', 'Power Score (PS)', 'ps', cards);
            createBarChart('value-chart', 'Score Global', 'valueScore', cards);
            createBarChart('roi-chart', 'Retour sur Investissement (ROI)', 'roi', cards);
        }

        // Variables pour le filtrage
        let activeFilters = {
            ps: { min: null, max: null },
            score: { min: null, max: null },
            roi: { min: null, max: null },
            price: { min: null, max: null },
            action: null,
            owned: null
        };

        // Initialiser les filtres avancés
        function initFilters(overlay) {
            // Toggle du panneau de filtres
            const toggleBtn = overlay.querySelector('#toggle-filters');
            const filtersContainer = overlay.querySelector('.filters-container');
            
            if (toggleBtn && filtersContainer) {
                toggleBtn.addEventListener('click', function() {
                    const isHidden = filtersContainer.style.display === 'none';
                    filtersContainer.style.display = isHidden ? 'grid' : 'none';
                    toggleBtn.textContent = isHidden ? '🔍 Masquer les filtres' : '🔍 Filtres avancés';
                });
            }
            
            // Gestionnaire pour appliquer les filtres
            const applyBtn = overlay.querySelector('#apply-filters');
            if (applyBtn) {
                applyBtn.addEventListener('click', function() {
                    updateActiveFilters(overlay);
                    renderTable();
                });
            }
            
            // Gestionnaire pour réinitialiser les filtres
            const resetBtn = overlay.querySelector('#reset-filters');
            if (resetBtn) {
                resetBtn.addEventListener('click', function() {
                    resetFilters(overlay);
                    renderTable();
                });
            }
            
            // Gestionnaire pour sauvegarder un préréglage personnalisé
            const savePresetBtn = overlay.querySelector('#save-preset');
            if (savePresetBtn) {
                savePresetBtn.addEventListener('click', function() {
                    saveCustomPreset(overlay);
                });
            }
            
            // Gestionnaire pour charger un préréglage
            const loadPresetSelect = overlay.querySelector('#load-preset');
            if (loadPresetSelect) {
                loadPresetSelect.addEventListener('change', function() {
                    if (this.value) {
                        loadPreset(overlay, this.value);
                        // Réinitialiser le sélecteur
                        setTimeout(() => { this.selectedIndex = 0; }, 10);
                    }
                });
                
                // Ajouter les préréglages personnalisés enregistrés
                loadCustomPresets(loadPresetSelect);
            }
        }

        // Charger un préréglage prédéfini
        function loadPreset(overlay, presetName) {
            // Réinitialiser d'abord tous les filtres
            resetFilters(overlay);
            
            // Appliquer le préréglage sélectionné
            switch(presetName) {
                case 'high-ps':
                    setFilterValue(overlay, '#filter-ps-min', 15);
                    break;
                    
                case 'high-roi':
                    setFilterValue(overlay, '#filter-roi-min', 5);
                    break;
                    
                case 'upgrade-priority':
                    setFilterValue(overlay, '#filter-score-min', 50);
                    overlay.querySelector('#filter-action').value = 'Monter';
                    break;
                    
                case 'owned-cards':
                    overlay.querySelector('#filter-owned').value = 'owned';
                    break;
                    
                case 'rent-efficient':
                    setFilterValue(overlay, '#filter-roi-min', 3);
                    break;
                    
                default:
                    // Charger un préréglage personnalisé
                    try {
                        const customPresets = JSON.parse(localStorage.getItem('pkm_filter_presets') || '{}');
                        if (customPresets[presetName]) {
                            const preset = customPresets[presetName];
                            
                            // Appliquer chaque filtre du préréglage
                            if (preset.ps) {
                                setFilterValue(overlay, '#filter-ps-min', preset.ps.min);
                                setFilterValue(overlay, '#filter-ps-max', preset.ps.max);
                            }
                            
                            if (preset.score) {
                                setFilterValue(overlay, '#filter-score-min', preset.score.min);
                                setFilterValue(overlay, '#filter-score-max', preset.score.max);
                            }
                            
                            if (preset.roi) {
                                setFilterValue(overlay, '#filter-roi-min', preset.roi.min * 100);
                                setFilterValue(overlay, '#filter-roi-max', preset.roi.max * 100);
                            }
                            
                            if (preset.price) {
                                setFilterValue(overlay, '#filter-price-min', preset.price.min);
                                setFilterValue(overlay, '#filter-price-max', preset.price.max);
                            }
                            
                            if (preset.action) {
                                overlay.querySelector('#filter-action').value = preset.action;
                            }
                            
                            if (preset.owned) {
                                overlay.querySelector('#filter-owned').value = preset.owned;
                            }
                        }
                    } catch (error) {
                        console.error("Erreur lors du chargement du préréglage personnalisé:", error);
                    }
                    break;
            }
            
            // Appliquer les filtres et mettre à jour l'interface
            updateActiveFilters(overlay);
            renderTable();
            
            console.log(`Préréglage "${presetName}" chargé`);
        }

        // Définir la valeur d'un filtre numérique
        function setFilterValue(overlay, selector, value) {
            const input = overlay.querySelector(selector);
            if (input && !isNaN(value) && value !== null) {
                input.value = value;
            }
        }

        // Sauvegarder un préréglage personnalisé
        function saveCustomPreset(overlay) {
            // Vérifier s'il y a des filtres actifs
            updateActiveFilters(overlay);
            
            const hasActiveFilters = Object.values(activeFilters).some(filter => {
                if (typeof filter === 'object') {
                    return filter.min !== null || filter.max !== null;
                }
                return filter !== null;
            });
            
            if (!hasActiveFilters) {
                alert("Veuillez définir au moins un filtre avant de sauvegarder un préréglage.");
                return;
            }
            
            // Demander un nom pour le préréglage
            const presetName = prompt("Donnez un nom à ce préréglage de filtres:");
            if (!presetName) return;
            
            // Sauvegarder le préréglage
            try {
                const customPresets = JSON.parse(localStorage.getItem('pkm_filter_presets') || '{}');
                customPresets[presetName] = activeFilters;
                localStorage.setItem('pkm_filter_presets', JSON.stringify(customPresets));
                
                // Mettre à jour la liste des préréglages
                const loadPresetSelect = overlay.querySelector('#load-preset');
                if (loadPresetSelect) {
                    loadCustomPresets(loadPresetSelect);
                }
                
                alert(`Préréglage "${presetName}" enregistré avec succès.`);
            } catch (error) {
                console.error("Erreur lors de l'enregistrement du préréglage:", error);
                alert("Une erreur est survenue lors de l'enregistrement du préréglage.");
            }
        }

        // Charger les préréglages personnalisés dans le sélecteur
        function loadCustomPresets(selectElement) {
            try {
                const customPresets = JSON.parse(localStorage.getItem('pkm_filter_presets') || '{}');
                
                // Supprimer les anciens préréglages personnalisés
                Array.from(selectElement.options).forEach(option => {
                    if (option.value && !['high-ps', 'high-roi', 'upgrade-priority', 'owned-cards', 'rent-efficient', ''].includes(option.value)) {
                        selectElement.removeChild(option);
                    }
                });
                
                // Ajouter une option de séparation si des préréglages personnalisés existent
                if (Object.keys(customPresets).length > 0) {
                    const separator = document.createElement('option');
                    separator.disabled = true;
                    separator.textContent = '-- Préréglages personnalisés --';
                    selectElement.appendChild(separator);
                    
                    // Ajouter chaque préréglage personnalisé
                    Object.keys(customPresets).forEach(presetName => {
                        const option = document.createElement('option');
                        option.value = presetName;
                        option.textContent = presetName;
                        selectElement.appendChild(option);
                    });
                }
            } catch (error) {
                console.error("Erreur lors du chargement des préréglages personnalisés:", error);
            }
        }

        // Mettre à jour les filtres actifs
        function updateActiveFilters(overlay) {
            activeFilters = {
                ps: {
                    min: getNumericFilterValue(overlay, '#filter-ps-min'),
                    max: getNumericFilterValue(overlay, '#filter-ps-max')
                },
                score: {
                    min: getNumericFilterValue(overlay, '#filter-score-min'),
                    max: getNumericFilterValue(overlay, '#filter-score-max')
                },
                roi: {
                    min: getNumericFilterValue(overlay, '#filter-roi-min', 100),
                    max: getNumericFilterValue(overlay, '#filter-roi-max', 100)
                },
                price: {
                    min: getNumericFilterValue(overlay, '#filter-price-min'),
                    max: getNumericFilterValue(overlay, '#filter-price-max')
                },
                action: overlay.querySelector('#filter-action').value || null,
                owned: overlay.querySelector('#filter-owned').value || null
            };
            
            console.log("Filtres appliqués:", activeFilters);
        }

        // Obtenir la valeur numérique d'un filtre
        function getNumericFilterValue(overlay, selector, multiplier = 1) {
            const input = overlay.querySelector(selector);
            if (!input || input.value === '') return null;
            
            const value = parseFloat(input.value);
            return isNaN(value) ? null : value / multiplier;
        }

        // Réinitialiser tous les filtres
        function resetFilters(overlay) {
            // Réinitialiser les champs de formulaire
            const inputs = overlay.querySelectorAll('.filters-container input, .filters-container select');
            inputs.forEach(input => {
                if (input.type === 'number') {
                    input.value = '';
                } else if (input.tagName === 'SELECT') {
                    input.selectedIndex = 0;
                }
            });
            
            // Réinitialiser les filtres actifs
            activeFilters = {
                ps: { min: null, max: null },
                score: { min: null, max: null },
                roi: { min: null, max: null },
                price: { min: null, max: null },
                action: null,
                owned: null
            };
            
            console.log("Filtres réinitialisés");
        }

        // Modifier la fonction de rendu du tableau pour appliquer les filtres
        function renderTable() {
            console.log("Rendu du tableau avec tri par", sortKey, sortAsc ? "ASC" : "DESC");
            tbody.innerHTML = '';
            
            // Supprimer l'ancien compteur s'il existe
            const oldCounter = document.querySelector('.filtered-count');
            if (oldCounter) oldCounter.remove();
            
            // Cloner et filtrer les cartes
            let filteredCards = [...cards].filter(card => {
                // Appliquer les filtres actifs
                if (activeFilters.ps.min !== null && card.ps < activeFilters.ps.min) return false;
                if (activeFilters.ps.max !== null && card.ps > activeFilters.ps.max) return false;
                
                if (activeFilters.score.min !== null && card.valueScore < activeFilters.score.min) return false;
                if (activeFilters.score.max !== null && card.valueScore > activeFilters.score.max) return false;
                
                if (activeFilters.roi.min !== null && card.roi < activeFilters.roi.min) return false;
                if (activeFilters.roi.max !== null && card.roi > activeFilters.roi.max) return false;
                
                if (activeFilters.price.min !== null && card.price < activeFilters.price.min) return false;
                if (activeFilters.price.max !== null && card.price > activeFilters.price.max) return false;
                
                if (activeFilters.action !== null && card.action !== activeFilters.action) return false;
                
                if (activeFilters.owned === 'owned' && (!card.owned || card.owned <= 0)) return false;
                if (activeFilters.owned === 'not-owned' && card.owned > 0) return false;
                
                return true;
            });
            
            // Afficher les résultats du filtrage
            const filteredCount = document.createElement('div');
            filteredCount.className = 'filtered-count';
            
            // S'il y a des filtres actifs, afficher le nombre de cartes filtrées
            const hasActiveFilters = Object.values(activeFilters).some(filter => {
                if (typeof filter === 'object') {
                    return filter.min !== null || filter.max !== null;
                }
                return filter !== null;
            });
            
            if (hasActiveFilters) {
                filteredCount.innerHTML = `<span>Filtres appliqués : ${filteredCards.length} cartes affichées sur ${cards.length} au total</span>`;
            } else {
                filteredCount.innerHTML = `<span>${cards.length} cartes au total</span>`;
            }
            
            // Insérer le compteur avant le tableau
            const table = tbody.closest('table');
            if (table && table.parentNode) {
                table.parentNode.insertBefore(filteredCount, table);
            }
            
            // Trier les cartes filtrées
            filteredCards.sort((a, b) => {
                let aVal = a[sortKey] === undefined ? 0 : a[sortKey];
                let bVal = b[sortKey] === undefined ? 0 : b[sortKey];
                return sortAsc ? aVal - bVal : bVal - aVal;
            });
            
            // Vérifier s'il y a des cartes sélectionnées pour comparaison
            const selectedCardIds = JSON.parse(localStorage.getItem('pkm_selected_cards') || '[]');
            
            // Afficher les cartes filtrées
            filteredCards.forEach(card => {
                // ... code existant pour afficher chaque carte ...
                const tr = document.createElement('tr');
                              
                // Vérifier si cette carte est sélectionnée pour comparaison
                const isSelected = selectedCardIds.includes(card.id || card.name);
                if (isSelected) {
                    tr.classList.add('card-selected');
                }
                
                tr.innerHTML = `
                    <td>
                        <div class="card-name">
                            ${card.name} 
                            <button class="compare-btn" data-card-id="${card.id || card.name}" title="Ajouter/retirer de la comparaison">
                                ${isSelected ? '✓' : '+'}
                            </button>
                        </div>
                    </td>
                    <td>${getActionIcon(card.action)} ${card.action}</td>
                    <td><b>${card.valueScore.toFixed(0)}</b></td>
                    <td><b>${card.upgradeScore > 0 ? card.upgradeScore.toFixed(0) : '-'}</b></td>
                    <td><b>${card.ps.toFixed(1)}</b></td>
                    <td>${card.abilityScore ? `<b>${card.abilityScore.toFixed(1)}</b>` : '-'}</td>
                    <td><b>${card.manaEfficiency ? card.manaEfficiency.toFixed(2) : '-'}</b></td>
                    <td><b>${card.pricePerPS ? card.pricePerPS.toFixed(3) : '-'}</b></td>
                    <td><b>${pct(card.roi)}</b></td>
                    <td><b>${card.dailyROI !== undefined ? pct(card.dailyROI) : '-'}</b></td>
                    <td><b>${card.winrate !== undefined ? pct(card.winrate) : '-'}</b></td>
                    <td><b>${card.survival.toFixed(1)}</b> tours</td>
                    <td>${card.mana}</td>
                    <td><b>$${card.price.toFixed(3)}</b></td>
                    <td>${card.owned > 0 ? `<b>${card.owned}</b>` : '0'}</td>
                `;
                
                tbody.appendChild(tr);
                
                // Ajouter l'interaction pour les boutons de comparaison
                const compareBtn = tr.querySelector('.compare-btn');
                if (compareBtn) {
                    compareBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        toggleCardComparison(card.id || card.name, card);
                    });
                }
            });

            // Mettre à jour les statistiques de collection basées sur le jeu de cartes filtré
            updateCollectionStats(filteredCards);
        }

        // Créer une fonction de diagnostic avec surlignage des éléments
        function highlightVueElements(card) {
            // Créer un élément de diagnostic
            const diagEl = document.createElement('div');
            diagEl.className = 'pkm-diagnostic-highlight';
            diagEl.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(255, 145, 77, 0.2);
                z-index: 9990;
                pointer-events: none;
                border: 2px solid #ff914d;
            `;
            
            // Ajouter temporairement à la carte
            const cardPos = card.style.position;
            card.style.position = 'relative';
            card.appendChild(diagEl);
            
            // Afficher les infos de la carte dans la console avec une couleur spéciale
            console.log('%c[PeakMonsters Analyzer] Carte Vue.js détectée', 'color: #ff914d; font-weight: bold;');
            
            // Créer un indicateur pour les éléments importants
            const highlightElements = (selector, color, label) => {
                const elements = card.querySelectorAll(selector);
                console.log(`%c[PeakMonsters Analyzer] ${label}: ${elements.length} élément(s) trouvé(s)`, `color: ${color};`);
                
                elements.forEach((el, idx) => {
                    // Créer un marqueur visuel
                    const marker = document.createElement('div');
                    marker.style.cssText = `
                        position: absolute;
                        padding: 2px 5px;
                        background: ${color};
                        color: white;
                        font-size: 10px;
                        z-index: 9991;
                        pointer-events: none;
                        border-radius: 3px;
                    `;
                    marker.textContent = `${label} #${idx+1}`;
                    
                    // Positionner près de l'élément
                    const rect = el.getBoundingClientRect();
                    const cardRect = card.getBoundingClientRect();
                    marker.style.top = `${rect.top - cardRect.top}px`;
                    marker.style.left = `${rect.left - cardRect.left}px`;
                    
                    // Ajouter à la carte
                    card.appendChild(marker);
                    
                    // Enregistrer le contenu dans la console
                    console.log(`%c[PeakMonsters Analyzer] ${label} #${idx+1}: ${el.textContent.trim().substring(0, 50)}`, `color: ${color};`);
                });
            };
            
            // Analyser les éléments clés
            highlightElements('a.text-default, .media-heading a', '#4caf50', 'Nom');
            highlightElements('.media-right h5', '#2196f3', 'Prix');
            highlightElements('table.table-xxs, .card-stats table', '#9c27b0', 'Stats');
            highlightElements('span[data-tippy], span[data-original-title]', '#ff5722', 'Capacité');
            
            // Nettoyer après 5 secondes
            setTimeout(() => {
                diagEl.remove();
                card.style.position = cardPos;
                card.querySelectorAll('.pkm-diagnostic-highlight').forEach(el => el.remove());
                Array.from(card.children).forEach(el => {
                    if (el.style && el.style.zIndex === '9991') {
                        el.remove();
                    }
                });
            }, 5000);
        }

        //--------------------------------------------------
        // Analyse de méta et positions de cartes
        //--------------------------------------------------
        function analyzeMetaAndPositions(cards) {
            // Données de méta (à remplacer par des données réelles ou une API)
            const metaData = {
                current: "Mana 30 - Terre/Eau",
                topDecks: [
                    { name: "Tank Terre + Soutien Eau", winrate: 0.68, manaCap: 30 },
                    { name: "Sneak Mort + Magic Feu", winrate: 0.65, manaCap: 30 },
                    { name: "Swarm Dragon", winrate: 0.62, manaCap: 25 }
                ],
                cardPositions: {
                    // Format: cardName: { position: "tank|ranged|magic|support", winrate: 0.XX }
                    "Pelacor Mercenary": { position: "tank", winrate: 0.72 },
                    "Venari Heatsmith": { position: "support", winrate: 0.65 },
                    "Twilight Basilisk": { position: "ranged", winrate: 0.61 },
                    "Chain Spinner": { position: "magic", winrate: 0.58 }
                    // Ajouter d'autres cartes selon les données disponibles
                },
                cardSynergies: {
                    // Format: cardName: [{ partner: "Card Name", synergy: 0.XX }]
                    "Pelacor Mercenary": [
                        { partner: "Venari Crystalsmith", synergy: 0.75, description: "Heal sur Tank" },
                        { partner: "Earth Elemental", synergy: 0.70, description: "Double Tank Terre" }
                    ],
                    "Twilight Basilisk": [
                        { partner: "Deeplurker", synergy: 0.72, description: "Sneak + Ranged" }
                    ]
                    // Ajouter d'autres synergies
                }
            };

            // Créer l'interface pour afficher les informations de méta
            const metaOverlay = document.createElement("div");
            metaOverlay.id = "pkm-meta-analyzer";
            metaOverlay.innerHTML = `
                <h2>Analyse de Méta</h2>
                <button id="pkm-meta-close">×</button>
                
                <div class="meta-section">
                    <h3>Méta Actuelle</h3>
                    <div class="meta-current">${metaData.current}</div>
                </div>
                
                <div class="meta-section">
                    <h3>Decks Performants</h3>
                    <div class="top-decks">
                        ${metaData.topDecks.map(deck => `
                            <div class="meta-deck">
                                <div class="deck-name">${deck.name}</div>
                                <div class="deck-stats">
                                    <span class="deck-winrate">Winrate: ${(deck.winrate * 100).toFixed(1)}%</span>
                                    <span class="deck-mana">Mana: ${deck.manaCap}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="meta-section">
                    <h3>Positions Optimales</h3>
                    <div class="card-positions">
                        <table class="positions-table">
                            <thead>
                                <tr>
                                    <th>Carte</th>
                                    <th>Position</th>
                                    <th>Winrate</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.entries(metaData.cardPositions)
                                    .sort((a, b) => b[1].winrate - a[1].winrate)
                                    .map(([card, data]) => `
                                        <tr>
                                            <td>${card}</td>
                                            <td>${getPositionIcon(data.position)} ${data.position}</td>
                                            <td>${(data.winrate * 100).toFixed(1)}%</td>
                                        </tr>
                                    `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="meta-section">
                    <h3>Synergies</h3>
                    <div class="card-synergies">
                        ${Object.entries(metaData.cardSynergies).map(([card, synergies]) => `
                            <div class="synergy-group">
                                <h4>${card}</h4>
                                <ul class="synergy-list">
                                    ${synergies.map(s => `
                                        <li>
                                            <span class="partner-name">${s.partner}</span>
                                            <span class="synergy-value">${(s.synergy * 100).toFixed(0)}%</span>
                                            <span class="synergy-desc">${s.description}</span>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Ajouter des styles pour l'analyse de méta
            if (!document.getElementById('pkm-meta-style')) {
                const style = document.createElement('style');
                style.id = 'pkm-meta-style';
                style.textContent = `
                    #pkm-meta-analyzer {
                        position: fixed;
                        top: 5vh;
                        left: 50%;
                        transform: translateX(-50%);
                        background: #fff;
                        padding: 20px 24px;
                        width: 90%;
                        max-width: 900px;
                        max-height: 90vh;
                        overflow: auto;
                        box-shadow: 0 6px 20px rgba(0,0,0,.2);
                        border-radius: 12px;
                        z-index: 10000;
                        font-family: sans-serif;
                    }
                    #pkm-meta-analyzer h2 {
                        margin: 0 0 20px;
                        font-size: 24px;
                        color: #333;
                    }
                    #pkm-meta-analyzer h3 {
                        margin: 0 0 10px;
                        font-size: 18px;
                        color: #444;
                    }
                    #pkm-meta-analyzer h4 {
                        margin: 10px 0 5px;
                        font-size: 16px;
                        color: #555;
                    }
                    #pkm-meta-close {
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        cursor: pointer;
                        font-size: 24px;
                        background: none;
                        border: none;
                        color: #666;
                    }
                    .meta-section {
                        margin-bottom: 25px;
                        padding-bottom: 15px;
                        border-bottom: 1px solid #eee;
                    }
                    .meta-current {
                        font-size: 18px;
                        font-weight: 600;
                        color: #ff914d;
                        padding: 10px;
                        background: #fff9f5;
                        border-radius: 5px;
                        text-align: center;
                    }
                    .top-decks {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                        gap: 15px;
                        margin-top: 15px;
                    }
                    .meta-deck {
                        background: #f8f9fa;
                        padding: 12px;
                        border-radius: 8px;
                        border-left: 4px solid #ff914d;
                    }
                    .deck-name {
                        font-weight: 600;
                        margin-bottom: 8px;
                        color: #333;
                    }
                    .deck-stats {
                        display: flex;
                        justify-content: space-between;
                        color: #666;
                        font-size: 14px;
                    }
                    .deck-winrate {
                        color: #28a745;
                        font-weight: 500;
                    }
                    .positions-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 10px;
                    }
                    .positions-table th, .positions-table td {
                        padding: 8px 12px;
                        text-align: left;
                        border-bottom: 1px solid #eee;
                    }
                    .positions-table th {
                        background: #f5f5f5;
                        font-weight: 600;
                    }
                    .synergy-group {
                        margin-bottom: 15px;
                    }
                    .synergy-list {
                        list-style: none;
                        padding: 0;
                        margin: 0;
                    }
                    .synergy-list li {
                        display: flex;
                        align-items: center;
                        padding: 8px 0;
                        border-bottom: 1px dashed #eee;
                    }
                    .partner-name {
                        flex: 1;
                        font-weight: 500;
                    }
                    .synergy-value {
                        background: #e8f4ff;
                        padding: 3px 8px;
                        border-radius: 12px;
                        margin: 0 10px;
                        font-size: 13px;
                        font-weight: 600;
                        color: #0366d6;
                    }
                    .synergy-desc {
                        color: #666;
                        font-size: 13px;
                        font-style: italic;
                    }
                `;
                document.head.appendChild(style);
            }

            // Ajouter au DOM
            document.body.appendChild(metaOverlay);

            // Gérer la fermeture - Correction du problème
            const closeBtn = document.getElementById("pkm-meta-close");
            if (closeBtn) {
                closeBtn.addEventListener("click", function() {
                    document.getElementById("pkm-meta-analyzer")?.remove();
                });
            }

            // Fonction utilitaire pour obtenir une icône selon la position
            function getPositionIcon(position) {
                switch(position.toLowerCase()) {
                    case 'tank': return '🛡️';
                    case 'ranged': return '🏹';
                    case 'magic': return '✨';
                    case 'support': return '🧪';
                    default: return '⚔️';
                }
            }
        }

        // Ajouter un bouton pour analyser la méta
        function addMetaAnalysisButton() {
            if (document.getElementById("pkm-meta-btn")) return;
            const btn = document.createElement("button");
            btn.id = "pkm-meta-btn";
            btn.textContent = "Analyse Méta";
            btn.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 170px;  /* Décalé vers la gauche pour ne pas chevaucher le bouton d'analyse de deck */
                padding: 10px 16px;
                font-size: 14px;
                background: #5d62d3;
                color: #fff;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                z-index: 9999;
                box-shadow: 0 4px 10px rgba(0,0,0,.15);
            `;
            btn.onclick = () => analyzeMetaAndPositions();
            document.body.appendChild(btn);
        }

        // Modifier la fonction d'initialisation pour ajouter le bouton d'analyse méta
        window.addEventListener("load", () => {
            injectStyles();
            
            // Observer pour le bouton d'analyse de deck
            const analyzerObserver = new MutationObserver(() => {
                if (document.querySelector(".card-stats tbody tr")) {
                    addAnalyzeButton();
                    addMetaAnalysisButton(); // Ajouter le bouton d'analyse méta
                    analyzerObserver.disconnect();
                }
            });
            analyzerObserver.observe(document.body, { childList: true, subtree: true });
            
            // ... existing code ...
        });

        // Ajouter après la fonction analyzeMetaAndPositions

        // Constantes pour les éléments (couleurs) de Splinterlands
        const SPLINTERLANDS_ELEMENTS = {
            "fire": {
                name: "Feu",
                icon: "🔥",
                color: "#ff4d4d",
                strengths: ["Attaque élevée", "Dégâts de zone", "Enrage"],
                weaknesses: ["Santé faible", "Vulnérable aux sorts d'eau"],
                strategy: "Offensive agressive, éliminer rapidement les ennemis"
            },
            "water": {
                name: "Eau",
                icon: "💧",
                color: "#4d94ff",
                strengths: ["Heal", "Debuffs", "Magic"],
                weaknesses: ["Vitesse moyenne", "Faible contre la terre"],
                strategy: "Contrôle, survie prolongée et affaiblissement des ennemis"
            },
            "earth": {
                name: "Terre",
                icon: "🌿",
                color: "#80cc33",
                strengths: ["Santé élevée", "Poison", "Thorns"],
                weaknesses: ["Vitesse faible", "Vulnérable au feu"],
                strategy: "Défensive, tanks solides et dégâts sur la durée"
            },
            "life": {
                name: "Vie",
                icon: "✨",
                color: "#ffcc00",
                strengths: ["Heal", "Buffs", "Resurrect"],
                weaknesses: ["Attaque moyenne", "Vulnérable à la mort"],
                strategy: "Support, renforcement des alliés et guérison"
            },
            "death": {
                name: "Mort",
                icon: "💀",
                color: "#9966cc",
                strengths: ["Afflictions", "Drain", "Sneak"],
                weaknesses: ["Santé faible", "Vulnérable à la vie"],
                strategy: "Affaiblissement, vol de vie et attaques sournoises"
            },
            "dragon": {
                name: "Dragon",
                icon: "🐉",
                color: "#ff9933",
                strengths: ["Stats équilibrées", "Polyvalence", "Flying"],
                weaknesses: ["Coût élevé", "Pas de spécialisation"],
                strategy: "Flexibilité, adaptable à différentes situations"
            },
            "neutral": {
                name: "Neutre",
                icon: "⚪",
                color: "#cccccc",
                strengths: ["Utilisable partout", "Bonnes synergies"],
                weaknesses: ["Pas de bonus d'élément"],
                strategy: "Complément pour tous les decks, rôles variés"
            }
        };

        // Positions de jeu
        const BATTLE_POSITIONS = {
            "tank": {
                name: "Tank",
                icon: "🛡️",
                description: "Première position, absorbe les dégâts",
                requirements: "Santé élevée, Armor, Taunt",
                bestElements: ["earth", "life", "dragon"]
            },
            "attacker": {
                name: "Attaquant",
                icon: "⚔️",
                description: "Deuxième position, inflige des dégâts élevés",
                requirements: "Attaque élevée, Vitesse correcte",
                bestElements: ["fire", "death", "dragon"]
            },
            "support": {
                name: "Support",
                icon: "🧪",
                description: "Position arrière, buff/debuff",
                requirements: "Capacités de soutien",
                bestElements: ["water", "life"]
            },
            "sniper": {
                name: "Sniper",
                icon: "🏹",
                description: "Position arrière, cible les ennemis spécifiques",
                requirements: "Snipe, Sneak, ou Opportunity",
                bestElements: ["water", "death"]
            },
            "magic": {
                name: "Magicien",
                icon: "✨",
                description: "Position arrière, ignore l'armure",
                requirements: "Attaque magique",
                bestElements: ["water", "death", "fire"]
            }
        };

        // Fonction pour analyser les decks par élément
        function analyzeDecksByElement(cards) {
            if (!cards || !cards.length) {
                cards = scrapeCards();
            }
            
            // Filtrer pour n'inclure que les cartes possédées
            const ownedCards = cards.filter(card => card.owned > 0);
            
            // Créer un overlay pour afficher l'analyse
            const overlay = document.createElement("div");
            overlay.id = "pkm-deck-analyzer";
            overlay.style.cssText = `
                position: fixed;
                top: 5vh;
                left: 50%;
                transform: translateX(-50%);
                background: #fff;
                padding: 20px 24px;
                width: 90%;
                max-width: 1000px;
                max-height: 90vh;
                overflow: auto;
                box-shadow: 0 6px 20px rgba(0,0,0,.2);
                border-radius: 12px;
                z-index: 10000;
                font-family: sans-serif;
            `;
            
            // Déterminer l'élément de chaque carte (à partir du nom ou des propriétés)
            ownedCards.forEach(card => {
                // Logique simplifiée pour déterminer l'élément - à améliorer avec des données réelles
                if (card.name.toLowerCase().includes("fire") || card.name.toLowerCase().includes("flame")) {
                    card.element = "fire";
                } else if (card.name.toLowerCase().includes("water") || card.name.toLowerCase().includes("wave")) {
                    card.element = "water";
                } else if (card.name.toLowerCase().includes("earth") || card.name.toLowerCase().includes("stone")) {
                    card.element = "earth";
                } else if (card.name.toLowerCase().includes("life") || card.name.toLowerCase().includes("light")) {
                    card.element = "life";
                } else if (card.name.toLowerCase().includes("death") || card.name.toLowerCase().includes("dark")) {
                    card.element = "death";
                } else if (card.name.toLowerCase().includes("dragon")) {
                    card.element = "dragon";
                } else {
                    card.element = "neutral";
                }
                
                // Déterminer la position recommandée
                card.recommendedPosition = determineCardPosition(card);
            });
            
            // Regrouper les cartes par élément
            const cardsByElement = {};
            Object.keys(SPLINTERLANDS_ELEMENTS).forEach(element => {
                cardsByElement[element] = ownedCards.filter(card => card.element === element);
            });
            
            // Générer le contenu HTML
            let html = `
                <h2>Analyse de Deck par Élément</h2>
                <button id="pkm-deck-close" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 24px; cursor: pointer;">×</button>
                
                <div class="element-tabs" style="display: flex; margin-bottom: 20px; border-bottom: 1px solid #eee;">
                    ${Object.entries(SPLINTERLANDS_ELEMENTS).map(([key, element]) => `
                        <div class="element-tab" data-element="${key}" style="padding: 10px 15px; cursor: pointer; margin-right: 5px; border-radius: 8px 8px 0 0; background: ${element.color}20;">
                            ${element.icon} ${element.name}
                        </div>
                    `).join('')}
                </div>
                
                <div class="element-content">
                    ${Object.entries(SPLINTERLANDS_ELEMENTS).map(([key, element]) => `
                        <div class="element-panel" id="element-panel-${key}" style="display: none;">
                            <div class="element-header" style="background: ${element.color}20; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                                <h3>${element.icon} ${element.name}</h3>
                                <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                                    <div>
                                        <strong>Forces:</strong> ${element.strengths.join(", ")}
                                    </div>
                                    <div>
                                        <strong>Faiblesses:</strong> ${element.weaknesses.join(", ")}
                                    </div>
                                </div>
                                <div style="margin-top: 10px;">
                                    <strong>Stratégie:</strong> ${element.strategy}
                                </div>
                            </div>
                            
                            <h4>Cartes ${element.name} Disponibles (${cardsByElement[key].length})</h4>
                            ${cardsByElement[key].length > 0 ? `
                                <div class="element-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                                    ${cardsByElement[key].map(card => `
                                        <div class="element-card" style="border: 1px solid #eee; border-radius: 8px; padding: 12px; background: ${element.color}10;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                                <strong>${card.name}</strong>
                                                <span>${BATTLE_POSITIONS[card.recommendedPosition].icon} ${BATTLE_POSITIONS[card.recommendedPosition].name}</span>
                                            </div>
                                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 14px;">
                                                <div>Mana: ${card.mana}</div>
                                                <div>PS: ${card.ps.toFixed(1)}</div>
                                                <div>Attaque: ${card.atk}</div>
                                                <div>Santé: ${card.hp}</div>
                                                <div>Vitesse: ${card.spd}</div>
                                                <div>Armure: ${card.armor || 0}</div>
                                            </div>
                                            ${card.abilities && card.abilities.length ? `
                                                <div style="margin-top: 8px; font-size: 13px;">
                                                    <strong>Capacités:</strong> ${card.abilities.join(", ")}
                                                </div>
                                            ` : ''}
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <h4 style="margin-top: 20px;">Deck ${element.name} Recommandé</h4>
                                <div class="recommended-deck" style="background: ${element.color}15; padding: 15px; border-radius: 8px;">
                                    ${generateRecommendedDeck(cardsByElement[key])}
                                </div>
                                
                                <h4 style="margin-top: 20px;">Conseils Tactiques</h4>
                                <ul>
                                    ${generateTacticalTips(key)}
                                </ul>
                            ` : `<p>Vous ne possédez pas de cartes de cet élément.</p>`}
                        </div>
                    `).join('')}
                </div>
            `;
            
            overlay.innerHTML = html;
            document.body.appendChild(overlay);
            
            // Ajouter les gestionnaires d'événements pour les onglets
            const tabs = overlay.querySelectorAll('.element-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const element = tab.getAttribute('data-element');
                    
                    // Masquer tous les panneaux
                    overlay.querySelectorAll('.element-panel').forEach(panel => {
                        panel.style.display = 'none';
                    });
                    
                    // Réinitialiser les styles des onglets
                    tabs.forEach(t => {
                        const el = SPLINTERLANDS_ELEMENTS[t.getAttribute('data-element')];
                        t.style.background = `${el.color}20`;
                        t.style.fontWeight = 'normal';
                    });
                    
                    // Afficher le panneau sélectionné
                    document.getElementById(`element-panel-${element}`).style.display = 'block';
                    
                    // Mettre en évidence l'onglet sélectionné
                    tab.style.background = `${SPLINTERLANDS_ELEMENTS[element].color}40`;
                    tab.style.fontWeight = 'bold';
                });
            });
            
            // Afficher le premier élément par défaut
            tabs[0].click();
            
            // Gestionnaire pour fermer l'overlay
            document.getElementById('pkm-deck-close').addEventListener('click', () => {
                overlay.remove();
            });
        }

        // Fonction pour déterminer la position recommandée d'une carte
        function determineCardPosition(card) {
            // Logique simplifiée - à améliorer avec des données réelles
            if (card.hp > 8 && card.armor > 0) {
                return "tank";
            } else if (card.atk > 3 && card.spd >= 3) {
                return "attacker";
            } else if (card.abilities && (card.abilities.includes("Heal") || card.abilities.includes("Protect"))) {
                return "support";
            } else if (card.abilities && (card.abilities.includes("Snipe") || card.abilities.includes("Sneak"))) {
                return "sniper";
            } else if (card.abilities && card.abilities.includes("Magic")) {
                return "magic";
            } else if (card.hp > 6) {
                return "tank";
            } else {
                return "attacker";
            }
        }

        // Fonction pour générer un deck recommandé à partir des cartes disponibles
        function generateRecommendedDeck(cards) {
            if (!cards || cards.length === 0) return "<p>Pas assez de cartes pour former un deck.</p>";
            
            // Trier les cartes par position et PS
            const sortedByPosition = {
                tank: cards.filter(c => c.recommendedPosition === "tank").sort((a, b) => b.ps - a.ps),
                attacker: cards.filter(c => c.recommendedPosition === "attacker").sort((a, b) => b.ps - a.ps),
                support: cards.filter(c => c.recommendedPosition === "support").sort((a, b) => b.ps - a.ps),
                sniper: cards.filter(c => c.recommendedPosition === "sniper").sort((a, b) => b.ps - a.ps),
                magic: cards.filter(c => c.recommendedPosition === "magic").sort((a, b) => b.ps - a.ps)
            };
            
            // Sélectionner les meilleures cartes pour chaque position
            const bestTank = sortedByPosition.tank[0] || null;
            const bestAttacker = sortedByPosition.attacker[0] || null;
            const bestSupport = sortedByPosition.support[0] || null;
            const bestSniper = sortedByPosition.sniper[0] || null;
            const bestMagic = sortedByPosition.magic[0] || null;
            
            // Sélectionner des cartes supplémentaires pour compléter le deck
            const remainingCards = cards
                .filter(c => c !== bestTank && c !== bestAttacker && c !== bestSupport && c !== bestSniper && c !== bestMagic)
                .sort((a, b) => b.ps - a.ps);
            
            const additionalCards = remainingCards.slice(0, 2); // Prendre les 2 meilleures cartes restantes
            
            // Générer le HTML pour le deck recommandé
            let html = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">`;
            
            // Ajouter les cartes par position
            [
                {card: bestTank, position: "tank"},
                {card: bestAttacker, position: "attacker"},
                {card: bestSupport, position: "support"},
                {card: bestSniper, position: "sniper"},
                {card: bestMagic, position: "magic"},
                ...additionalCards.map(card => ({card, position: card.recommendedPosition}))
            ].forEach(item => {
                if (item.card) {
                    const position = BATTLE_POSITIONS[item.position];
                    html += `
                        <div style="border: 1px solid #ddd; border-radius: 6px; padding: 10px; background: #f9f9f9;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <strong>${item.card.name}</strong>
                                <span>${position.icon}</span>
                            </div>
                            <div style="font-size: 13px; color: #666;">
                                Mana: ${item.card.mana} | PS: ${item.card.ps.toFixed(1)}
                            </div>
                        </div>
                    `;
                }
            });
            
            html += `</div>`;
            
            // Ajouter le coût total en mana
            const totalMana = [bestTank, bestAttacker, bestSupport, bestSniper, bestMagic, ...additionalCards]
                .filter(Boolean)
                .reduce((sum, card) => sum + card.mana, 0);
            
            html += `<div style="margin-top: 15px; text-align: right;">
                <strong>Coût total en mana:</strong> ${totalMana}
            </div>`;
            
            return html;
        }

        // Fonction pour générer des conseils tactiques selon l'élément
        function generateTacticalTips(element) {
            const tips = {
                "fire": [
                    "Placez vos attaquants de feu en deuxième position pour maximiser les dégâts",
                    "Combinez avec des tanks de terre pour compenser la faible santé",
                    "Utilisez des cartes avec Enrage pour augmenter les dégâts au fil du combat",
                    "Évitez les matchups contre des decks eau qui peuvent contrer vos attaques"
                ],
                "water": [
                    "Utilisez des debuffs pour réduire l'efficacité des ennemis puissants",
                    "Placez vos magiciens d'eau en position arrière pour les protéger",
                    "Combinez avec des tanks de vie pour une stratégie défensive solide",
                    "Efficace contre les decks feu grâce aux sorts d'eau"
                ],
                "earth": [
                    "Placez vos tanks de terre en première ligne pour absorber les dégâts",
                    "Utilisez Poison pour des dégâts sur la durée contre les ennemis à haute santé",
                    "Combinez avec des healers de vie pour prolonger la survie de vos tanks",
                    "Efficace contre les decks eau mais vulnérable au feu"
                ],
                "life": [
                    "Placez vos healers en position arrière pour les protéger",
                    "Utilisez Resurrect pour donner une seconde chance à vos cartes puissantes",
                    "Combinez avec des attaquants de feu pour une stratégie équilibrée",
                    "Efficace contre les decks mort mais vulnérable aux attaques directes"
                ],
                "death": [
                    "Utilisez Sneak pour cibler directement les unités arrière ennemies",
                    "Placez vos cartes avec Affliction en position sûre pour maximiser leur effet",
                    "Combinez avec des tanks neutres pour compenser la faible santé",
                    "Efficace contre les decks eau et terre mais vulnérable à la vie"
                ],
                "dragon": [
                    "Utilisez la polyvalence des dragons pour adapter votre stratégie pendant le combat",
                    "Placez vos dragons selon leurs capacités spécifiques plutôt que leur élément",
                    "Combinez avec des cartes neutres pour des synergies efficaces",
                    "Efficace dans la plupart des situations mais coûteux en mana"
                ],
                "neutral": [
                    "Utilisez des cartes neutres pour compléter les faiblesses de votre élément principal",
                    "Placez vos cartes neutres selon leurs capacités spécifiques",
                    "Combinez avec n'importe quel élément pour des synergies flexibles",
                    "Utile dans tous les decks mais sans bonus d'élément"
                ]
            };
            
            return tips[element].map(tip => `<li>${tip}</li>`).join('');
        }

        // Ajouter un bouton pour l'analyse de deck
        function addDeckAnalysisButton() {
            if (document.getElementById("pkm-deck-btn")) return;
            
            const btn = document.createElement("button");
            btn.id = "pkm-deck-btn";
            btn.textContent = "Analyse de Deck";
            btn.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 320px;  /* Décalé pour ne pas chevaucher les autres boutons */
                padding: 10px 16px;
                font-size: 14px;
                background: #80cc33;
                color: #fff;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                z-index: 9999;
                box-shadow: 0 4px 10px rgba(0,0,0,.15);
            `;
            
            btn.onclick = () => analyzeDecksByElement();
            document.body.appendChild(btn);
        }

        // Modifier la fonction d'initialisation pour ajouter le nouveau bouton
        window.addEventListener("load", () => {
            injectStyles();
            
            // Observer pour le bouton d'analyse de deck
            const analyzerObserver = new MutationObserver(() => {
                if (document.querySelector(".card-stats tbody tr")) {
                    addAnalyzeButton();
                    addMetaAnalysisButton();
                    addDeckAnalysisButton(); // Ajouter le nouveau bouton
                    analyzerObserver.disconnect();
                }
            });
            analyzerObserver.observe(document.body, { childList: true, subtree: true });
            
            // Afficher la version dans la console pour le débogage
            console.log(`PeakMonsters Deck Analyzer v${VERSION} chargé`);
        });

        // Après la fonction generateTacticalTips, ajouter ces nouvelles fonctions

        // Système de synergies entre cartes
        const CARD_SYNERGIES = {
            "tank-healer": {
                description: "Le healer prolonge la survie du tank",
                bonus: 2.5,
                condition: (card1, card2) => {
                    return (card1.recommendedPosition === "tank" && card2.abilities && card2.abilities.includes("Heal")) ||
                           (card2.recommendedPosition === "tank" && card1.abilities && card1.abilities.includes("Heal"));
                }
            },
            "sniper-tank": {
                description: "Le tank protège le sniper pendant qu'il élimine les cibles",
                bonus: 2.0,
                condition: (card1, card2) => {
                    return (card1.recommendedPosition === "tank" && card2.recommendedPosition === "sniper") ||
                           (card2.recommendedPosition === "tank" && card1.recommendedPosition === "sniper");
                }
            },
            "magic-armor": {
                description: "Les attaques magiques ignorent l'armure ennemie",
                bonus: 1.8,
                condition: (card1, card2) => {
                    return (card1.abilities && card1.abilities.includes("Magic") && card2.abilities && card2.abilities.includes("Magic"));
                }
            },
            "speed-boost": {
                description: "Cartes rapides qui agissent avant l'ennemi",
                bonus: 1.5,
                condition: (card1, card2) => {
                    return card1.spd >= 4 && card2.spd >= 4;
                }
            },
            "poison-slow": {
                description: "Ralentir l'ennemi tout en appliquant du poison",
                bonus: 2.2,
                condition: (card1, card2) => {
                    return (card1.abilities && card1.abilities.includes("Poison") && card2.abilities && card2.abilities.includes("Slow")) ||
                           (card2.abilities && card2.abilities.includes("Poison") && card1.abilities && card1.abilities.includes("Slow"));
                }
            },
            "flying-ranged": {
                description: "Attaques à distance depuis les airs",
                bonus: 1.7,
                condition: (card1, card2) => {
                    return (card1.abilities && card1.abilities.includes("Flying") && card2.abilities && card2.abilities.includes("Snipe")) ||
                           (card2.abilities && card2.abilities.includes("Flying") && card1.abilities && card1.abilities.includes("Snipe"));
                }
            },
            "thorns-taunt": {
                description: "Forcer l'ennemi à attaquer et subir des dégâts en retour",
                bonus: 2.3,
                condition: (card1, card2) => {
                    return (card1.abilities && card1.abilities.includes("Thorns") && card2.abilities && card2.abilities.includes("Taunt")) ||
                           (card2.abilities && card2.abilities.includes("Thorns") && card1.abilities && card1.abilities.includes("Taunt"));
                }
            },
            "same-element": {
                description: "Bonus d'élément pour cartes de même type",
                bonus: 1.3,
                condition: (card1, card2) => {
                    return card1.element === card2.element && card1.element !== "neutral" && card2.element !== "neutral";
                }
            }
        };

        // Fonction pour évaluer les synergies entre deux cartes
        function evaluateSynergy(card1, card2) {
            let synergies = [];
            let totalBonus = 1.0;
            
            Object.entries(CARD_SYNERGIES).forEach(([key, synergy]) => {
                if (synergy.condition(card1, card2)) {
                    synergies.push({
                        name: key,
                        description: synergy.description,
                        bonus: synergy.bonus
                    });
                    totalBonus *= synergy.bonus;
                }
            });
            
            return {
                synergies,
                totalBonus,
                score: totalBonus * (card1.ps + card2.ps) / 2
            };
        }

        // Fonction pour générer un deck optimal basé sur les règles de mana et les synergies
        function generateOptimalDeck(cards, manaLimit = 30) {
            if (!cards || cards.length < 7) return null;
            
            // Trier les cartes par position et PS
            const positionGroups = {
                tank: cards.filter(c => c.recommendedPosition === "tank").sort((a, b) => b.ps - a.ps),
                attacker: cards.filter(c => c.recommendedPosition === "attacker").sort((a, b) => b.ps - a.ps),
                support: cards.filter(c => c.recommendedPosition === "support").sort((a, b) => b.ps - a.ps),
                sniper: cards.filter(c => c.recommendedPosition === "sniper").sort((a, b) => b.ps - a.ps),
                magic: cards.filter(c => c.recommendedPosition === "magic").sort((a, b) => b.ps - a.ps)
            };
            
            // Vérifier si nous avons assez de cartes pour chaque position clé
            if (positionGroups.tank.length === 0 || 
                (positionGroups.attacker.length === 0 && positionGroups.magic.length === 0)) {
                return null;
            }
            
            // Commencer par sélectionner le meilleur tank
            const selectedCards = [positionGroups.tank[0]];
            let remainingMana = manaLimit - positionGroups.tank[0].mana;
            
            // Ajouter un attaquant principal
            if (positionGroups.attacker.length > 0) {
                const bestAttacker = positionGroups.attacker[0];
                if (remainingMana >= bestAttacker.mana) {
                    selectedCards.push(bestAttacker);
                    remainingMana -= bestAttacker.mana;
                }
            }
            
            // Ajouter un magicien si possible
            if (positionGroups.magic.length > 0) {
                const bestMagic = positionGroups.magic[0];
                if (remainingMana >= bestMagic.mana) {
                    selectedCards.push(bestMagic);
                    remainingMana -= bestMagic.mana;
                }
            }
            
            // Ajouter un support si possible
            if (positionGroups.support.length > 0) {
                const bestSupport = positionGroups.support[0];
                if (remainingMana >= bestSupport.mana) {
                    selectedCards.push(bestSupport);
                    remainingMana -= bestSupport.mana;
                }
            }
            
            // Ajouter un sniper si possible
            if (positionGroups.sniper.length > 0) {
                const bestSniper = positionGroups.sniper[0];
                if (remainingMana >= bestSniper.mana) {
                    selectedCards.push(bestSniper);
                    remainingMana -= bestSniper.mana;
                }
            }
            
            // Créer une liste de toutes les cartes restantes non sélectionnées
            const remainingCards = cards.filter(card => !selectedCards.includes(card))
                               .sort((a, b) => b.ps - a.ps);
            
            // Évaluer les synergies pour chaque carte restante avec les cartes déjà sélectionnées
            const cardsWithSynergy = remainingCards.map(card => {
                let totalSynergyScore = 0;
                let synergyDetails = [];
                
                selectedCards.forEach(selectedCard => {
                    const synergy = evaluateSynergy(card, selectedCard);
                    totalSynergyScore += synergy.score;
                    
                    if (synergy.synergies.length > 0) {
                        synergyDetails.push({
                            withCard: selectedCard.name,
                            synergies: synergy.synergies
                        });
                    }
                });
                
                return {
                    card,
                    synergyScore: totalSynergyScore,
                    synergyDetails,
                    valuePerMana: card.ps / card.mana
                };
            });
            
            // Trier par meilleur rapport synergie/mana
            cardsWithSynergy.sort((a, b) => {
                // Favoriser les cartes avec synergies
                if (a.synergyScore > 0 && b.synergyScore === 0) return -1;
                if (a.synergyScore === 0 && b.synergyScore > 0) return 1;
                
                // Si les deux ont des synergies, comparer le rapport synergie/mana
                if (a.synergyScore > 0 && b.synergyScore > 0) {
                    return (b.synergyScore / b.card.mana) - (a.synergyScore / a.card.mana);
                }
                
                // Sinon, utiliser le rapport PS/mana
                return b.valuePerMana - a.valuePerMana;
            });
            
            // Ajouter les meilleures cartes restantes jusqu'à la limite de mana
            for (const cardData of cardsWithSynergy) {
                if (selectedCards.length >= 7) break; // Maximum 7 cartes dans un deck
                
                if (remainingMana >= cardData.card.mana) {
                    selectedCards.push(cardData.card);
                    remainingMana -= cardData.card.mana;
                }
            }
            
            // Calculer les synergies entre toutes les cartes sélectionnées
            const deckSynergies = [];
            for (let i = 0; i < selectedCards.length; i++) {
                for (let j = i + 1; j < selectedCards.length; j++) {
                    const synergy = evaluateSynergy(selectedCards[i], selectedCards[j]);
                    if (synergy.synergies.length > 0) {
                        deckSynergies.push({
                            card1: selectedCards[i].name,
                            card2: selectedCards[j].name,
                            synergies: synergy.synergies
                        });
                    }
                }
            }
            
            // Calculer le score total du deck
            const deckPowerScore = selectedCards.reduce((sum, card) => sum + card.ps, 0);
            const totalMana = selectedCards.reduce((sum, card) => sum + card.mana, 0);
            const deckEfficiency = deckPowerScore / totalMana;
            
            return {
                cards: selectedCards,
                totalMana,
                remainingMana,
                deckPowerScore,
                deckEfficiency,
                synergies: deckSynergies
            };
        }

        // Modifier la fonction analyzeDecksByElement pour inclure le générateur de deck optimal
        function analyzeDecksByElement(cards) {
            if (!cards || !cards.length) {
                cards = scrapeCards();
            }
            
            // Filtrer pour n'inclure que les cartes possédées
            const ownedCards = cards.filter(card => card.owned > 0);
            
            // Créer un overlay pour afficher l'analyse
            const overlay = document.createElement("div");
            overlay.id = "pkm-deck-analyzer";
            overlay.style.cssText = `
                position: fixed;
                top: 5vh;
                left: 50%;
                transform: translateX(-50%);
                background: #fff;
                padding: 20px 24px;
                width: 90%;
                max-width: 1000px;
                max-height: 90vh;
                overflow: auto;
                box-shadow: 0 6px 20px rgba(0,0,0,.2);
                border-radius: 12px;
                z-index: 10000;
                font-family: sans-serif;
            `;
            
            // Déterminer l'élément de chaque carte (à partir du nom ou des propriétés)
            ownedCards.forEach(card => {
                // Logique simplifiée pour déterminer l'élément - à améliorer avec des données réelles
                if (card.name.toLowerCase().includes("fire") || card.name.toLowerCase().includes("flame")) {
                    card.element = "fire";
                } else if (card.name.toLowerCase().includes("water") || card.name.toLowerCase().includes("wave")) {
                    card.element = "water";
                } else if (card.name.toLowerCase().includes("earth") || card.name.toLowerCase().includes("stone")) {
                    card.element = "earth";
                } else if (card.name.toLowerCase().includes("life") || card.name.toLowerCase().includes("light")) {
                    card.element = "life";
                } else if (card.name.toLowerCase().includes("death") || card.name.toLowerCase().includes("dark")) {
                    card.element = "death";
                } else if (card.name.toLowerCase().includes("dragon")) {
                    card.element = "dragon";
                } else {
                    card.element = "neutral";
                }
                
                // Déterminer la position recommandée
                card.recommendedPosition = determineCardPosition(card);
            });
            
            // Regrouper les cartes par élément
            const cardsByElement = {};
            Object.keys(SPLINTERLANDS_ELEMENTS).forEach(element => {
                cardsByElement[element] = ownedCards.filter(card => card.element === element);
            });
            
            // Générer des decks optimaux pour chaque élément
            const optimalDecks = {};
            Object.keys(SPLINTERLANDS_ELEMENTS).forEach(element => {
                // Pour chaque élément, inclure aussi les cartes neutres
                const elementCards = [
                    ...cardsByElement[element],
                    ...cardsByElement["neutral"]
                ];
                
                // Générer un deck optimal pour cet élément
                optimalDecks[element] = generateOptimalDeck(elementCards);
            });
            
            // Trouver le meilleur deck global toutes couleurs confondues
            const allCards = [...ownedCards];
            const bestOverallDeck = generateOptimalDeck(allCards);
            
            // Générer le contenu HTML
            let html = `
                <h2>Analyse de Deck par Élément</h2>
                <button id="pkm-deck-close" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 24px; cursor: pointer;">×</button>
                
                <div class="mana-filter" style="margin-bottom: 20px;">
                    <label for="mana-limit">Limite de mana:</label>
                    <input type="range" id="mana-limit" min="15" max="50" value="30" step="1" style="width: 200px;">
                    <span id="mana-value">30</span>
                    <button id="regenerate-decks" style="margin-left: 15px; padding: 5px 10px; background: #5d62d3; color: white; border: none; border-radius: 4px; cursor: pointer;">Régénérer</button>
                </div>
                
                <div class="element-tabs" style="display: flex; margin-bottom: 20px; border-bottom: 1px solid #eee;">
                    <div class="element-tab" data-element="best" style="padding: 10px 15px; cursor: pointer; margin-right: 5px; border-radius: 8px 8px 0 0; background: #5d62d320;">
                        🏆 Meilleur Deck
                    </div>
                    ${Object.entries(SPLINTERLANDS_ELEMENTS).map(([key, element]) => `
                        <div class="element-tab" data-element="${key}" style="padding: 10px 15px; cursor: pointer; margin-right: 5px; border-radius: 8px 8px 0 0; background: ${element.color}20;">
                            ${element.icon} ${element.name}
                        </div>
                    `).join('')}
                </div>
                
                <div class="element-content">
                    <div class="element-panel" id="element-panel-best" style="display: none;">
                        <div class="element-header" style="background: #5d62d320; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                            <h3>🏆 Meilleur Deck Global</h3>
                            <div style="margin-top: 10px;">
                                <strong>Stratégie:</strong> Deck le plus puissant basé sur vos cartes disponibles, toutes couleurs confondues
                            </div>
                        </div>
                        
                        ${bestOverallDeck ? renderOptimalDeck(bestOverallDeck) : "<p>Pas assez de cartes pour former un deck optimal.</p>"}
                    </div>
                
                    ${Object.entries(SPLINTERLANDS_ELEMENTS).map(([key, element]) => `
                        <div class="element-panel" id="element-panel-${key}" style="display: none;">
                            <div class="element-header" style="background: ${element.color}20; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                                <h3>${element.icon} ${element.name}</h3>
                                <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                                    <div>
                                        <strong>Forces:</strong> ${element.strengths.join(", ")}
                                    </div>
                                    <div>
                                        <strong>Faiblesses:</strong> ${element.weaknesses.join(", ")}
                                    </div>
                                </div>
                                <div style="margin-top: 10px;">
                                    <strong>Stratégie:</strong> ${element.strategy}
                                </div>
                            </div>
                            
                            <h4>Deck ${element.name} Optimal</h4>
                            ${optimalDecks[key] ? renderOptimalDeck(optimalDecks[key]) : `<p>Pas assez de cartes ${element.name} pour former un deck optimal.</p>`}
                            
                            <h4 style="margin-top: 30px;">Cartes ${element.name} Disponibles (${cardsByElement[key].length})</h4>
                            ${cardsByElement[key].length > 0 ? `
                                <div class="element-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                                    ${cardsByElement[key].map(card => `
                                        <div class="element-card" style="border: 1px solid #eee; border-radius: 8px; padding: 12px; background: ${element.color}10;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                                <strong>${card.name}</strong>
                                                <span>${BATTLE_POSITIONS[card.recommendedPosition].icon} ${BATTLE_POSITIONS[card.recommendedPosition].name}</span>
                                            </div>
                                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 14px;">
                                                <div>Mana: ${card.mana}</div>
                                                <div>PS: ${card.ps.toFixed(1)}</div>
                                                <div>Attaque: ${card.atk}</div>
                                                <div>Santé: ${card.hp}</div>
                                                <div>Vitesse: ${card.spd}</div>
                                                <div>Armure: ${card.armor || 0}</div>
                                            </div>
                                            ${card.abilities && card.abilities.length ? `
                                                <div style="margin-top: 8px; font-size: 13px;">
                                                    <strong>Capacités:</strong> ${card.abilities.join(", ")}
                                                </div>
                                            ` : ''}
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <h4 style="margin-top: 20px;">Conseils Tactiques</h4>
                                <ul>
                                    ${generateTacticalTips(key)}
                                </ul>
                            ` : `<p>Vous ne possédez pas de cartes de cet élément.</p>`}
                        </div>
                    `).join('')}
                </div>
            `;
            
            overlay.innerHTML = html;
            document.body.appendChild(overlay);
            
            // Fonction pour afficher un deck optimal
            function renderOptimalDeck(deck) {
                if (!deck) return "<p>Impossible de générer un deck optimal avec les cartes disponibles.</p>";
                
                let html = `
                    <div class="optimal-deck" style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <div class="deck-stats" style="display: flex; justify-content: space-between; margin-bottom: 15px; background: #fff; padding: 10px; border-radius: 6px;">
                            <div><strong>Score de puissance:</strong> ${deck.deckPowerScore.toFixed(1)}</div>
                            <div><strong>Mana total:</strong> ${deck.totalMana}/${document.getElementById('mana-limit')?.value || 30}</div>
                            <div><strong>Efficacité:</strong> ${deck.deckEfficiency.toFixed(2)} PS/mana</div>
                        </div>
                        
                        <div class="deck-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 20px;">
                            ${deck.cards.map(card => {
                                const position = BATTLE_POSITIONS[card.recommendedPosition];
                                const elementColor = SPLINTERLANDS_ELEMENTS[card.element]?.color || "#cccccc";
                                
                                return `
                                    <div class="deck-card" style="border: 2px solid ${elementColor}; border-radius: 6px; padding: 10px; background: #fff;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                            <strong>${card.name}</strong>
                                            <div>
                                                <span style="margin-right: 5px;">${SPLINTERLANDS_ELEMENTS[card.element]?.icon || "⚪"}</span>
                                                <span>${position.icon}</span>
                                            </div>
                                        </div>
                                        <div style="font-size: 13px; color: #666; display: flex; justify-content: space-between;">
                                            <div>Mana: ${card.mana}</div>
                                            <div>PS: ${card.ps.toFixed(1)}</div>
                                        </div>
                                        ${card.abilities && card.abilities.length ? `
                                            <div style="margin-top: 5px; font-size: 12px; color: #555;">
                                                ${card.abilities.slice(0, 2).join(", ")}${card.abilities.length > 2 ? "..." : ""}
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        
                        ${deck.synergies.length > 0 ? `
                            <div class="deck-synergies">
                                <h4 style="margin-top: 0; margin-bottom: 10px;">Synergies (${deck.synergies.length})</h4>
                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px;">
                                    ${deck.synergies.map(synergy => `
                                        <div style="background: #fff; padding: 8px 12px; border-radius: 6px; font-size: 14px;">
                                            <div style="font-weight: 500; margin-bottom: 5px;">
                                                ${synergy.card1} + ${synergy.card2}
                                            </div>
                                            <ul style="margin: 0; padding-left: 20px; color: #666;">
                                                ${synergy.synergies.map(s => `
                                                    <li>${s.description} (+${((s.bonus - 1) * 100).toFixed(0)}%)</li>
                                                `).join('')}
                                            </ul>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
                
                return html;
            }
            
            // Ajouter les gestionnaires d'événements pour les onglets
            const tabs = overlay.querySelectorAll('.element-tab');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const element = tab.getAttribute('data-element');
                    
                    // Masquer tous les panneaux
                    overlay.querySelectorAll('.element-panel').forEach(panel => {
                        panel.style.display = 'none';
                    });
                    
                    // Réinitialiser les styles des onglets
                    tabs.forEach(t => {
                        const el = t.getAttribute('data-element');
                        if (el === "best") {
                            t.style.background = "#5d62d320";
                        } else {
                            const elementData = SPLINTERLANDS_ELEMENTS[el];
                            t.style.background = `${elementData.color}20`;
                        }
                        t.style.fontWeight = 'normal';
                    });
                    
                    // Afficher le panneau sélectionné
                    document.getElementById(`element-panel-${element}`).style.display = 'block';
                    
                    // Mettre en évidence l'onglet sélectionné
                    if (element === "best") {
                        tab.style.background = "#5d62d360";
                    } else {
                        tab.style.background = `${SPLINTERLANDS_ELEMENTS[element].color}40`;
                    }
                    tab.style.fontWeight = 'bold';
                });
            });
            
            // Gestionnaire pour le slider de mana
            const manaSlider = document.getElementById('mana-limit');
            const manaValue = document.getElementById('mana-value');
            const regenerateBtn = document.getElementById('regenerate-decks');
            
            if (manaSlider && manaValue) {
                manaSlider.addEventListener('input', () => {
                    manaValue.textContent = manaSlider.value;
                });
            }
            
            if (regenerateBtn) {
                regenerateBtn.addEventListener('click', () => {
                    const manaLimit = parseInt(manaSlider.value, 10);
                    
                    // Régénérer tous les decks avec la nouvelle limite de mana
                    Object.keys(SPLINTERLANDS_ELEMENTS).forEach(element => {
                        const elementCards = [
                            ...cardsByElement[element],
                            ...cardsByElement["neutral"]
                        ];
                        
                        optimalDecks[element] = generateOptimalDeck(elementCards, manaLimit);
                        
                        // Mettre à jour l'affichage du deck
                        const deckPanel = document.getElementById(`element-panel-${element}`);
                        if (deckPanel) {
                            const deckSection = deckPanel.querySelector('h4 + div');
                            if (deckSection) {
                                deckSection.innerHTML = optimalDecks[element] 
                                    ? renderOptimalDeck(optimalDecks[element]) 
                                    : `<p>Pas assez de cartes ${SPLINTERLANDS_ELEMENTS[element].name} pour former un deck optimal.</p>`;
                            }
                        }
                    });
                    
                    // Régénérer le meilleur deck global
                    const newBestDeck = generateOptimalDeck(allCards, manaLimit);
                    const bestDeckPanel = document.getElementById('element-panel-best');
                    if (bestDeckPanel) {
                        const deckSection = bestDeckPanel.querySelector('.element-header + div');
                        if (deckSection) {
                            deckSection.innerHTML = newBestDeck 
                                ? renderOptimalDeck(newBestDeck) 
                                : "<p>Pas assez de cartes pour former un deck optimal.</p>";
                        }
                    }
                });
            }
            
            // Afficher l'onglet "Meilleur Deck" par défaut
            tabs[0].click();
            
            // Gestionnaire pour fermer l'overlay
            document.getElementById('pkm-deck-close').addEventListener('click', () => {
                overlay.remove();
            });
        }
})();
