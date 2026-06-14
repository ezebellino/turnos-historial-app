# Turnos Historial App

Aplicacion local para gestionar pacientes, turnos e historial de atencion en kinesiologia.

Pensada para una sola PC, con foco en:

- agenda clara
- historial clinico simple
- control de sesiones
- uso portable en Windows

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Base de datos: SQLite
- Escritorio portable: Electron + PyInstaller

## Funciones principales

- login local con `username` y contrasena
- recuperacion de acceso con codigo
- agenda por dia, semana y mes
- calendario mensual con pacientes nuevos destacados
- alta, edicion y eliminacion de pacientes
- alta, edicion y eliminacion de turnos
- multiples pacientes en el mismo horario
- historial por paciente con ultimas sesiones y detalle clinico
- fotos opcionales de pacientes
- contador de sesiones realizadas y restantes
- recordatorios por WhatsApp
- modal de turnos del dia

## Funciones clinicas nuevas

La version actual incorpora automatizacion de tratamientos.

### Planificacion automatica de sesiones

Cada paciente puede tener:

- cantidad total de sesiones
- fecha de comienzo
- horario preferido
- dias fijos de atencion
- mes de facturacion
- valor por sesion

Con esos datos, la app puede generar automaticamente los turnos futuros hasta completar el tratamiento.

Ejemplo:

- paciente con `10 sesiones`
- `martes y jueves`
- `16:00`

La app distribuye ese patron automaticamente hasta completar el plan.

### Reprogramacion manual

Si una sesion puntual cambia:

- el turno puede editarse manualmente
- la reprogramacion no rompe el resto del esquema

### Feriados locales

Los feriados se cargan manualmente desde la app.

Si un turno automatico cae en un feriado:

- no se toma como sesion realizada
- se mueve al siguiente dia valido segun el patron del paciente

### Control mensual de nuevos pacientes

La app controla automaticamente los pacientes que comienzan en el mes actual.

- limite mensual configurado: `20 pacientes`
- si se intenta cargar el paciente `21`, la app ofrece pasarlo al mes siguiente mediante confirmacion

### Estimacion mensual de PAMI

Por paciente se puede cargar:

- valor por sesion
- cantidad total de sesiones

La app calcula el valor total proyectado del tratamiento y muestra un estimado mensual para control administrativo.

## Estructura

- `frontend/`: interfaz principal
- `backend/`: API y persistencia
- `desktop/`: integracion Electron y build portable

## Desarrollo local

### Backend

```powershell
cd backend
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

La API corre en `http://127.0.0.1:8000` y el frontend en `http://127.0.0.1:5173`.

## Fotos de pacientes

La foto del paciente es opcional.

- se guarda en la misma PC
- no depende de internet
- queda asociada al paciente
- los archivos se almacenan dentro de `patient_photos/`

Formatos admitidos:

- JPG
- PNG
- WEBP

Tamano maximo:

- 5 MB

## Escritorio portable

La app puede entregarse como ejecutable portable para Windows.

### Ejecutar escritorio en desarrollo

```powershell
npm install
npm run desktop:dev
```

### Generar portable para Windows

Requisitos validados para esta build:

- Node.js instalado
- Python `3.10` disponible en Windows
- dependencias del frontend instaladas

Comando:

```powershell
npm install
npm run desktop:portable
```

Ese flujo:

- builda el frontend
- empaqueta el backend
- genera el portable final en `dist/`

## Archivo a entregar

El ejecutable correcto para entregar al cliente es:

- `dist/Turnos-Historial-App-Portable.exe`

Ese archivo fue validado con arranque real y backend interno respondiendo correctamente.

## Datos del usuario

Al abrir el portable se crea o reutiliza la carpeta:

- `TurnosHistorialData/`

Dentro quedan:

- base SQLite
- fotos de pacientes
- datos locales de la aplicacion

## Actualizacion en una PC que ya tiene version vieja

Si el cliente ya usa una version anterior:

1. cerrar la app vieja
2. reemplazar el `.exe` anterior por el nuevo `Turnos-Historial-App-Portable.exe`
3. conservar la carpeta `TurnosHistorialData/`
4. mantener el `.exe` y `TurnosHistorialData` en la misma ubicacion

No borrar `TurnosHistorialData` si se quiere conservar:

- pacientes
- turnos
- historial
- fotos

## Uso rapido para el kinesiologo

Primer ingreso:

1. abrir `Turnos-Historial-App-Portable.exe`
2. completar `Nombre completo`, `Username`, `Contrasena` y celular
3. crear el acceso local

Uso diario:

1. ingresar con `username` y `contrasena`
2. crear pacientes desde `Nuevo paciente`
3. crear turnos desde `Nuevo turno`
4. revisar `Turnos de hoy`
5. usar la agenda semanal o mensual segun necesidad
6. editar pacientes y turnos desde sus respectivas tarjetas o modales

## Respaldo recomendado

- hacer copia periodica de `TurnosHistorialData/`
- guardar una copia en OneDrive, Google Drive o un pendrive aparte
- no mover solo la base sin sus fotos si tambien se usan imagenes de pacientes
