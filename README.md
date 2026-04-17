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

