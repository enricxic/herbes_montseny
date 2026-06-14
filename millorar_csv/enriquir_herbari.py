import csv
import os

# Base de dades d'ampliació concisa orientada a la identificació offline i seguretat de camp
AMPLIACIONS_BOTANIQUES = {   
    "Orenga": {
        "descripcio_fulla": "Petites, oposades, ovades i peciolades; marge sencer o lleument dentat. Presenten punts translúcids a contrallum (glàndules d'essència).",
        "descripcio_tija": "Erecta, rígida i de secció marcadament quadrangular; sovint de color porpra o vermellós i recoberta de pèls fins (pubescent).",
        "descripcio_flor": "Molt menudes i labiades, de color rosa intens, lila o blanc, agrupades en corimbes terminals molt densos amb bràctees fosques.",
        "remeis": "Expectorant, antitussigen, digestiva, carminativa i potent antisèptic de les vies respiratòries.",
        "receptes": "Infusió de sumitats florides per a la tos espasmòdica; oli macerat via externa per a friccions musculars i desinfectant.",
        "toxicitat": "Segura en ús tradicional. L'oli essencial pur s'ha de moderar via interna ja que pot irritar les mucoses digestives."
    },
    "Farigola": {
        "descripcio_fulla": "Diminutes, linears o oblongues, oposades; to verd grisenc pel revers texturat amb pèls blancs i el marge fortament girat cap avall (revolut).",
        "descripcio_tija": "Llenyosa a la base, molt ramificada, tortuosa i de color grisenc o marró; forma matolls densos de poca alçada.",
        "descripcio_flor": "Labiades i petites, d'un color rosa pàl·lid o blanquinoses, reunides en capítols o glomèruls ovoides terminals densos.",
        "remeis": "Antisèptica (rica en timol), digestiva, espasmolítica, mucolítica i tònica general del sistema immunitari.",
        "receptes": "Sopa de farigola tradicional com a remei reconfortant; decocció concentrada per a gargarismes contra el mal de gola.",
        "toxicitat": "Innòcua en dosis normals. Evitar l'oli essencial pur via interna durant l'embaràs."
    },
    "Galzeran": {
        "descripcio_fulla": "Falses fulles rígides i punxegudes (cladodis) en forma oval-llanceolada que acaben en una espina dura. Les veritables són escates microscòpiques.",
        "descripcio_tija": "Erecta, molt rígida, estriada longitudinalment, flexible però dura, de color verd fosc; creix formant petits arbusts a sotabosc.",
        "descripcio_flor": "Insignificants, verdoses o blanquinoses, neixen solitàries o en parelles clavades exactament al mig del cladodi (falsa fulla).",
        "remeis": "Excel·lent tònic venós (venotrònic), antiinflamatori, diürètic i protector capil·lar (ideal per a cames cansades i varius).",
        "receptes": "Decocció del rizoma sec per via interna (sovint combinat amb civada per potenciar l'efecte circulatori).",
        "toxicitat": "ALTA EN ELS FRUITS. Les baies roges arrodonides de la tardor són altament tòxiques via interna, provocant vòmits i alteracions cardíaques."
    },
    "Herba sabonera": {
        "descripcio_fulla": "Grans, ovals o lanceolades, oposades, de color verd clar, agudes a l'àpex i sense pecíol. Destaquen tres nervis longitudinals molt marcats.",
        "descripcio_tija": "Erecta, robusta, cilíndrica i llisa (glabra), amb nusos un xic inflats d'on neixen les fulles; de consistència herbàcia.",
        "descripcio_flor": "Grans i vistoses, de color rosa pàl·lid o blanc, amb 5 pètals estesos i un calze tubular verd o porpra molt llarg. Olor agradable.",
        "remeis": "Depurativa, sudorífica, expectorant i utilitzada com a sabó natural dermo-protector (per a èczemes i dermatitis).",
        "receptes": "Decocció de l'arrel triturada; en agitar l'aigua genera una bromera abundant (saponines) ideal per rentar la piel sensible.",
        "toxicitat": "MODERADA-ALTA VIA INTERNA. Conté altes concentracions de saponines que irriten el tub digestiu i provoquen hemòlisi. Ús preferent extern."
    },
    "Romaní": {
        "descripcio_fulla": "Linears, gairebé sese, dures i de consistència coriàcia; marge totalment revolut cap avall, anvers verd fosc i revers blanc-tomentós.",
        "descripcio_tija": "Llenyosa, molt ramificada, de color marró cendra en branques velles i verdosa o quadrada en els brots joves aromàtics.",
        "descripcio_flor": "Labiades, de color blau clar o lila amb línies fosques (rarament blanques), amb els estams arquejats molt sortits cap enfora.",
        "remeis": "Estimulant circulatori, hepàtic (colerètic i colagog), antioxidant, tònic muscular i cicatritzant extern.",
        "receptes": "Alcohol de romaní macerat durant 15 dies per a fregar articulacions doloroses; infusió de flors per a la hipotensió.",
        "toxicitat": "Baixa. Evitar l'ús d'oli essencial pur per via interna en pacients epilèptics o durant la gestació."
    },
    "Espinalb": {
        "descripcio_fulla": "Petites, alternes, amb pecíol llarg; dividides profundament en 3, 5 o 7 lòbuls ovals i marcadament dentades a la punta.",
        "descripcio_tija": "Arbustiva i molt llenyosa, escorça grisa clivellada; branques molt intricades proveïdes d'espines curtes i molt punxegudes.",
        "descripcio_flor": "Blanques (rarament roses), olorosa, amb 5 pètals rodons i nombrosos estams amb anteres de color vermell-rosat intens.",
        "remeis": "Excel·lent regulador del ritme cardíac (cardiotònic, antiarítmic), hipotensor, sedant del sistema nerviós central i antiespasmòdic.",
        "receptes": "Infusió de flors i fulles seques per combatre l'insomni d'origen nerviós o les palpitacions.",
        "toxicitat": "Molt segura. No utilitzar conjuntament amb fàrmacs cardiotònics sintètics (digoxina) sense control mèdic."
    },
    "Malrubí": {
        "descripcio_fulla": "Oposades, ovals o arrodonides, amb pecíol llarg; de consistència rugosa o fistonada, recobertes d'una pilositat blanca densa (revers llanós).",
        "descripcio_tija": "Quadrangular, erecta, robusta i d'un color verd blanquinós a causa de la capa espessa de pèls llanosos que la cobreix.",
        "descripcio_flor": "Molt petites, de color blanc pur, agrupades en verticil·lastres globulars molt densos i compactes a les axil·les de les fulles superiors.",
        "remeis": "Potent fluidificant de les secrecions bronquials (expectorant), febrífug, digestiu amarg, colerètic i emenagog.",
        "receptes": "Infusió de la planta florida (de gust molt amarg) per calmar la tos amb flegma i netejar les vies respiratòries.",
        "toxicitat": "Baixa. Contraindicat en cas d'úlceres gastroduodenals a causa de l'augment de secreció de sucs gàstrics."
    },
    "Dent de lleó": {
        "descripcio_fulla": "Totes disposades en roseta basal arran de terra; fulles profundament dividides en lòbuls triangulars en forma de llança, amb els marges dentats apuntant cap a la base.",
        "descripcio_tija": "Manca de tija veritables (escap floral buit); surten peduncles cilíndrics verds o rosats, tindrets, que contenen un làtex blanc amarg.",
        "descripcio_flor": "Capítol floral gran i terminal de color groc daurat intens, format exclusivament per flors lígules, que es transforma en un plomall (papus) esfèric.",
        "remeis": "Excel·lent depuratiu general, diürètic potent (ric en potassi), estimulant biliar (colagog) i laxant suau.",
        "receptes": "Amanida de fulles tendres a la primavera per fer neteja hepàtica; infusió de l'arrel seca triturada per a la retenció de líquids.",
        "toxicitat": "Innòcua. Evitar en cas d'obstrucció de les vies biliars o pedres a la vesícula sense supervisió."
    },
    "Rosella": {
        "descripcio_fulla": "Alternes, allargades i pinnatipartides, amb segments llanceolats i fortament dentats; cobertes de pèls rígids ben visibles a l'anvers i revers.",
        "descripcio_tija": "Erecta, cilíndrica, prima i coberta de pèls llargs i patents de tacte aspre; conté un suc lletós (làtex) que s'allibera en tallar-la.",
        "descripcio_flor": "Grans, solitàries i terminals; 4 pètals molt fins de color vermell escarlata intens, sovint amb una taca negra a la base, que cauen fàcilment.",
        "remeis": "Sedant suau de la tos (antitussigen), calmant del sistema nerviós, espasmolítica i lleugerament hipnòtica (ideal per a infants).",
        "receptes": "Infusió dels pètals secs (s'han d'assecar ràpidament a l'ombra perquè no s'ennegreixin) combinats amb farigola per a la tos nocturna.",
        "toxicitat": "Baixa-moderada. Segura en ús popular de pètals. Evitar el consum de la càpsula verda i les tiges en quantitat pel seu contingut en alcaloides."
    },
    "Milfulles": {
        "descripcio_fulla": "Alternes, allargades i dividides de forma elegant en centenars de segments linears finíssims, donant l'aspecte d'una ploma verda molt tova.",
        "descripcio_tija": "Erecta, gairebé cilíndrica o lleument estriada, rígida, llanosa i poc ramificada; neix d'un rizoma reptant subterrani.",
        "descripcio_flor": "Capítols menuts reunits en corimbes terminals plans; flors de la vora blanques o rosades (falsos pètals) i les del centre groguenques.",
        "remeis": "Potent hemostàtica (talla hemorràgies), cicatritzant, antiinflamatòria, espasmolítica de l'aparell digestiu i emenagoga.",
        "receptes": "Decocció de la planta per a rentar ferides, llagues o cremades (ús extern); infusió de sumitats per a regles doloroses.",
        "toxicitat": "Baixa. Pot produir reaccions al·lèrgiques cutànies per contacte (dermatitis) en persones molt sensibles a les compostes."
    },
    "Ortiga": {
        "descripcio_fulla": "Grans, oposades, ovades o cordiformes, de color verd fosc; marge marcadament dentat. Cobertes de pèls urticants rígids i trencadissos.",
        "descripcio_tija": "Erecta, quadrangular, estriada, generalment simple; recoberta tant de pèls urticants (replets d'àcid fòrmic) com de pèls normals.",
        "descripcio_flor": "Insignificants, de color verdós, agrupades en aments o rams penjants a les axil·les de les fulles; plantes dioiques (sexes separats).",
        "remeis": "Molt remineralitzant (rica en ferro i sílice), diürètica, uricosúrica (elimina àcid úric, ideal contra la gota), antianèmica i astringent.",
        "receptes": "Sopa d'ortigues tendres (bullides perden totalment el poder urticant) contra el cansat; decocció d'arrel per a la dermatitis seborreica.",
        "toxicitat": "Molt segura com a aliment o medicina. L'únic perill és la coïssor i inflamació cutània immediata en tocar-la fresca al camp."
    }
}


