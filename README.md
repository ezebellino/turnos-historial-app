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
- genera un `.exe` portable con Electron Builder en `dist/`

La base SQLite se guarda en una carpeta portable junto al ejecutable para poder moverla en pendrive.

## Entrega al usuario

Archivo principal:

- `dist/Turnos-Historial-App-Portable.exe`

Carpeta de datos creada automaticamente al abrir la app:

- `TurnosHistorialData/`

Dentro de esa carpeta quedan guardados:

- base de datos SQLite
- fotos de pacientes
- informacion local del sistema

Recomendacion para entregar:

1. Copiar `Turnos-Historial-App-Portable.exe` a un pendrive.
2. Si ya existen datos reales, copiar tambien la carpeta `TurnosHistorialData/`.
3. En la PC del kinesiologo, abrir el `.exe` con doble click.
4. Mantener siempre el `.exe` y `TurnosHistorialData` en la misma ubicacion.

## Uso rapido para el kinesiologo

Primer ingreso:

1. Abrir `Turnos-Historial-App-Portable.exe`.
2. Completar `Nombre completo`, `Username`, `Contrasena` y celular.
3. Guardar el codigo de recuperacion.

Uso diario:

1. Ingresar con `username` y `contrasena`.
2. Crear pacientes desde `Nuevo paciente`.
3. Crear turnos desde `Nuevo turno`.
4. Revisar `Turnos de hoy` para enviar recordatorios por WhatsApp.
5. Editar pacientes o turnos tocando el registro correspondiente.

Funciones incluidas:

- agenda semanal y vista por dia
- historial por paciente
- conteo de sesiones
- fotos de pacientes
- recordatorios por WhatsApp
- edicion y eliminacion de turnos
- eliminacion de pacientes

## Recomendaciones de respaldo

- Hacer copia periodica de la carpeta `TurnosHistorialData/`
- Guardar una copia en otro pendrive o en una carpeta de respaldo
- No borrar esa carpeta si se quiere conservar historial, fotos y agenda
