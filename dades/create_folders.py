import sqlite3
import os
import shutil
import unicodedata
import re

def slugify(text):
    # Convertir a minúscules i normalitzar per treure accents
    text = text.lower()
    text = text.replace('·', 'l').replace('l.l', 'll')
    nfkd_form = unicodedata.normalize('NFKD', text)
    text = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    # Reemplaçar espais i caràcters especials per guions baixos
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '_', text)
    return text.strip('_')

def create_gallery_folders_by_name():
    db_path = os.path.join('dades', 'herbes.db')
    base_gallery_path = os.path.join('imatges', 'galeria')
    
    # Esborrar la carpeta de galeria anterior (amb números) per començar de net
    if os.path.exists(base_gallery_path):
        shutil.rmtree(base_gallery_path)
        print(f"S'ha netejat l'estructura anterior a: {base_gallery_path}")
        
    os.makedirs(base_gallery_path)
    print(f"Creada la carpeta principal buida: {base_gallery_path}")
        
    if not os.path.exists(db_path):
        print(f"Error: No s'ha trobat la base de dades a {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Obtenir tots els IDs i noms de les herbes
    cursor.execute("SELECT idHerba, nom_comu FROM herbes")
    herbes = cursor.fetchall()
    
    folders_created = 0
    for id_herba, nom in herbes:
        # Generar un nom de carpeta net i intuïtiu (slug)
        folder_name = slugify(nom)
        folder_path = os.path.join(base_gallery_path, folder_name)
        
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
            with open(os.path.join(folder_path, '.gitkeep'), 'w') as f:
                pass
            folders_created += 1
            
    conn.close()
    print(f"S'han creat correctament {folders_created} subcarpetes amb el nom de les herbes a {base_gallery_path}.")

if __name__ == '__main__':
    create_gallery_folders_by_name()
