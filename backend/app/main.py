from datetime import date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .database import Base, engine, get_db
from .models import Appointment, Patient
from .schemas import AppointmentCreate, AppointmentRead, AppointmentUpdate, DashboardSummary, PatientCreate, PatientRead


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Turnos Historial App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


WORK_START_HOUR = 8
WORK_END_HOUR = 20


def validate_business_rules(payload: AppointmentCreate, db: Session, appointment_id: int | None = None):
    if payload.date.weekday() > 4:
        raise HTTPException(status_code=400, detail="Solo se permiten turnos de lunes a viernes.")

    if payload.time.hour < WORK_START_HOUR or payload.time.hour >= WORK_END_HOUR:
        raise HTTPException(status_code=400, detail="El horario debe estar entre las 08:00 y las 20:00.")

    overlapping_query = select(Appointment).where(
        Appointment.date == payload.date,
        Appointment.time == payload.time,
        Appointment.status != "cancelled",
    )
    if appointment_id is not None:
        overlapping_query = overlapping_query.where(Appointment.id != appointment_id)

    existing = db.scalar(overlapping_query)
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un turno en ese horario.")


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


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/dashboard", response_model=DashboardSummary)
def dashboard(db: Session = Depends(get_db)):
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
):
    query = select(Patient).order_by(Patient.full_name.asc())
    if search:
        query = query.where(Patient.full_name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query).all())


@app.post("/patients", response_model=PatientRead, status_code=201)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db)):
    patient = Patient(**payload.model_dump())
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@app.get("/patients/{patient_id}/history", response_model=list[AppointmentRead])
def patient_history(patient_id: int, db: Session = Depends(get_db)):
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
def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
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
def update_appointment(appointment_id: int, payload: AppointmentUpdate, db: Session = Depends(get_db)):
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
def delete_appointment(appointment_id: int, db: Session = Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(status_code=404, detail="Turno no encontrado.")

    db.delete(appointment)
    db.commit()
