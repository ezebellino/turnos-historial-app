# Turnos Historial App

Aplicacion simple para gestionar pacientes, turnos e historial de atencion para kinesiologia.

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Base de datos: SQLite

## Estructura

- `frontend/`: interfaz principal
- `backend/`: API y persistencia

## Desarrollo

### Backend

```bash
cd backend
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

La API corre en `http://127.0.0.1:8000` y el frontend en `http://127.0.0.1:5173`.

## Fotos de pacientes

La app ahora permite cargar una foto opcional por paciente para reconocerlo visualmente.

- Se guarda en la misma PC
- No depende de internet
- Queda asociada al paciente en la base SQLite
- Los archivos se almacenan en la carpeta de datos local, dentro de `patient_photos/`

Formatos admitidos:

- JPG
- PNG
- WEBP

Tamano maximo por foto:

- 5 MB

## Escritorio portable

Se agrego una base de escritorio con Electron para llevar la app en Windows.

### Modo escritorio en desarrollo

```bash
npm install
npm run desktop:dev
```

Ese comando ahora:

- levanta Vite automaticamente
- abre Electron
- usa el backend de escritorio

Si existe `backend/.venv`, se usa ese Python de forma automatica.

### Generar portable para Windows

```bash
cd backend
py -3 -m pip install -r requirements.txt
cd ..
npm install
npm run desktop:portable
```

El flujo hace:

- build del frontend
- empaqueta FastAPI con PyInstaller
- genera un `.exe` portable con Electron Builder en `desktop-dist/`

La base SQLite se guarda en una carpeta portable junto al ejecutable para poder moverla en pendrive.
