import os
import re
import sqlite3
import unicodedata
import shutil

def slugify(text):
    # Normalitzar text per separar els accents
    text = unicodedata.normalize('NFD', text)
    # Eliminar els accents (Mn és la categoria de marques combinades)
    text = "".join([c for c in text if unicodedata.category(c) != 'Mn'])
    text = text.lower()
    text = text.replace('·', 'l')
    # Mantenir només lletres, números, guions i guions baixos
    text = re.sub(r'[^a-z0-9\s\-_]', '', text)
    text = text.strip()
    # Substituir espais i guions per guions baixos
    text = re.sub(r'[-\s]+', '_', text)
    return text

def sync():
    db_path = os.path.join('dades', 'herbes.db')
    galeria_dir = os.path.join('imatges', 'galeria')
    
    if not os.path.exists(db_path):
        print(f"Error: No s'ha trobat la base de dades a {db_path}")
        return
        
    if not os.path.exists(galeria_dir):
        print(f"Error: No s'ha trobat el directori de galeria a {galeria_dir}")
        return

    # Connexió a SQLite
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Buidar la taula herba_imatges completament
    cursor.execute("DELETE FROM herba_imatges")
    print("S'ha buidat la taula 'herba_imatges' correctament de la base de dades local.")

    # 2. Obtenir el mapa de plantes (nom_comu -> idHerba)
    cursor.execute("SELECT idHerba, nom_comu FROM herbes")
    herbes = cursor.fetchall()
    
    slug_to_id = {}
    for id_herba, nom in herbes:
        slug = slugify(nom)
        slug_to_id[slug] = id_herba

    # 3. Escanejar les carpetes de la galeria
    folders = [f for f in os.listdir(galeria_dir) if os.path.isdir(os.path.join(galeria_dir, f))]
    
    empty_deleted = 0
    images_registered = 0
    
    for folder in folders:
        folder_path = os.path.join(galeria_dir, folder)
        files = [f for f in os.listdir(folder_path) if os.path.isfile(os.path.join(folder_path, f))]
        
        # Ignorar fitxers del sistema operatiu i control de git
        files = [f for f in files if f.lower() not in ['thumbs.db', '.ds_store', '.gitkeep', '.gitignore']]
        
        if len(files) == 0:
            # Eliminar la carpeta buida
            try:
                shutil.rmtree(folder_path)
                empty_deleted += 1
            except Exception as e:
                print(f"No s'ha pogut eliminar la carpeta buida {folder}: {e}")
        else:
            # Si la carpeta té fitxers, mirem si té relació amb alguna herba
            id_herba = slug_to_id.get(folder)
            if id_herba:
                for file in files:
                    file_lower = file.lower()
                    
                    # Identificar de quin detall es tracta segons el nom del fitxer
                    if 'fulla' in file_lower or 'leaf' in file_lower:
                        descripcio = "Detall de la fulla (_fulla)"
                    elif 'flor' in file_lower or 'flower' in file_lower:
                        descripcio = "Detall de la flor (_flor)"
                    elif 'fruit' in file_lower or 'seed' in file_lower:
                        descripcio = "Detall del fruit (_fruit)"
                    else:
                        descripcio = "Imatge general"
                        
                    # Camí relatiu per desar a la base de dades
                    ruta_db = f"imatges/galeria/{folder}/{file}"
                    
                    # Inserir registre a SQLite
                    cursor.execute(
                        "INSERT INTO herba_imatges (idHerba, ruta_imatge, descripcio) VALUES (?, ?, ?)",
                        (id_herba, ruta_db, descripcio)
                    )
                    images_registered += 1
            else:
                print(f"Avís: La carpeta '{folder}' conté fitxers però no s'ha trobat cap planta amb aquest nom al catàleg.")

    conn.commit()
    conn.close()
    
    print("\n--- RESUM DE LA SINCRONITZACIO ---")
    print(f"Carpetes buides eliminades: {empty_deleted}")
    print(f"Imatges de disc registrades a la BD: {images_registered}")

if __name__ == '__main__':
    sync()
