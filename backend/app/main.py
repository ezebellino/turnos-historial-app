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
from .models import Appointment, Holiday, Patient, User
from .schemas import (
    AuthResponse,
    AuthStatus,
    AppointmentCreate,
    AppointmentRead,
    AppointmentUpdate,
    DashboardSummary,
    HolidayCreate,
    HolidayRead,
    LoginRequest,
    PatientCreate,
    PatientRead,
    PatientUpdate,
    PricingBulkApplyRequest,
    PricingSettingsRead,
    PricingSettingsUpdate,
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
MONTHLY_PATIENT_LIMIT = 20
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


def month_floor(value: date) -> date:
    return value.replace(day=1)


def next_month(value: date) -> date:
    return (value.replace(day=28) + timedelta(days=4)).replace(day=1)


def serialize_weekdays(values: list[int]) -> str | None:
    cleaned = sorted({int(value) for value in values if 0 <= int(value) <= 4})
    return ",".join(str(value) for value in cleaned) if cleaned else None


def parse_weekdays(value: str | None) -> list[int]:
    if not value:
        return []
    return [int(chunk) for chunk in value.split(",") if chunk != ""]


def appointment_key(appointment: Appointment) -> tuple[date, time, int]:
    return (appointment.date, appointment.time, appointment.id)


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


def sync_due_appointments(db: Session):
    now = datetime.now()
    due_appointments = db.scalars(
        select(Appointment).where(Appointment.status == "scheduled")
    ).all()
    changed = False

    for appointment in due_appointments:
        if datetime.combine(appointment.date, appointment.time) <= now:
            appointment.status = "completed"
            changed = True

    if changed:
        db.commit()
    sync_session_numbers(db)


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


def list_holiday_dates(db: Session) -> set[date]:
    return set(db.scalars(select(Holiday.date)).all())


def patient_plan_ready(patient: Patient) -> bool:
    return bool(
        patient.auto_schedule_enabled
        and patient.treatment_start_date
        and patient.preferred_time
        and parse_weekdays(patient.preferred_weekdays)
        and patient.prescribed_sessions > 0
    )


def assign_session_numbers(patient: Patient, db: Session):
    active_appointments = [
        appointment
        for appointment in sorted(patient.appointments, key=appointment_key)
        if appointment.status != "cancelled"
    ]
    for index, appointment in enumerate(active_appointments, start=1):
        appointment.session_number = index
    db.flush()


def sync_session_numbers(db: Session):
    patients = db.scalars(
        select(Patient).options(joinedload(Patient.appointments))
    ).unique().all()
    changed = False

    for patient in patients:
        active_appointments = [
            appointment
            for appointment in sorted(patient.appointments, key=appointment_key)
            if appointment.status != "cancelled"
        ]

        for index, appointment in enumerate(active_appointments, start=1):
            if appointment.session_number != index:
                appointment.session_number = index
                changed = True

        cancelled_appointments = [
            appointment for appointment in patient.appointments if appointment.status == "cancelled"
        ]
        for appointment in cancelled_appointments:
            if appointment.session_number is not None:
                appointment.session_number = None
                changed = True

    if changed:
        db.commit()


def ensure_month_capacity(db: Session, billing_month: date, exclude_patient_id: int | None = None):
    current_month = month_floor(date.today())
    if billing_month != current_month:
        return

    query = select(func.count()).select_from(Patient).where(Patient.billing_month == billing_month)
    if exclude_patient_id is not None:
        query = query.where(Patient.id != exclude_patient_id)

    current_count = db.scalar(query) or 0
    if current_count >= MONTHLY_PATIENT_LIMIT:
        raise HTTPException(
            status_code=400,
            detail="Ya alcanzaste el maximo de 20 pacientes del mes actual. Puedes asignarlo al proximo mes.",
        )


def normalize_patient_fields(payload: PatientCreate | PatientUpdate) -> dict:
    values = payload.model_dump(exclude_unset=True)
    if "preferred_weekdays" in values:
        values["preferred_weekdays"] = serialize_weekdays(values["preferred_weekdays"] or [])
    if values.get("treatment_start_date") and not values.get("billing_month"):
        values["billing_month"] = month_floor(values["treatment_start_date"])
    return values


def resolve_care_mode_rate(user: User, care_mode: str) -> int:
    if care_mode == "domiciliary":
        return user.domiciliary_rate
    return user.institutional_rate


def apply_default_session_price(
    values: dict,
    user: User,
    current_patient: Patient | None = None,
):
    next_mode = values.get("care_mode") or (current_patient.care_mode if current_patient else "institutional")

    if current_patient is None:
        if not values.get("session_price"):
            values["session_price"] = resolve_care_mode_rate(user, next_mode)
        return values

    if "session_price" in values:
        if values["session_price"] == 0:
            values["session_price"] = resolve_care_mode_rate(user, next_mode)
        return values

    if "care_mode" in values and values["care_mode"] != current_patient.care_mode:
        values["session_price"] = resolve_care_mode_rate(user, values["care_mode"])

    return values


def regenerate_patient_schedule(patient_id: int, db: Session):
    patient = read_patient_or_404(patient_id, db)
    if not patient_plan_ready(patient):
        assign_session_numbers(patient, db)
        db.commit()
        return read_patient_or_404(patient_id, db)

    weekdays = set(parse_weekdays(patient.preferred_weekdays))
    holiday_dates = list_holiday_dates(db)
    today = date.today()
    current_time = datetime.now().time()

    preserved = []
    for appointment in sorted(patient.appointments, key=appointment_key):
        future_slot = appointment.date > today or (appointment.date == today and appointment.time >= current_time)
        if appointment.status == "completed":
            preserved.append(appointment)
        elif appointment.status == "scheduled" and (not appointment.autogenerated or appointment.manual_override):
            preserved.append(appointment)
        elif appointment.status == "scheduled" and appointment.autogenerated and not appointment.manual_override and future_slot:
            db.delete(appointment)

    db.flush()

    reserved_slots = {
        (appointment.date, appointment.time)
        for appointment in preserved
        if appointment.status != "cancelled"
    }
    planned_sessions = len(
        [appointment for appointment in preserved if appointment.status != "cancelled"]
    )
    cursor = patient.treatment_start_date
    max_cursor = today + timedelta(days=730)

    while planned_sessions < patient.prescribed_sessions and cursor <= max_cursor:
        slot_key = (cursor, patient.preferred_time)
        if (
            cursor.weekday() in weekdays
            and cursor not in holiday_dates
            and cursor >= today
            and slot_key not in reserved_slots
        ):
            db.add(
                Appointment(
                    patient_id=patient.id,
                    date=cursor,
                    time=patient.preferred_time,
                    duration_minutes=60,
                    status="scheduled",
                    reason="Sesion programada",
                    autogenerated=True,
                    manual_override=False,
                )
            )
            reserved_slots.add(slot_key)
            planned_sessions += 1
        cursor += timedelta(days=1)

    db.flush()
    patient = read_patient_or_404(patient_id, db)
    assign_session_numbers(patient, db)
    db.commit()
    return read_patient_or_404(patient_id, db)


def regenerate_all_schedules(db: Session):
    patient_ids = list(
        db.scalars(select(Patient.id).where(Patient.auto_schedule_enabled == True)).all()
    )
    for patient_id in patient_ids:
        regenerate_patient_schedule(patient_id, db)


def validate_business_rules(
    payload: AppointmentCreate,
    db: Session,
    appointment_id: int | None = None,
    patient: Patient | None = None,
):
    if payload.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Solo se permiten turnos de lunes a viernes.")

    start_time = payload.time
    end_datetime = datetime.combine(payload.date, start_time) + timedelta(minutes=payload.duration_minutes)
    end_time = end_datetime.time()

    if start_time < time(hour=WORK_START_HOUR) or end_time > time(hour=WORK_END_HOUR):
        raise HTTPException(status_code=400, detail="El horario debe estar entre las 08:00 y las 20:00.")

    holiday_dates = list_holiday_dates(db)
    if payload.date in holiday_dates and patient and patient.care_mode != "domiciliary":
        raise HTTPException(
            status_code=400,
            detail="Ese dia esta cargado como feriado. Solo puedes agendarlo si el paciente es domiciliario.",
        )

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
        institutional_rate=0,
        domiciliary_rate=0,
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
    sync_due_appointments(db)
    today = date.today()
    current_month = month_floor(today)
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
    current_month_patients = db.scalar(
        select(func.count()).select_from(Patient).where(Patient.billing_month == current_month)
    ) or 0
    projected_revenue = db.scalar(
        select(func.coalesce(func.sum(Patient.session_price * Patient.prescribed_sessions), 0)).where(
            Patient.billing_month == current_month
        )
    ) or 0

    return DashboardSummary(
        total_patients=total_patients,
        upcoming_appointments=upcoming,
        completed_sessions=completed,
        today_label=today.strftime("%d/%m/%Y"),
        current_month_new_patients=current_month_patients,
        monthly_patient_limit=MONTHLY_PATIENT_LIMIT,
        current_month_projected_revenue=projected_revenue,
    )


@app.get("/settings/pricing", response_model=PricingSettingsRead)
def get_pricing_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return PricingSettingsRead(
        institutional_rate=current_user.institutional_rate,
        domiciliary_rate=current_user.domiciliary_rate,
    )


@app.put("/settings/pricing", response_model=PricingSettingsRead)
def update_pricing_settings(
    payload: PricingSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.institutional_rate = payload.institutional_rate
    current_user.domiciliary_rate = payload.domiciliary_rate
    db.commit()
    return PricingSettingsRead(
        institutional_rate=current_user.institutional_rate,
        domiciliary_rate=current_user.domiciliary_rate,
    )


@app.post("/settings/pricing/apply", response_model=PricingSettingsRead)
def bulk_apply_pricing(
    payload: PricingBulkApplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.scope == "all":
        current_user.institutional_rate = payload.amount
        current_user.domiciliary_rate = payload.amount
        patients = db.scalars(select(Patient)).all()
    else:
        if payload.scope == "institutional":
            current_user.institutional_rate = payload.amount
        else:
            current_user.domiciliary_rate = payload.amount
        patients = db.scalars(select(Patient).where(Patient.care_mode == payload.scope)).all()

    for patient in patients:
        patient.session_price = payload.amount

    db.commit()
    return PricingSettingsRead(
        institutional_rate=current_user.institutional_rate,
        domiciliary_rate=current_user.domiciliary_rate,
    )


@app.get("/holidays", response_model=list[HolidayRead])
def list_holidays(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(Holiday).order_by(Holiday.date.asc())).all())


@app.post("/holidays", response_model=HolidayRead, status_code=201)
def create_holiday(payload: HolidayCreate, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    existing = db.scalar(select(Holiday).where(Holiday.date == payload.date))
    if existing:
        raise HTTPException(status_code=400, detail="Ese feriado ya esta cargado.")

    holiday = Holiday(**payload.model_dump())
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    regenerate_all_schedules(db)
    return holiday


@app.delete("/holidays/{holiday_id}", status_code=204)
def delete_holiday(holiday_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    holiday = db.get(Holiday, holiday_id)
    if not holiday:
        raise HTTPException(status_code=404, detail="Feriado no encontrado.")
    db.delete(holiday)
    db.commit()
    regenerate_all_schedules(db)


@app.get("/patients", response_model=list[PatientRead])
def list_patients(
    search: str | None = Query(default=None, min_length=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sync_due_appointments(db)
    query = select(Patient).options(joinedload(Patient.appointments)).order_by(Patient.full_name.asc())
    if search:
        query = query.where(Patient.full_name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query).unique().all())


@app.post("/patients", response_model=PatientRead, status_code=201)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    values = normalize_patient_fields(payload)
    values = apply_default_session_price(values, current_user)
    billing_month = values.get("billing_month", month_floor(date.today()))
    ensure_month_capacity(db, billing_month)
    values.setdefault("billing_month", billing_month)

    patient = Patient(**values)
    db.add(patient)
    db.commit()
    db.refresh(patient)

    if patient_plan_ready(patient):
        return regenerate_patient_schedule(patient.id, db)
    return read_patient_or_404(patient.id, db)


@app.patch("/patients/{patient_id}", response_model=PatientRead)
def update_patient(
    patient_id: int,
    payload: PatientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado.")

    changes = normalize_patient_fields(payload)
    changes = apply_default_session_price(changes, current_user, patient)
    billing_month = changes.get("billing_month", patient.billing_month or month_floor(date.today()))
    ensure_month_capacity(db, billing_month, exclude_patient_id=patient_id)
    changes.setdefault("billing_month", billing_month)

    for field, value in changes.items():
        setattr(patient, field, value)

    db.commit()

    if patient_plan_ready(patient):
        return regenerate_patient_schedule(patient.id, db)
    return read_patient_or_404(patient.id, db)


@app.delete("/patients/{patient_id}", status_code=204)
def delete_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    patient = read_patient_or_404(patient_id, db)
    delete_patient_photo_file(patient.photo_filename)
    db.delete(patient)
    db.commit()


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
    sync_due_appointments(db)
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
    sync_due_appointments(db)
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

    validate_business_rules(payload, db, patient=patient)

    appointment = Appointment(**payload.model_dump(), autogenerated=False, manual_override=False)
    db.add(appointment)
    db.commit()
    db.refresh(appointment)

    if patient_plan_ready(patient):
        regenerate_patient_schedule(patient.id, db)
    else:
        sync_session_numbers(db)
    return read_appointment_or_404(appointment.id, db)


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
    previous_patient_id = appointment.patient_id
    target_patient = appointment.patient
    if "patient_id" in changes:
        patient = db.get(Patient, changes["patient_id"])
        if not patient:
            raise HTTPException(status_code=404, detail="Paciente no encontrado.")
        target_patient = patient

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
        validate_business_rules(merged_payload, db, appointment_id=appointment_id, patient=target_patient)

    scheduling_keys = {"patient_id", "date", "time"}
    if appointment.autogenerated and scheduling_keys & changes.keys():
        changes["manual_override"] = True

    for field, value in changes.items():
        setattr(appointment, field, value)

    db.commit()

    current_patient = db.get(Patient, appointment.patient_id)
    previous_patient = db.get(Patient, previous_patient_id)
    if current_patient and patient_plan_ready(current_patient):
        regenerate_patient_schedule(current_patient.id, db)
    elif current_patient:
        sync_session_numbers(db)
    if previous_patient and previous_patient.id != appointment.patient_id and patient_plan_ready(previous_patient):
        regenerate_patient_schedule(previous_patient.id, db)
    elif previous_patient and previous_patient.id != appointment.patient_id:
        sync_session_numbers(db)

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

    patient_id = appointment.patient_id
    db.delete(appointment)
    db.commit()

    patient = db.get(Patient, patient_id)
    if patient and patient_plan_ready(patient):
        regenerate_patient_schedule(patient.id, db)
    else:
        sync_session_numbers(db)
