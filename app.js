/* ==========================================================================
   LÒGICA I MOTOR DE DADES ACTUALITZAT: ARXIU BOTÀNIC DEL MONTSENY
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Estat global de l'aplicació
    const state = {
        herbes: [],             // Llista de totes les herbes obtingudes del CSV
        filteredHerbes: [],     // Herbes filtrades actualment
        activeTab: 'alfabetic', // Pestanya activa actualment
        activeLetter: 'Tots',   // Filtre alfabètic active
        activeRemedy: 'Tots',   // Filtre de remei actiu
        activeSeason: 'all',    // Filtre de temporada actiu
        searchQuery: '',        // Consulta de cerca activa
        cameraStream: null,     // Stream de la webcam si està activa
        currentScanImage: null, // Foto carregada o feta durant l'escaneig actual
        activeRemedySubTab: 'remeis', // Sub-pestanya activa (remeis o receptes)
        isSupabase: false,      // Si s'està utilitzant Supabase
        supabaseClient: null,   // Client de Supabase
        geminiKey: localStorage.getItem('gemini_api_key') || ''
    };

    // --- 1. REFREIXI D'ELEMENTS DOM ---
    const DOM = {
        statPlants: document.getElementById('stat-plants'),
        statRecipes: document.getElementById('stat-recipes'),
        statPendents: document.getElementById('stat-pendents'),
        
        btnCamera: document.getElementById('btn-camera'),
        btnUpload: document.getElementById('btn-upload'),
        fileInput: document.getElementById('file-input'),
        scannerSim: document.getElementById('scanner-sim'),
        scannerMainActions: document.getElementById('scanner-main-actions'),
        webcamPreview: document.getElementById('webcam-preview'),
        simForest: document.getElementById('sim-forest'),
        scanStatusText: document.getElementById('scan-status-text'),
        presetSelector: document.getElementById('preset-selector'),
        btnCancelScan: document.getElementById('btn-cancel-scan'),
        
        // Formulari d'identificació fallida
        scannerResultFailed: document.getElementById('scanner-result-failed'),
        failPreviewImg: document.getElementById('fail-preview-img'),
        failNotes: document.getElementById('fail-notes'),
        btnSaveFailed: document.getElementById('btn-save-failed'),
        btnDiscardFailed: document.getElementById('btn-discard-failed'),
        
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        alphabetContainer: document.getElementById('alphabet-container'),
        
        searchInputField: document.getElementById('search-input-field'),
        btnClearSearch: document.getElementById('btn-clear-search'),
        suggestionTags: document.querySelectorAll('.suggestion-tag'),
        
        remedyContainer: document.getElementById('remedy-container'),
        seasonBtns: document.querySelectorAll('.season-btn'),
        
        // Herbari de mostres pendents
        pendentsGrid: document.getElementById('pendents-grid-container'),
        pendentsCount: document.getElementById('pendents-count'),
        
        filterStatusBar: document.getElementById('filter-status-bar'),
        filterStatusText: document.getElementById('filter-status-text'),
        btnResetFilters: document.getElementById('btn-reset-filters'),
        
        plantsGrid: document.getElementById('plants-grid-container'),
        
        drawerOverlay: document.getElementById('drawer-overlay'),
        drawer: document.getElementById('botanical-drawer'),
        drawerClose: document.getElementById('drawer-close'),
        drawerContent: document.getElementById('drawer-data-content'),
        
        toast: document.getElementById('toast-notif'),
        
        chatMessages: document.getElementById('chat-messages-container'),
        chatInput: document.getElementById('chat-input'),
        chatSendBtn: document.getElementById('chat-send-btn'),
        chatSuggestions: document.getElementById('chat-suggestions')
    };

    // --- 2. PARSEJADOR DE CSV (RFC 4180) ---
    function parseCSV(text) {
        const result = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        
        let i = 0;
        while (i < text.length) {
            const char = text[i];
            const nextChar = text[i + 1];
            
            if (inQuotes) {
                if (char === '"') {
                    if (nextChar === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    } else {
                        inQuotes = false;
                        i++;
                        continue;
                    }
                }
                field += char;
                i++;
            } else {
                if (char === '"') {
                    inQuotes = true;
                    i++;
                    continue;
                } else if (char === ';') {
                    row.push(field.trim());
                    field = '';
                    i++;
                    continue;
                } else if (char === '\r' || char === '\n') {
                    row.push(field.trim());
                    field = '';
                    if (row.length > 1 || row[0] !== '') {
                        result.push(row);
                    }
                    row = [];
                    if (char === '\r' && nextChar === '\n') {
                        i += 2;
                    } else {
                        i++;
                    }
                    continue;
                }
                field += char;
                i++;
            }
        }
        
        if (field !== '' || row.length > 0) {
            row.push(field.trim());
            result.push(row);
        }
        
        // Convertir a array d'objectes usant les capçaleres de la primera fila
        const headers = result[0];
        const data = [];
        for (let r = 1; r < result.length; r++) {
            const currentRow = result[r];
            if (currentRow.length < headers.length) continue;
            const obj = {};
            for (let h = 0; h < headers.length; h++) {
                obj[headers[h]] = currentRow[h] || '';
            }
            data.push(obj);
        }
        return data;
    }

    // --- 2.5 SUPORT PERSISTÈNCIA DE BASE DE DADES A INDEXEDDB (OFFLINE / ESTÀTIC) ---
    const DB_STORE_NAME = 'arxiu_db_store';
    const DB_KEY = 'herbes_db_file';

    function openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ArxiuBotanicDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
                    db.createObjectStore(DB_STORE_NAME);
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getPersistedDB() {
        try {
            const db = await openIndexedDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(DB_STORE_NAME, 'readonly');
                const store = transaction.objectStore(DB_STORE_NAME);
                const request = store.get(DB_KEY);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Error llegint de IndexedDB:", err);
            return null;
        }
    }

    async function savePersistedDB(arrayBuffer) {
        try {
            const db = await openIndexedDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(DB_STORE_NAME, 'readwrite');
                const store = transaction.objectStore(DB_STORE_NAME);
                const request = store.put(arrayBuffer, DB_KEY);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error("Error desant a IndexedDB:", err);
            return false;
        }
    }

    function slugify(text) {
        return text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // treure accents
            .replace(/·/g, 'l')
            .replace(/[^a-z0-9\s-_]/g, '')
            .trim()
            .replace(/[-\s]+/g, '_');
    }

    async function uploadToCloudinary(file) {
        const cloudName = localStorage.getItem('cloudinary_cloud_name');
        const uploadPreset = localStorage.getItem('cloudinary_upload_preset');
        
        if (!cloudName || !uploadPreset) {
            throw new Error("Cloudinary no configurat");
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);
        
        const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || "Error en la resposta de Cloudinary");
        }
        
        const data = await response.json();
        return data.secure_url;
    }

    // --- 3. CARREGAR DADES ---
    async function loadData() {
        const supabaseUrl = localStorage.getItem('supabase_url') || '';
        const supabaseKey = localStorage.getItem('supabase_key') || '';
        
        if (supabaseUrl && supabaseKey) {
            try {
                // Inicialitzar Supabase
                state.supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
                state.isSupabase = true;
                console.log("Connectat a Supabase.");
                
                // Carregar totes les herbes de Supabase
                const { data, error } = await state.supabaseClient
                    .from('herbes_montseny')
                    .select('*');
                    
                if (error) throw error;
                
                state.herbes = data || [];
                
                // Ordenar alfabèticament per nom comú
                state.herbes.sort((a, b) => a.nom_comu.localeCompare(b.nom_comu, 'ca'));
                state.filteredHerbes = [...state.herbes];
                
                // Inicialitzacions
                initializeStats();
                initializeAlphabet();
                bindRemedySubTabs();
                renderRemedyCategoryGrid();
                updatePendentsCount();
                renderPlantsGrid();
                return;
            } catch (err) {
                console.error("Error connectant a Supabase, intentant fallback SQLite:", err);
                showToast("⚠️ Fallada de connexió a Supabase. Usant SQLite local.");
                state.isSupabase = false;
                state.supabaseClient = null;
            }
        }

        try {
            // Inicialitzar SQL.js amb el fitxer WebAssembly des del CDN
            const SQL = await initSqlJs({
                locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${filename}`
            });
            
            // Intentar recuperar de IndexedDB primer per carregar canvis persistits de l'usuari
            let uInt8Array;
            const savedBuffer = await getPersistedDB();
            
            if (savedBuffer) {
                uInt8Array = new Uint8Array(savedBuffer);
                console.log("Base de dades carregada correctament de IndexedDB.");
            } else {
                // Carregar el fitxer de base de dades SQLite del disc per defecte
                const response = await fetch('dades/herbes.db');
                if (!response.ok) {
                    throw new Error("No s'ha pogut carregar la base de dades SQLite.");
                }
                const arrayBuffer = await response.arrayBuffer();
                uInt8Array = new Uint8Array(arrayBuffer);
                // Desar còpia inicial a IndexedDB
                await savePersistedDB(arrayBuffer);
                console.log("Base de dades inicial carregada del servidor i desada a IndexedDB.");
            }
            
            // Obrir la base de dades
            state.db = new SQL.Database(uInt8Array);
            
            // Obtenir totes les herbes per defecte
            const stmt = state.db.prepare("SELECT * FROM herbes");
            const herbesList = [];
            while (stmt.step()) {
                herbesList.push(stmt.getAsObject());
            }
            stmt.free();
            
            state.herbes = herbesList;
            
            // Ordenar alfabèticament per nom comú
            state.herbes.sort((a, b) => a.nom_comu.localeCompare(b.nom_comu, 'ca'));
            state.filteredHerbes = [...state.herbes];
            
            // Inicialitzacions
            initializeStats();
            initializeAlphabet();
            bindRemedySubTabs();
            renderRemedyCategoryGrid();
            updatePendentsCount();
            renderPlantsGrid();
            
        } catch (error) {
            console.error("Error carregant les dades botàniques des de SQLite:", error);
            DOM.plantsGrid.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">⚠️</div>
                    <div class="no-results-title">Error al carregar la base de dades</div>
                    <p>No s'ha pogut carregar la base de dades SQLite. Assegura't que s'ha generat a "dades/herbes.db".</p>
                </div>
            `;
        }
    }

    // --- 4. INICIALITZADOR D'ESTADÍSTIQUES ---
    function initializeStats() {
        const totalPlants = state.herbes.length;
        
        // Calcular dinàmicament receptes o idees de cuina/remei reals
        const totalRecipes = state.herbes.reduce((acc, h) => {
            if (!h.receptes) return acc;
            const split = h.receptes.split(/[.;:]/).map(s => s.trim()).filter(s => s.length > 5);
            return acc + (split.length > 0 ? split.length : 1);
        }, 0);

        // Animar números
        animateValue(DOM.statPlants, 0, totalPlants, 1200);
        animateValue(DOM.statRecipes, 0, totalRecipes, 1500);
        
        const totalPendents = JSON.parse(localStorage.getItem('herbari_pendents') || '[]').length;
        animateValue(DOM.statPendents, 0, totalPendents, 800);
    }

    function animateValue(element, start, end, duration) {
        if (!element) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            element.textContent = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                element.textContent = end;
            }
        };
        window.requestAnimationFrame(step);
    }

    // --- 5. INICIALITZADOR D'ALFABET (PESTANYA ALFABÈTIC) ---
    function initializeAlphabet() {
        DOM.alphabetContainer.innerHTML = '';
        
        const existingLetters = new Set();
        state.herbes.forEach(h => {
            if (h.nom_comu) {
                const firstLetter = h.nom_comu.charAt(0).toUpperCase();
                existingLetters.add(firstLetter);
            }
        });

        // Crear botó "Tots"
        const allBtn = document.createElement('button');
        allBtn.className = 'letter-btn active';
        allBtn.textContent = 'Tots';
        allBtn.addEventListener('click', () => filterByLetter('Tots', allBtn));
        DOM.alphabetContainer.appendChild(allBtn);

        // Lletres de l'alfabet
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        alphabet.forEach(letter => {
            const btn = document.createElement('button');
            btn.className = 'letter-btn';
            btn.textContent = letter;
            
            if (!existingLetters.has(letter)) {
                btn.classList.add('disabled');
            } else {
                btn.addEventListener('click', () => filterByLetter(letter, btn));
            }
            DOM.alphabetContainer.appendChild(btn);
        });
    }

    function filterByLetter(letter, buttonElement) {
        DOM.alphabetContainer.querySelectorAll('.letter-btn').forEach(btn => btn.classList.remove('active'));
        buttonElement.classList.add('active');
        
        state.activeLetter = letter;
        applyFilters();
    }

    // --- 6. INICIALITZADOR DE REMEIS I RECEPTES (PESTANYA UNIFICADA) ---
    const REMEDY_CATEGORIES = [
        { id: 'digestiva', name: 'Digestiva i gasos', icon: '🍵', keywords: ['digestiva', 'espasmes', 'digestions', 'gasos', 'carminatiu', 'estómac', 'amarg'] },
        { id: 'respiratoria', name: 'Vies respiratòries i tos', icon: '🫁', keywords: ['expectorant', 'tos', 'bronquitis', 'respiratòries', 'asma', 'mucolítica', 'balsàmic'] },
        { id: 'cicatritzant', name: 'Pell i cicatrització', icon: '🩹', keywords: ['cicatritzant', 'ferides', 'berrugues', 'pell', 'èczemes', 'inflamacions pell', 'cops', 'cataplasma', 'tòpic'] },
        { id: 'diuretica', name: 'Diürètica i ronyons', icon: '💧', keywords: ['diürètica', 'càlculs', 'ronyó', 'depuratiu', 'netejar', 'urinaris', 'pixallits'] },
        { id: 'nerviosa', name: 'Nerviosa i relaxant', icon: '😴', keywords: ['sedant', 'relaxants', 'insomni', 'ansietat', 'calmant', 'migranyes', 'dolors'] },
        { id: 'circulatoria', name: 'Circulació i cor', icon: '❤️', keywords: ['circulació', 'cor', 'hemostàtics', 'sang', 'vasoconstrictors', 'cardiosaludable', 'arítmies'] },
        { id: 'antiseptica', name: 'Antisèptica i bacteris', icon: '🛡️', keywords: ['antisèptica', 'fongs', 'bacteris', 'antiviral', 'antibiòtic', 'infeccions'] },
        { id: 'hormonal', name: 'Hormonal i femenina', icon: '🌸', keywords: ['menstruació', 'hormonal', 'emenagoga', 'dolors menstruals', 'menstrual'] }
    ];

    const RECIPE_CATEGORIES = [
        { id: 'truites', name: 'Truites i remenats', icon: '🍳', keywords: ['truita', 'remenat', 'saltat', 'saltades', 'truites'] },
        { id: 'amanides', name: 'Amanides i sopes', icon: '🥗', keywords: ['amanida', 'amanides', 'fresca', 'fresques', 'sopes'] },
        { id: 'condiments', name: 'Condiments i adobs', icon: '🧂', keywords: ['condiment', 'adobar', 'olives', 'adob', 'adobs', 'aromatitzar'] },
        { id: 'infusions', name: 'Infusions i begudes', icon: '🍵', keywords: ['infusió', 'infusions', 'cafè', 'beguda', 'begudes'] },
        { id: 'olis', name: 'Olis i macerats', icon: '🏺', keywords: ['oli', 'macerat', 'macerar', 'cataplasma', 'macerada'] }
    ];

    function bindRemedySubTabs() {
        const subTabRemeis = document.getElementById('sub-tab-remeis');
        const subTabReceptes = document.getElementById('sub-tab-receptes');
        
        if (subTabRemeis && subTabReceptes) {
            subTabRemeis.onclick = () => {
                subTabRemeis.classList.add('active');
                subTabReceptes.classList.remove('active');
                state.activeRemedySubTab = 'remeis';
                state.activeRemedy = 'Tots';
                renderRemedyCategoryGrid();
                applyFilters();
            };
            
            subTabReceptes.onclick = () => {
                subTabReceptes.classList.add('active');
                subTabRemeis.classList.remove('active');
                state.activeRemedySubTab = 'receptes';
                state.activeRemedy = 'Tots';
                renderRemedyCategoryGrid();
                applyFilters();
            };
        }
    }

    function renderRemedyCategoryGrid() {
        DOM.remedyContainer.innerHTML = '';
        
        const categories = state.activeRemedySubTab === 'receptes' ? RECIPE_CATEGORIES : REMEDY_CATEGORIES;
        const mainIcon = state.activeRemedySubTab === 'receptes' ? '🍳' : '🌿';
        const mainLabel = state.activeRemedySubTab === 'receptes' ? 'Totes les receptes' : 'Tots els remeis';
        
        // Targeta de reset "Tots"
        const allCard = document.createElement('div');
        allCard.className = `remedy-card${state.activeRemedy === 'Tots' ? ' active' : ''}`;
        allCard.innerHTML = `
            <span class="remedy-card-icon">${mainIcon}</span>
            <span class="remedy-card-title">${mainLabel}</span>
            <span class="remedy-card-count">${state.herbes.length}</span>
        `;
        allCard.addEventListener('click', () => filterByRemedy('Tots', allCard));
        DOM.remedyContainer.appendChild(allCard);

        categories.forEach(cat => {
            const count = state.herbes.filter(h => {
                if (state.activeRemedySubTab === 'receptes') {
                    const text = `${h.receptes}`.toLowerCase();
                    return cat.keywords.some(kw => text.includes(kw));
                } else {
                    const text = `${h.remeis} ${h.descripcio_fulla} ${h.noms_comuns_coneguts}`.toLowerCase();
                    return cat.keywords.some(kw => text.includes(kw));
                }
            }).length;

            if (count > 0) {
                const card = document.createElement('div');
                card.className = `remedy-card${state.activeRemedy === cat.id ? ' active' : ''}`;
                card.innerHTML = `
                    <span class="remedy-card-icon">${cat.icon}</span>
                    <span class="remedy-card-title">${cat.name}</span>
                    <span class="remedy-card-count">${count}</span>
                `;
                card.addEventListener('click', () => filterByRemedy(cat.id, card));
                DOM.remedyContainer.appendChild(card);
            }
        });
    }

    function filterByRemedy(remedyId, cardElement) {
        DOM.remedyContainer.querySelectorAll('.remedy-card').forEach(card => card.classList.remove('active'));
        cardElement.classList.add('active');
        
        state.activeRemedy = remedyId;
        applyFilters();
    }

    // --- 7. APLICACIÓ DELS FILTRES ---
    function applyFilters() {
        if (state.activeTab === 'pendents' || state.activeTab === 'chat') {
            DOM.plantsGrid.style.display = 'none';
            return;
        }

        if (state.isSupabase) {
            applySupabaseFilters();
            return;
        }

        if (!state.db) {
            // Fallback si la BD no està inicialitzada
            return;
        }

        let query = "SELECT * FROM herbes WHERE 1=1";
        let params = [];

        if (state.activeTab === 'alfabetic') {
            if (state.activeLetter !== 'Tots') {
                query += " AND UPPER(SUBSTR(nom_comu, 1, 1)) = ?";
                params.push(state.activeLetter);
            }
        } 
        else if (state.activeTab === 'buscar') {
            if (state.searchQuery.trim() !== '') {
                const searchParam = `%${state.searchQuery}%`;
                query += ` AND (
                    LOWER(nom_comu) LIKE LOWER(?) OR 
                    LOWER(nom_cientific) LIKE LOWER(?) OR 
                    LOWER(noms_comuns_coneguts) LIKE LOWER(?) OR 
                    LOWER(familia) LIKE LOWER(?) OR 
                    LOWER(remeis) LIKE LOWER(?) OR 
                    LOWER(receptes) LIKE LOWER(?) OR 
                    LOWER(habitat) LIKE LOWER(?) OR 
                    LOWER(toxicitat) LIKE LOWER(?)
                )`;
                for (let i = 0; i < 8; i++) params.push(searchParam);
            }
        } 
        else if (state.activeTab === 'remei') {
            if (state.activeRemedy !== 'Tots') {
                if (state.activeRemedySubTab === 'receptes') {
                    const cat = RECIPE_CATEGORIES.find(c => c.id === state.activeRemedy);
                    if (cat) {
                        const conditions = cat.keywords.map(() => "LOWER(receptes) LIKE LOWER(?)").join(" OR ");
                        query += ` AND (${conditions})`;
                        cat.keywords.forEach(kw => params.push(`%${kw}%`));
                    }
                } else {
                    const cat = REMEDY_CATEGORIES.find(c => c.id === state.activeRemedy);
                    if (cat) {
                        const conditions = cat.keywords.map(() => "(LOWER(remeis) LIKE LOWER(?) OR LOWER(descripcio_fulla) LIKE LOWER(?) OR LOWER(noms_comuns_coneguts) LIKE LOWER(?))").join(" OR ");
                        query += ` AND (${conditions})`;
                        cat.keywords.forEach(kw => {
                            params.push(`%${kw}%`);
                            params.push(`%${kw}%`);
                            params.push(`%${kw}%`);
                        });
                    }
                }
            }
        } 
        else if (state.activeTab === 'temporada') {
            if (state.activeSeason !== 'all') {
                const season = state.activeSeason.toLowerCase();
                if (season === "tot l'any") {
                    query += " AND (LOWER(epoca_recollida) LIKE '%tot l\\'any%' OR LOWER(epoca_recollida) LIKE '%tot l’any%')";
                } else {
                    query += " AND LOWER(epoca_recollida) LIKE LOWER(?)";
                    params.push(`%${season}%`);
                }
            }
        }

        try {
            const stmt = state.db.prepare(query);
            stmt.bind(params);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();

            // Ordenar alfabèticament per nom comú (per a garantir ordenació en català correcte)
            results.sort((a, b) => a.nom_comu.localeCompare(b.nom_comu, 'ca'));

            DOM.plantsGrid.style.display = 'grid';
            state.filteredHerbes = results;
            updateFilterStatusBar();
            renderPlantsGrid();
        } catch (e) {
            console.error("Error executant la consulta SQL de filtres:", e);
        }
    }

    async function applySupabaseFilters() {
        if (!state.supabaseClient) return;
        
        let query = state.supabaseClient.from('herbes_montseny').select('*');
        
        if (state.activeTab === 'alfabetic') {
            if (state.activeLetter !== 'Tots') {
                query = query.ilike('nom_comu', `${state.activeLetter}%`);
            }
        } 
        else if (state.activeTab === 'buscar') {
            if (state.searchQuery.trim() !== '') {
                const searchStr = `%${state.searchQuery}%`;
                query = query.or(`nom_comu.ilike.${searchStr},nom_cientific.ilike.${searchStr},noms_comuns_coneguts.ilike.${searchStr},familia.ilike.${searchStr},remeis.ilike.${searchStr},receptes.ilike.${searchStr},habitat.ilike.${searchStr},toxicitat.ilike.${searchStr}`);
            }
        } 
        else if (state.activeTab === 'remei') {
            if (state.activeRemedy !== 'Tots') {
                if (state.activeRemedySubTab === 'receptes') {
                    const cat = RECIPE_CATEGORIES.find(c => c.id === state.activeRemedy);
                    if (cat) {
                        const orFilters = cat.keywords.map(kw => `receptes.ilike.%${kw}%`).join(',');
                        query = query.or(orFilters);
                    }
                } else {
                    const cat = REMEDY_CATEGORIES.find(c => c.id === state.activeRemedy);
                    if (cat) {
                        const orFilters = [];
                        cat.keywords.forEach(kw => {
                            orFilters.push(`remeis.ilike.%${kw}%`);
                            orFilters.push(`descripcio_fulla.ilike.%${kw}%`);
                            orFilters.push(`noms_comuns_coneguts.ilike.%${kw}%`);
                        });
                        query = query.or(orFilters.join(','));
                    }
                }
            }
        } 
        else if (state.activeTab === 'temporada') {
            if (state.activeSeason !== 'all') {
                const season = state.activeSeason.toLowerCase();
                if (season === "tot l'any") {
                    query = query.or("epoca_recollida.ilike.%tot l'any%,epoca_recollida.ilike.%tot l’any%");
                } else {
                    query = query.ilike('epoca_recollida', `%${season}%`);
                }
            }
        }

        try {
            const { data, error } = await query;
            if (error) throw error;
            
            const results = data || [];
            results.sort((a, b) => a.nom_comu.localeCompare(b.nom_comu, 'ca'));
            state.filteredHerbes = results;
            
            DOM.plantsGrid.style.display = 'grid';
            updateFilterStatusBar();
            renderPlantsGrid();
        } catch (err) {
            console.error("Error consultant Supabase:", err);
        }
    }

    function updateFilterStatusBar() {
        const total = state.herbes.length;
        const filtered = state.filteredHerbes.length;
        
        const hasActiveFilter = (
            (state.activeTab === 'alfabetic' && state.activeLetter !== 'Tots') ||
            (state.activeTab === 'buscar' && state.searchQuery.trim() !== '') ||
            (state.activeTab === 'remei' && state.activeRemedy !== 'Tots') ||
            (state.activeTab === 'temporada' && state.activeSeason !== 'all')
        );

        if (hasActiveFilter && state.activeTab !== 'pendents') {
            DOM.filterStatusBar.style.display = 'flex';
            DOM.filterStatusText.textContent = `S'han trobat ${filtered} herbes de ${total} catalogades.`;
        } else {
            DOM.filterStatusBar.style.display = 'none';
        }
    }

    // --- 8. RENDERITZADOR DE LA GRAELLA DE PLANTES ---
    function renderPlantsGrid() {
        DOM.plantsGrid.innerHTML = '';
        
        if (state.filteredHerbes.length === 0) {
            DOM.plantsGrid.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">🍂</div>
                    <div class="no-results-title">No s'ha trobat cap espècie</div>
                    <p>Prova de canviar els filtres de cerca o de fer una cerca més general.</p>
                </div>
            `;
            return;
        }

        state.filteredHerbes.forEach(herba => {
            const isToxic = isPlantToxic(herba);
            
            const card = document.createElement('article');
            card.className = 'plant-card';
            card.setAttribute('data-id', herba.idHerba);
            
            card.innerHTML = `
                <div class="plant-card-top">
                    <span class="plant-family-tag">${herba.familia}</span>
                    <h3 class="plant-title">${herba.nom_comu}</h3>
                    <span class="plant-scientific">${herba.nom_cientific}</span>
                </div>
                <div class="plant-card-middle">
                    <p class="plant-desc-short">${herba.descripcio_fulla || "Descripció física en preparació per al catàleg."}</p>
                </div>
                <div class="plant-card-bottom">
                    <span class="plant-info-badge">
                        ${isToxic ? '<span class="plant-toxic-badge">⚠️ Tòxica</span>' : `
                            <svg class="plant-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                            ${herba.parts_utilitzades ? herba.parts_utilitzades.split(',')[0].trim() : 'planta'}
                        `}
                    </span>
                    <span class="plant-card-action">
                        Fitxa
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </span>
                </div>
            `;

            card.addEventListener('click', () => openBotanicalDrawer(herba));
            DOM.plantsGrid.appendChild(card);
        });
    }

    function isPlantToxic(herba) {
        if (!herba.toxicitat) return false;
        const text = herba.toxicitat.toLowerCase();
        return (
            text.includes('tòxic') || 
            text.includes('toxic') || 
            text.includes('mortal') || 
            text.includes('verinós') || 
            text.includes('irritant') ||
            text.includes('prohibit') ||
            text.includes('atenció')
        );
    }

    // --- 8.5 OBTENIR IMATGES DE LA GALERIA D'UNA PLANTA (COMBINA SQLITE I DISC) ---
    async function getHerbGalleryImages(herba) {
        const slug = slugify(herba.nom_comu);
        const extensions = ['jpg', 'jpeg', 'png', 'webp'];
        const types = [
            { suffix: '', desc: 'Imatge general' },
            { suffix: '_fulla', desc: 'Detall de la fulla' },
            { suffix: '_flor', desc: 'Detall de la flor' },
            { suffix: '_fruit', desc: 'Detall del fruit' }
        ];

        let foundImages = [];

        // A. Llegir de la base de dades local SQLite/IndexedDB o Supabase
        if (state.isSupabase && state.supabaseClient) {
            try {
                const { data, error } = await state.supabaseClient
                    .from('herba_imatges')
                    .select('*')
                    .eq('idHerba', herba.idHerba);
                if (error) throw error;
                foundImages = data || [];
            } catch (err) {
                console.error("Error consultant Supabase per galeria:", err);
            }
        } else if (state.db) {
            try {
                const stmt = state.db.prepare("SELECT * FROM herba_imatges WHERE idHerba = ?");
                stmt.bind([herba.idHerba]);
                while (stmt.step()) {
                    foundImages.push(stmt.getAsObject());
                }
                stmt.free();
            } catch (err) {
                console.error("Error consultant SQLite per galeria:", err);
            }
        }

        // B. Comprovar de forma asíncrona si existeixen fitxers a la carpeta del disc (imatges/galeria/{slug}/)
        const promises = [];
        types.forEach(t => {
            extensions.forEach(ext => {
                const url = `imatges/galeria/${slug}/${slug}${t.suffix}.${ext}`;
                promises.push(
                    tryLoadImage(url).then(validUrl => {
                        if (validUrl) {
                            return {
                                ruta_imatge: validUrl,
                                descripcio: `${t.desc} de la ${herba.nom_comu}`
                            };
                        }
                        return null;
                    })
                );
                
                // També comprovar sense el prefix
                const urlSimple = `imatges/galeria/${slug}/${t.suffix.replace('_', '') || 'general'}.${ext}`;
                promises.push(
                    tryLoadImage(urlSimple).then(validUrl => {
                        if (validUrl) {
                            return {
                                ruta_imatge: validUrl,
                                descripcio: `${t.desc} de la ${herba.nom_comu}`
                            };
                        }
                        return null;
                    })
                );
            });
        });

        // Comprovar indexos (1.jpg, 2.jpg)
        for (let i = 1; i <= 3; i++) {
            extensions.forEach(ext => {
                const urlNum = `imatges/galeria/${slug}/${i}.${ext}`;
                promises.push(
                    tryLoadImage(urlNum).then(validUrl => {
                        if (validUrl) {
                            return {
                                ruta_imatge: validUrl,
                                descripcio: `Imatge de camp ${i} de la ${herba.nom_comu}`
                            };
                        }
                        return null;
                    })
                );
            });
        }

        const checkedResults = await Promise.all(promises);
        checkedResults.forEach(res => {
            if (res) {
                // Evitar duplicats si la ruta ja existeix
                if (!foundImages.some(img => img.ruta_imatge === res.ruta_imatge)) {
                    foundImages.push(res);
                }
            }
        });

        return foundImages;
    }

    function tryLoadImage(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(url);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    // --- 9. PANELL DETALLAT DE CADA PLANTA (DRAWER) ---
    async function openBotanicalDrawer(herba) {
        let synonymsHTML = '';
        if (herba.noms_comuns_coneguts && herba.noms_comuns_coneguts.trim() !== '') {
            synonymsHTML = `<div class="drawer-synonyms"><strong>També coneguda com:</strong> ${herba.noms_comuns_coneguts}</div>`;
        }

        let remediesHTML = '';
        if (herba.remeis && herba.remeis.trim() !== '') {
            remediesHTML = `
                <div class="paper-box">
                    <h4 class="paper-box-title">🍵 Usos Medicinals</h4>
                    <p class="paper-box-desc">${herba.remeis}</p>
                </div>
            `;
        }

        let recipesHTML = '';
        if (herba.receptes && herba.receptes.trim() !== '') {
            recipesHTML = `
                <div class="paper-box" style="border-left-color: var(--color-primary);">
                    <h4 class="paper-box-title" style="color: var(--color-primary-light);">🍳 Aplicacions Culinàries / Preparats</h4>
                    <p class="paper-box-desc">${herba.receptes}</p>
                </div>
            `;
        }

        let toxicityHTML = '';
        if (herba.toxicitat && herba.toxicitat.trim() !== '') {
            toxicityHTML = `
                <div class="toxic-alert-box">
                    <h4 class="toxic-alert-title">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        Seguretat i Toxicitat
                    </h4>
                    <p class="toxic-alert-desc">${herba.toxicitat}</p>
                </div>
            `;
        }

        // Consultar les imatges de la galeria des de SQLite i el disc
        const images = await getHerbGalleryImages(herba);
        let galleryHTML = '';

        // Definir miniatures específiques per a la descripció botànica
        let leafImg = '';
        let flowerImg = '';
        let fruitImg = '';
        
        if (images.length > 0) {
            leafImg = images.find(img => {
                const desc = (img.descripcio || '').toLowerCase();
                const path = (img.ruta_imatge || '').toLowerCase();
                return desc.includes('fulla') || path.includes('fulla') || desc.includes('leaf') || desc.includes('foliar') || desc.includes('plant');
            })?.ruta_imatge || images[0].ruta_imatge;

            flowerImg = images.find(img => {
                const desc = (img.descripcio || '').toLowerCase();
                const path = (img.ruta_imatge || '').toLowerCase();
                return desc.includes('flor') || path.includes('flor') || desc.includes('petal') || desc.includes('flower') || desc.includes('infloresc');
            })?.ruta_imatge || (images.length > 1 ? images[1].ruta_imatge : images[0].ruta_imatge);

            fruitImg = images.find(img => {
                const desc = (img.descripcio || '').toLowerCase();
                const path = (img.ruta_imatge || '').toLowerCase();
                return desc.includes('fruit') || path.includes('fruit') || desc.includes('llavor') || desc.includes('capsula') || desc.includes('seed');
            })?.ruta_imatge || (images.length > 2 ? images[2].ruta_imatge : images[0].ruta_imatge);
        } else {
            leafImg = 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=300&q=80';
            flowerImg = 'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?auto=format&fit=crop&w=300&q=80';
            fruitImg = 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=300&q=80';
        }

        galleryHTML = `
            <div class="drawer-section" style="margin-top: 15px;">
                <h3 class="drawer-section-title">
                    <svg class="drawer-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    Galeria de Camp
                </h3>
                ${images.length > 0 ? `
                    <div class="carousel-container">
                        <div class="carousel-slides">
                            ${images.map((img, index) => `
                                <div class="carousel-slide ${index === 0 ? 'active' : ''}" data-index="${index}">
                                    <img src="${img.ruta_imatge}" alt="${img.descripcio || herba.nom_comu}" class="carousel-img" data-full="${img.ruta_imatge}" data-desc="${img.descripcio || herba.nom_comu}">
                                    ${img.descripcio ? `<div class="carousel-caption">${img.descripcio}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                        ${images.length > 1 ? `
                            <button class="carousel-prev" aria-label="Anterior">&lt;</button>
                            <button class="carousel-next" aria-label="Següent">&gt;</button>
                            <div class="carousel-dots">
                                ${images.map((_, index) => `
                                    <span class="carousel-dot ${index === 0 ? 'active' : ''}" data-index="${index}"></span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                ` : `
                    <div class="no-images-placeholder" style="text-align: center; padding: 30px; background: #fbf9f3; border: 1px dashed var(--color-border); border-radius: 8px; margin-top: 10px; margin-bottom: 15px;">
                        <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">📸</span>
                        <p style="font-size: 0.8rem; color: var(--color-text-muted); margin: 0;">Encara no hi ha cap imatge de camp en aquesta galeria.</p>
                    </div>
                `}
                <div class="gallery-actions" style="margin-top: 10px; display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; align-items: center;">
                    <button class="btn btn-secondary" id="btn-add-gallery-image" style="font-size: 0.85rem; padding: 8px 16px; border-radius: 20px; display: flex; align-items: center; gap: 6px; border-color: var(--color-primary-light); color: var(--color-primary); background: transparent;">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Afegir imatge de camp
                    </button>
                    <input type="file" id="input-gallery-file" accept="image/*" style="display: none;">
                </div>
            </div>
        `;

        DOM.drawerContent.innerHTML = `
            <div class="drawer-header">
                <span class="drawer-family">${herba.familia}</span>
                <h2 class="drawer-title">${herba.nom_comu}</h2>
                <div class="drawer-scientific">${herba.nom_cientific}</div>
                ${synonymsHTML}
            </div>

            ${galleryHTML}

            ${toxicityHTML}

            <div class="drawer-section">
                <h3 class="drawer-section-title">
                    <svg class="drawer-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    Usos i Aplicacions
                </h3>
                ${remediesHTML}
                ${recipesHTML}
            </div>

            <div class="drawer-section">
                <h3 class="drawer-section-title">
                    <svg class="drawer-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Hàbitat i Recol·lecció
                </h3>
                <div class="info-row-grid">
                    <div class="info-row">
                        <span class="info-row-label">🌳 Hàbitat</span>
                        <span class="info-row-value">${herba.habitat || "Boscos i prats del Montseny."}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-row-label">📅 Recollida</span>
                        <span class="info-row-value">${herba.epoca_recollida || "Segons la fase de floració."}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-row-label">✂️ Parts útils</span>
                        <span class="info-row-value">${herba.parts_utilitzades || "Parts aèries."}</span>
                    </div>
                </div>
            </div>

            <div class="drawer-section">
                <h3 class="drawer-section-title">
                    <svg class="drawer-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    Descripció Botànica
                </h3>
                <div class="morphology-grid">
                    ${herba.descripcio_fulla ? `
                        <div class="morphology-item" style="display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;">
                            <div style="flex: 1;">
                                <div class="morphology-label">🍃 Fulles</div>
                                <div class="morphology-value">${herba.descripcio_fulla}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                                <div class="morphology-img-container" style="width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--color-border); cursor: pointer;">
                                    <img src="${leafImg}" alt="Fulles" class="morphology-thumb" data-full="${leafImg}" data-desc="Detall foliar de ${herba.nom_comu}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                                </div>
                                <button class="btn-add-detail-img" data-type="fulla" title="Afegir/Descarregar foto de fulla" style="background: transparent; border: 1px solid var(--color-primary-light); color: var(--color-primary); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; cursor: pointer; font-weight: bold;">
                                    + Fulla
                                </button>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${herba.descripcio_tija ? `
                        <div class="morphology-item">
                            <div class="morphology-label">🪵 Tija</div>
                            <div class="morphology-value">${herba.descripcio_tija}</div>
                        </div>
                    ` : ''}
                    
                    ${herba.descripcio_flor ? `
                        <div class="morphology-item" style="display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;">
                            <div style="flex: 1;">
                                <div class="morphology-label">🌸 Flors</div>
                                <div class="morphology-value">${herba.descripcio_flor}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                                <div class="morphology-img-container" style="width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--color-border); cursor: pointer;">
                                    <img src="${flowerImg}" alt="Flors" class="morphology-thumb" data-full="${flowerImg}" data-desc="Detall floral de ${herba.nom_comu}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                                </div>
                                <button class="btn-add-detail-img" data-type="flor" title="Afegir/Descarregar foto de flor" style="background: transparent; border: 1px solid var(--color-primary-light); color: var(--color-primary); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; cursor: pointer; font-weight: bold;">
                                    + Flor
                                </button>
                            </div>
                        </div>
                    ` : ''}
 
                    ${herba.inflorescencia ? `
                        <div class="morphology-item">
                            <div class="morphology-label">🌾 Inflorescència</div>
                            <div class="morphology-value">${herba.inflorescencia}</div>
                        </div>
                    ` : ''}
 
                    ${herba.arrels ? `
                        <div class="morphology-item">
                            <div class="morphology-label">🥕 Arrels</div>
                            <div class="morphology-value">${herba.arrels}</div>
                        </div>
                    ` : ''}
 
                    ${herba.rebrots ? `
                        <div class="morphology-item">
                            <div class="morphology-label">🌱 Rebrots</div>
                            <div class="morphology-value">${herba.rebrots}</div>
                        </div>
                    ` : ''}
 
                    ${herba.fruits ? `
                        <div class="morphology-item" style="display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;">
                            <div style="flex: 1;">
                                <div class="morphology-label">🍒 Fruits</div>
                                <div class="morphology-value">${herba.fruits}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                                <div class="morphology-img-container" style="width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--color-border); cursor: pointer;">
                                    <img src="${fruitImg}" alt="Fruits" class="morphology-thumb" data-full="${fruitImg}" data-desc="Detall de fruits de ${herba.nom_comu}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                                </div>
                                <button class="btn-add-detail-img" data-type="fruit" title="Afegir/Descarregar foto de fruit" style="background: transparent; border: 1px solid var(--color-primary-light); color: var(--color-primary); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; cursor: pointer; font-weight: bold;">
                                    + Fruit
                                </button>
                            </div>
                        </div>
                    ` : ''}

                    ${herba.llavors ? `
                        <div class="morphology-item">
                            <div class="morphology-label">🪙 Llavors</div>
                            <div class="morphology-value">${herba.llavors}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
            <!-- Botó per obrir la infografia de la làmina botànica estil s. XIX -->
            <div style="margin-top: 30px; border-top: 1px solid var(--color-border); padding-top: 20px; text-align: center;">
                <button class="btn btn-primary" id="btn-open-infographic" style="width: 100%; border-color: var(--color-accent); background: var(--color-accent); font-family: var(--font-serif); font-size: 1.15rem; gap: 8px;">
                    📜 Il·lustració Botànica (Segle XIX)
                </button>
            </div>
        `;

        // Activar la interactivitat del Carrusel
        const carousel = DOM.drawerContent.querySelector('.carousel-container');
        if (carousel && images.length > 1) {
            const slides = carousel.querySelectorAll('.carousel-slide');
            const dots = carousel.querySelectorAll('.carousel-dot');
            const prevBtn = carousel.querySelector('.carousel-prev');
            const nextBtn = carousel.querySelector('.carousel-next');
            let currentIndex = 0;

            function showSlide(index) {
                if (index < 0) index = slides.length - 1;
                if (index >= slides.length) index = 0;
                currentIndex = index;

                slides.forEach((slide, i) => {
                    slide.classList.toggle('active', i === currentIndex);
                });
                dots.forEach((dot, i) => {
                    dot.classList.toggle('active', i === currentIndex);
                });
            }

            if (prevBtn) prevBtn.addEventListener('click', () => showSlide(currentIndex - 1));
            if (nextBtn) nextBtn.addEventListener('click', () => showSlide(currentIndex + 1));
            dots.forEach(dot => {
                dot.addEventListener('click', () => {
                    const idx = parseInt(dot.getAttribute('data-index'), 10);
                    showSlide(idx);
                });
            });
        }

        // Activar Lightbox per a les imatges del carrusel i de la morfologia botànica
        const allLightboxImgs = DOM.drawerContent.querySelectorAll('.carousel-img, .morphology-thumb');
        
        // Crear llista d'imatges úniques per evitar duplicats en la navegació del lightbox
        const imagesList = [];
        const seenSrcs = new Set();
        allLightboxImgs.forEach(img => {
            const src = img.getAttribute('data-full');
            const desc = img.getAttribute('data-desc') || '';
            if (src && !seenSrcs.has(src)) {
                seenSrcs.add(src);
                imagesList.push({ src, desc });
            }
        });

        allLightboxImgs.forEach(img => {
            img.addEventListener('click', () => {
                const src = img.getAttribute('data-full');
                const idx = imagesList.findIndex(item => item.src === src);
                openLightbox(imagesList, idx !== -1 ? idx : 0);
            });
        });

        // Activar la pujada d'imatges de camp a la galeria
        const btnAddImage = DOM.drawerContent.querySelector('#btn-add-gallery-image');
        const inputGalleryFile = DOM.drawerContent.querySelector('#input-gallery-file');
        
        if (btnAddImage && inputGalleryFile) {
            btnAddImage.addEventListener('click', () => {
                inputGalleryFile.click();
            });
            
            inputGalleryFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const desc = prompt("Introdueix una petita descripció de la imatge (ex: Detall de la fulla a la tardor):");
                
                showToast("⏳ Pujant imatge...");
                
                let imageUrl = '';
                
                try {
                    imageUrl = await uploadToCloudinary(file);
                    showToast("☁️ Imatge pujada a Cloudinary correctament!");
                } catch (err) {
                    console.log("Cloudinary upload skipped or failed, falling back to local Base64:", err.message);
                    if (err.message === "Cloudinary no configurat") {
                        showToast("ℹ️ Usant emmagatzematge local (base64) perquè Cloudinary no està configurat.");
                    } else {
                        showToast("⚠️ Fallada en Cloudinary. Usant emmagatzematge local (base64). Detall: " + err.message);
                    }
                    
                    // Fallback to Base64
                    imageUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (event) => resolve(event.target.result);
                        reader.readAsDataURL(file);
                    });
                }
                
                if (state.isSupabase && state.supabaseClient && imageUrl) {
                    try {
                        const { error } = await state.supabaseClient
                            .from('herba_imatges')
                            .insert([
                                { idHerba: herba.idHerba, ruta_imatge: imageUrl, descripcio: desc || '' }
                            ]);
                        if (error) throw error;
                        
                        showToast("📸 Nova imatge afegida a la galeria de Supabase!");
                        
                        // Recarregar la fitxa de l'herba actual
                        const { data, error: fetchErr } = await state.supabaseClient
                            .from('herbes_montseny')
                            .select('*')
                            .eq('idHerba', herba.idHerba)
                            .single();
                        if (!fetchErr && data) {
                            openBotanicalDrawer(data);
                        }
                    } catch (err) {
                        console.error("Error inserint la imatge a Supabase:", err);
                        showToast("⚠️ Error al desar la imatge a Supabase.");
                    }
                } else if (state.db && imageUrl) {
                    try {
                        state.db.run(
                            "INSERT INTO herba_imatges (idHerba, ruta_imatge, descripcio) VALUES (?, ?, ?)",
                            [herba.idHerba, imageUrl, desc || '']
                        );
                        
                        // Serialitzar i persistir a IndexedDB
                        const binaryDb = state.db.export();
                        await savePersistedDB(binaryDb.buffer);
                        
                        showToast("📸 Nova imatge afegida a la galeria i desada correctament!");
                        
                        // Recarregar la fitxa de l'herba actual
                        const stmt = state.db.prepare("SELECT * FROM herbes WHERE idHerba = ?");
                        stmt.bind([herba.idHerba]);
                        if (stmt.step()) {
                            const updatedHerba = stmt.getAsObject();
                            openBotanicalDrawer(updatedHerba);
                        }
                        stmt.free();
                        
                    } catch (err) {
                        console.error("Error inserint la imatge a la BD:", err);
                        showToast("⚠️ Error al desar la imatge a la base de dades.");
                    }
                }
            });
        }

        // Lògica per a pujar detalls de fulla, flor i fruit amb descàrrega i guardat directe
        const detailUploadBtns = DOM.drawerContent.querySelectorAll('.btn-add-detail-img');
        const inputDetailFile = document.createElement('input');
        inputDetailFile.type = 'file';
        inputDetailFile.accept = 'image/*';
        inputDetailFile.style.display = 'none';
        document.body.appendChild(inputDetailFile);
        
        let targetType = '';
        
        detailUploadBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                targetType = btn.getAttribute('data-type');
                inputDetailFile.click();
            });
        });
        
        inputDetailFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            showToast("⏳ Processant i pujant imatge...");
            
            const slug = slugify(herba.nom_comu);
            const ext = file.name.split('.').pop() || 'jpg';
            const downloadName = `${slug}_${targetType}.${ext}`;
            const label = targetType === 'fulla' ? 'Detall de la fulla' : (targetType === 'flor' ? 'Detall de la flor' : 'Detall del fruit');

            // 1. Obtenir base64 localment per a la descàrrega immediata i possible fallback
            const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target.result);
                reader.readAsDataURL(file);
            });

            // 2. Descarregar immediatament el fitxer amb el nom i sufix correcte per col·locar al disc dur
            const downloadAnchor = document.createElement('a');
            downloadAnchor.href = base64Data;
            downloadAnchor.download = downloadName;
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            document.body.removeChild(downloadAnchor);

            // 3. Pujada a Cloudinary (amb fallback a local base64)
            let imageUrl = '';
            try {
                imageUrl = await uploadToCloudinary(file);
                showToast("☁️ Imatge de detall pujada a Cloudinary!");
            } catch (err) {
                console.log("Cloudinary upload for detail skipped or failed, falling back to local Base64:", err.message);
                if (err.message === "Cloudinary no configurat") {
                    showToast(`📸 Foto afegida localment. Desa el fitxer descarregat a: imatges/galeria/${slug}/${downloadName}`);
                } else {
                    showToast(`⚠️ Error Cloudinary. Desa el fitxer a: imatges/galeria/${slug}/${downloadName}`);
                }
                imageUrl = base64Data;
            }

            // 4. Desar a la base de dades (Supabase o SQLite)
            if (state.isSupabase && state.supabaseClient && imageUrl) {
                try {
                    const { error } = await state.supabaseClient
                        .from('herba_imatges')
                        .insert([
                            { idHerba: herba.idHerba, ruta_imatge: imageUrl, descripcio: `${label} (_${targetType})` }
                        ]);
                    if (error) throw error;
                } catch (err) {
                    console.error("Error inserint imatge de detall a Supabase:", err);
                }
            } else if (state.db && imageUrl) {
                try {
                    state.db.run(
                        "INSERT INTO herba_imatges (idHerba, ruta_imatge, descripcio) VALUES (?, ?, ?)",
                        [herba.idHerba, imageUrl, `${label} (_${targetType})`]
                    );
                    
                    // Serialitzar i persistir a IndexedDB
                    const binaryDb = state.db.export();
                    await savePersistedDB(binaryDb.buffer);
                } catch (err) {
                    console.error("Error inserint imatge de detall a la BD:", err);
                }
            }

            // 5. Recarregar el drawer
            if (state.isSupabase && state.supabaseClient) {
                try {
                    const { data, error } = await state.supabaseClient
                        .from('herbes_montseny')
                        .select('*')
                        .eq('idHerba', herba.idHerba)
                        .single();
                    if (!error && data) {
                        openBotanicalDrawer(data);
                    }
                } catch (err) {
                    console.error("Error recarregant fitxa de Supabase:", err);
                }
            } else if (state.db) {
                const stmt = state.db.prepare("SELECT * FROM herbes WHERE idHerba = ?");
                stmt.bind([herba.idHerba]);
                if (stmt.step()) {
                    const updatedHerba = stmt.getAsObject();
                    openBotanicalDrawer(updatedHerba);
                }
                stmt.free();
            }
        });



        const openInfoBtn = document.getElementById('btn-open-infographic');
        if (openInfoBtn) {
            openInfoBtn.addEventListener('click', () => {
                openBotanicalInfographic(herba);
            });
        }

        DOM.drawerOverlay.classList.add('active');
        DOM.drawer.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    // --- 9.5 LIGHTBOX PER AMPLIAR IMATGES DE LA GALERIA ---
    let currentLightboxIndex = 0;
    let lightboxImages = [];

    function openLightbox(images, index) {
        lightboxImages = images;
        currentLightboxIndex = index;

        let overlay = document.getElementById('gallery-lightbox');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'gallery-lightbox';
            overlay.className = 'lightbox-overlay';
            overlay.innerHTML = `
                <span class="lightbox-close">&times;</span>
                <button class="lightbox-prev" id="lightbox-prev-btn">&lt;</button>
                <img class="lightbox-content" id="lightbox-img">
                <button class="lightbox-next" id="lightbox-next-btn">&gt;</button>
                <div class="lightbox-caption" id="lightbox-caption"></div>
            `;
            document.body.appendChild(overlay);
            
            overlay.addEventListener('click', (e) => {
                if (e.target.id !== 'lightbox-img' && e.target.id !== 'lightbox-prev-btn' && e.target.id !== 'lightbox-next-btn') {
                    overlay.classList.remove('active');
                }
            });

            document.getElementById('lightbox-prev-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                navigateLightbox(-1);
            });

            document.getElementById('lightbox-next-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                navigateLightbox(1);
            });

            document.addEventListener('keydown', (e) => {
                if (!overlay.classList.contains('active')) return;
                if (e.key === 'ArrowLeft') {
                    navigateLightbox(-1);
                } else if (e.key === 'ArrowRight') {
                    navigateLightbox(1);
                } else if (e.key === 'Escape') {
                    overlay.classList.remove('active');
                }
            });
        }
        
        updateLightboxContent();
        overlay.classList.add('active');
    }

    function navigateLightbox(direction) {
        if (lightboxImages.length <= 1) return;
        currentLightboxIndex += direction;
        if (currentLightboxIndex < 0) {
            currentLightboxIndex = lightboxImages.length - 1;
        } else if (currentLightboxIndex >= lightboxImages.length) {
            currentLightboxIndex = 0;
        }
        updateLightboxContent();
    }

    function updateLightboxContent() {
        const img = document.getElementById('lightbox-img');
        const caption = document.getElementById('lightbox-caption');
        const prevBtn = document.getElementById('lightbox-prev-btn');
        const nextBtn = document.getElementById('lightbox-next-btn');

        if (lightboxImages.length > 0) {
            const currentImg = lightboxImages[currentLightboxIndex];
            img.src = currentImg.src;
            caption.textContent = currentImg.desc || '';
        }

        if (lightboxImages.length <= 1) {
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        } else {
            if (prevBtn) prevBtn.style.display = 'block';
            if (nextBtn) nextBtn.style.display = 'block';
        }
    }

    function closeBotanicalDrawer() {
        DOM.drawerOverlay.classList.remove('active');
        DOM.drawer.classList.remove('active');
        document.body.style.overflow = '';
    }

    DOM.drawerClose.addEventListener('click', closeBotanicalDrawer);
    DOM.drawerOverlay.addEventListener('click', closeBotanicalDrawer);

    // --- 10. GESTIÓ DE PESTANYES ---
    DOM.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            
            DOM.tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            DOM.tabPanes.forEach(pane => pane.classList.remove('active'));
            document.getElementById(`pane-${tabName}`).classList.add('active');
            
            state.activeTab = tabName;
            
            if (tabName === 'pendents') {
                renderPendentsGrid();
            }
            
            applyFilters();
        });
    });

    // --- 11. EVENT LISTENERS DE CERCA ---
    DOM.searchInputField.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (state.searchQuery.trim() !== '') {
            DOM.btnClearSearch.style.display = 'block';
        } else {
            DOM.btnClearSearch.style.display = 'none';
        }
        applyFilters();
    });

    DOM.btnClearSearch.addEventListener('click', () => {
        DOM.searchInputField.value = '';
        DOM.btnClearSearch.style.display = 'none';
        state.searchQuery = '';
        applyFilters();
        DOM.searchInputField.focus();
    });

    DOM.suggestionTags.forEach(tag => {
        tag.addEventListener('click', () => {
            const term = tag.getAttribute('data-search');
            DOM.searchInputField.value = term;
            DOM.btnClearSearch.style.display = 'block';
            state.searchQuery = term;
            applyFilters();
        });
    });

    // --- 12. EVENT LISTENERS DE TEMPORADES ---
    DOM.seasonBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.seasonBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            state.activeSeason = btn.getAttribute('data-season');
            applyFilters();
        });
    });

    // --- 13. RESTABLIR FILTRES ---
    DOM.btnResetFilters.addEventListener('click', resetAllFilters);

    function resetAllFilters() {
        state.activeLetter = 'Tots';
        state.activeRemedy = 'Tots';
        state.activeSeason = 'all';
        state.searchQuery = '';
        
        DOM.searchInputField.value = '';
        DOM.btnClearSearch.style.display = 'none';
        
        DOM.alphabetContainer.querySelectorAll('.letter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent === 'Tots') btn.classList.add('active');
        });
        
        DOM.remedyContainer.querySelectorAll('.remedy-card').forEach(card => {
            card.classList.remove('active');
            if (card.querySelector('.remedy-card-title').textContent.includes('Tots')) card.classList.add('active');
        });
        
        DOM.seasonBtns.forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-season') === 'all') btn.classList.add('active');
        });
        
        applyFilters();
        showToast("S'han restablit tots els filtres.");
    }

    // --- 14. TOAST NOTIFICATIONS ---
    function showToast(message) {
        DOM.toast.textContent = message;
        DOM.toast.classList.add('active');
        
        setTimeout(() => {
            DOM.toast.classList.remove('active');
        }, 3500);
    }

    // --- 15. HERBARI DE MOSTRES PENDENTS (localStorage) ---
    function updatePendentsCount() {
        const items = JSON.parse(localStorage.getItem('herbari_pendents') || '[]');
        DOM.pendentsCount.textContent = items.length;
        if (DOM.statPendents) {
            DOM.statPendents.textContent = items.length;
        }
    }

    function renderPendentsGrid() {
        const container = DOM.pendentsGrid;
        container.innerHTML = '';
        
        const items = JSON.parse(localStorage.getItem('herbari_pendents') || '[]');
        updatePendentsCount();
        
        if (items.length === 0) {
            container.innerHTML = `
                <div class="no-results" style="grid-column: 1 / -1; padding: 40px 0;">
                    <div class="no-results-icon">📋</div>
                    <div class="no-results-title">Herbari buit</div>
                    <p>No tens cap mostra pendent d'identificació. Fes un escaneig i desa les plantes desconegudes per a poder investigar-les posteriorment.</p>
                </div>
            `;
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'pendents-card';
            card.innerHTML = `
                <div class="pendents-img-wrapper" style="background-image: url('${item.image}')">
                    <span class="pendents-date-tag">📅 ${item.date}</span>
                </div>
                <div class="pendents-body">
                    <span class="pendents-notes-label">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        Notes de camp:
                    </span>
                    <textarea class="pendents-notes-textarea" placeholder="Afegeix notes (lloc, hora, caràcters especials...)" data-id="${item.id}">${item.notes}</textarea>
                    <div class="pendents-actions">
                        <button class="btn-sm btn-sm-danger" data-action="delete" data-id="${item.id}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            Eliminar
                        </button>
                        <button class="btn-sm btn-sm-save" data-action="save" data-id="${item.id}">
                            Desar notes
                        </button>
                    </div>
                </div>
            `;

            const textarea = card.querySelector('.pendents-notes-textarea');
            const deleteBtn = card.querySelector('[data-action="delete"]');
            const saveBtn = card.querySelector('[data-action="save"]');

            deleteBtn.addEventListener('click', () => deletePendentItem(item.id));
            saveBtn.addEventListener('click', () => savePendentNotes(item.id, textarea.value));

            container.appendChild(card);
        });
    }

    function savePendentNotes(id, notes) {
        let items = JSON.parse(localStorage.getItem('herbari_pendents') || '[]');
        items = items.map(item => {
            if (item.id === id) {
                return { ...item, notes: notes };
            }
            return item;
        });
        localStorage.setItem('herbari_pendents', JSON.stringify(items));
        showToast("💾 Notes de camp actualitzades correctament.");
        renderPendentsGrid();
    }

    function deletePendentItem(id) {
        if (confirm("Segur que vols eliminar aquesta mostra de l'herbari?")) {
            let items = JSON.parse(localStorage.getItem('herbari_pendents') || '[]');
            items = items.filter(item => item.id !== id);
            localStorage.setItem('herbari_pendents', JSON.stringify(items));
            showToast("🗑️ Mostra eliminada de l'herbari.");
            renderPendentsGrid();
            updatePendentsCount();
        }
    }

    // --- 16. SIMULADOR D'IDENTIFICACIÓ DE PLANTES ---
    DOM.btnCamera.addEventListener('click', () => startScanningSimulation('camera'));
    DOM.btnUpload.addEventListener('click', () => DOM.fileInput.click());
    DOM.fileInput.addEventListener('change', handleFileUpload);
    DOM.btnCancelScan.addEventListener('click', stopScanningSimulation);

    // Formularis de fallida
    DOM.btnDiscardFailed.addEventListener('click', resetScannerState);
    DOM.btnSaveFailed.addEventListener('click', saveUnidentifiedHerb);

    // Gestió dels botons de mostres preset
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const plantName = btn.getAttribute('data-plant');
            runAnalysisSequence(plantName);
        });
    });

    function startScanningSimulation(mode) {
        // Amagar formulari de fallida anterior
        DOM.scannerResultFailed.style.display = 'none';
        DOM.scannerMainActions.style.display = 'none';
        
        DOM.scannerSim.style.display = 'flex';
        DOM.presetSelector.style.display = 'block';
        DOM.simForest.style.backgroundImage = "url('imatges/fonsWeb.jpeg')";
        DOM.simForest.style.display = 'block';
        DOM.webcamPreview.style.display = 'none';
        
        // Establir foto per defecte per a la simulació
        state.currentScanImage = 'imatges/fonsWeb.jpeg';
        
        document.getElementById('scanner-block').scrollIntoView({ behavior: 'smooth' });

        if (mode === 'camera') {
            DOM.scanStatusText.textContent = "Intentant obrir la càmera real...";
            
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                    .then(stream => {
                        state.cameraStream = stream;
                        DOM.webcamPreview.srcObject = stream;
                        DOM.webcamPreview.style.display = 'block';
                        DOM.simForest.style.display = 'none';
                        DOM.scanStatusText.textContent = "Càmera connectada. Escanejant...";
                        
                        setTimeout(() => {
                            runAnalysisSequence(null);
                        }, 2500);
                    })
                    .catch(err => {
                        console.warn("No s'ha pogut accedir a la càmera web, activant entorn virtual.", err);
                        DOM.scanStatusText.textContent = "Sense accés a la càmera. Entorn virtual actiu.";
                        setTimeout(() => {
                            DOM.scanStatusText.textContent = "Escanejant biomassa virtual...";
                        }, 1200);
                    });
            } else {
                DOM.scanStatusText.textContent = "Entorn virtual botànic actiu.";
            }
        }
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            // Desar base64 de la imatge carregada
            state.currentScanImage = event.target.result;
            
            DOM.scannerResultFailed.style.display = 'none';
            DOM.scannerMainActions.style.display = 'none';
            DOM.scannerSim.style.display = 'flex';
            DOM.presetSelector.style.display = 'none';
            DOM.simForest.style.backgroundImage = `url('${event.target.result}')`;
            DOM.simForest.style.display = 'block';
            DOM.webcamPreview.style.display = 'none';
            DOM.scanStatusText.textContent = "Imatge carregada correctament.";
            
            document.getElementById('scanner-block').scrollIntoView({ behavior: 'smooth' });
            
            setTimeout(() => {
                let recommendedPlant = null;
                const fileNameLower = file.name.toLowerCase();
                
                for (let h of state.herbes) {
                    if (fileNameLower.includes(h.nom_comu.toLowerCase())) {
                        recommendedPlant = h.nom_comu;
                        break;
                    }
                }
                
                // Si té paraules de fallida o no coincideix amb res
                if (fileNameLower.includes('desconegut') || fileNameLower.includes('desconeguda') || fileNameLower.includes('unknown') || fileNameLower.includes('planta_nova')) {
                    recommendedPlant = 'Desconeguda';
                }
                
                runAnalysisSequence(recommendedPlant);
            }, 1000);
        };
        reader.readAsDataURL(file);
    }

    function stopScanningSimulation() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
        }
        DOM.webcamPreview.srcObject = null;
        
        DOM.scannerSim.style.display = 'none';
        DOM.fileInput.value = '';
        DOM.scannerMainActions.style.display = 'flex';
    }

    function resetScannerState() {
        stopScanningSimulation();
        DOM.scannerResultFailed.style.display = 'none';
        DOM.scannerMainActions.style.display = 'flex';
    }

    function runAnalysisSequence(forcedPlantName) {
        const statuses = [
            "Sincronitzant espectrometria...",
            "Analitzant morfologia de la fulla...",
            "Identificant estructura de la flor...",
            "Cercant coincidències a l'arxiu..."
        ];

        let idx = 0;
        const interval = setInterval(() => {
            if (idx < statuses.length) {
                DOM.scanStatusText.textContent = statuses[idx];
                idx++;
            } else {
                clearInterval(interval);
                completeIdentification(forcedPlantName);
            }
        }, 600);
    }

    function completeIdentification(plantName) {
        // Aturar stream de càmera primer
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
        }
        DOM.webcamPreview.srcObject = null;

        // Cas A: Hem forçat planta desconeguda
        if (plantName === 'Desconeguda') {
            DOM.scannerSim.style.display = 'none';
            DOM.failPreviewImg.style.backgroundImage = `url('${state.currentScanImage}')`;
            DOM.failNotes.value = '';
            DOM.scannerResultFailed.style.display = 'block';
            return;
        }

        let selectedHerba = null;
        if (plantName) {
            selectedHerba = state.herbes.find(h => h.nom_comu.toLowerCase() === plantName.toLowerCase());
        }

        // Probabilitat del 15% de fallar si es fa a l'atzar amb la càmera real/virtual
        if (!plantName && Math.random() < 0.15) {
            DOM.scannerSim.style.display = 'none';
            DOM.failPreviewImg.style.backgroundImage = `url('${state.currentScanImage}')`;
            DOM.failNotes.value = '';
            DOM.scannerResultFailed.style.display = 'block';
            return;
        }

        // Selecció aleatòria d'herbes conegudes si no ve forçada per un botó preset
        if (!selectedHerba) {
            const populars = ["Farigola", "Romaní", "Orenga", "Malva", "Saüc", "Dent de lleó", "Rosella"];
            const randomName = populars[Math.floor(Math.random() * populars.length)];
            selectedHerba = state.herbes.find(h => h.nom_comu === randomName);
        }

        if (!selectedHerba) {
            selectedHerba = state.herbes[0];
        }

        // Cerca la família provant diferents variants de columnes que pot retornar el núvol/Supabase
        const familiaDetectada = selectedHerba.familia || 
                         selectedHerba.familia_botanica || 
                         selectedHerba.Familia || 
                         "Família no determinada";
        
        // Canviem temporalment el text del visor per mostrar la classificació taxonòmica intermèdia
        DOM.scanStatusText.style.color = "var(--color-accent)";
        DOM.scanStatusText.textContent = `🧬 CLASSIFICACIÓ: Família ${familiaDetectada}...`;

        // Retardem la resolució final 1,2 segons per donar l'efecte òptic de classificació en dos passos
        setTimeout(() => {
            resetScannerState();

            const matchPercent = Math.floor(Math.random() * 8) + 91;
            
            // Notificació premium on es detalla primer la família i després l'espècie
            showToast(`📊 [${familiaDetectada}] -> Espècie: ${selectedHerba.nom_comu} (${matchPercent}% Coincidència)`);
            
            setTimeout(() => {
                openBotanicalDrawer(selectedHerba);
            }, 400);
            
        }, 1200); 
    }

    // --- 17. RUTINA PER DESAR PLANTA DESCONEGUDA (L'HERBARI) ---
    function saveUnidentifiedHerb() {
        const notes = DOM.failNotes.value.trim() || "Mostra trobada al Montseny pendent d'identificar.";
        const date = new Date().toLocaleDateString('ca-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const newPendentItem = {
            id: 'pendent_' + Date.now(),
            date: date,
            image: state.currentScanImage || 'imatges/fonsWeb.jpeg',
            notes: notes
        };

        // Llegir existents
        const currentItems = JSON.parse(localStorage.getItem('herbari_pendents') || '[]');
        currentItems.unshift(newPendentItem); // Afegir al principi de la llista
        localStorage.setItem('herbari_pendents', JSON.stringify(currentItems));

        // Tancar formulari
        resetScannerState();

        // Notificar i redirigir
        showToast("💾 S'ha afegit el nou espècimen al vostre Herbari de pendents!");
        updatePendentsCount();

        // Anar directament a la pestanya pendents per veure el resultat (UX premium)
        setTimeout(() => {
            const tabBtn = Array.from(DOM.tabBtns).find(b => b.getAttribute('data-tab') === 'pendents');
            if (tabBtn) tabBtn.click();
            document.querySelector('.explorer-section').scrollIntoView({ behavior: 'smooth' });
        }, 800);
    }

    // --- 18. INFOGRAFIA BOTÀNICA DINÀMICA (ESTIL S. XIX) ---
    function openBotanicalInfographic(herba) {
        const isToxic = isPlantToxic(herba);
        const infoModalOverlay = document.getElementById('info-modal-overlay');
        const botanicalSheetContent = document.getElementById('botanical-sheet-content');
        
        // Intentar carregar la làmina estàtica pre-generada en alta definició
        const staticImg = new Image();
        
        staticImg.onload = () => {
            // S'ha trobat la làmina estàtica, la carreguem a sang completa
            botanicalSheetContent.classList.add('is-static');
            botanicalSheetContent.innerHTML = `
                <img src="infografies/${herba.idHerba}.png" class="full-botanical-plate" alt="Il·lustració botànica de la ${herba.nom_comu}">
            `;
            activateModalControls();
        };

        staticImg.onerror = () => {
            // No s'ha trobat la làmina pre-generada, fem fallback al disseny dinàmic en SVG
            botanicalSheetContent.classList.remove('is-static');
            renderDynamicInfographic();
            activateModalControls();
        };

        // Engegar la càrrega asíncrona del fitxer
        staticImg.src = `infografies/${herba.idHerba}.png`;

        function activateModalControls() {
            // Activar visualment el modal a pantalla completa
            infoModalOverlay.classList.add('active');
            
            // Binds de control
            const btnClose = document.getElementById('btn-close-sheet');
            const btnPrint = document.getElementById('btn-print-sheet');
            
            btnClose.onclick = () => {
                infoModalOverlay.classList.remove('active');
            };
            
            btnPrint.onclick = () => {
                window.print();
            };
        }

        function renderDynamicInfographic() {
            // Determinar color de flor per als quadrants segons la família botànica
            let flowerColor = 'rgba(240, 240, 240, 0.35)';
            const fam = herba.familia ? herba.familia.toLowerCase() : '';
            const isRosella = herba.nom_comu.toLowerCase().includes('rosella');

            if (fam.includes('lamiàcia') || fam.includes('lamiacia')) {
                flowerColor = 'rgba(190, 160, 215, 0.4)';
            } else if (fam.includes('papaveràcia') || fam.includes('papaveracia')) {
                flowerColor = 'rgba(215, 80, 80, 0.45)';
            } else if (fam.includes('asteràcia') || fam.includes('asteracia')) {
                flowerColor = 'rgba(235, 200, 80, 0.48)';
            } else if (fam.includes('violàcia') || fam.includes('violacia')) {
                flowerColor = 'rgba(125, 100, 200, 0.42)';
            } else if (fam.includes('rosàcia') || fam.includes('rosacia')) {
                flowerColor = 'rgba(240, 215, 215, 0.38)';
            }

            // SVGs dinàmics de gran qualitat per als quadrants diagnòstics (detall botànic s. XIX)
            let svgA, svgB, svgC, svgD;

            if (isRosella) {
                // === QUADRANTS DE ROSELLA REALISTES (Papaver rhoeas) ===
                // Quadrant A: Fulla pinnatipartida lobulada i secció circular de la tija peluda
                svgA = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;" xmlns="http://www.w3.org/2000/svg">
                    <!-- Fulla pinnada clàssica de Rosella dentada -->
                    <path d="M 15,75 C 16,65 12,58 10,50 C 13,50 16,53 18,55 C 18,48 14,42 12,35 C 16,35 19,38 21,41 C 20,32 17,25 15,15 C 19,25 21,30 22,35 C 24,28 26,20 28,12 C 28,22 27,27 26,32 C 29,31 31,30 34,28 C 30,36 28,38 27,42 C 30,44 33,45 35,46 C 31,52 28,54 26,58 C 28,62 30,65 31,68 C 26,70 22,72 15,75 Z" stroke="#111612" stroke-width="0.85" fill="rgba(42, 88, 38, 0.14)" />
                    <path d="M 15,75 L 20,32" stroke="#111612" stroke-width="0.55" opacity="0.8" />
                    <path d="M 15,50 Q 18,52 23,54" stroke="#111612" stroke-width="0.4" fill="none" opacity="0.65" />
                    <path d="M 14,35 Q 18,37 22,39" stroke="#111612" stroke-width="0.4" fill="none" opacity="0.65" />
                    
                    <!-- Secció transversal circular de la tija pilosa amb pèls patents -->
                    <g transform="translate(68, 40)">
                        <circle cx="0" cy="0" r="14" fill="rgba(42, 88, 38, 0.1)" stroke="#111612" stroke-width="0.95" />
                        <circle cx="0" cy="0" r="6" stroke="#111612" stroke-width="0.55" stroke-dasharray="1, 1" fill="none" />
                        <circle cx="0" cy="-10" r="1.2" fill="#111612" />
                        <circle cx="0" cy="10" r="1.2" fill="#111612" />
                        <circle cx="-10" cy="0" r="1.2" fill="#111612" />
                        <circle cx="10" cy="0" r="1.2" fill="#111612" />
                        <circle cx="-7" cy="-7" r="1" fill="#111612" />
                        <circle cx="7" cy="-7" r="1" fill="#111612" />
                        <circle cx="-7" cy="7" r="1" fill="#111612" />
                        <circle cx="7" cy="7" r="1" fill="#111612" />
                        
                        <line x1="0" y1="-14" x2="0" y2="-19" stroke="#111612" stroke-width="0.5" />
                        <line x1="-5" y1="-13" x2="-8" y2="-17" stroke="#111612" stroke-width="0.5" />
                        <line x1="5" y1="-13" x2="8" y2="-17" stroke="#111612" stroke-width="0.5" />
                        <line x1="-14" y1="0" x2="-19" y2="0" stroke="#111612" stroke-width="0.5" />
                        <line x1="-13" y1="-5" x2="-17" y2="-8" stroke="#111612" stroke-width="0.5" />
                        <line x1="-13" y1="5" x2="-17" y2="8" stroke="#111612" stroke-width="0.5" />
                        <line x1="14" y1="0" x2="19" y2="0" stroke="#111612" stroke-width="0.5" />
                        <line x1="13" y1="-5" x2="17" y2="-8" stroke="#111612" stroke-width="0.5" />
                        <line x1="13" y1="5" x2="17" y2="8" stroke="#111612" stroke-width="0.5" />
                        <line x1="0" y1="14" x2="0" y2="19" stroke="#111612" stroke-width="0.5" />
                        <line x1="-5" y1="13" x2="-8" y2="17" stroke="#111612" stroke-width="0.5" />
                        <line x1="5" y1="13" x2="8" y2="17" stroke="#111612" stroke-width="0.5" />
                        
                        <text x="0" y="-21" font-size="4.5" font-style="italic" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Pèls patents</text>
                        <text x="0" y="25" font-size="4.8" font-weight="700" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Secció tija</text>
                    </g>
                    <text x="28" y="70" font-size="4.2" font-style="italic" font-family="var(--font-serif)" fill="#111612">Fulla caulinar</text>
                    <line x1="28" y1="65" x2="22" y2="52" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="22" cy="52" r="0.8" fill="#111612" />
                </svg>`;

                // Quadrant B: Estructura de la flor en secció longitudinal amb ovari central verd i calze caduc
                svgB = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;" xmlns="http://www.w3.org/2000/svg">
                    <path d="M 12,50 C 10,25 35,15 50,15 C 65,15 90,25 88,50 C 80,62 60,65 50,65 C 40,65 20,62 12,50 Z" fill="${flowerColor}" stroke="none" />
                    <path d="M 15,48 C 14,28 36,18 50,18 C 64,18 86,28 85,48" stroke="#111612" stroke-width="0.75" fill="none" opacity="0.55" />
                    <path d="M 45,70 Q 50,56 50,54 Q 50,56 55,70" stroke="#111612" stroke-width="1.2" fill="none" />
                    <path d="M 44,56 C 47,56 53,56 56,56" stroke="#111612" stroke-width="0.85" />
                    
                    <ellipse cx="50" cy="42" rx="7.5" ry="9" fill="rgba(42, 88, 38, 0.22)" stroke="#111612" stroke-width="0.9" />
                    <path d="M 40,34 Q 50,32 60,34 Q 60,36 50,36 Q 40,36 40,34 Z" stroke="#111612" stroke-width="0.95" fill="rgba(42, 88, 38, 0.35)" />
                    <line x1="50" y1="34" x2="50" y2="51" stroke="#111612" stroke-width="0.55" stroke-dasharray="1,1" />
                    <line x1="47" y1="35" x2="44" y2="48" stroke="#111612" stroke-width="0.45" stroke-dasharray="1,1" opacity="0.7" />
                    <line x1="53" y1="35" x2="56" y2="48" stroke="#111612" stroke-width="0.45" stroke-dasharray="1,1" opacity="0.7" />
                    
                    <path d="M 38,50 Q 38,40 42,42" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="38" cy="50" r="0.8" fill="#111612" />
                    <path d="M 40,46 Q 41,38 43,40" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="40" cy="46" r="0.8" fill="#111612" />
                    <path d="M 37,42 Q 42,35 44,38" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="37" cy="42" r="0.8" fill="#111612" />
                    <path d="M 62,50 Q 62,40 58,42" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="62" cy="50" r="0.8" fill="#111612" />
                    <path d="M 60,46 Q 59,38 57,40" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="60" cy="46" r="0.8" fill="#111612" />
                    <path d="M 63,42 Q 58,35 56,38" stroke="#111612" stroke-width="0.5" fill="none" />
                    <circle cx="63" cy="42" r="0.8" fill="#111612" />
                    
                    <g transform="translate(32, 60) rotate(-25)">
                        <path d="M -4,-8 C -4,-1 4,-1 4,-8 C 4,-15 -4,-15 -4,-8" stroke="#111612" stroke-width="0.75" fill="rgba(42, 88, 38, 0.12)" />
                        <line x1="-4" y1="-8" x2="-7" y2="-9" stroke="#111612" stroke-width="0.4" />
                        <line x1="4" y1="-8" x2="7" y2="-9" stroke="#111612" stroke-width="0.4" />
                        <line x1="-2" y1="-14" x2="-4" y2="-17" stroke="#111612" stroke-width="0.4" />
                    </g>

                    <text x="50" y="29" font-size="4.2" font-style="italic" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Disc estigmàtic</text>
                    <text x="12" y="66" font-size="4.2" font-style="italic" font-family="var(--font-serif)" fill="#111612">Sèpal caduc</text>
                    <line x1="24" y1="64" x2="30" y2="60" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="30" cy="60" r="0.8" fill="#111612" />
                    
                    <text x="88" y="66" font-size="4.2" font-style="italic" font-family="var(--font-serif)" text-anchor="end" fill="#111612">Androceu (estams)</text>
                    <line x1="68" y1="64" x2="62" y2="48" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="62" cy="48" r="0.8" fill="#111612" />
                    
                    <text x="50" y="76" font-size="4.8" font-weight="700" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Secció longitudinal flor</text>
                </svg>`;

                // Quadrant C: Càpsula poricida típica (caparró) i detalls de llavors reniformes reticulades
                svgC = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;" xmlns="http://www.w3.org/2000/svg">
                    <g transform="translate(30, 42)">
                        <path d="M 0,32 L 0,16" stroke="#111612" stroke-width="1.1" />
                        <path d="M -8,16 C -12,12 -12,-8 -7,-12 C -2,-12 2,-12 7,-12 C 12,-8 12,12 8,16 Z" stroke="#111612" stroke-width="0.9" fill="rgba(42, 88, 38, 0.15)" />
                        <path d="M -10,-12 C -7,-16 7,-16 10,-12 Z" stroke="#111612" stroke-width="0.9" fill="rgba(196, 172, 137, 0.3)" />
                        <path d="M -8,-12 Q 0,-14 8,-12" stroke="#111612" stroke-width="0.5" fill="none" />
                        <line x1="0" y1="-12" x2="0" y2="-15" stroke="#111612" stroke-width="0.5" />
                        <line x1="-4" y1="-12" x2="-3" y2="-14" stroke="#111612" stroke-width="0.5" />
                        <line x1="4" y1="-12" x2="3" y2="-14" stroke="#111612" stroke-width="0.5" />
                        
                        <ellipse cx="-5" cy="-8" rx="1.5" ry="1" fill="#111612" />
                        <ellipse cx="5" cy="-8" rx="1.5" ry="1" fill="#111612" />
                        <ellipse cx="0" cy="-9" rx="1.5" ry="1" fill="#111612" />
                        
                        <path d="M -7,8 C -9,4 -9,-4 -6,-8" stroke="#111612" stroke-width="0.45" stroke-dasharray="1,1" opacity="0.75" />
                        <path d="M -4,14 C -6,11 -6,4 -4,-2" stroke="#111612" stroke-width="0.45" stroke-dasharray="1,1" opacity="0.65" />
                        
                        <text x="0" y="24" font-size="4.8" font-weight="700" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Càpsula</text>
                    </g>
                    
                    <g transform="translate(72, 36)">
                        <path d="M -6,-6 C -11,-7 -13,0 -8,7 C -3,11 3,2 -2,-4 C -4,-6 -5,-5 -6,-6 Z" stroke="#111612" stroke-width="0.8" fill="rgba(196, 172, 137, 0.22)" />
                        <path d="M -9,0 Q -8,3 -6,4 M -10,-3 Q -7,-1 -5,0 M -8,-5 Q -6,-3 -4,-1" stroke="#111612" stroke-width="0.4" opacity="0.8" fill="none" />
                        <circle cx="-7.5" cy="1" r="0.3" fill="#111612" />
                        <circle cx="-5.5" cy="2" r="0.3" fill="#111612" />
                        
                        <path d="M 6,-2 C 3,-3 1,2 4,6 C 7,9 11,3 8,-1 C 7,-2 6,-1 6,-2 Z" stroke="#111612" stroke-width="0.65" fill="rgba(196, 172, 137, 0.16)" opacity="0.8" />
                        <path d="M 4,1 Q 5,3 7,4 M 3,-1 Q 5,1 7,2" stroke="#111612" stroke-width="0.35" opacity="0.65" fill="none" />
                        
                        <text x="0" y="26" font-size="4.8" font-weight="700" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Llavors reniformes</text>
                    </g>
                    <text x="4" y="26" font-size="4.2" font-style="italic" font-family="var(--font-serif)" fill="#111612">Porus</text>
                    <line x1="9" y1="28" x2="25" y2="34" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="25" cy="34" r="0.8" fill="#111612" />
                </svg>`;

                // Quadrant D: Sistema radicular vertical axonomorfa esvelta i roseta basal
                svgD = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;" xmlns="http://www.w3.org/2000/svg">
                    <path d="M 12,25 C 25,23 45,26 88,24" stroke="#111612" stroke-width="0.9" stroke-linecap="round" fill="none" />
                    <line x1="20" y1="28" x2="25" y2="28" stroke="#111612" stroke-width="0.45" />
                    <line x1="38" y1="29" x2="42" y2="29" stroke="#111612" stroke-width="0.45" />
                    <line x1="65" y1="28" x2="72" y2="28" stroke="#111612" stroke-width="0.45" />
                    
                    <path d="M 50,25 C 50,30 49,36 47,44 C 45,52 46,62 44,75" stroke="#111612" stroke-width="1.95" fill="none" stroke-linecap="round" />
                    <path d="M 50,25 C 51,32 50,38 48,46 C 46,54 47,64 45,75" stroke="#111612" stroke-width="0.55" fill="none" stroke-linecap="round" opacity="0.5" />
                    
                    <path d="M 49,36 Q 40,42 35,46" stroke="#111612" stroke-width="0.65" fill="none" stroke-linecap="round" />
                    <path d="M 47,44 Q 58,52 64,56" stroke="#111612" stroke-width="0.65" fill="none" stroke-linecap="round" />
                    <path d="M 46,55 Q 36,60 30,66" stroke="#111612" stroke-width="0.5" fill="none" stroke-linecap="round" />
                    <path d="M 45,63 Q 54,68 59,73" stroke="#111612" stroke-width="0.5" fill="none" stroke-linecap="round" />
                    
                    <path d="M 35,46 Q 32,52 28,55" stroke="#111612" stroke-width="0.38" fill="none" />
                    <path d="M 64,56 Q 67,62 70,64" stroke="#111612" stroke-width="0.38" fill="none" />
                    <path d="M 30,66 Q 28,72 24,75" stroke="#111612" stroke-width="0.38" fill="none" />
                    
                    <path d="M 50,25 C 44,24 38,20 32,16 C 36,21 42,23 50,25" stroke="#111612" stroke-width="0.75" fill="rgba(42, 88, 38, 0.12)" />
                    <path d="M 50,25 C 56,24 62,20 68,16 C 64,21 58,23 50,25" stroke="#111612" stroke-width="0.75" fill="rgba(42, 88, 38, 0.12)" />
                    <path d="M 50,25 C 48,22 45,15 46,8 C 49,14 50,20 50,25" stroke="#111612" stroke-width="0.75" fill="rgba(42, 88, 38, 0.15)" />
                    
                    <ellipse cx="50" cy="50" rx="14" ry="22" fill="rgba(196, 172, 137, 0.12)" stroke="none" />

                    <text x="24" y="44" font-size="4.2" font-style="italic" font-family="var(--font-serif)" fill="#111612">Roseta basal</text>
                    <line x1="34" y1="41" x2="43" y2="20" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="43" cy="20" r="0.8" fill="#111612" />
                    
                    <text x="76" y="44" font-size="4.2" font-style="italic" font-family="var(--font-serif)" fill="#111612">Arrel vertical</text>
                    <line x1="75" y1="46" x2="47" y2="52" stroke="#111612" stroke-width="0.3" stroke-dasharray="1,1" />
                    <circle cx="47" cy="52" r="0.8" fill="#111612" />
                    
                    <text x="50" y="78" font-size="5" font-weight="700" font-family="var(--font-serif)" text-anchor="middle" fill="#111612">Arrel axonomorfa</text>
                </svg>`;
            } else {
                // === QUADRANTS GENÈRICS MILLORATS PER A ALTRES HERBES ===
                svgA = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;">
                    <path d="M 25,75 C 20,60 22,50 16,42 Q 22,37 18,30 Q 24,25 25,12 Q 26,25 32,30 Q 28,37 34,42 C 28,50 30,60 25,75" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.12)" />
                    <path d="M 25,75 L 25,15" stroke="#111612" stroke-width="0.5" opacity="0.8" />
                    <path d="M 50,75 C 46,62 48,52 42,45 Q 47,40 44,34 Q 49,30 50,18 Q 51,30 56,34 Q 53,40 58,45 C 52,52 54,62 50,75" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.08)" />
                    <path d="M 50,75 L 50,20" stroke="#111612" stroke-width="0.5" opacity="0.8" />
                    <g transform="translate(75, 42)">
                        <rect x="-12" y="-12" width="24" height="24" rx="5" ry="5" stroke="#111612" stroke-width="0.8" fill="none" />
                        <rect x="-8" y="-8" width="16" height="16" rx="3" ry="3" stroke="#111612" stroke-width="0.5" fill="rgba(42, 88, 38, 0.16)" stroke-dasharray="1, 1" />
                        <circle cx="0" cy="0" r="2" fill="#111612" />
                        <text x="0" y="21" font-size="5" font-family="var(--font-sans)" font-weight="700" text-anchor="middle" fill="#111612">Secció tija</text>
                    </g>
                </svg>`;

                svgB = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;">
                    <path d="M 50,70 C 47,56 42,54 42,42 C 42,32 58,32 58,42 C 58,54 53,56 50,70" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.12)" />
                    <path d="M 28,40 Q 32,50 38,58" stroke="#111612" stroke-width="0.6" fill="none" />
                    <ellipse cx="28" cy="40" rx="2" ry="1" fill="#111612" />
                    <path d="M 72,40 Q 68,50 62,58" stroke="#111612" stroke-width="0.6" fill="none" />
                    <ellipse cx="72" cy="40" rx="2" ry="1" fill="#111612" />
                    <path d="M 18,55 Q 12,25 35,20 Q 50,15 65,20 Q 88,25 82,55 Z" stroke="#111612" stroke-width="0.8" fill="${flowerColor}" />
                    <path d="M 50,70 L 50,42" stroke="#111612" stroke-width="0.5" stroke-dasharray="1,1" />
                </svg>`;

                svgC = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;">
                    <g transform="translate(30, 40)">
                        <path d="M -8,15 L -8,5 C -15,2 -15,-12 -8,-14 C -1,-12 -1,-12 6,-14 C 6,-12 6,2 -1,5 L -1,15" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.1)" />
                        <path d="M -13,-14 C -10,-20 3,-20 5,-14 Z" stroke="#111612" stroke-width="0.8" fill="rgba(196, 172, 137, 0.25)" />
                        <text x="-2" y="24" font-size="5" font-family="var(--font-sans)" font-weight="700" text-anchor="middle" fill="#111612">Càpsula</text>
                    </g>
                    <g transform="translate(72, 36)">
                        <path d="M -6,-5 C -10,-5 -12,2 -6,8 C 0,10 2,0 -6,-5 Z" stroke="#111612" stroke-width="0.6" fill="rgba(111, 22, 18, 0.15)" />
                        <path d="M 6,-2 C 2,-2 0,5 6,11 C 12,13 14,3 6,-2 Z" stroke="#111612" stroke-width="0.6" fill="rgba(111, 22, 18, 0.15)" />
                        <text x="0" y="27" font-size="5" font-family="var(--font-sans)" font-weight="700" text-anchor="middle" fill="#111612">Detall llavors</text>
                    </g>
                </svg>`;

                svgD = `
                <svg viewBox="0 0 100 80" width="100%" height="80" style="margin-bottom: 8px;">
                    <path d="M 20,40 Q 50,30 80,45" stroke="#111612" stroke-width="2" fill="none" stroke-linecap="round" />
                    <path d="M 30,37 Q 25,65 20,72" stroke="#111612" stroke-width="0.8" fill="none" />
                    <path d="M 50,35 Q 52,68 45,75" stroke="#111612" stroke-width="0.8" fill="none" />
                    <path d="M 68,40 Q 72,60 76,68" stroke="#111612" stroke-width="0.7" fill="none" />
                    <path d="M 22,38 Q 50,28 78,43" stroke="#111612" stroke-width="0.5" stroke-dasharray="1,2" fill="none" />
                    <text x="50" y="20" font-size="5.5" font-family="var(--font-sans)" font-weight="700" text-anchor="middle" fill="#111612">Rizoma i arrels</text>
                </svg>`;
            }

            // Processar textos de quadrants amb fallbacks segurs i professionals
            const rootsText = herba.arrels && herba.arrels.trim() !== '' 
                ? herba.arrels 
                : (isRosella ? "Arrel axonomorfa llarga, prima i esvelta amb fines arrels secundàries fibroses." : "Rizoma subterrani o eix radicular persistent amb ramificacions secundàries.");
                
            const fruitsText = (herba.fruits || herba.llavors) 
                ? `${herba.fruits || ''} ${herba.llavors || ''}`.trim() 
                : (isRosella ? "Càpsula poricida madura (caparró) que conté nombroses llavors microscòpiques reniformes reticulades dispersades pels porus." : "Càpsula o aqueni indehiscent contenint llavors microscòpiques dispersades pel vent.");

            // Text d'explicació de toxicitat a la base estil segle XIX
            let safetyWarningHTML = '';
            if (isToxic) {
                const warningText = (herba.toxicitat && herba.toxicitat.trim() !== '') 
                    ? herba.toxicitat.toUpperCase() 
                    : "PLANTA ALTAMENT TÒXICA. EVITAR ÚS CASOLÀ DIRECTE.";
                safetyWarningHTML = `
                    <div class="safety-warning-base">
                        ⚠️ ALERTA: ${warningText}
                    </div>
                `;
            }

            const baseRootLabelText = isRosella 
                ? "Arrel axonomorfa (Sistema de fixació)" 
                : "Rizoma i fixació (Arrels fibroses)";

            // Estructurar el contingut complet de la làmina botànica s. XIX
            botanicalSheetContent.innerHTML = `
                <div class="sheet-grid">
                    <!-- COLUMNA ESQUERRA (Box A i Box D) -->
                    <div class="sheet-col">
                        <div class="sheet-quadrant">
                            <h3 class="quadrant-title">A. 1. DETALL DE LES FULLES I TIJA</h3>
                            ${svgA}
                            <p class="quadrant-text">
                                <strong>Fulles:</strong> ${herba.descripcio_fulla || "Llanolada o dentada, amb disposició diagnòstica de camp."}<br>
                                <strong>Tija:</strong> ${herba.descripcio_tija || "Tiges erectes o prostrades."}
                            </p>
                        </div>
                        <div class="sheet-quadrant">
                            <h3 class="quadrant-title">D. 4. SISTEMA RADICULAR I REBROTS (Arrels)</h3>
                            ${svgD}
                            <p class="quadrant-text">${rootsText}</p>
                        </div>
                    </div>
                    
                    <!-- COLUMNA CENTRAL -->
                    <div class="sheet-center-col">
                        <div class="sheet-title-container" style="text-align: left; border-bottom: 2px double #111612; padding-bottom: 6px; margin-bottom: 15px; width: 100%;">
                            <h1 class="sheet-title" style="font-size: 1.6rem; font-weight: 800; line-height: 1.1; margin: 0; color: #111612; font-family: var(--font-serif);">IL·LUSTRACIÓ BOTÀNICA DE<br>LA ${herba.nom_comu.toUpperCase()}</h1>
                            <div class="sheet-scientific" style="font-size: 1.1rem; font-style: italic; margin-top: 3px; color: #222a23; font-family: var(--font-serif);">(${herba.nom_cientific})</div>
                        </div>

                        <div class="family-watermark">${herba.family || herba.familia}</div>
                        ${generateBotanicalSVG(herba)}
                        ${isToxic ? '<div class="skull-circle" title="Espècie altament tòxica">💀</div>' : ''}
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 15px; border-top: 0.8px solid #111612; padding-top: 8px; font-size: 0.68rem; font-weight: 700; font-family: var(--font-sans);">
                            <div style="display: flex; align-items: center; gap: 4px; color: #333d35;">
                                <span style="font-size: 0.75rem;">🌱</span>
                                <span>${baseRootLabelText}</span>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 1px;">
                                <span style="font-size: 0.6rem; color: #5e6b60;">Mida real</span>
                                <div style="display: flex; border: 0.8px solid #111612; height: 5px; width: 70px; background: #ffffff;">
                                    <div style="width: 17px; background: #111612;"></div>
                                    <div style="width: 18px; background: #ffffff;"></div>
                                    <div style="width: 17px; background: #111612;"></div>
                                    <div style="width: 18px; background: #ffffff;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- COLUMNA DRETA -->
                    <div class="sheet-col">
                        <div class="sheet-quadrant">
                            <h3 class="quadrant-title">B. 2. ESTRUCTURA DE LA FLOR I CALZE</h3>
                            ${svgB}
                            <p class="quadrant-text">
                                <strong>Detalls florals:</strong> ${herba.descripcio_flor || "Peces florals completes amb estructura diagnòstica."}<br>
                                <strong>Inflorescència:</strong> ${herba.inflorescencia || "Flor típica en corimbes o umbel·les."}
                            </p>
                        </div>
                        <div class="sheet-quadrant">
                            <h3 class="quadrant-title">C. 3. DETALL DE L'ESTRUCTURA FRUIT I ESPORES</h3>
                            ${svgC}
                            <p class="quadrant-text">
                                ${fruitsText}
                            </p>
                            ${safetyWarningHTML}
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // --- 19. GENERADOR DE DIBUIX BOTÀNIC DINÀMIC (SVG DE LÀMINA CIENTÍFICA) ---
    function generateBotanicalSVG(herba) {
        let flowerColor = 'rgba(240, 240, 240, 0.35)'; // Fons aquarel·la per defecte (blanc)
        let flowerStroke = '#3a4a3e';
        const isRosella = herba.nom_comu.toLowerCase().includes('rosella');
        const fam = herba.familia ? herba.familia.toLowerCase() : '';
        
        let isLamiacia = fam.includes('lamiàcia') || fam.includes('lamiacia') || fam.includes('labiada');
        let isAsteracia = fam.includes('asteràcia') || fam.includes('asteracia') || fam.includes('composta');
        let isApiacia = fam.includes('apiàcia') || fam.includes('apiacia') || fam.includes('umbel·l');
        let isRosacia = fam.includes('rosàcia') || fam.includes('rosacia') || fam.includes('rosaceae');
        
        // Colors plans aquarel·lats dessaturats dinàmics segons família botànica
        if (isLamiacia) {
            flowerColor = 'rgba(190, 160, 215, 0.45)'; // Púrpura dessaturat
            flowerStroke = '#5b3d72';
        } else if (isRosella) {
            flowerColor = 'rgba(215, 80, 80, 0.52)'; // Vermell escarlata Rosella
            flowerStroke = '#842626';
        } else if (isAsteracia) {
            flowerColor = 'rgba(235, 200, 80, 0.5)'; // Groc botànic Asteràcia
            flowerStroke = '#82681a';
        } else if (isApiacia) {
            flowerColor = 'rgba(245, 242, 235, 0.6)'; // Blanc crema lluminós
            flowerStroke = '#6b665c';
        } else if (isRosacia) {
            flowerColor = 'rgba(240, 215, 215, 0.45)'; // Rosat o groc daurat
            if (herba.nom_comu.toLowerCase().includes('agrimoni')) {
                flowerColor = 'rgba(235, 215, 60, 0.52)'; // Groc Agrimoni!
                flowerStroke = '#8c7816';
            } else {
                flowerStroke = '#755c5c';
            }
        }
        
        let svg = `<svg class="svg-illustration" viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style="font-family: var(--font-serif); fill: #111612;">`;
        
        // Afegir patrons de gravat hatching per a ombrejat botànic antiga
        svg += `
        <defs>
            <pattern id="hatching" width="5" height="5" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="0" y2="5" stroke="#111612" stroke-width="0.4" opacity="0.25" />
            </pattern>
            <pattern id="hatching-dense" width="3" height="3" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="0" y2="3" stroke="#111612" stroke-width="0.38" opacity="0.32" />
            </pattern>
        </defs>`;
        
        // 1. SISTEMA RADICULAR O DE BASE A TINTA
        if (isRosella || isAsteracia) {
            // Arrel axonomorfa vertical de gravat
            svg += `
            <path d="M 180,380 C 180,380 178,410 172,445 C 170,455 168,465 166,478" stroke="#111612" stroke-width="2.5" fill="none" stroke-linecap="round" />
            <path d="M 180,385 C 182,402 181,422 177,445" stroke="#111612" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.6" />
            <path d="M 176,412 Q 164,420 156,424" stroke="#111612" stroke-width="0.8" fill="none" />
            <path d="M 174,428 Q 186,436 192,442" stroke="#111612" stroke-width="0.6" fill="none" />
            <path d="M 170,448 Q 160,456 154,462" stroke="#111612" stroke-width="0.5" fill="none" />
            <ellipse cx="176" cy="410" rx="14" ry="10" fill="rgba(196, 172, 137, 0.16)" stroke="none" />
            `;
        } else {
            // Rizoma curt o ramificat a ploma per a Lamiàcies, Rosàcies i Apiàcies
            svg += `
            <path d="M 150,405 C 170,400 180,395 210,408" stroke="#111612" stroke-width="3" fill="none" stroke-linecap="round" />
            <path d="M 175,400 Q 170,432 162,468" stroke="#111612" stroke-width="1.6" fill="none" stroke-linecap="round" />
            <path d="M 188,402 Q 194,435 202,464" stroke="#111612" stroke-width="1.4" fill="none" stroke-linecap="round" />
            <path d="M 160,403 Q 152,425 142,438" stroke="#111612" stroke-width="0.9" fill="none" stroke-linecap="round" />
            <ellipse cx="178" cy="410" rx="25" ry="12" fill="rgba(196, 172, 137, 0.18)" stroke="none" />
            `;
        }

        // 2. DISSENY D'IL·LUSTRACIÓ CENTRAL SEGONS LA FAMÍLIA
        if (isRosella) {
            // === ROSELLA ===
            svg += `
            <!-- Tiges de la Rosella (piloses, fines i esveltes) -->
            <!-- Tija central de la flor oberta -->
            <path d="M 180,380 C 180,280 160,180 190,95" stroke="#111612" stroke-width="1.8" fill="none" stroke-linecap="round" />
            <!-- Tija del capoll esquerre (flàcid, drooping bud) -->
            <path d="M 175,290 C 160,260 135,220 148,165 C 150,155 158,150 162,158 C 165,165 158,185 154,198" stroke="#111612" stroke-width="1.2" fill="none" stroke-linecap="round" />
            <!-- Tija del capoll dret (drooping bud) -->
            <path d="M 185,260 C 200,220 180,185 188,150 C 190,140 198,138 202,146 C 205,152 198,170 194,185" stroke="#111612" stroke-width="1.2" fill="none" stroke-linecap="round" />
            
            <!-- Pèls patents del gravat a la tija -->
            <path d="M 173,340 L 169,340 M 174,320 L 170,320 M 172,295 L 168,295 M 171,270 L 167,270 M 165,250 L 161,250 M 160,220 L 156,220" stroke="#111612" stroke-width="0.5" />
            <path d="M 183,350 L 187,350 M 181,330 L 185,330 M 177,280 L 181,280 M 175,245 L 179,245 M 177,210 L 181,210" stroke="#111612" stroke-width="0.5" />

            <!-- Capoll esquerre drooping (acoblat a la tija 154, 198) -->
            <g transform="translate(154, 198) rotate(15)">
                <ellipse cx="0" cy="8" rx="8" ry="12" fill="rgba(42, 88, 38, 0.15)" stroke="none" />
                <path d="M -8,8 C -8,-4 8,-4 8,8 C 8,20 -8,20 -8,8 Z" stroke="#111612" stroke-width="0.8" fill="none" />
                <!-- Petals vermells sortint de l'esquerda -->
                <path d="M -4,15 C -4,22 4,22 4,15 Z" fill="rgba(215, 80, 80, 0.6)" stroke="#111612" stroke-width="0.5" />
                <!-- Pèls del capoll -->
                <path d="M -8,4 L -11,2 M -7,12 L -10,13 M 8,4 L 11,2 M 7,12 L 10,13 M 0,20 L 0,23" stroke="#111612" stroke-width="0.5" />
            </g>
            
            <!-- Capoll dret drooping (acoblat a la tija 194, 185) -->
            <g transform="translate(194, 185) rotate(-10)">
                <ellipse cx="0" cy="8" rx="7" ry="11" fill="rgba(42, 88, 38, 0.15)" stroke="none" />
                <path d="M -7,8 C -7,-3 7,-3 7,8 C 7,19 -7,19 -7,8 Z" stroke="#111612" stroke-width="0.8" fill="none" />
                <path d="M -7,4 L -10,2 M 7,4 L 10,2 M 0,19 L 0,22" stroke="#111612" stroke-width="0.5" />
            </g>

            <!-- Càpsules verticals de fruits (Papaver) -->
            <g transform="translate(166, 110) rotate(-15)">
                <path d="M 0,45 L 0,0" stroke="#111612" stroke-width="0.8" />
                <path d="M -5,0 C -5,-6 5,-6 5,0 C 5,6 -5,6 -5,0 Z" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.1)" />
                <path d="M -8,-2 C -6,-5 6,-5 8,-2 Z" stroke="#111612" stroke-width="0.8" fill="rgba(196, 172, 137, 0.3)" />
            </g>
            <g transform="translate(215, 120) rotate(10)">
                <path d="M 0,55 L 0,0" stroke="#111612" stroke-width="0.8" />
                <path d="M -4,0 C -4,-5 4,-5 4,0 C 4,5 -4,5 -4,0 Z" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.1)" />
                <path d="M -7,-2 C -5,-4 5,-4 7,-2 Z" stroke="#111612" stroke-width="0.8" fill="rgba(196, 172, 137, 0.3)" />
            </g>

            <!-- Flor oberta gran superior de la Rosella (acoblada a 190, 95) -->
            <g transform="translate(190, 95)">
                <!-- Aquarel·la vermella vibrant plana dessaturada -->
                <circle cx="-12" cy="-12" r="22" fill="rgba(215, 80, 80, 0.42)" stroke="none" />
                <circle cx="12" cy="-12" r="22" fill="rgba(215, 80, 80, 0.42)" stroke="none" />
                <circle cx="-2" cy="12" r="22" fill="rgba(215, 80, 80, 0.45)" stroke="none" />
                <circle cx="0" cy="-6" r="16" fill="rgba(215, 80, 80, 0.5)" stroke="none" />
                
                <!-- Petals (gravat d'esboç lineal a tinta) -->
                <!-- Petal superior esquerre -->
                <path d="M 0,-5 C -25,-25 -42,-10 -30,12 C -20,24 -5,8 0,-5 Z" stroke="#111612" stroke-width="0.9" fill="none" />
                <!-- Petal superior dret -->
                <path d="M 0,-5 C 25,-25 42,-10 30,12 C 20,24 5,8 0,-5 Z" stroke="#111612" stroke-width="0.9" fill="none" />
                <!-- Petal frontal gran -->
                <path d="M -30,12 C -28,38 28,38 30,12 C 15,4 -15,4 -30,12 Z" stroke="#111612" stroke-width="1" fill="none" />
                
                <!-- Hatching d'ombreig a tinta de gravat -->
                <path d="M -15,18 C -15,28 15,28 15,18" stroke="#111612" stroke-width="0.5" stroke-dasharray="1,1" />

                <!-- Centre fosc de la Rosella (capsula central + anteres negres) -->
                <ellipse cx="0" cy="2" rx="5" ry="6" fill="rgba(42, 88, 38, 0.3)" stroke="#111612" stroke-width="0.85" />
                <!-- Radi d'estigmes a la càpsula central -->
                <path d="M -4,2 L 4,2 M 0,-4 L 0,8 M -3,-1 L 3,5 M -3,5 L 3,-1" stroke="#111612" stroke-width="0.55" />
                
                <!-- Anteres negres al voltant -->
                <circle cx="-7" cy="2" r="1.2" fill="#111612" />
                <circle cx="7" cy="2" r="1.2" fill="#111612" />
                <circle cx="-5" cy="-4" r="1.2" fill="#111612" />
                <circle cx="5" cy="-4" r="1.2" fill="#111612" />
                <circle cx="-4" cy="7" r="1.2" fill="#111612" />
                <circle cx="4" cy="7" r="1.2" fill="#111612" />
                <circle cx="0" cy="-6" r="1.2" fill="#111612" />
                <circle cx="0" cy="9" r="1.2" fill="#111612" />
            </g>
            `;
        } 
        else if (isLamiacia) {
            // === LAMIÀCIES (Tiges verticals rígides, flors en verticils com Farigola/Romaní/Acant) ===
            svg += `
            <!-- Tija principal quadrangular i branques laterals -->
            <path d="M 180,380 C 180,300 178,200 180,80" stroke="#111612" stroke-width="2.5" fill="none" stroke-linecap="round" />
            <path d="M 180,310 C 150,270 135,230 120,200" stroke="#111612" stroke-width="1.4" fill="none" stroke-linecap="round" />
            <path d="M 180,270 C 210,230 225,190 235,160" stroke="#111612" stroke-width="1.4" fill="none" stroke-linecap="round" />
            
            <!-- Flors en verticils liles (Lamiàcia tipus) -->
            <!-- Verticil superior -->
            <g transform="translate(180, 95)">
                <ellipse cx="0" cy="0" rx="14" ry="10" fill="${flowerColor}" stroke="none" />
                <!-- Flors bilabiades detallades a tinta -->
                <path d="M -8,-4 C -12,-8 -14,-4 -12,0 C -10,4 -6,2 -8,-4 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M 0,-6 C 0,-12 4,-12 4,-6 C 4,-2 -2,-2 0,-6 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M 8,-4 C 12,-8 14,-4 12,0 C 10,4 6,2 8,-4 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M -5,-2 Q 0,-3 5,-2" stroke="#111612" stroke-width="0.5" fill="none" />
            </g>
            <!-- Verticil mig -->
            <g transform="translate(180, 150)">
                <ellipse cx="0" cy="0" rx="16" ry="11" fill="${flowerColor}" stroke="none" />
                <path d="M -10,-4 C -14,-8 -16,-4 -14,0 Q -8,4 -10,-4 Z" stroke="#111612" stroke-width="0.8" fill="none" />
                <path d="M 10,-4 C 14,-8 16,-4 14,0 Q 8,4 10,-4 Z" stroke="#111612" stroke-width="0.8" fill="none" />
                <circle cx="-2" cy="-4" r="1.5" stroke="#111612" stroke-width="0.6" fill="none" />
                <circle cx="2" cy="-4" r="1.5" stroke="#111612" stroke-width="0.6" fill="none" />
            </g>
            <!-- Verticil branques -->
            <g transform="translate(120, 200) rotate(-35)">
                <circle cx="0" cy="-6" r="9" fill="${flowerColor}" stroke="none" />
                <path d="M -4,-8 C -8,-10 -6,-4 -4,-2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
                <path d="M 4,-8 C 8,-10 6,-4 4,-2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
            </g>
            <g transform="translate(235, 160) rotate(35)">
                <circle cx="0" cy="-6" r="9" fill="${flowerColor}" stroke="none" />
                <path d="M -4,-8 C -8,-10 -6,-4 -4,-2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
            </g>
            `;
        }
        else if (isAsteracia) {
            // === ASTERÀCIES (Flors en capítol groc tipus margarida/dent de lleó) ===
            svg += `
            <!-- Tiges florals esveltes buides -->
            <path d="M 180,380 C 180,260 190,180 185,125" stroke="#111612" stroke-width="2" fill="none" stroke-linecap="round" />
            <path d="M 175,290 C 150,220 145,170 140,135" stroke="#111612" stroke-width="1.5" fill="none" stroke-linecap="round" />
            
            <!-- Involucre de bràctees sota el capítol floral -->
            <!-- Capítol central gran obert superior -->
            <g transform="translate(185, 125)">
                <ellipse cx="0" cy="2" rx="14" ry="7" fill="rgba(42, 88, 38, 0.22)" stroke="#111612" stroke-width="0.95" />
                <!-- Bràctees en imbricació (gravat lineal escatat) -->
                <path d="M -14,2 C -12,8 12,8 14,2 M -10,3 C -8,7 8,7 10,3 M -6,4 C -4,6 4,6 6,4" stroke="#111612" stroke-width="0.8" />
                
                <!-- Aquarel·la groga vibrant plana al fons dels pètals radials -->
                <circle cx="0" cy="-18" r="28" fill="${flowerColor}" stroke="none" />
                
                <!-- Pètals radials (flors lligulades) disposats radialment -->
                <path d="M -2,-2 C -3,-25 -10,-22 -1,-30 C 6,-22 2,-25 0,-2 Z" stroke="#111612" stroke-width="0.8" fill="none" />
                <path d="M -6,-1 C -12,-22 -20,-16 -12,-26 C -4,-18 -3,-18 -6,-1 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M 6,-1 C 12,-22 20,-16 12,-26 C 4,-18 3,-18 6,-1 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M -10,0 C -22,-15 -28,-6 -22,-18 C -14,-10 -9,-8 -10,0 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                <path d="M 10,0 C 22,-15 28,-6 22,-18 C 14,-10 9,-8 10,0 Z" stroke="#111612" stroke-width="0.75" fill="none" />
                
                <!-- Hatching dens al receptacle floral central -->
                <ellipse cx="0" cy="-6" rx="8" ry="4" fill="url(#hatching-dense)" stroke="#111612" stroke-width="0.7" />
            </g>
            
            <!-- Capítol secundari -->
            <g transform="translate(140, 135) rotate(-15)">
                <ellipse cx="0" cy="2" rx="10" ry="5" fill="rgba(42, 88, 38, 0.22)" stroke="#111612" stroke-width="0.8" />
                <circle cx="0" cy="-12" r="18" fill="${flowerColor}" stroke="none" />
                <path d="M -2,-2 C -3,-18 -8,-16 -1,-22 C 4,-16 2,-18 0,-2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
                <path d="M -5,-1 C -9,-16 -14,-12 -9,-20" stroke="#111612" stroke-width="0.65" fill="none" />
                <path d="M 5,-1 C 9,-16 14,-12 9,-20" stroke="#111612" stroke-width="0.65" fill="none" />
            </g>
            `;
        }
        else if (isApiacia) {
            // === APIÀCIES / UMBEL·LÍFERES (Inflorescència en umbel·la de flors blanques tipus Fonoll/Angelica) ===
            svg += `
            <!-- Tija central fistulosa molt erecta i llisa -->
            <path d="M 180,380 C 180,280 180,180 180,150" stroke="#111612" stroke-width="2.6" fill="none" stroke-linecap="round" />
            
            <!-- Radis de l'umbel·la central superior (en paraigua) -->
            <g transform="translate(180, 150)">
                <!-- Aquarel·la blanca-sorra en boles per al fons -->
                <circle cx="-35" cy="-45" r="15" fill="${flowerColor}" stroke="none" />
                <circle cx="0" cy="-55" r="17" fill="${flowerColor}" stroke="none" />
                <circle cx="35" cy="-45" r="15" fill="${flowerColor}" stroke="none" />
                
                <!-- Radis de ploma prims de l'umbel·la -->
                <line x1="0" y1="0" x2="-35" y2="-45" stroke="#111612" stroke-width="1" />
                <line x1="0" y1="0" x2="-18" y2="-52" stroke="#111612" stroke-width="1" />
                <line x1="0" y1="0" x2="0" y2="-55" stroke="#111612" stroke-width="1" />
                <line x1="0" y1="0" x2="18" y2="-52" stroke="#111612" stroke-width="1" />
                <line x1="0" y1="0" x2="35" y2="-45" stroke="#111612" stroke-width="1" />
                
                <!-- Involucre de bràctees reflexes a la base dels radis -->
                <path d="M -5,2 L -8,8 M 5,2 L 8,8 M 0,2 L 0,9" stroke="#111612" stroke-width="0.6" />
                
                <!-- Petites umbel·lules (umbellules) a cada extrem amb flors microscòpiques -->
                <g transform="translate(-35, -45)">
                    <line x1="0" y1="0" x2="-8" y2="-8" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="-2" y2="-10" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="4" y2="-9" stroke="#111612" stroke-width="0.5" />
                    <circle cx="-8" cy="-8" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="-2" cy="-10" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="4" cy="-9" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                </g>
                <g transform="translate(0, -55)">
                    <line x1="0" y1="0" x2="-7" y2="-9" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="0" y2="-11" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="7" y2="-9" stroke="#111612" stroke-width="0.5" />
                    <circle cx="-7" cy="-9" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="0" cy="-11" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="7" cy="-9" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                </g>
                <g transform="translate(35, -45)">
                    <line x1="0" y1="0" x2="-4" y2="-9" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="2" y2="-10" stroke="#111612" stroke-width="0.5" />
                    <line x1="0" y1="0" x2="8" y2="-8" stroke="#111612" stroke-width="0.5" />
                    <circle cx="-4" cy="-9" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="2" cy="-10" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                    <circle cx="8" cy="-8" r="1.5" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
                </g>
            </g>
            `;
        }
        else if (isRosacia) {
            // === ROSÀCIES (Agrimoni / flors de 5 pètals actinomorfes en espiga vertical) ===
            if (herba.nom_comu.toLowerCase().includes('agrimoni')) {
                svg += `
                <!-- Tiga en espiga prima vertical de l'Agrimoni -->
                <path d="M 180,380 C 180,280 180,180 180,70" stroke="#111612" stroke-width="2.0" fill="none" stroke-linecap="round" />
                <!-- branquetes laterals -->
                <path d="M 180,250 Q 192,230 205,215" stroke="#111612" stroke-width="0.8" fill="none" />
                
                <!-- Flors grogues de 5 pètals -->
                <g transform="translate(180, 95)">
                    <circle cx="0" cy="0" r="10" fill="${flowerColor}" stroke="none" />
                    <path d="M 0,-2 C -3,-6 3,-6 0,-2 Z M -2,0 C -6,-3 -6,3 -2,0 Z M 2,0 C 6,-3 6,3 2,0 Z M -2,2 C -5,5 1,6 -2,2 Z M 2,2 C 5,5 -1,6 2,2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
                    <circle cx="0" cy="0" r="1.2" fill="#111612" />
                </g>
                <g transform="translate(180, 140)">
                    <circle cx="0" cy="0" r="10" fill="${flowerColor}" stroke="none" />
                    <path d="M 0,-2 C -3,-6 3,-6 0,-2 Z M -2,0 C -6,-3 -6,3 -2,0 Z M 2,0 C 6,-3 6,3 2,0 Z M -2,2 C -5,5 1,6 -2,2 Z M 2,2 C 5,5 -1,6 2,2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
                    <circle cx="0" cy="0" r="1.2" fill="#111612" />
                </g>
                <g transform="translate(180, 190)">
                    <circle cx="0" cy="0" r="10" fill="${flowerColor}" stroke="none" />
                    <path d="M 0,-2 C -3,-6 3,-6 0,-2 Z M -2,0 C -6,-3 -6,3 -2,0 Z M 2,0 C 6,-3 6,3 2,0 Z M -2,2 C -5,5 1,6 -2,2 Z M 2,2 C 5,5 -1,6 2,2 Z" stroke="#111612" stroke-width="0.7" fill="none" />
                    <circle cx="0" cy="0" r="1.2" fill="#111612" />
                </g>
                <g transform="translate(205, 215)">
                    <circle cx="0" cy="0" r="8" fill="${flowerColor}" stroke="none" />
                    <circle cx="0" cy="0" r="0.9" fill="#111612" />
                </g>
                `;
            } else {
                svg += `
                <!-- Branca arbustiva llisa de Rosàcia -->
                <path d="M 180,380 C 180,280 170,180 190,110" stroke="#111612" stroke-width="2.3" fill="none" stroke-linecap="round" />
                <path d="M 178,280 Q 173,285 174,290" stroke="#111612" stroke-width="0.8" fill="none" />
                <path d="M 183,230 Q 188,235 186,240" stroke="#111612" stroke-width="0.8" fill="none" />
                
                <g transform="translate(190, 110)">
                    <circle cx="0" cy="0" r="26" fill="${flowerColor}" stroke="none" />
                    <path d="M 0,-4 C -12,-20 -28,-14 -20,0 C -12,12 -5,5 0,-4 Z" stroke="#111612" stroke-width="0.85" fill="none" />
                    <path d="M 0,-4 C 12,-20 28,-14 20,0 C 12,12 5,5 0,-4 Z" stroke="#111612" stroke-width="0.85" fill="none" />
                    <path d="M -20,0 C -32,12 -16,28 0,18 C 8,12 2,6 -20,0 Z" stroke="#111612" stroke-width="0.85" fill="none" />
                    <path d="M 20,0 C 32,12 16,28 0,18 C -8,12 -2,6 20,0 Z" stroke="#111612" stroke-width="0.85" fill="none" />
                    <path d="M 0,-4 C 0,-24 18,-24 15,-6" stroke="#111612" stroke-width="0.8" fill="none" />
                    
                    <circle cx="0" cy="2" r="5" fill="none" stroke="#111612" stroke-width="0.75" />
                    <circle cx="-3" cy="-2" r="0.8" fill="#111612" />
                    <circle cx="3" cy="-2" r="0.8" fill="#111612" />
                    <circle cx="-4" cy="4" r="0.8" fill="#111612" />
                    <circle cx="4" cy="4" r="0.8" fill="#111612" />
                    <circle cx="0" cy="7" r="0.8" fill="#111612" />
                </g>
                `;
            }
        }
        else {
            // === ALTRE FAMÍLIA GENERAL (Branca naturalista esvelta de fulles alternes) ===
            svg += `
            <path d="M 180,380 C 180,300 170,200 185,90" stroke="#111612" stroke-width="2.3" fill="none" stroke-linecap="round" />
            <path d="M 181,365 C 181,300 171,200 186,100" stroke="#111612" stroke-width="0.5" fill="none" stroke-linecap="round" stroke-dasharray="2, 4" opacity="0.6" />
            <path d="M 180,280 Q 200,260 215,248" stroke="#111612" stroke-width="1.2" fill="none" stroke-linecap="round" />
            <path d="M 177,210 Q 155,195 142,182" stroke="#111612" stroke-width="1.2" fill="none" stroke-linecap="round" />
            
            <g transform="translate(185, 90)">
                <ellipse cx="0" cy="-8" rx="14" ry="10" fill="${flowerColor}" stroke="none" opacity="0.8" />
                <circle cx="-5" cy="-8" r="3" fill="#ffffff" stroke="#111612" stroke-width="0.7" />
                <circle cx="5" cy="-8" r="3" fill="#ffffff" stroke="#111612" stroke-width="0.7" />
                <circle cx="0" cy="-14" r="3.5" fill="#ffffff" stroke="#111612" stroke-width="0.75" />
                <path d="M -5,-8 L 5,-8" stroke="#111612" stroke-width="0.5" />
            </g>
            <g transform="translate(215, 248) rotate(35)">
                <ellipse cx="0" cy="-4" rx="8" ry="6" fill="${flowerColor}" stroke="none" />
                <circle cx="0" cy="-4" r="2.2" fill="#ffffff" stroke="#111612" stroke-width="0.6" />
            </g>
            `;
        }

        // 3. FULLATGE DIAGNÒSTIC INTEGRAT SEGONS LA FAMÍLIA (Rosella, Lamiàcia, Asteràcia, Apiàcia, etc.)
        if (isRosella) {
            // El fullatge de la Rosella
            const leaves = [
                { y: 350, dir: -1, length: 50, rot: -22 },
                { y: 318, dir: 1, length: 52, rot: 24 },
                { y: 268, dir: -1, length: 56, rot: -28 },
                { y: 236, dir: 1, length: 54, rot: 26 },
                { y: 188, dir: -1, length: 44, rot: -24 },
                { y: 158, dir: 1, length: 42, rot: 18 }
            ];
            
            leaves.forEach((l, index) => {
                const startX = 180 + (l.dir * 1.5);
                const endX = startX + (l.dir * l.length);
                const endY = l.y + (l.rot * 0.45);
                const controlY = l.y - 10;
                
                svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.4)},${controlY} ${startX + l.dir * (l.length * 0.82)},${endY - 4} ${endX},${endY} C ${startX + l.dir * (l.length * 0.68)},${endY + 11} ${startX + l.dir * (l.length * 0.32)},${l.y + 7} ${startX},${l.y}" fill="rgba(42, 88, 38, 0.13)" stroke="none" />`;
                
                if (index % 2 === 0) {
                    svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.4)},${controlY} ${startX + l.dir * (l.length * 0.82)},${endY - 4} ${endX},${endY} C ${startX + l.dir * (l.length * 0.68)},${endY + 11} ${startX + l.dir * (l.length * 0.32)},${l.y + 7} ${startX},${l.y}" fill="url(#hatching)" stroke="none" />`;
                }
                
                svg += `<path d="M ${startX},${l.y} Q ${startX + l.dir * (l.length * 0.2)},${l.y - 5} ${startX + l.dir * (l.length * 0.35)},${l.y - 2} Q ${startX + l.dir * (l.length * 0.55)},${l.y - 10} ${startX + l.dir * (l.length * 0.7)},${l.y - 4} L ${endX},${endY} Q ${startX + l.dir * (l.length * 0.75)},${l.y + 12} ${startX + l.dir * (l.length * 0.5)},${l.y + 8} Q ${startX + l.dir * (l.length * 0.25)},${l.y + 10} ${startX},${l.y}" stroke="#111612" stroke-width="0.85" fill="none" stroke-linejoin="round" />`;
                svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.45)},${l.y + (l.rot * 0.18)} ${startX + l.dir * (l.length * 0.78)},${endY + 1} ${endX},${endY}" stroke="#111612" stroke-width="0.75" fill="none" opacity="0.8" />`;
            });
        } else {
            let leaves = [];
            if (isLamiacia) {
                leaves = [
                    { y: 340, dir: -1, length: 32, rot: -10, type: 'lanolada' },
                    { y: 340, dir: 1, length: 32, rot: 10, type: 'lanolada' },
                    { y: 290, dir: -1, length: 28, rot: -12, type: 'lanolada' },
                    { y: 290, dir: 1, length: 28, rot: 12, type: 'lanolada' },
                    { y: 230, dir: -1, length: 26, rot: -15, type: 'lanolada' },
                    { y: 230, dir: 1, length: 26, rot: 15, type: 'lanolada' },
                    { y: 170, dir: -1, length: 22, rot: -18, type: 'lanolada' },
                    { y: 170, dir: 1, length: 22, rot: 18, type: 'lanolada' }
                ];
            } else if (isAsteracia) {
                leaves = [
                    { y: 350, dir: -1, length: 48, rot: -28, type: 'runcinada' },
                    { y: 325, dir: 1, length: 50, rot: 30, type: 'runcinada' },
                    { y: 270, dir: -1, length: 44, rot: -25, type: 'runcinada' },
                    { y: 240, dir: 1, length: 42, rot: 28, type: 'runcinada' },
                    { y: 185, dir: -1, length: 32, rot: -20, type: 'runcinada' }
                ];
            } else if (isApiacia) {
                leaves = [
                    { y: 340, dir: -1, length: 42, rot: -22, type: 'filamentosa' },
                    { y: 310, dir: 1, length: 45, rot: 25, type: 'filamentosa' },
                    { y: 260, dir: -1, length: 38, rot: -25, type: 'filamentosa' },
                    { y: 220, dir: 1, length: 35, rot: 22, type: 'filamentosa' }
                ];
            } else if (isRosacia) {
                leaves = [
                    { y: 340, dir: -1, length: 40, rot: -20, type: 'serrada' },
                    { y: 315, dir: 1, length: 42, rot: 24, type: 'serrada' },
                    { y: 265, dir: -1, length: 38, rot: -25, type: 'serrada' },
                    { y: 235, dir: 1, length: 36, rot: 20, type: 'serrada' },
                    { y: 180, dir: -1, length: 30, rot: -20, type: 'serrada' }
                ];
            } else {
                leaves = [
                    { y: 345, dir: -1, length: 45, rot: -24, type: 'sinuosa' },
                    { y: 312, dir: 1, length: 48, rot: 26, type: 'sinuosa' },
                    { y: 262, dir: -1, length: 44, rot: -28, type: 'sinuosa' },
                    { y: 228, dir: 1, length: 42, rot: 22, type: 'sinuosa' },
                    { y: 178, dir: -1, length: 36, rot: -24, type: 'sinuosa' }
                ];
            }

            leaves.forEach((l, index) => {
                const startX = 180 + (l.dir * 1.5);
                const endX = startX + (l.dir * l.length);
                const endY = l.y + (l.rot * 0.45);
                const controlY = l.y - 12;
                
                svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.4)},${controlY} ${startX + l.dir * (l.length * 0.8)},${endY - 4} ${endX},${endY} C ${startX + l.dir * (l.length * 0.65)},${endY + 10} ${startX + l.dir * (l.length * 0.3)},${l.y + 6} ${startX},${l.y}" fill="rgba(42, 88, 38, 0.12)" stroke="none" />`;
                
                if (index % 2 === 0) {
                    svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.4)},${controlY} ${startX + l.dir * (l.length * 0.8)},${endY - 4} ${endX},${endY} C ${startX + l.dir * (l.length * 0.65)},${endY + 10} ${startX + l.dir * (l.length * 0.3)},${l.y + 6} ${startX},${l.y}" fill="url(#hatching)" stroke="none" />`;
                }

                if (l.type === 'lanolada') {
                    svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.45)},${controlY} ${startX + l.dir * (l.length * 0.85)},${endY - 2} ${endX},${endY} C ${startX + l.dir * (l.length * 0.7)},${endY + 8} ${startX + l.dir * (l.length * 0.3)},${l.y + 5} ${startX},${l.y}" stroke="#111612" stroke-width="0.8" fill="none" />`;
                } 
                else if (l.type === 'runcinada') {
                    svg += `<path d="M ${startX},${l.y} L ${startX + l.dir * (l.length * 0.25)},${l.y - 6} L ${startX + l.dir * (l.length * 0.32)},${l.y - 2} L ${startX + l.dir * (l.length * 0.55)},${l.y - 8} L ${startX + l.dir * (l.length * 0.65)},${l.y - 3} L ${endX},${endY} L ${startX + l.dir * (l.length * 0.7)},${l.y + 9} L ${startX + l.dir * (l.length * 0.45)},${l.y + 6} L ${startX},${l.y}" stroke="#111612" stroke-width="0.85" fill="none" stroke-linejoin="round" />`;
                }
                else if (l.type === 'filamentosa') {
                    svg += `<path d="M ${startX},${l.y} Q ${startX + l.dir * (l.length * 0.4)},${l.y - 8} ${endX},${endY} M ${startX + l.dir * (l.length * 0.3)},${l.y - 4} Q ${startX + l.dir * (l.length * 0.25)},${l.y - 12} ${startX + l.dir * (l.length * 0.55)},${l.y - 15} M ${startX + l.dir * (l.length * 0.5)},${l.y - 2} Q ${startX + l.dir * (l.length * 0.65)},${l.y + 8} ${startX + l.dir * (l.length * 0.85)},${l.y + 6}" stroke="#111612" stroke-width="0.75" fill="none" />`;
                }
                else if (l.type === 'serrada') {
                    svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.25)},${l.y - 5} ${startX + l.dir * (l.length * 0.32)},${l.y - 3} ${startX + l.dir * (l.length * 0.45)},${l.y - 7} L ${endX},${endY} Q ${startX + l.dir * (l.length * 0.75)},${l.y + 11} ${startX + l.dir * (l.length * 0.55)},${l.y + 8} L ${startX},${l.y}" stroke="#111612" stroke-width="0.85" fill="none" stroke-linejoin="round" />`;
                    svg += `<path d="M ${startX + l.dir * (l.length * 0.5)},${l.y - 7} L ${startX + l.dir * (l.length * 0.55)},${l.y - 9} L ${startX + l.dir * (l.length * 0.6)},${l.y - 6} M ${startX + l.dir * (l.length * 0.7)},${l.y - 5} L ${startX + l.dir * (l.length * 0.75)},${l.y - 7} L ${startX + l.dir * (l.length * 0.8)},${l.y - 4}" stroke="#111612" stroke-width="0.5" fill="none" />`;
                }
                else {
                    svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.4)},${controlY} ${startX + l.dir * (l.length * 0.82)},${endY - 4} ${endX},${endY} C ${startX + l.dir * (l.length * 0.68)},${endY + 11} ${startX + l.dir * (l.length * 0.32)},${l.y + 7} ${startX},${l.y}" stroke="#111612" stroke-width="0.8" fill="none" stroke-linejoin="round" />`;
                }

                svg += `<path d="M ${startX},${l.y} C ${startX + l.dir * (l.length * 0.45)},${l.y + (l.rot * 0.18)} ${startX + l.dir * (l.length * 0.78)},${endY + 1} ${endX},${endY}" stroke="#111612" stroke-width="0.7" fill="none" opacity="0.8" />`;
            });
        }
        
        // 4. LÍNIES APUNTADORES DEL 1 AL 7 REPLICANT ROSELLA.PNG
        svg += `
        <!-- Eix d'apuntadors a tinta de ploma clàssica -->
        <!-- 1. Fruit/Inflorescència superior (dalt dreta) -->
        <path d="M 230,110 L 260,110" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="230" cy="110" r="1.5" fill="#111612" />
        <text x="265" y="112" font-size="7.5" font-weight="700" font-family="var(--font-serif)">1. Fruit o òrgan reproductor</text>
 
        <!-- 2. Inflorescència o flor activa (superior dret) -->
        <path d="M 205,90 L 260,140" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="205" cy="90" r="1.5" fill="#111612" />
        <text x="265" y="142" font-size="7.5" font-weight="700" font-family="var(--font-serif)">2. Inflorescència (Flor sencer)</text>
 
        <!-- 3. Detall de fulla mitjana (mig dreta) -->
        <path d="M 220,240 L 260,180" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="220" cy="240" r="1.5" fill="#111612" />
        <text x="265" y="182" font-size="7.5" font-weight="700" font-family="var(--font-serif)">3. Detall de la fulla caulinar</text>
 
        <!-- 4. Roseta o fulles basals (baix dreta) -->
        <path d="M 210,330 L 260,260" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="210" cy="330" r="1.5" fill="#111612" />
        <text x="265" y="262" font-size="7.5" font-weight="700" font-family="var(--font-serif)">4. Disposició foliar a la tija</text>
 
        <!-- 5. Detall d'anteres o ovari central (baix dreta interior) -->
        <path d="M 195,100 L 260,340" stroke="#111612" stroke-width="0.4" fill="none" opacity="0.4" />
        <text x="265" y="342" font-size="7.5" font-weight="700" font-family="var(--font-serif)">5. Anatomia interna de la flor</text>
 
        <!-- 6. Sistema de fixació/Arrels (base dreta) -->
        <path d="M 185,420 L 260,410" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="185" cy="420" r="1.5" fill="#111612" />
        <text x="265" y="412" font-size="7.5" font-weight="700" font-family="var(--font-serif)">6. Sistema radicular i fixació</text>
 
        <!-- 7. Tija florífera (base dreta inferior) -->
        <path d="M 183,280 L 260,450" stroke="#111612" stroke-width="0.4" fill="none" opacity="0.5" />
        <circle cx="183" cy="280" r="1.5" fill="#111612" />
        <text x="265" y="452" font-size="7.5" font-weight="700" font-family="var(--font-serif)">7. Tija caulinar diagnòstica</text>
 
        <!-- Indicadors anatòmics esquerra (Estil natural s. XIX) -->
        <path d="M 148,198 L 110,185" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="148" cy="198" r="1.5" fill="#111612" />
        <text x="106" y="184" font-size="7" font-weight="700" font-family="var(--font-serif)" text-anchor="end">${isRosella ? "Capoll flàcid (drooping bud)" : "Branca secundària jove"}</text>
 
        <path d="M 172,250 L 110,250" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="172" cy="250" r="1.5" fill="#111612" />
        <text x="106" y="249" font-size="7" font-weight="700" font-family="var(--font-serif)" text-anchor="end">${isRosella ? "Làtex lletós vermell" : "Nervadures marcades"}</text>
 
        <path d="M 132,412 L 75,412" stroke="#111612" stroke-width="0.4" fill="none" />
        <circle cx="132" cy="412" r="1.5" fill="#111612" />
        <text x="71" y="411" font-size="7" font-weight="700" font-family="var(--font-serif)" text-anchor="end">${isRosella || isAsteracia ? "Eix d'arrels principal" : "Rizoma llenyós curt"}</text>
        `;

        // 5. PETIT ARBRE COMPARATIU DE MIDA A L'ESQUERRA
        svg += `
        <!-- Petit arbre comparatiu de mida i arrels -->
        <g transform="translate(45, 330)" opacity="0.85">
            <path d="M 30,35 L 30,20 C 26,16 20,18 20,12 C 20,6 40,6 40,12 C 40,18 34,16 30,20" stroke="#111612" stroke-width="0.8" fill="rgba(42, 88, 38, 0.15)" />
            <path d="M 30,35 Q 22,48 10,48" stroke="#111612" stroke-width="0.7" fill="none" />
            <path d="M 30,35 Q 36,45 42,48" stroke="#111612" stroke-width="0.6" fill="none" />
            <text x="30" y="44" font-size="5.2" font-family="var(--font-sans)" font-weight="700" text-anchor="middle" fill="#111612">Mida natural</text>
        </g>
        `;
        
        svg += `</svg>`;
        return svg;
    }

    // --- 19.5 INTERACTIVITAT DE LES TARGETES D'ESTADÍSTIQUES ---
    const cardPlants = document.getElementById('card-plants');
    const cardPendents = document.getElementById('card-pendents');
    
    if (cardPlants) {
        cardPlants.addEventListener('click', () => {
            const tabBtn = Array.from(DOM.tabBtns).find(b => b.getAttribute('data-tab') === 'alfabetic');
            if (tabBtn) tabBtn.click();
            document.querySelector('.explorer-section').scrollIntoView({ behavior: 'smooth' });
        });
    }
    
    if (cardPendents) {
        cardPendents.addEventListener('click', () => {
            const tabBtn = Array.from(DOM.tabBtns).find(b => b.getAttribute('data-tab') === 'pendents');
            if (tabBtn) tabBtn.click();
            document.querySelector('.explorer-section').scrollIntoView({ behavior: 'smooth' });
        });
    }

    const cardRecipes = document.getElementById('card-recipes');
    if (cardRecipes) {
        cardRecipes.addEventListener('click', () => {
            // Activar la pestanya "Usos i Receptes" (data-tab="remei")
            const tabBtn = Array.from(DOM.tabBtns).find(b => b.getAttribute('data-tab') === 'remei');
            if (tabBtn) tabBtn.click();
            
            // Activar la sub-pestanya "Receptes de Cuina"
            const subTabReceptes = document.getElementById('sub-tab-receptes');
            if (subTabReceptes) subTabReceptes.click();
            
            // Desplaçament suau cap a l'explorador
            document.querySelector('.explorer-section').scrollIntoView({ behavior: 'smooth' });
        });
    }

    // --- 19.6 LÒGICA INTERACTIVA DEL MENÚ I LES NOTIFICACIONS ---
    const notifBtn = document.getElementById('btn-notifications');
    const notifPanel = document.getElementById('notifications-panel');
    const notifClose = document.getElementById('btn-close-notif');
    const notifBadge = document.getElementById('notif-badge');

    const hamburgerBtn = document.getElementById('btn-hamburger');
    const menuDrawer = document.getElementById('menu-drawer');
    const menuOverlay = document.getElementById('menu-drawer-overlay');
    const menuClose = document.getElementById('btn-close-menu');

    const menuBtnGlossari = document.getElementById('menu-btn-glossari');
    const menuBtnPendents = document.getElementById('menu-btn-pendents');
    const menuBtnConfig = document.getElementById('menu-btn-config');
    const menuBtnAcces = document.getElementById('menu-btn-acces');
    const menuDynamicContent = document.getElementById('menu-drawer-dynamic-content');

    // 1. Gestió del panell flotant de notificacions
    if (notifBtn) {
        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanel.classList.toggle('active');
            // Tancar menú si està obert
            closeMenuDrawer();
        });
    }

    if (notifClose) {
        notifClose.addEventListener('click', () => {
            notifPanel.classList.remove('active');
        });
    }

    // Netejar la campaneta quan es veu
    if (notifPanel) {
        notifPanel.addEventListener('click', () => {
            if (notifBadge) {
                notifBadge.style.display = 'none';
            }
        });
    }

    // Tancar en fer clic a fora
    document.addEventListener('click', (e) => {
        if (notifPanel && !notifPanel.contains(e.target) && e.target !== notifBtn) {
            notifPanel.classList.remove('active');
        }
    });

    // 2. Gestió del menú lateral lliscant (Hamburger Drawer)
    function openMenuDrawer() {
        if (menuDrawer) menuDrawer.classList.add('active');
        if (menuOverlay) menuOverlay.classList.add('active');
        notifPanel.classList.remove('active');
        document.body.style.overflow = 'hidden';
        
        // Carregar per defecte el Glossari al obrir
        menuBtnGlossari.click();
    }

    function closeMenuDrawer() {
        if (menuDrawer) menuDrawer.classList.remove('active');
        if (menuOverlay) menuOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', openMenuDrawer);
    }

    if (menuClose) {
        menuClose.addEventListener('click', closeMenuDrawer);
    }

    if (menuOverlay) {
        menuOverlay.addEventListener('click', closeMenuDrawer);
    }

    // 3. Controladors dels botons interns del menú
    const menuBtns = [menuBtnGlossari, menuBtnPendents, menuBtnConfig, menuBtnAcces];

    function activateMenuTab(activeBtn) {
        menuBtns.forEach(btn => {
            if (btn) btn.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
    }

    if (menuBtnGlossari) {
        menuBtnGlossari.addEventListener('click', () => {
            activateMenuTab(menuBtnGlossari);
            renderGlossariView();
        });
    }

    if (menuBtnPendents) {
        menuBtnPendents.addEventListener('click', () => {
            activateMenuTab(menuBtnPendents);
            renderPendentsDBView();
        });
    }

    if (menuBtnConfig) {
        menuBtnConfig.addEventListener('click', () => {
            activateMenuTab(menuBtnConfig);
            renderConfigView();
        });
    }

    if (menuBtnAcces) {
        menuBtnAcces.addEventListener('click', () => {
            activateMenuTab(menuBtnAcces);
            renderAccesView();
        });
    }

    // 4. Renderitzadors dinàmics dels continguts del menú

    // A. Vista Glossari
    function renderGlossariView() {
        menuDynamicContent.innerHTML = `
            <h4 class="menu-section-title">📖 Glossari de Termes</h4>
            <div class="glossary-item">
                <div class="glossary-term">Emenagoga</div>
                <div class="glossary-desc">Planta o remei que afavoreix, regula o activa el flux menstrual en les dones.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Diürètica</div>
                <div class="glossary-desc">Facilita o estimula l'eliminació d'aigua i orina a través dels ronyons.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Zigomorfa / Labiada</div>
                <div class="glossary-desc">Flor amb un sol pla de simetria bilateral. Típica de les Lamiàcies, amb forma de llavis.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Pinnada / Pinnatipartida</div>
                <div class="glossary-desc">Fulla composta amb folíols disposats a banda i banda del nervi central com una ploma.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Aqueni</div>
                <div class="glossary-desc">Fruit sec de coberta coriàcia que conté una sola llavor no adherida a les seves parets.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Rizoma</div>
                <div class="glossary-desc">Tija subterrània horitzontal rica en nutrients, de la qual neixen brots i arrels.</div>
            </div>
            <div class="glossary-item">
                <div class="glossary-term">Pivotant / Axonomorfa</div>
                <div class="glossary-desc">Arrel principal gruixuda que creix verticalment cap a sota amb poques ramificacions primeres.</div>
            </div>
        `;
    }

    // B. Vista Camps Pendents de la Base de Dades (CSV)
    function renderPendentsDBView() {
        menuDynamicContent.innerHTML = `
            <h4 class="menu-section-title">🔍 Camps buits a la Base de Dades</h4>
            <p style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 15px; line-height: 1.4;">
                Cerca automàtica d'espècies que tenen dades absents o buides en el catàleg (per ex. sense receptes, rebrots, fruits, llavors o advertiments de toxicitat).
            </p>
            <div id="db-pending-list" style="display: flex; flex-direction: column;">
                <p style="font-size: 0.8rem; text-align: center; color: var(--color-text-muted);">Escanejant la base de dades...</p>
            </div>
        `;

        const listContainer = document.getElementById('db-pending-list');
        if (!listContainer) return;

        // Cercar espècies amb columnes buides o de valor per defecte a state.herbes
        const missingItems = state.herbes.filter(h => {
            return (
                !h.receptes || h.receptes.trim() === '' ||
                !h.toxicitat || h.toxicitat.trim() === '' ||
                !h.rebrots || h.rebrots.trim() === '' ||
                !h.fruits || h.fruits.trim() === '' ||
                !h.llavors || h.llavors.trim() === '' ||
                !h.noms_comuns_coneguts || h.noms_comuns_coneguts.trim() === '' ||
                (h.idHerba !== '21' && h.idHerba !== '36' && h.idHerba !== '199') // no té imatge pre-generada pre-existent
            );
        });

        if (missingItems.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 20px 0; color: var(--color-safe); font-weight: 700; font-size: 0.9rem;">
                    ✅ Base de dades completa! Tots els camps estan plens.
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';
        
        // Mostrar només els primers 15 per no saturar visualment el menú
        const itemsToShow = missingItems.slice(0, 15);

        itemsToShow.forEach(item => {
            const emptyFields = [];
            if (!item.receptes || item.receptes.trim() === '') emptyFields.push('Receptes');
            if (!item.toxicitat || item.toxicitat.trim() === '') emptyFields.push('Toxicitat');
            if (!item.fruits || item.fruits.trim() === '') emptyFields.push('Fruits');
            if (!item.llavors || item.llavors.trim() === '') emptyFields.push('Llavors');
            if (!item.rebrots || item.rebrots.trim() === '') emptyFields.push('Rebrots');
            if (item.idHerba !== '21' && item.idHerba !== '36') emptyFields.push('Làmina botànica');

            const itemDiv = document.createElement('div');
            itemDiv.className = 'pending-db-item';
            itemDiv.innerHTML = `
                <div class="pending-db-title">
                    <span>${item.nom_comu} <span style="font-size: 0.72rem; font-weight: normal; color: var(--color-text-muted);">(${item.nom_cientific})</span></span>
                    <span class="pending-db-badge">ID ${item.idHerba}</span>
                </div>
                <div class="pending-db-fields">
                    <strong>Buid:</strong> ${emptyFields.join(', ')}
                </div>
            `;
            
            // Permetre fer clic a la targeta pendent per anar directament a la seva fitxa botànica per omplir-la!
            itemDiv.addEventListener('click', () => {
                closeMenuDrawer();
                openBotanicalDrawer(item);
            });

            listContainer.appendChild(itemDiv);
        });

        if (missingItems.length > 15) {
            const extraCount = missingItems.length - 15;
            const extraDiv = document.createElement('div');
            extraDiv.style.cssText = 'text-align: center; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 10px; font-style: italic;';
            extraDiv.textContent = `... i ${extraCount} espècies més amb camps incomplets.`;
            listContainer.appendChild(extraDiv);
        }
    }

    // C. Vista Configuració
    function renderConfigView() {
        const isHighContrast = document.body.classList.contains('high-contrast');
        const isSerifActive = document.body.style.fontFamily.includes('Playfair');
        
        const cloudName = localStorage.getItem('cloudinary_cloud_name') || '';
        const uploadPreset = localStorage.getItem('cloudinary_upload_preset') || '';
        
        const supabaseUrl = localStorage.getItem('supabase_url') || '';
        const supabaseKey = localStorage.getItem('supabase_key') || '';
        
        const geminiKey = localStorage.getItem('gemini_api_key') || '';

        menuDynamicContent.innerHTML = `
            <h4 class="menu-section-title">⚙️ Configuració de l'Arxiu</h4>
            <div class="config-group">
                <div class="config-row">
                    <div class="config-info">
                        <span class="config-label">Contrast alt</span>
                        <span class="config-desc">Millora la llegibilitat posant text negre pur sobre blanc.</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="toggle-contrast" ${isHighContrast ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="config-row">
                    <div class="config-info">
                        <span class="config-label">Font estil clàssic (Serif)</span>
                        <span class="config-desc">Canvia la lletra de l'arxiu a estil mecànic tradicional.</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="toggle-serif" ${isSerifActive ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="config-row">
                    <div class="config-info">
                        <span class="config-label">Esborrar memòria cau</span>
                        <span class="config-desc">Elimina les dades de camp temporals i de l'herbari.</span>
                    </div>
                    <button class="btn-sm btn-sm-danger" id="btn-reset-cache" style="padding: 6px 12px; font-size: 0.75rem; border-radius: 4px;">Netejar</button>
                </div>
            </div>

            <h4 class="menu-section-title" style="margin-top: 25px;">☁️ Configuració de Cloudinary</h4>
            <div class="config-group" style="padding: 12px; background: rgba(30,63,32,0.04); border-radius: 8px;">
                <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 12px; line-height: 1.3;">
                    Configura la teva compta gratuïta de Cloudinary per a desar les fotos al núvol de forma il·limitada i obtenir enllaços permanents compartibles.
                </p>
                <div class="access-field" style="margin-bottom: 10px;">
                    <label for="config-cloud-name" style="font-size: 0.75rem; font-weight: 700;">Cloud Name</label>
                    <input type="text" class="access-input" id="config-cloud-name" placeholder="Ex. dmyxxxxx" value="${cloudName}" style="padding: 6px 10px; font-size: 0.8rem; border-radius: 4px;">
                </div>
                <div class="access-field" style="margin-bottom: 10px;">
                    <label for="config-upload-preset" style="font-size: 0.75rem; font-weight: 700;">Upload Preset (Unsigned)</label>
                    <input type="text" class="access-input" id="config-upload-preset" placeholder="Ex. preset_name" value="${uploadPreset}" style="padding: 6px 10px; font-size: 0.8rem; border-radius: 4px;">
                </div>
                <button class="access-btn" id="btn-save-cloudinary" style="padding: 8px 12px; font-size: 0.8rem; width: 100%; margin-top: 5px; border-radius: 4px;">Desar configuració Cloud</button>
            </div>

            <h4 class="menu-section-title" style="margin-top: 25px;">⚡ Configuració de Supabase (Opcional)</h4>
            <div class="config-group" style="padding: 12px; background: rgba(30,63,32,0.04); border-radius: 8px;">
                <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 12px; line-height: 1.3;">
                    Configura Supabase per sincronitzar el teu catàleg botànic al núvol en temps real entre dispositius (PC i mòbil).
                </p>
                <div class="access-field" style="margin-bottom: 10px;">
                    <label for="config-supabase-url" style="font-size: 0.75rem; font-weight: 700;">Supabase URL</label>
                    <input type="text" class="access-input" id="config-supabase-url" placeholder="https://xxxxxx.supabase.co" value="${supabaseUrl}" style="padding: 6px 10px; font-size: 0.8rem; border-radius: 4px;">
                </div>
                <div class="access-field" style="margin-bottom: 10px;">
                    <label for="config-supabase-key" style="font-size: 0.75rem; font-weight: 700;">Supabase Anon Key</label>
                    <input type="password" class="access-input" id="config-supabase-key" placeholder="Clau pública anon" value="${supabaseKey}" style="padding: 6px 10px; font-size: 0.8rem; border-radius: 4px;">
                </div>
                <button class="access-btn" id="btn-save-supabase" style="padding: 8px 12px; font-size: 0.8rem; width: 100%; margin-top: 5px; border-radius: 4px;">Desar configuració Supabase</button>
            </div>

            <h4 class="menu-section-title" style="margin-top: 25px;">🤖 Intel·ligència Artificial Gemini (Opcional)</h4>
            <div class="config-group" style="padding: 12px; background: rgba(30,63,32,0.04); border-radius: 8px;">
                <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 12px; line-height: 1.3;">
                    Introdueix la teva clau d'API de Gemini per a tindre converses intel·ligents i fer preguntes complexes. Si es deixa buida, el xat funcionarà localment basat en paraules clau i coincidències.
                </p>
                <div class="access-field" style="margin-bottom: 10px;">
                    <label for="config-gemini-key" style="font-size: 0.75rem; font-weight: 700;">Gemini API Key</label>
                    <input type="password" class="access-input" id="config-gemini-key" placeholder="AIzaSy..." value="${geminiKey}" style="padding: 6px 10px; font-size: 0.8rem; border-radius: 4px;">
                </div>
                <button class="access-btn" id="btn-save-gemini" style="padding: 8px 12px; font-size: 0.8rem; width: 100%; margin-top: 5px; border-radius: 4px;">Desar clau Gemini</button>
            </div>
        `;

        // Lògica de control de canvis de configuració
        const contrastCheck = document.getElementById('toggle-contrast');
        if (contrastCheck) {
            contrastCheck.addEventListener('change', (e) => {
                if (e.target.checked) {
                    document.body.classList.add('high-contrast');
                    showToast("👁️ Contrast alt activat per a accessibilitat.");
                } else {
                    document.body.classList.remove('high-contrast');
                    showToast("👁️ Contrast alt desactivat.");
                }
            });
        }

        const serifCheck = document.getElementById('toggle-serif');
        if (serifCheck) {
            serifCheck.addEventListener('change', (e) => {
                if (e.target.checked) {
                    document.body.style.setProperty('--font-sans', "var(--font-serif)");
                    showToast("📜 Tipografia de gravat Serif activa.");
                } else {
                    document.body.style.removeProperty('--font-sans');
                    showToast("📱 Tipografia de pantalla Sans-serif activa.");
                }
            });
        }

        const resetCacheBtn = document.getElementById('btn-reset-cache');
        if (resetCacheBtn) {
            resetCacheBtn.addEventListener('click', () => {
                if (confirm("Segur que vols esborrar l'herbari pendent? S'eliminaran totes les mostres afegides localment.")) {
                    localStorage.removeItem('herbari_pendents');
                    updatePendentsCount();
                    showToast("🗑️ S'ha buidat l'herbari de mostres pendents.");
                    renderConfigView();
                }
            });
        }

        const saveCloudBtn = document.getElementById('btn-save-cloudinary');
        if (saveCloudBtn) {
            saveCloudBtn.addEventListener('click', () => {
                const nameVal = document.getElementById('config-cloud-name').value.trim();
                const presetVal = document.getElementById('config-upload-preset').value.trim();
                localStorage.setItem('cloudinary_cloud_name', nameVal);
                localStorage.setItem('cloudinary_upload_preset', presetVal);
                showToast("☁️ Configuració de Cloudinary desada correctament.");
            });
        }

        const saveSupabaseBtn = document.getElementById('btn-save-supabase');
        if (saveSupabaseBtn) {
            saveSupabaseBtn.addEventListener('click', () => {
                const urlVal = document.getElementById('config-supabase-url').value.trim();
                const keyVal = document.getElementById('config-supabase-key').value.trim();
                localStorage.setItem('supabase_url', urlVal);
                localStorage.setItem('supabase_key', keyVal);
                showToast("⚡ Configuració de Supabase desada. Recarregant...");
                setTimeout(() => window.location.reload(), 1500);
            });
        }

        const saveGeminiBtn = document.getElementById('btn-save-gemini');
        if (saveGeminiBtn) {
            saveGeminiBtn.addEventListener('click', () => {
                const keyVal = document.getElementById('config-gemini-key').value.trim();
                localStorage.setItem('gemini_api_key', keyVal);
                state.geminiKey = keyVal;
                showToast("🤖 Clau de Gemini desada correctament.");
            });
        }
    }

    // D. Vista Accés / Permisos
    function renderAccesView() {
        const username = localStorage.getItem('arxiu_user');

        if (username) {
            menuDynamicContent.innerHTML = `
                <h4 class="menu-section-title">🔒 Perfil de l'Usuari</h4>
                <div style="text-align: center; padding: 15px 0;">
                    <div style="font-size: 3rem; margin-bottom: 10px;">👤</div>
                    <p style="font-weight: 700; color: var(--color-primary);">Connectat com a: ${username}</p>
                    <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 5px;">Tens permisos d'administrador i escriptura botànica actius.</p>
                    <button class="access-btn" id="btn-logout" style="background-color: var(--color-toxic); width: 100%; margin-top: 20px;">
                        Tancar sessió
                    </button>
                </div>
            `;

            const logoutBtn = document.getElementById('btn-logout');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    localStorage.removeItem('arxiu_user');
                    showToast("🔒 Sessió tancada correctament.");
                    renderAccesView();
                });
            }
            return;
        }

        menuDynamicContent.innerHTML = `
            <h4 class="menu-section-title">🔒 Accés / Permisos</h4>
            <p style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 20px; line-height: 1.4;">
                Accedeix al teu perfil amb el nom d'usuari i la contrasenya del teu catàleg per a desbloquejar els permisos d'edició i gestió de làmines botàniques.
            </p>
            <form class="access-form" id="form-login" onsubmit="return false;">
                <div class="access-field">
                    <label for="login-username">Nom d'usuari</label>
                    <input type="text" class="access-input" id="login-username" placeholder="Ex. admin" required>
                </div>
                <div class="access-field">
                    <label for="login-password">Contrasenya</label>
                    <input type="password" class="access-input" id="login-password" placeholder="••••••••" required>
                </div>
                <button type="submit" class="access-btn" id="btn-submit-login">Entrar</button>
            </form>
        `;

        const loginForm = document.getElementById('form-login');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const user = document.getElementById('login-username').value.trim();
                const pass = document.getElementById('login-password').value.trim();

                // Simulació de validació (usuari: admin, pass: montseny)
                if (user.toLowerCase() === 'admin' && pass === 'montseny') {
                    localStorage.setItem('arxiu_user', user);
                    showToast("🔑 Accés autoritzat com a Administrador.");
                    renderAccesView();
                } else {
                    showToast("⚠️ Usuari o contrasenya incorrectes.");
                }
            });
        }
    }

    // E. Vista Receptes de l'Arxiu
    function renderRecipesView() {
        menuDynamicContent.innerHTML = `
            <h4 class="menu-section-title">🍳 Receptes i Preparats</h4>
            <p style="font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 15px; line-height: 1.4;">
                Descobreix aplicacions culinàries, adobs, remenats, truites i preparats de les plantes medicinals catalogades al Montseny.
            </p>
            <div id="recipes-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
        `;

        const listContainer = document.getElementById('recipes-list');
        if (!listContainer) return;

        const herbsWithRecipes = state.herbes.filter(h => h.receptes && h.receptes.trim() !== '');

        if (herbsWithRecipes.length === 0) {
            listContainer.innerHTML = `<p style="font-size: 0.8rem; text-align: center; color: var(--color-text-muted);">No hi ha receptes disponibles en aquest moment.</p>`;
            return;
        }

        herbsWithRecipes.forEach(h => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'pending-db-item';
            itemDiv.style.borderLeftColor = 'var(--color-primary)';
            itemDiv.innerHTML = `
                <div class="pending-db-title">
                    <span>🍳 ${h.nom_comu}</span>
                    <span class="pending-db-badge" style="background: var(--color-primary-ultra-light); color: var(--color-primary-light);">Recepta</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--color-text-dark); margin-top: 6px; line-height: 1.4; font-family: var(--font-sans);">
                    ${h.receptes}
                </div>
            `;
            
            itemDiv.addEventListener('click', () => {
                closeMenuDrawer();
                openBotanicalDrawer(h);
            });

            listContainer.appendChild(itemDiv);
        });
    }

    // --- 19.7 GESTIÓ DEL CALAIX DEL XAT (DRAWER ESQUERRE) ---
    const chatToggleBtn = document.getElementById('btn-chat-toggle');
    const chatDrawer = document.getElementById('chat-drawer');
    const chatOverlay = document.getElementById('chat-drawer-overlay');
    const chatDrawerCloseBtn = document.getElementById('btn-close-chat-drawer');

    function openChatDrawer() {
        if (chatDrawer) chatDrawer.classList.add('active');
        if (chatOverlay) chatOverlay.classList.add('active');
        
        // Tancar menú lateral i notif si estan oberts
        closeMenuDrawer();
        if (notifPanel) notifPanel.classList.remove('active');
        
        document.body.style.overflow = 'hidden';
        
        // Inicialitzar o carregar el xat
        initializeChatView();
    }

    function closeChatDrawer() {
        if (chatDrawer) chatDrawer.classList.remove('active');
        if (chatOverlay) chatOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (chatToggleBtn) {
        chatToggleBtn.addEventListener('click', openChatDrawer);
    }
    if (chatDrawerCloseBtn) {
        chatDrawerCloseBtn.addEventListener('click', closeChatDrawer);
    }
    if (chatOverlay) {
        chatOverlay.addEventListener('click', closeChatDrawer);
    }

    // --- 19.8 VISTA DE XAT BOTÀNIC (INTEGRACIÓ GEMINI I MODE LOCAL) ---
    function initializeChatView() {
        if (state.chatInitialized) return;
        state.chatInitialized = true;

        // Mostrar missatge de benvinguda inicial
        appendChatMessage("bot", `Hola! Sóc l'Assistent Botànic de l'Arxiu del Montseny. Pregunta'm sobre les herbes del catàleg, receptes culinàries, remeis medicinals o la toxicitat d'alguna planta.<br><br>*Nota: Si vols obtenir respostes més avançades i conversacionals per IA, recorda que pots introduir la teva clau d'API de Gemini al menú de Configuració.*`);

        // Generar botons de suggeriment
        renderSuggestionChips();

        // Enllaçar esdeveniments d'enviament de missatges
        DOM.chatSendBtn.addEventListener('click', () => {
            sendChatMessage();
        });

        DOM.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });

        // Delegació d'esdeveniments per als enllaços de plantes clicables dins del xat
        DOM.chatMessages.addEventListener('click', (e) => {
            const plantLink = e.target.closest('.chat-plant-link');
            if (plantLink) {
                e.preventDefault();
                const id = parseInt(plantLink.getAttribute('data-id'), 10);
                const herba = state.herbes.find(h => h.idHerba === id);
                if (herba) {
                    openBotanicalDrawer(herba);
                } else {
                    showToast("No s'ha trobat la planta al catàleg.");
                }
            }
        });
    }

    function renderSuggestionChips() {
        const suggestions = [
            "Quines herbes ajuden a la digestió?",
            "Dona'm receptes amb Romaní",
            "Quines plantes són tòxiques?",
            "Com puc alleujar la tos?"
        ];
        
        DOM.chatSuggestions.innerHTML = '';
        suggestions.forEach(text => {
            const chip = document.createElement('button');
            chip.className = 'chat-suggestion-chip';
            chip.textContent = text;
            chip.addEventListener('click', () => {
                DOM.chatInput.value = text;
                sendChatMessage();
            });
            DOM.chatSuggestions.appendChild(chip);
        });
    }

    async function sendChatMessage() {
        const text = DOM.chatInput.value.trim();
        if (!text) return;

        // Afegir missatge de l'usuari
        appendChatMessage("user", text);
        DOM.chatInput.value = '';
        DOM.chatInput.focus();

        // Mostrar indicador d'escriptura (typing indicator)
        const typingIndicator = showTypingIndicator();

        try {
            let responseText = "";
            
            if (state.geminiKey) {
                responseText = await getGeminiBotResponse(text);
            } else {
                // Simular un petit retard natural per al bot local (500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
                responseText = getLocalBotResponse(text);
            }

            // Eliminar indicador d'escriptura
            typingIndicator.remove();

            // Afegir missatge del bot
            appendChatMessage("bot", responseText);

        } catch (error) {
            console.error("Error al xat:", error);
            typingIndicator.remove();
            appendChatMessage("bot", `⚠️ S'ha produït un error en connectar amb Gemini: ${error.message}. Funcionant en mode local de reserva.<br><br>${getLocalBotResponse(text)}`);
        }
    }

    function appendChatMessage(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'chat-message-content';
        
        if (sender === 'bot') {
            contentDiv.innerHTML = formatBotResponse(text);
        } else {
            contentDiv.textContent = text;
        }
        
        msgDiv.appendChild(contentDiv);
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'chat-message-time';
        const now = new Date();
        timeSpan.textContent = now.toLocaleTimeString('ca', { hour: '2-digit', minute: '2-digit' });
        msgDiv.appendChild(timeSpan);
        
        DOM.chatMessages.appendChild(msgDiv);
        
        // Scroll automàtic cap a baix
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    }

    function showTypingIndicator() {
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'chat-message bot typing-message';
        indicatorDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        DOM.chatMessages.appendChild(indicatorDiv);
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
        return indicatorDiv;
    }

    async function getGeminiBotResponse(query) {
        // RAG Local: cercar les 8 herbes més coincidents basades en paraules clau
        const queryClean = query.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .trim();
            
        const stopWords = new Set(['que', 'per', 'amb', 'els', 'les', 'una', 'uns', 'del', 'dels', 'als', 'del', 'pel', 'pels', 'com', 'mes', 'tot', 'tots', 'molt', 'tinc', 'vull', 'saber', 'quines', 'quins', 'quina', 'dona', 'donam', 'receptes', 'recepta', 'sobre', 'de', 'la', 'el']);
        const tokens = queryClean.split(/[^\w\d_]+/).filter(t => t.length > 2 && !stopWords.has(t));
        
        let candidates = [];
        state.herbes.forEach(h => {
            const nomClean = h.nom_comu.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const cientificClean = (h.nom_cientific || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const alternatiusClean = (h.noms_comuns_coneguts || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const textToSearch = `${h.remeis} ${h.receptes} ${h.toxicitat} ${h.familia} ${h.parts_utilitzades}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            let score = 0;
            
            // Alta puntuació si el nom de la planta és a la cerca
            if (queryClean.includes(nomClean) || (alternatiusClean && alternatiusClean.split(',').some(alt => queryClean.includes(alt.trim())))) {
                score += 50;
            }
            if (queryClean.includes(cientificClean)) {
                score += 40;
            }
            
            // Puntuació per tokens coincidents en la descripció, remeis, etc.
            tokens.forEach(token => {
                if (textToSearch.includes(token)) score += 5;
                if (nomClean.includes(token)) score += 10;
            });
            
            if (score > 0) {
                candidates.push({ plant: h, score: score });
            }
        });
        
        // Ordenar candidats i agafar els 8 millors
        candidates.sort((a, b) => b.score - a.score);
        const topPlants = candidates.slice(0, 8).map(c => c.plant);
        
        // Si no hi ha candidats rellevants, posem algunes herbes mediterrànies conegudes com a base
        if (topPlants.length === 0) {
            const populars = state.herbes.filter(h => {
                const n = h.nom_comu.toLowerCase();
                return n.includes('romani') || n.includes('romaní') || n.includes('farigola') || n.includes('orenga') || n.includes('rosella');
            });
            topPlants.push(...populars.slice(0, 6));
        }

        // Construir context reduït per a RAG
        let context = "Plantes del catàleg del Montseny potencialment relacionades:\n";
        topPlants.forEach(p => {
            context += `- ID ${p.idHerba}: ${p.nom_comu} (${p.nom_cientific}). Família: ${p.familia}. Remeis/Usos: ${p.remeis || 'No especificats'}. Receptes: ${p.receptes || 'No especificades'}. Toxicitat: ${p.toxicitat || 'No descrita'}.\n`;
        });

        const systemPrompt = `Ets l'Assistent Botànic de l'Arxiu del Montseny. Respon sempre en català d'una manera propera, amable i rigorosa.
El teu objectiu és orientar els usuaris en remeis medicinals tradicionals i usos gastronòmics de les plantes del Montseny.
Et dono una llista de plantes de la nostra base de dades local. Si respons sobre elles, és OBLIGATORI que les enllacis usant la sintaxi exacte: [Nom Comú](plant:ID), per exemple [Romaní](plant:14) o [Menta](plant:3). No inventis enllaços per a plantes que no estiguin al llistat de context.
Si una planta presenta toxicitat segons el catàleg, adverteix clarament de les precaucions o perills amb un emoji ⚠️. Sigues concís (mòdul de 2-3 paràgrafs màxim).`;

        const payload = {
            contents: [
                {
                    parts: [
                        {
                            text: `${systemPrompt}\n\n[CONTEXT DEL CATÀLEG]\n${context}\n\n[PREGUNTA DE L'USUARI]\n"${query}"`
                        }
                    ]
                }
            ]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.geminiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `Error HTTP ${response.status}`);
        }

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!textResponse) {
            throw new Error("Resposta de text buida o invàlida de l'API.");
        }

        return textResponse;
    }

    function getLocalBotResponse(query) {
        const queryClean = query.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .trim();
        
        let responseText = "";
        let matchedPlants = [];

        // 1. Cerca directa per nom de la planta
        state.herbes.forEach(h => {
            const nomClean = h.nom_comu.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const cientificClean = (h.nom_cientific || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const alternatiusClean = (h.noms_comuns_coneguts || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (queryClean.includes(nomClean) || 
                queryClean.includes(cientificClean) || 
                (h.nom_comu.length > 4 && nomClean.includes(queryClean)) ||
                (alternatiusClean && alternatiusClean.split(',').some(alt => queryClean.includes(alt.trim())))) {
                matchedPlants.push(h);
            }
        });

        // Detectar intencions
        const isToxicQuery = queryClean.includes('toxic') || queryClean.includes('perill') || queryClean.includes('venen') || queryClean.includes('mortal') || queryClean.includes('dolent') || queryClean.includes('morir');
        const isRecipeQuery = queryClean.includes('recept') || queryClean.includes('cuin') || queryClean.includes('menjar') || queryClean.includes('truita') || queryClean.includes('amanida') || queryClean.includes('oli') || queryClean.includes('infus');
        const isRemedyQuery = queryClean.includes('remei') || queryClean.includes('cura') || queryClean.includes('tos') || queryClean.includes('digest') || queryClean.includes('panxa') || queryClean.includes('cap') || queryClean.includes('ferida') || queryClean.includes('inflama') || queryClean.includes('respir') || queryClean.includes('gasos');

        if (matchedPlants.length > 0) {
            const plant = matchedPlants[0];
            responseText += `He trobat la fitxa de la planta **[${plant.nom_comu}](plant:${plant.idHerba})** (*${plant.nom_cientific}*), de la família de les *${plant.familia}*.<br><br>`;
            
            if (isToxicQuery) {
                responseText += `⚠️ **Toxicitat registrada:** ${plant.toxicitat || "No s'indica cap toxicitat o perill especial al catàleg per a aquesta espècie. Tot i així, recomanem un ús moderat."}<br><br>`;
            } else if (isRecipeQuery) {
                responseText += `🍳 **Usos a la cuina i receptes:** ${plant.receptes || "No hi ha receptes detallades per a aquesta planta a la base de dades. Normalment s'usa en infusions."}<br><br>`;
            } else if (isRemedyQuery) {
                responseText += `🏥 **Propietats medicinals / Remeis:** ${plant.remeis || "No s'han registrat remeis medicinals concrets per a aquesta espècie al catàleg."}<br><br>`;
            } else {
                responseText += `**Descripció física:** ${plant.descripcio_fulla || "Físic general en redacció."}<br><br>`;
                responseText += `**Remeis tradicionals:** ${plant.remeis || "No indicats."}<br><br>`;
                if (plant.receptes) responseText += `🍳 **Cuina:** ${plant.receptes}<br><br>`;
                if (isPlantToxic(plant)) responseText += `⚠️ **Atenció:** Aquesta planta té riscos de toxicitat (*${plant.toxicitat}*).<br><br>`;
            }
            
            if (matchedPlants.length > 1) {
                responseText += `També et pot interessar consultar altres plantes relacionades: `;
                matchedPlants.slice(1).forEach((p, idx) => {
                    if (idx > 0) responseText += ", ";
                    responseText += `**[${p.nom_comu}](plant:${p.idHerba})**`;
                });
                responseText += ".";
            }
        } else {
            // Cerca de text a les columnes d'usos/receptes amb sistema de puntuació de tokens
            let matchedByText = [];
            const stopWords = new Set(['que', 'per', 'amb', 'els', 'les', 'una', 'uns', 'del', 'dels', 'als', 'del', 'pel', 'pels', 'com', 'mes', 'tot', 'tots', 'molt', 'tinc', 'vull', 'saber', 'quines', 'quins', 'quina', 'sobre', 'de', 'la', 'el']);
            const tokens = queryClean.split(/[^\w\d_]+/).filter(t => t.length > 2 && !stopWords.has(t));
            
            state.herbes.forEach(h => {
                const textToSearch = `${h.remeis} ${h.receptes} ${h.toxicitat} ${h.familia}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                
                let matches = 0;
                tokens.forEach(token => {
                    if (textToSearch.includes(token)) matches++;
                });
                
                if (matches > 0) {
                    matchedByText.push({ plant: h, score: matches });
                }
            });
            
            matchedByText.sort((a, b) => b.score - a.score);

            if (matchedByText.length > 0) {
                const limit = Math.min(5, matchedByText.length);
                responseText += `No he trobat cap herba exacta amb aquest nom, però per a la teva consulta sobre **"${tokens.join(', ')}"**, et suggereixo donar un cop d'ull a les següents herbes de l'Arxiu:<br><br>`;
                
                for (let k = 0; k < limit; k++) {
                    const p = matchedByText[k].plant;
                    const snippet = p.remeis ? p.remeis.slice(0, 120) + '...' : p.descripcio_fulla.slice(0, 120) + '...';
                    responseText += `• **[${p.nom_comu}](plant:${p.idHerba})**: ${snippet}<br>`;
                }
            } else {
                responseText += `Ho sento, no he trobat cap planta o remei coincident amb la teva cerca a la base de dades local.<br><br>`;
                responseText += `Prova de fer-me preguntes sobre remeis concrets (com *tos*, *digestió*, *nerviós*), plats (*truita*, *amanida*, *infusió*) o cerca directament una espècie pel seu nom.`;
            }
        }
        
        return responseText;
    }

    function formatBotResponse(text) {
        // Escapar HTML per seguretat
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Parsejar [Planta](plant:ID) a enllaç botànic
        const plantRegex = /\[([^\]]+)\]\(plant:(\d+)\)/g;
        html = html.replace(plantRegex, (match, name, id) => {
            return `<a href="#" class="chat-plant-link" data-id="${id}">${name}</a>`;
        });

        // Negretes
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Llistes desendreçades
        html = html.replace(/^\s*[-•*]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');

        // Salts de línia
        html = html.replace(/\n/g, '<br>');

        // Netejar salts de línia a les llistes
        html = html.replace(/<\/li>\s*<br\s*\/?>\s*<li>/g, '</li><li>');
        html = html.replace(/<ul>\s*<br\s*\/?>/g, '<ul>');
        html = html.replace(/<br\s*\/?>\s*<\/ul>/g, '</ul>');

        return html;
    }

    // --- 20. INICIAR L'APLICACIÓ ---
    loadData();
});
