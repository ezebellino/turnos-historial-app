import { startTransition, useEffect, useMemo, useState } from "react";
import {
  createAppointment,
  createPatient,
  fetchAppointments,
  fetchDashboard,
  fetchPatientHistory,
  fetchPatients,
  updateAppointment,
} from "./api";

const weekdayFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_LABELS = {
  scheduled: "Programado",
  completed: "Realizado",
  cancelled: "Cancelado",
};

const STATUS_CLASS = {
  scheduled: "status-planned",
  completed: "status-done",
  cancelled: "status-cancelled",
};

const DEFAULT_PATIENT_FORM = {
  full_name: "",
  phone: "",
  email: "",
  diagnosis: "",
  notes: "",
};

function getWeekRange(baseDate) {
  const current = new Date(baseDate);
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + diff);

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(current);
    date.setDate(current.getDate() + index);
    return date;
  });
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClock(dateString, timeString) {
  return timeFormatter.format(new Date(`${dateString}T${timeString}`));
}

export default function App() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [dashboard, setDashboard] = useState(null);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [history, setHistory] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientForm, setPatientForm] = useState(DEFAULT_PATIENT_FORM);
  const [appointmentForm, setAppointmentForm] = useState({
    patient_id: "",
    date: toDateInputValue(getWeekRange(new Date())[0]),
    time: "08:00",
    duration_minutes: 60,
    reason: "",
    evolution_note: "",
    status: "scheduled",
  });
  const [savingPatient, setSavingPatient] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const weekDates = useMemo(() => getWeekRange(weekAnchor), [weekAnchor]);
  const weekStart = toDateInputValue(weekDates[0]);
  const weekEnd = toDateInputValue(weekDates[4]);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadPatients(patientSearch);
  }, [patientSearch]);

  useEffect(() => {
    loadAppointments(weekStart, weekEnd);
  }, [weekStart, weekEnd]);

  useEffect(() => {
    if (!selectedPatientId) {
      setHistory([]);
      return;
    }
    fetchPatientHistory(selectedPatientId)
      .then(setHistory)
      .catch((error) => setErrorMessage(error.message));
  }, [selectedPatientId]);

  async function loadDashboard() {
    try {
      const data = await fetchDashboard();
      setDashboard(data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function loadPatients(searchValue) {
    try {
      const data = await fetchPatients(searchValue);
      setPatients(data);
      if (!selectedPatientId && data.length > 0) {
        setSelectedPatientId(data[0].id);
        setAppointmentForm((current) => ({ ...current, patient_id: String(data[0].id) }));
      }
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function loadAppointments(start, end) {
    try {
      const data = await fetchAppointments(start, end);
      setAppointments(data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function shiftWeek(direction) {
    startTransition(() => {
      setWeekAnchor((current) => {
        const next = new Date(current);
        next.setDate(next.getDate() + direction * 7);
        return next;
      });
    });
  }

  async function handlePatientSubmit(event) {
    event.preventDefault();
    setSavingPatient(true);
    setErrorMessage("");

    try {
      const created = await createPatient(patientForm);
      setPatientForm(DEFAULT_PATIENT_FORM);
      await loadPatients(patientSearch);
      setSelectedPatientId(created.id);
      setAppointmentForm((current) => ({
        ...current,
        patient_id: String(created.id),
      }));
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setSavingPatient(false);
    }
  }

  async function handleAppointmentSubmit(event) {
    event.preventDefault();
    setSavingAppointment(true);
    setErrorMessage("");

    try {
      await createAppointment({
        ...appointmentForm,
        patient_id: Number(appointmentForm.patient_id),
        duration_minutes: Number(appointmentForm.duration_minutes),
      });
      setAppointmentForm((current) => ({
        ...current,
        reason: "",
        evolution_note: "",
        status: "scheduled",
      }));
      await Promise.all([
        loadAppointments(weekStart, weekEnd),
        loadDashboard(),
        selectedPatientId ? fetchPatientHistory(selectedPatientId).then(setHistory) : Promise.resolve(),
      ]);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setSavingAppointment(false);
    }
  }

  async function handleStatusChange(appointment, status) {
    setErrorMessage("");
    try {
      await updateAppointment(appointment.id, { status });
      await Promise.all([
        loadAppointments(weekStart, weekEnd),
        loadDashboard(),
        selectedPatientId ? fetchPatientHistory(selectedPatientId).then(setHistory) : Promise.resolve(),
      ]);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;

  const appointmentsByDay = useMemo(() => {
    return weekDates.map((date) => {
      const key = toDateInputValue(date);
      return {
        key,
        label: weekdayFormatter.format(date),
        items: appointments.filter((appointment) => appointment.date === key),
      };
    });
  }, [appointments, weekDates]);

  return (
    <div className="app-shell">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Turnos Historial App</p>
          <h1>Agenda y pacientes</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => shiftWeek(-1)}>
            Semana anterior
          </button>
          <button type="button" className="primary-button" onClick={() => setWeekAnchor(new Date())}>
            Hoy
          </button>
          <button type="button" className="ghost-button" onClick={() => shiftWeek(1)}>
            Semana siguiente
          </button>
        </div>
      </header>

      {dashboard ? (
        <section className="overview">
          <div>
            <span>Pacientes</span>
            <strong>{dashboard.total_patients}</strong>
          </div>
          <div>
            <span>Turnos activos</span>
            <strong>{dashboard.upcoming_appointments}</strong>
          </div>
          <div>
            <span>Sesiones realizadas</span>
            <strong>{dashboard.completed_sessions}</strong>
          </div>
          <div>
            <span>Hoy</span>
            <strong>{dashboard.today_label}</strong>
          </div>
        </section>
      ) : null}

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <main className="workspace">
        <section className="agenda-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Agenda semanal</p>
              <h2>{`${weekdayFormatter.format(weekDates[0])} - ${weekdayFormatter.format(weekDates[4])}`}</h2>
            </div>
          </div>

          <div className="week-grid">
            {appointmentsByDay.map((day) => (
              <article key={day.key} className="day-column">
                <header>
                  <span>{day.label}</span>
                  <strong>{day.items.length}</strong>
                </header>

                <div className="day-slots">
                  {day.items.length === 0 ? (
                    <div className="empty-state">Libre</div>
                  ) : (
                    day.items.map((appointment) => (
                      <button
                        type="button"
                        key={appointment.id}
                        className="appointment-item"
                        onClick={() => setSelectedPatientId(appointment.patient.id)}
                      >
                        <div className="appointment-main">
                          <strong>{appointment.patient.full_name}</strong>
                          <span>{formatClock(appointment.date, appointment.time)}</span>
                        </div>
                        <div className="appointment-meta">
                          <span className={`status-chip ${STATUS_CLASS[appointment.status]}`}>
                            {STATUS_LABELS[appointment.status]}
                          </span>
                          <div className="quick-actions">
                            <span onClick={(event) => event.stopPropagation()}>
                              <select
                                value={appointment.status}
                                onChange={(event) => handleStatusChange(appointment, event.target.value)}
                              >
                                <option value="scheduled">Programado</option>
                                <option value="completed">Realizado</option>
                                <option value="cancelled">Cancelado</option>
                              </select>
                            </span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="side-panel">
          <section className="pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Pacientes</p>
                <h2>Registro</h2>
              </div>
              <input
                className="search-input"
                type="search"
                placeholder="Buscar"
                value={patientSearch}
                onChange={(event) => setPatientSearch(event.target.value)}
              />
            </div>

            <div className="patient-list">
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  className={`patient-item ${selectedPatientId === patient.id ? "patient-item-active" : ""}`}
                  onClick={() => {
                    setSelectedPatientId(patient.id);
                    setAppointmentForm((current) => ({ ...current, patient_id: String(patient.id) }));
                  }}
                >
                  <strong>{patient.full_name}</strong>
                  <span>{patient.diagnosis || "Sin diagnostico"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Nuevo paciente</p>
                <h2>Alta rapida</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handlePatientSubmit}>
              <input
                required
                placeholder="Nombre y apellido"
                value={patientForm.full_name}
                onChange={(event) => setPatientForm((current) => ({ ...current, full_name: event.target.value }))}
              />
              <input
                placeholder="Telefono"
                value={patientForm.phone}
                onChange={(event) => setPatientForm((current) => ({ ...current, phone: event.target.value }))}
              />
              <input
                placeholder="Email"
                value={patientForm.email}
                onChange={(event) => setPatientForm((current) => ({ ...current, email: event.target.value }))}
              />
              <input
                placeholder="Diagnostico"
                value={patientForm.diagnosis}
                onChange={(event) => setPatientForm((current) => ({ ...current, diagnosis: event.target.value }))}
              />
              <textarea
                rows="3"
                placeholder="Notas"
                value={patientForm.notes}
                onChange={(event) => setPatientForm((current) => ({ ...current, notes: event.target.value }))}
              />
              <button className="primary-button" type="submit" disabled={savingPatient}>
                {savingPatient ? "Guardando..." : "Guardar paciente"}
              </button>
            </form>
          </section>

          <section className="pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Nuevo turno</p>
                <h2>Agenda</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleAppointmentSubmit}>
              <select
                required
                value={appointmentForm.patient_id}
                onChange={(event) =>
                  setAppointmentForm((current) => ({ ...current, patient_id: event.target.value }))
                }
              >
                <option value="">Seleccionar paciente</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.full_name}
                  </option>
                ))}
              </select>
              <div className="input-row">
                <input
                  required
                  type="date"
                  value={appointmentForm.date}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, date: event.target.value }))}
                />
                <input
                  required
                  type="time"
                  value={appointmentForm.time}
                  onChange={(event) => setAppointmentForm((current) => ({ ...current, time: event.target.value }))}
                />
              </div>
              <input
                placeholder="Motivo"
                value={appointmentForm.reason}
                onChange={(event) => setAppointmentForm((current) => ({ ...current, reason: event.target.value }))}
              />
              <textarea
                rows="3"
                placeholder="Evolucion"
                value={appointmentForm.evolution_note}
                onChange={(event) =>
                  setAppointmentForm((current) => ({ ...current, evolution_note: event.target.value }))
                }
              />
              <button className="primary-button" type="submit" disabled={savingAppointment}>
                {savingAppointment ? "Guardando..." : "Guardar turno"}
              </button>
            </form>
          </section>

          <section className="pane history-pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Historial</p>
                <h2>{selectedPatient ? selectedPatient.full_name : "Sin seleccionar"}</h2>
              </div>
            </div>

            <div className="history-list">
              {history.length === 0 ? (
                <div className="empty-history">Todavia sin registros.</div>
              ) : (
                history.map((entry) => (
                  <article key={entry.id} className="history-entry">
                    <div className="history-head">
                      <strong>{entry.date}</strong>
                      <span className={`status-chip ${STATUS_CLASS[entry.status]}`}>
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    <p>{entry.reason || "Sesion general"}</p>
                    <small>{entry.evolution_note || "Sin notas clinicas."}</small>
                  </article>
                ))
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
