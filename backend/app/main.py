from datetime import date, datetime, time, timedelta
import hashlib
import hmac
from pathlib import Path
import shutil
import secrets

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .database import DATA_DIR, get_db, init_db
from .models import Appointment, Patient, User
from .schemas import (
    AuthResponse,
    AuthStatus,
    AppointmentCreate,
    AppointmentRead,
    AppointmentUpdate,
    DashboardSummary,
    LoginRequest,
    PatientCreate,
    PatientRead,
    PatientUpdate,
    RecoverRequest,
    RecoveryCodeRequest,
    RecoveryCodeResponse,
    SetupRequest,
)


init_db()

app = FastAPI(title="Turnos Historial App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


WORK_START_HOUR = 8
WORK_END_HOUR = 20
SESSION_HEADER = "x-session-token"
PHOTO_MAX_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
PATIENT_PHOTOS_DIR = DATA_DIR / "patient_photos"
PATIENT_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/patient-photos", StaticFiles(directory=PATIENT_PHOTOS_DIR), name="patient-photos")


def hash_secret(value: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${derived.hex()}"


def verify_secret(value: str, stored_hash: str) -> bool:
    try:
        salt, expected = stored_hash.split("$", 1)
    except ValueError:
        return False
    derived = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
    return hmac.compare_digest(derived, expected)


def issue_session_token(user: User, db: Session) -> str:
    token = secrets.token_urlsafe(32)
    user.session_token_hash = hash_secret(token)
    db.commit()
    return token


def issue_recovery_code(user: User, db: Session) -> str:
    recovery_code = secrets.token_hex(4).upper()
    user.recovery_code_hash = hash_secret(recovery_code)
    db.commit()
    return recovery_code


def get_single_user(db: Session) -> User | None:
    return db.scalar(select(User).limit(1))


def get_current_user(
    session_token: str | None = Header(default=None, alias=SESSION_HEADER),
    db: Session = Depends(get_db),
):
    if not session_token:
        raise HTTPException(status_code=401, detail="Sesion requerida.")

    user = get_single_user(db)
    if not user or not user.session_token_hash or not verify_secret(session_token, user.session_token_hash):
        raise HTTPException(status_code=401, detail="Sesion invalida.")
    return user


def validate_business_rules(payload: AppointmentCreate, db: Session, appointment_id: int | None = None):
    if payload.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Solo se permiten turnos de lunes a viernes.")

    start_time = payload.time
    end_datetime = datetime.combine(payload.date, start_time) + timedelta(minutes=payload.duration_minutes)
    end_time = end_datetime.time()

    if start_time < time(hour=WORK_START_HOUR) or end_time > time(hour=WORK_END_HOUR):
        raise HTTPException(status_code=400, detail="El horario debe estar entre las 08:00 y las 20:00.")

    overlapping_query = select(Appointment).where(
        Appointment.patient_id == payload.patient_id,
        Appointment.date == payload.date,
        Appointment.time == payload.time,
        Appointment.status != "cancelled",
    )
    if appointment_id is not None:
        overlapping_query = overlapping_query.where(Appointment.id != appointment_id)

    existing = db.scalar(overlapping_query)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Ese paciente ya tiene un turno en la misma fecha y horario.",
        )


def read_appointment_or_404(appointment_id: int, db: Session):
    statement = (
        select(Appointment)
        .options(joinedload(Appointment.patient))
        .where(Appointment.id == appointment_id)
    )
    appointment = db.scalar(statement)
    if not appointment:
        raise HTTPException(status_code=404, detail="Turno no encontrado.")
    return appointment


def read_patient_or_404(patient_id: int, db: Session):
    statement = (
        select(Patient)
        .options(joinedload(Patient.appointments))
        .where(Patient.id == patient_id)
    )
    patient = db.scalar(statement)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")
    return patient


def delete_patient_photo_file(filename: str | None):
    if not filename:
        return

    file_path = PATIENT_PHOTOS_DIR / Path(filename).name
    if file_path.exists():
        file_path.unlink()


def persist_patient_photo(patient: Patient, upload: UploadFile, db: Session):
    if upload.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="La foto debe ser JPG, PNG o WEBP.")

    extension = ALLOWED_IMAGE_TYPES[upload.content_type]
    filename = f"patient-{patient.id}-{secrets.token_hex(8)}{extension}"
    target_path = PATIENT_PHOTOS_DIR / filename

    with target_path.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    if target_path.stat().st_size > PHOTO_MAX_BYTES:
        target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="La foto no puede superar los 5 MB.")

    delete_patient_photo_file(patient.photo_filename)
    patient.photo_filename = filename
    db.commit()
    return read_patient_or_404(patient.id, db)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/auth/status", response_model=AuthStatus)
