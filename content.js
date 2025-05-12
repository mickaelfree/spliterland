(() => {
        //--------------------------------------------------
        // Constants & thresholds
        //--------------------------------------------------
        const THRESHOLD_PS = 15;
        const THRESHOLD_ROI_BUY = 0.05;   // ≥5% ⇒ intéressant
        const THRESHOLD_ROI_SELL = 0.02;  // <2%  ⇒ vendre si cher
        const THRESHOLD_PRICE_MIN = 0.20; // Prix minimum pour considérer la vente
        const META_AVG_DAMAGE = 4.2;      // Dégâts moyens par tour dans la méta
        const DEC_PER_MATCH = 0.04;       // DEC gagnés par match
        const WIN_RATE = 0.5;             // Taux de victoire moyen

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

                return (psScore * 0.3 + roiScore * 0.3 + damageScore * 0.2 + survivalScore * 0.1 + priceScore * 0.1) * 100;
        }

        //--------------------------------------------------
        // Action recommendation engine
        //--------------------------------------------------
        function getAction(card) {
                if (!card.price) return "—";
                if (card.roi >= THRESHOLD_ROI_BUY && card.owned === 0) return "Acheter";
                if (card.roi >= THRESHOLD_ROI_BUY && card.owned > 0 && card.ps < THRESHOLD_PS) return "Monter";
                if (card.roi < THRESHOLD_ROI_SELL && card.price > THRESHOLD_PRICE_MIN) return "Vendre";
                if (card.ps < THRESHOLD_PS / 3) return "Bench";
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
                obj.action = getAction(obj);
                obj.valueScore = computeValueScore(obj);
                return obj;
        }

        // BULK/GRID
        function scrapeTableView() {
                const rows = document.querySelectorAll("table tbody tr");
                const cards = [];
                rows.forEach((tr) => {
                        const cols = tr.querySelectorAll("td");
                        if (!cols.length) return;
                        const name = cols[0].innerText.trim();
                        const statsCell = cols[2];
                        const mana = getFirstNumber(statsCell.innerText.match(/Mana[^\d]*(\d+)/i)?.[1] || statsCell.innerText);
                        const atk = getFirstNumber(statsCell.innerText.match(/Melee[^\d]*(\d+)/i)?.[1] || statsCell.innerText);
                        const spd = getFirstNumber(statsCell.innerText.match(/Speed[^\d]*(\d+)/i)?.[1] || statsCell.innerText);
                        const hp = getFirstNumber(statsCell.innerText.match(/Health[^\d]*(\d+)/i)?.[1] || statsCell.innerText);
                        const price = num(cols[cols.length - 1].textContent);
                        cards.push(buildCard({ name, mana, atk, spd, hp, price, owned: 0 }));
                });
                return cards;
        }

        // LIST mode
        function scrapeListView() {
                console.log("Début du scraping de la vue liste");
                const boxes = document.querySelectorAll("li.panel, div.card-row, div[role='listitem'], .card");
                console.log("Nombre de cartes trouvées:", boxes.length);
                
                const cards = [];
                boxes.forEach((box, index) => {
                        console.log(`Analyse de la carte ${index + 1}`);
                        
                        const nameEl = box.querySelector("h4 a, h4, h3, h2, .card-name");
                        if (!nameEl) {
                                console.log(`Carte ${index + 1}: Nom non trouvé`);
                                return;
                        }
                        const name = nameEl.textContent.trim();
                        console.log(`Carte ${index + 1}: Nom = ${name}`);

                        // stats row level 1
                        const row = box.querySelector(".card-stats tbody tr, .stats-row");
                        if (!row) {
                                console.log(`Carte ${index + 1}: Stats non trouvées`);
                                return;
                        }
                        const tds = row.querySelectorAll("td");
                        if (tds.length < 6) {
                                console.log(`Carte ${index + 1}: Pas assez de colonnes de stats`);
                                return;
                        }

                        const mana = num(tds[1].textContent);
                        let atk = 0;
                        tds[2].textContent.split(/[\/]/).forEach((p) => { const v = num(p); if (v && !atk) atk = v; });
                        const spd = num(tds[3].textContent);
                        const hp = num(tds[5].textContent);
                        const armor = num(tds[4].textContent) || 0;
                        const crit = num(tds[2].textContent.match(/\+(\d+)%/)?.[1]) || 0;

                        console.log(`Carte ${index + 1}: Stats = Mana:${mana}, ATK:${atk}, SPD:${spd}, HP:${hp}, ARM:${armor}, CRIT:${crit}`);

                        // owned cards
                        let owned = 0;
                        const ownedEl = box.querySelector(".media-right h5, .owned-count");
                        if (ownedEl) {
                                owned = num(ownedEl.textContent.split("/")[0]);
                                console.log(`Carte ${index + 1}: Possédée = ${owned}`);
                        }

                        // price
                        let price = 0;
                        const priceNode = box.querySelector(".media-right h5 span, .media-right h5, .price");
                        if (priceNode) {
                                price = num(priceNode.textContent);
                                console.log(`Carte ${index + 1}: Prix = ${price}`);
                        }

                        const card = buildCard({ name, mana, atk, spd, hp, armor, crit, price, owned });
                        console.log(`Carte ${index + 1}: Score = ${card.valueScore}`);
                        cards.push(card);
                });

                console.log(`Scraping terminé. ${cards.length} cartes analysées.`);
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
                "Acheter": "#d2f4d2",
                "Monter": "#d0e8ff",
                "Vendre": "#ffd6d6",
                "Bench": "#eee",
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
      <div class="summary">
        <div class="summary-item">
          <h3>À acheter</h3>
          <div id="buy-cards"></div>
        </div>
        <div class="summary-item">
          <h3>À vendre</h3>
          <div id="sell-cards"></div>
        </div>
      </div>
      <div class="sort-buttons">
        <span>Trier par : </span>
        <button data-sort="valueScore" class="sort-btn active">⭐ Score</button>
        <button data-sort="ps" class="sort-btn">💪 PS</button>
        <button data-sort="roi" class="sort-btn">💰 ROI</button>
        <button data-sort="manaEfficiency" class="sort-btn">⚡ Efficacité</button>
        <button data-sort="pricePerPS" class="sort-btn">💲/PS</button>
        <button data-sort="winrate" class="sort-btn">🏆 Winrate</button>
        <button data-sort="survival" class="sort-btn">🛡️ Survie</button>
        <button data-sort="price" class="sort-btn">💲 Prix</button>
        <div class="sort-direction">
          <button id="sort-desc" class="direction-btn active">↓ Desc</button>
          <button id="sort-asc" class="direction-btn">↑ Asc</button>
        </div>
      </div>
      <button id="pkm-close">×</button>
      <table><thead><tr>
      <th data-kpi="name">🃏 Carte</th>
      <th data-kpi="action">⚡ Action <span class="kpi-info" title="Action recommandée en fonction des KPIs. Aide à prendre des décisions rapides sur votre collection.">ⓘ</span></th>
      <th data-kpi="valueScore">⭐ Score <span class="kpi-info" title="Score global basé sur PS, ROI, efficacité, etc. Plus le score est élevé, plus la carte est valable globalement. Important pour comparer rapidement les cartes entre elles.">ⓘ</span></th>
      <th data-kpi="ps">💪 PS <span class="kpi-info" title="Power Score = (Attaque × Santé × Vitesse) / Mana. Essentiel pour évaluer l'efficacité combat/coût. Un PS > 15 est excellent.">ⓘ</span></th>
      <th data-kpi="manaEfficiency">⚡ Efficacité <span class="kpi-info" title="(Attaque + Santé) / Mana. Crucial pour évaluer le rapport stats/coût. Un ratio > 3.0 indique une carte très efficace pour son coût.">ⓘ</span></th>
      <th data-kpi="pricePerPS">💲/PS <span class="kpi-info" title="Prix marché ÷ Power Score. Mesure le rapport qualité/prix. Un ratio < 0.15 $/PS indique un bon investissement.">ⓘ</span></th>
      <th data-kpi="roi">💰 ROI <span class="kpi-info" title="(DEC/match × Winrate) / Prix. Retour sur investissement. Un ROI > 5% est excellent, < 2% suggère de vendre.">ⓘ</span></th>
      <th data-kpi="dailyROI">📅 ROI loc. <span class="kpi-info" title="(DEC gagnés par jour) / Prix location. Rentabilité journalière de la location. Un ROI > 5% par jour est très rentable.">ⓘ</span></th>
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
                        cards.sort((a, b) => {
                                // Gérer les valeurs undefined/null
                                if ((a[sortKey] === undefined || a[sortKey] === null) && (b[sortKey] === undefined || b[sortKey] === null)) return 0;
                                if (a[sortKey] === undefined || a[sortKey] === null) return 1;
                                if (b[sortKey] === undefined || b[sortKey] === null) return -1;
                                
                                // Tri basé sur le type
                                if (typeof a[sortKey] === 'string') {
                                        return sortAsc ? a[sortKey].localeCompare(b[sortKey]) : b[sortKey].localeCompare(a[sortKey]);
                                }
                                return sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey];
                        });

                        cards.forEach((c) => {
                                const tr = document.createElement("tr");
                                tr.style.background = ACTION_COLORS[c.action] || "transparent";
                                tr.innerHTML = `
        <td>${c.name}</td>
        <td><strong>${getActionIcon(c.action)} ${c.action}</strong></td>
        <td>${c.valueScore.toFixed(0)}</td>
        <td>${c.ps.toFixed(1)}</td>
        <td>${c.manaEfficiency ? c.manaEfficiency.toFixed(2) : '-'}</td>
        <td>${c.pricePerPS ? c.pricePerPS.toFixed(3) : '-'}</td>
        <td>${pct(c.roi)}</td>
        <td>${c.dailyROI ? pct(c.dailyROI) : '-'}</td>
        <td>${c.winrate !== null && c.winrate !== undefined ? pct(c.winrate) : '-'}</td>
        <td>${c.survival.toFixed(1)} tours</td>
        <td>${c.mana}</td>
        <td>${c.price.toFixed(3)}</td>
        <td>${c.owned}</td>`;
                                tbody.appendChild(tr);
                        });
                }

                // Icônes pour les actions
                function getActionIcon(action) {
                        switch(action) {
                                case 'Acheter': return '🛒';
                                case 'Vendre': return '💸';
                                case 'Louer': return '📅';
                                case 'Améliorer': return '🔼';
                                case 'Bench': return '🪑';
                                case 'Garder': return '✅';
                                default: return '';
                        }
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
                console.log(`${buyCards.length} cartes à acheter, ${sellCards.length} cartes à vendre`);

                const buyCardsDiv = overlay.querySelector("#buy-cards");
                const sellCardsDiv = overlay.querySelector("#sell-cards");

                if (buyCardsDiv) {
                        buyCardsDiv.innerHTML = buyCards.map(c => 
                                `<div>${getActionIcon('Acheter')} ${c.name} - ${c.price.toFixed(3)}$ (PS: ${c.ps.toFixed(1)}, ROI: ${pct(c.roi)})</div>`
                        ).join("");
                        console.log("Résumé des achats rempli");
                } else {
                        console.error("Div buy-cards non trouvé");
                }

                if (sellCardsDiv) {
                        sellCardsDiv.innerHTML = sellCards.map(c => 
                                `<div>${getActionIcon('Vendre')} ${c.name} - ${c.price.toFixed(3)}$ (PS: ${c.ps.toFixed(1)}, ROI: ${pct(c.roi)})</div>`
                        ).join("");
                        console.log("Résumé des ventes rempli");
                } else {
                        console.error("Div sell-cards non trouvé");
                }

                // Ajouter le gestionnaire d'événements pour le bouton de fermeture
                const closeBtn = overlay.querySelector("#pkm-close");
                if (closeBtn) {
                        closeBtn.onclick = () => overlay.remove();
                        console.log("Bouton de fermeture configuré");
                } else {
                        console.error("Bouton de fermeture non trouvé");
                }
        }

        //--------------------------------------------------
        // Styles & button
        //--------------------------------------------------
        function injectStyles() {
                if (document.getElementById("pkm-style")) return;
                const style = document.createElement("style");
                style.id = "pkm-style";
                style.textContent = `
                    #pkm-analyze-btn {
                        position: fixed;
                        bottom: 24px;
                        right: 24px;
                        padding: 10px 16px;
                        font-size: 14px;
                        background: #ff914d;
                        color: #fff;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        z-index: 9999;
                        box-shadow: 0 4px 10px rgba(0,0,0,.15);
                    }
                    #pkm-analyzer {
                        position: fixed;
                        top: 5vh;
                        left: 50%;
                        transform: translateX(-50%);
                        background: #fff;
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
                        color: #333;
                    }
                    #pkm-close {
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        cursor: pointer;
                        font-size: 24px;
                        background: none;
                        border: none;
                        color: #666;
                    }
                    #pkm-analyzer table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 13px;
                        margin-top: 20px;
                    }
                    #pkm-analyzer th, #pkm-analyzer td {
                        padding: 8px 12px;
                        border-bottom: 1px solid #eee;
                        text-align: left;
                    }
                    #pkm-analyzer th {
                        background: #f5f5f5;
                        font-weight: 600;
                    }
                    #pkm-analyzer tr:hover {
                        filter: brightness(0.97);
                    }
                    .summary {
                        display: flex;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    .summary-item {
                        flex: 1;
                        background: #f8f9fa;
                        padding: 15px;
                        border-radius: 8px;
                    }
                    .summary-item h3 {
                        margin: 0 0 10px;
                        color: #333;
                        font-size: 16px;
                    }
                    .summary-item div {
                        font-size: 13px;
                        margin: 5px 0;
                        color: #555;
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
            // Seulement sur les pages de liste ou de marché
            if (!window.location.href.includes("/market")) return;

            // S'assurer que les filtres ne sont pas déjà ajoutés
            if (document.getElementById("pkm-inline-filters")) return;

            // Trouver la zone de filtres existante
            const filterArea = document.querySelector(".filters-section, .card-filters");
            if (!filterArea) return;

            // Créer notre conteneur de filtres
            const filterContainer = document.createElement("div");
            filterContainer.id = "pkm-inline-filters";
            filterContainer.className = "pkm-filters-container";
            filterContainer.innerHTML = `
                <div class="pkm-filters-header">
                    <h4>Tri Avancé</h4>
                    <span class="pkm-help" title="Ces filtres ajoutent des KPIs avancés pour vous aider à trouver les meilleures cartes.">ⓘ</span>
                </div>
                <div class="pkm-filter-buttons">
                    <button class="pkm-filter-btn" data-sort="ps">💪 Power Score</button>
                    <button class="pkm-filter-btn" data-sort="roi">💰 ROI</button>
                    <button class="pkm-filter-btn" data-sort="manaEfficiency">⚡ Efficacité</button>
                    <button class="pkm-filter-btn" data-sort="pricePerPS">💲/PS</button>
                    <button class="pkm-filter-btn" data-sort="survival">🛡️ Survie</button>
                </div>
            `;

            // Injecter des styles pour nos filtres
            const style = document.createElement("style");
            style.textContent = `
                .pkm-filters-container {
                    background: #f8f9fa;
                    border: 1px solid #ddd;
                    padding: 12px 15px;
                    margin: 15px 0;
                    border-radius: 5px;
                }
                .pkm-filters-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .pkm-filters-header h4 {
                    margin: 0;
                    font-size: 16px;
                    color: #333;
                }
                .pkm-help {
                    cursor: help;
                    margin-left: 8px;
                    font-size: 14px;
                    color: #888;
                    border-bottom: 1px dotted #888;
                }
                .pkm-filter-buttons {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                }
                .pkm-filter-btn {
                    padding: 6px 12px;
                    background: #fff;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #333;
                    transition: all 0.2s;
                }
                .pkm-filter-btn:hover {
                    background: #f0f0f0;
                }
                .pkm-filter-btn.active {
                    background: #ff914d;
                    color: white;
                    border-color: #e67e35;
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
                .pkm-card-kpi-neutral {
                    color: #666;
                }
            `;
            document.head.appendChild(style);

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

                // Calculer les KPIs
                const ps = computePS({ atk, hp, spd, mana });
                const manaEfficiency = mana ? (atk + hp) / mana : 0;
                const pricePerPS = ps ? price / ps : 0;
                const roi = computeROI(ps, price);
                const survival = computeSurvival({ hp, armor });

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
                    case "survival":
                        kpiValue = `Survie: ${survival.toFixed(1)} tours`;
                        kpiClass = survival >= 3.0 ? "pkm-card-kpi-good" : (survival < 1.5 ? "pkm-card-kpi-bad" : "pkm-card-kpi-neutral");
                        break;
                }

                kpiEl.textContent = kpiValue;
                kpiEl.className = `pkm-card-kpi ${kpiClass}`;
                kpiEl.style.display = "block";
            });

            // Optional: sort cards by KPI
            // Cette fonction nécessiterait de réorganiser les éléments du DOM selon le tri
        }

        //--------------------------------------------------
        // Init
        //--------------------------------------------------
        window.addEventListener("load", () => {
                injectStyles();
                
                // Observer pour le bouton d'analyse
                const analyzerObserver = new MutationObserver(() => {
                        if (document.querySelector(".card-stats tbody tr")) {
                                addAnalyzeButton();
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
        });

        // Ajout des helpers pour les nouveaux KPIs
        function computeManaEfficiency(atk, hp, mana) {
                return mana ? (atk + hp) / mana : 0;
        }
        function computePricePerPS(price, ps) {
                return ps ? price / ps : 0;
        }
        function computeDailyROI(decPerDay, rentalPrice) {
                return rentalPrice ? decPerDay / rentalPrice : 0;
        }
})();
