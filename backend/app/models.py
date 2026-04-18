from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(40), default=None)
    password_hash: Mapped[str] = mapped_column(String(256))
    recovery_code_hash: Mapped[str] = mapped_column(String(256))
    session_token_hash: Mapped[str | None] = mapped_column(String(256), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), index=True)
    photo_filename: Mapped[str | None] = mapped_column(String(255), default=None)
    phone: Mapped[str | None] = mapped_column(String(40), default=None)
    email: Mapped[str | None] = mapped_column(String(120), default=None)
    diagnosis: Mapped[str | None] = mapped_column(String(160), default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)
    prescribed_sessions: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    appointments: Mapped[list["Appointment"]] = relationship(
        back_populates="patient",
        cascade="all, delete-orphan",
        order_by="Appointment.date.desc()",
    )

    @property
    def completed_sessions(self) -> int:
        return sum(1 for appointment in self.appointments if appointment.status == "completed")

    @property
    def remaining_sessions(self) -> int:
        return max(self.prescribed_sessions - self.completed_sessions, 0)

    @property
    def photo_url(self) -> str | None:
        if not self.photo_filename:
            return None
        return f"/patient-photos/{self.photo_filename}"


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    time: Mapped[time] = mapped_column(Time, index=True)
    duration_minutes: Mapped[int] = mapped_column(default=60)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    reason: Mapped[str | None] = mapped_column(String(160), default=None)
    evolution_note: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    patient: Mapped["Patient"] = relationship(back_populates="appointments")