def enriquir_herbari(fitxer_entrada, fitxer_sortida):
    if not os.path.exists(fitxer_entrada):
        print(f"❌ Error: No s'ha trobat el fitxer '{fitxer_entrada}' a la carpeta actual.")
        print("Si us plau, assegura't que el fitxer CSV original estigui al mateix directori.")
        return

    print(f"📖 Llegint '{fitxer_entrada}' i processant les descripcions...")
    
    comptador_enriquides = 0
    
    # Obrim el fitxer d'entrada especificant el delimitador ';' que fa servir la teva base de dades
    with open(fitxer_entrada, mode='r', encoding='utf-8') as f_in:
        lector = csv.DictReader(f_in, delimiter=';')
        camps = lector.fieldnames
        
        # Preparem les files per escriure
        files_modificades = []
        
        for fila in lector:
            nom_comu = fila.get('nom_comu', '').strip()
            
            # Si tenim una ampliació de contingut preparada per a aquesta herba, la apliquem
            if nom_comu in AMPLIACIONS_BOTANIQUES:
                dades_noves = AMPLIACIONS_BOTANIQUES[nom_comu]
                
                # Només modifiquem o ampliem si el camp original és molt curt (menys de 50 caràcters) o està buit
                for camp, contingut_nou in dades_noves.items():
                    if camp in fila:
                        contingut_actual = fila[camp].strip()
                        if len(contingut_actual) < 50 or contingut_actual == "":
                            fila[camp] = contingut_nou
                
                comptador_enriquides += 1
            
            files_modificades.append(fila)

    # Guardem el resultat en el nou fitxer CSV de sortida
    with open(fitxer_sortida, mode='w', encoding='utf-8', newline='') as f_out:
        escriptor = csv.DictWriter(f_out, fieldnames=camps, delimiter=';')
        escriptor.writeheader()
        escriptor.writerows(files_modificades)
        
    print(f"✨ Procés finalitzat amb èxit!")
    print(f"🌿 S'han revisat i ampliat de forma òptima: {comptador_enriquides} herbes icòniques.")
    print(f"💾 El teu nou fitxer enriquit està llistat a: '{fitxer_sortida}'")

# Execució de la funció
if __name__ == "__main__":
    FITXER_ORIGINAL = "Herbes final.csv"
    FITXER_RESULTAT = "Herbes_Enriquit.csv"
    enriquir_herbari(FITXER_ORIGINAL, FITXER_RESULTAT)