def auth_status(
    session_token: str | None = Header(default=None, alias=SESSION_HEADER),
    db: Session = Depends(get_db),
):
    user = get_single_user(db)
    if not user:
        return AuthStatus(configured=False, authenticated=False)

    authenticated = bool(
        session_token and user.session_token_hash and verify_secret(session_token, user.session_token_hash)
    )
    return AuthStatus(
        configured=True,
        authenticated=authenticated,
        username=user.username if authenticated else None,
        full_name=user.full_name if authenticated else None,
        has_recovery_phone=bool(user.phone),
    )


@app.post("/auth/setup", response_model=AuthResponse, status_code=201)
def auth_setup(payload: SetupRequest, db: Session = Depends(get_db)):
    if get_single_user(db):
        raise HTTPException(status_code=400, detail="El usuario ya fue configurado.")

    recovery_code = secrets.token_hex(4).upper()
    user = User(
        username=payload.username.strip().lower(),
        full_name=payload.full_name.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        password_hash=hash_secret(payload.password),
        recovery_code_hash=hash_secret(recovery_code),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = issue_session_token(user, db)
    return AuthResponse(
        token=token,
        username=user.username,
        full_name=user.full_name,
        recovery_code=recovery_code,
    )


@app.post("/auth/login", response_model=AuthResponse)
def auth_login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = get_single_user(db)
    if not user:
        raise HTTPException(status_code=400, detail="Primero debes configurar el usuario.")

    if user.username != payload.username.strip().lower() or not verify_secret(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales invalidas.")

    token = issue_session_token(user, db)
    return AuthResponse(token=token, username=user.username, full_name=user.full_name)


@app.post("/auth/logout", status_code=204)
def auth_logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.session_token_hash = None
    db.commit()


@app.post("/auth/recovery-code", response_model=RecoveryCodeResponse)
def auth_recovery_code(payload: RecoveryCodeRequest, db: Session = Depends(get_db)):
    user = get_single_user(db)
    if not user or user.username != payload.username.strip().lower():
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    phone = payload.phone.strip() if payload.phone else user.phone
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Carga un celular para enviarte el codigo por WhatsApp.",
        )

    if payload.phone:
        user.phone = phone

    recovery_code = issue_recovery_code(user, db)
    return RecoveryCodeResponse(recovery_code=recovery_code, phone=phone)


@app.post("/auth/recover", response_model=AuthResponse)
def auth_recover(payload: RecoverRequest, db: Session = Depends(get_db)):
    user = get_single_user(db)
    if not user or user.username != payload.username.strip().lower():
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    if not verify_secret(payload.recovery_code.strip().upper(), user.recovery_code_hash):
        raise HTTPException(status_code=401, detail="Codigo de recuperacion invalido.")

    user.password_hash = hash_secret(payload.new_password)
    token = issue_session_token(user, db)
    return AuthResponse(token=token, username=user.username, full_name=user.full_name)


@app.get("/dashboard", response_model=DashboardSummary)
def dashboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    today = date.today()
    upcoming = db.scalar(
        select(func.count()).select_from(Appointment).where(
            Appointment.date >= today,
            Appointment.status == "scheduled",
        )
    ) or 0
    completed = db.scalar(
        select(func.count()).select_from(Appointment).where(Appointment.status == "completed")
    ) or 0
    total_patients = db.scalar(select(func.count()).select_from(Patient)) or 0

    return DashboardSummary(
        total_patients=total_patients,
        upcoming_appointments=upcoming,
        completed_sessions=completed,
        today_label=today.strftime("%d/%m/%Y"),
    )


@app.get("/patients", response_model=list[PatientRead])
def list_patients(
    search: str | None = Query(default=None, min_length=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Patient).options(joinedload(Patient.appointments)).order_by(Patient.full_name.asc())
    if search:
        query = query.where(Patient.full_name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query).unique().all())


@app.post("/patients", response_model=PatientRead, status_code=201)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    patient = Patient(**payload.model_dump())
    db.add(patient)
    db.commit()
    statement = (
        select(Patient)
        .options(joinedload(Patient.appointments))
        .where(Patient.id == patient.id)
    )
    return db.scalar(statement)


@app.patch("/patients/{patient_id}", response_model=PatientRead)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(patient, field, value)

    db.commit()

    statement = (
        select(Patient)
        .options(joinedload(Patient.appointments))
        .where(Patient.id == patient.id)
    )
    return db.scalar(statement)


@app.post("/patients/{patient_id}/photo", response_model=PatientRead)
def upload_patient_photo(
    patient_id: int,
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    try:
        return persist_patient_photo(patient, photo, db)
    finally:
        photo.file.close()


@app.delete("/patients/{patient_id}/photo", response_model=PatientRead)
def delete_patient_photo(
    patient_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    delete_patient_photo_file(patient.photo_filename)
    patient.photo_filename = None
    db.commit()
    return read_patient_or_404(patient.id, db)


@app.get("/patients/{patient_id}/history", response_model=list[AppointmentRead])
def patient_history(patient_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    query = (
        select(Appointment)
        .options(joinedload(Appointment.patient))
        .where(Appointment.patient_id == patient_id)
        .order_by(Appointment.date.desc(), Appointment.time.desc())
    )
    return list(db.scalars(query).unique().all())


@app.get("/appointments", response_model=list[AppointmentRead])
def list_appointments(
    start: date | None = None,
    end: date | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if start is None:
        today = date.today()
        start = today - timedelta(days=today.weekday())
    if end is None:
        end = start + timedelta(days=4)

    query = (
        select(Appointment)
        .options(joinedload(Appointment.patient))
        .where(Appointment.date >= start, Appointment.date <= end)
        .order_by(Appointment.date.asc(), Appointment.time.asc())
    )
    return list(db.scalars(query).unique().all())


@app.post("/appointments", response_model=AppointmentRead, status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    validate_business_rules(payload, db)

    appointment = Appointment(**payload.model_dump())
    db.add(appointment)
    db.commit()
    db.refresh(appointment)

    statement = (
        select(Appointment)
        .options(joinedload(Appointment.patient))
        .where(Appointment.id == appointment.id)
    )
    return db.scalar(statement)


@app.patch("/appointments/{appointment_id}", response_model=AppointmentRead)
def update_appointment(
    appointment_id: int,
    payload: AppointmentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(status_code=404, detail="Turno no encontrado.")

    changes = payload.model_dump(exclude_unset=True)
    if "patient_id" in changes:
        patient = db.get(Patient, changes["patient_id"])
        if not patient:
            raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    if {"patient_id", "date", "time", "duration_minutes"} & changes.keys():
        merged_payload = AppointmentCreate(
            patient_id=changes.get("patient_id", appointment.patient_id),
            date=changes.get("date", appointment.date),
            time=changes.get("time", appointment.time),
            duration_minutes=changes.get("duration_minutes", appointment.duration_minutes),
            status=changes.get("status", appointment.status),
            reason=changes.get("reason", appointment.reason),
            evolution_note=changes.get("evolution_note", appointment.evolution_note),
        )
        validate_business_rules(merged_payload, db, appointment_id=appointment_id)

    for field, value in changes.items():
        setattr(appointment, field, value)

    db.commit()
    return read_appointment_or_404(appointment.id, db)


@app.delete("/appointments/{appointment_id}", status_code=204)
def delete_appointment(
    appointment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(status_code=404, detail="Turno no encontrado.")

    db.delete(appointment)
    db.commit()
