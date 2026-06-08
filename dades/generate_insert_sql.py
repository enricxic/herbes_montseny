import sqlite3
import os

def generate():
    db_path = os.path.join('dades', 'herbes.db')
    out_path = os.path.join('dades', 'insert_images.sql')
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('SELECT idHerba, ruta_imatge, descripcio FROM herba_imatges')
    rows = cursor.fetchall()
    
    values = []
    for r in rows:
        id_herba = r[0]
        ruta = r[1]
        desc = r[2].replace("'", "''")  # Escapar cometes simples per SQL
        values.append(f"({id_herba}, '{ruta}', '{desc}')")
        
    sql = 'INSERT INTO herba_imatges ("idHerba", ruta_imatge, descripcio) VALUES\n'
    sql += ",\n".join(values) + ";"
    
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(sql)
        
    print(f"S'ha generat correctament el fitxer SQL a: {out_path}")
    conn.close()

if __name__ == '__main__':
    generate()
