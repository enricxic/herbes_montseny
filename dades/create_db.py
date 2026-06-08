import csv
import sqlite3
import os

def create_database():
    csv_path = os.path.join('dades', 'Herbes final.csv')
    db_path = os.path.join('dades', 'herbes.db')
    
    # Eliminar BD anterior si existeix
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"S'ha eliminat la base de dades existent a {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Crear taula herbes
    cursor.execute('''
    CREATE TABLE herbes (
        idHerba INTEGER PRIMARY KEY,
        nom_comu TEXT NOT NULL,
        noms_comuns_coneguts TEXT,
        nom_cientific TEXT,
        familia TEXT,
        descripcio_fulla TEXT,
        descripcio_tija TEXT,
        descripcio_flor TEXT,
        inflorescencia TEXT,
        arrels TEXT,
        rebrots TEXT,
        fruits TEXT,
        llavors TEXT,
        habitat TEXT,
        epoca_recollida TEXT,
        remeis TEXT,
        receptes TEXT,
        toxicitat TEXT,
        parts_utilitzades TEXT
    )
    ''')
    
    # Crear taula galeria imatges
    cursor.execute('''
    CREATE TABLE herba_imatges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idHerba INTEGER,
        ruta_imatge TEXT NOT NULL,
        descripcio TEXT,
        FOREIGN KEY (idHerba) REFERENCES herbes(idHerba)
    )
    ''')
    
    # Llegir CSV i inserir a BD
    with open(csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        headers = next(reader) # Saltar capçaleres
        
        insert_query = '''
        INSERT INTO herbes (
            idHerba, nom_comu, noms_comuns_coneguts, nom_cientific, familia,
            descripcio_fulla, descripcio_tija, descripcio_flor, inflorescencia,
            arrels, rebrots, fruits, llavors, habitat, epoca_recollida,
            remeis, receptes, toxicitat, parts_utilitzades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        '''
        
        for row in reader:
            if not row:
                continue
            # Assegurar que tenim prou columnes (farfar 19 columnes)
            while len(row) < 19:
                row.append('')
            cursor.execute(insert_query, row[:19])
            
    print("S'han importat les herbes correctament del CSV.")
    
    # Inserir algunes imatges reals i de demostració de Unsplash d'alta qualitat per a la galeria
    # Llistat d'imatges d'Unsplash associades a les herbes més populars del catàleg
    galeries_demo = {
        # 1. Orenga
        1: [
            ("https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?auto=format&fit=crop&w=800&q=80", "Planta d'orenga fresca al camp"),
            ("https://images.unsplash.com/photo-1608797178974-15b35a61d121?auto=format&fit=crop&w=800&q=80", "Fulles d'orenga seques i preparades per cuinar"),
            ("https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80", "Espècies de cuina mediterrània")
        ],
        # 14. Romaní (Rosmarinus officinalis) - o l'ID correcte a la BD
        # Busquem Romaní, Farigola, Rosella a la BD. 
        # Farem una inserció dinàmica basant-nos en els IDs reals inserits.
    }
    
    # Obtenir els IDs reals de les herbes principals
    cursor.execute("SELECT idHerba, nom_comu FROM herbes")
    herbes_registrades = cursor.fetchall()
    
    # Imatges genèriques de botànica/plantes per omplir les que no tenen galeria personalitzada
    imatges_generiques = [
        "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1463936575829-25148e1db1b8?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=800&q=80"
    ]
    
    # Poblarem de forma personalitzada segons el nom de la planta
    for id_herba, nom in herbes_registrades:
        nom_l = nom.lower()
        imatges = []
        
        if "rosella" in nom_l:
            imatges = [
                ("imatges/Rosella.png", "Làmina de referència de la Rosella"),
                ("https://images.unsplash.com/photo-1560717789-0ac7c58ac90a?auto=format&fit=crop&w=800&q=80", "Camp de roselles florides a la primavera"),
                ("https://images.unsplash.com/photo-1498673394965-85cb14902c89?auto=format&fit=crop&w=800&q=80", "Detall de flor de rosella vermella")
            ]
        elif "romaní" in nom_l or "romani" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1594313757244-1f1504938a1a?auto=format&fit=crop&w=800&q=80", "Detall de branques de romaní fresc"),
                ("https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80", "Macerat d'oli de romaní i espècies"),
                ("https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=800&q=80", "Flor de romaní a la muntanya")
            ]
        elif "farigola" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1563865436914-44ec927b7385?auto=format&fit=crop&w=800&q=80", "Farigola silvestre florida"),
                ("https://images.unsplash.com/photo-1594313757244-1f1504938a1a?auto=format&fit=crop&w=800&q=80", "Farigola collida i lligada en un pom"),
                ("https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=800&q=80", "Preparació d'infusió de farigola")
            ]
        elif "orenga" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?auto=format&fit=crop&w=800&q=80", "Planta d'orenga al camp"),
                ("https://images.unsplash.com/photo-1608797178974-15b35a61d121?auto=format&fit=crop&w=800&q=80", "Fulles d'orenga seques aromàtiques")
            ]
        elif "menta" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1603033156172-c2e391307b22?auto=format&fit=crop&w=800&q=80", "Menta fresca de fulla verda lluminosa"),
                ("https://images.unsplash.com/photo-1628556270448-4d4e4148e1b1?auto=format&fit=crop&w=800&q=80", "Beguda refrescant de menta i llimona")
            ]
        elif "lavanda" in nom_l or "espígol" in nom_l or "espigol" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1528183429752-a97d0bf99b5a?auto=format&fit=crop&w=800&q=80", "Camps infinits de lavanda en flor"),
                ("https://images.unsplash.com/photo-1468327768560-75b778cbb551?auto=format&fit=crop&w=800&q=80", "Pom d'espígol lligat per assecar")
            ]
        elif "dent de lleó" in nom_l or "dent de lleo" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1533038590840-1cde6b66b723?auto=format&fit=crop&w=800&q=80", "Dent de lleó groc intens en un prat"),
                ("https://images.unsplash.com/photo-1500622944204-b135684e99fd?auto=format&fit=crop&w=800&q=80", "Detall de la bola de bufar blanca (vil·là)")
            ]
        elif "malva" in nom_l:
            imatges = [
                ("https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=800&q=80", "Flors de malva silvestre de color lila"),
                ("https://images.unsplash.com/photo-1507290439931-a861b5a38200?auto=format&fit=crop&w=800&q=80", "Detall de flor de malva")
            ]
        else:
            # Afegir imatges genèriques de botànica/plantes segons l'ID per fer-ho divers i bonic
            idx1 = (id_herba) % len(imatges_generiques)
            idx2 = (id_herba + 1) % len(imatges_generiques)
            imatges = [
                (imatges_generiques[idx1], f"Detall botànic de {nom}"),
                (imatges_generiques[idx2], f"Hàbitat natural de {nom}")
            ]
            
        for ruta, desc in imatges:
            cursor.execute("INSERT INTO herba_imatges (idHerba, ruta_imatge, descripcio) VALUES (?, ?, ?)", (id_herba, ruta, desc))
            
    conn.commit()
    conn.close()
    print("Base de dades SQLite creada amb èxit i poblada amb imatges per a la galeria.")

if __name__ == '__main__':
    create_database()
