import { startTransition, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  createAppointment,
  createPatient,
  deleteAppointment,
  fetchAppointments,
  fetchDashboard,
  fetchPatientHistory,
  fetchPatients,
  updateAppointment,
  updatePatient,
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
  prescribed_sessions: 10,
};

const DEFAULT_APPOINTMENT_FORM = {
  patient_id: "",
  date: "",
  time: "08:00",
  duration_minutes: 60,
  reason: "",
  evolution_note: "",
  status: "scheduled",
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

function sanitizeWhatsappNumber(phone) {
  return (phone || "").replace(/\D/g, "");
}

function buildWhatsappMessage(appointment) {
  const time = formatClock(appointment.date, appointment.time);
  return `Hola ${appointment.patient.full_name}, te recordamos tu turno de kinesiologia de hoy a las ${time}.`;
}

function validateAppointmentInput({ date, time }) {
  if (!date || !time) {
    return "Completa fecha y hora.";
  }

  const selectedDate = new Date(`${date}T12:00:00`);
  const weekday = selectedDate.getDay();
  if (weekday === 0 || weekday === 6) {
    return "Solo se permiten turnos de lunes a viernes.";
  }

  if (time < "08:00" || time > "19:00") {
    return "El horario debe estar entre las 08:00 y las 19:00.";
  }

  return null;
}

export default function App() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [dashboard, setDashboard] = useState(null);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [showReminders, setShowReminders] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [history, setHistory] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientForm, setPatientForm] = useState(DEFAULT_PATIENT_FORM);
  const [appointmentForm, setAppointmentForm] = useState({
    ...DEFAULT_APPOINTMENT_FORM,
    date: toDateInputValue(getWeekRange(new Date())[0]),
  });
  const [editingForm, setEditingForm] = useState(DEFAULT_APPOINTMENT_FORM);
  const [savingPatient, setSavingPatient] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [savingEdition, setSavingEdition] = useState(false);
  const [deletingAppointment, setDeletingAppointment] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const weekDates = useMemo(() => getWeekRange(weekAnchor), [weekAnchor]);
  const weekStart = toDateInputValue(weekDates[0]);
  const weekEnd = toDateInputValue(weekDates[4]);

  useEffect(() => {
    loadDashboard();
    loadTodayAppointments();
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

  useEffect(() => {
    const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId);
    if (!selectedAppointment) {
      setEditingForm(DEFAULT_APPOINTMENT_FORM);
      return;
    }

    setEditingForm({
      patient_id: String(selectedAppointment.patient.id),
      date: selectedAppointment.date,
      time: selectedAppointment.time.slice(0, 5),
      duration_minutes: selectedAppointment.duration_minutes,
      reason: selectedAppointment.reason || "",
      evolution_note: selectedAppointment.evolution_note || "",
      status: selectedAppointment.status,
    });
  }, [appointments, selectedAppointmentId]);

  async function loadDashboard() {
    try {
      const data = await fetchDashboard();
      setDashboard(data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function loadTodayAppointments() {
    try {
      const today = toDateInputValue(new Date());
      const data = await fetchAppointments(today, today);
      setTodayAppointments(data);
      setShowReminders(data.length > 0);
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
      setSelectedAppointmentId((current) => {
        if (current && data.some((appointment) => appointment.id === current)) {
          return current;
        }
        return null;
      });
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function refreshAgendaAndHistory(patientId = selectedPatientId) {
    await Promise.all([
      loadAppointments(weekStart, weekEnd),
      loadDashboard(),
      loadTodayAppointments(),
      patientId ? fetchPatientHistory(patientId).then(setHistory) : Promise.resolve(),
    ]);
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
      const validationError = validateAppointmentInput(appointmentForm);
      if (validationError) {
        throw new Error(validationError);
      }

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
      await refreshAgendaAndHistory();
    } catch (error) {
      setErrorMessage(error.message);
      await Swal.fire({
        title: "No se pudo guardar el turno",
        text: error.message,
        icon: "error",
        confirmButtonText: "Cerrar",
      });
    } finally {
      setSavingAppointment(false);
    }
  }

  async function openPatientEditor(patient) {
    const { value: formValues } = await Swal.fire({
      title: "Editar paciente",
      html: `
        <div class="swal-form-grid">
          <input id="swal-full-name" class="swal2-input" placeholder="Nombre y apellido" value="${patient.full_name}" />
          <input id="swal-phone" class="swal2-input" placeholder="Telefono con codigo pais" value="${patient.phone || ""}" />
          <input id="swal-email" class="swal2-input" placeholder="Email" value="${patient.email || ""}" />
          <input id="swal-diagnosis" class="swal2-input" placeholder="Diagnostico" value="${patient.diagnosis || ""}" />
          <input id="swal-sessions" class="swal2-input" type="number" min="0" max="120" placeholder="Cantidad de sesiones" value="${patient.prescribed_sessions}" />
          <textarea id="swal-notes" class="swal2-textarea" placeholder="Notas">${patient.notes || ""}</textarea>
        </div>
      `,
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: {
        popup: "swal-patient-modal",
      },
      preConfirm: () => {
        const fullName = document.getElementById("swal-full-name")?.value.trim();
        const phone = document.getElementById("swal-phone")?.value.trim() || "";
        const email = document.getElementById("swal-email")?.value.trim() || "";
        const diagnosis = document.getElementById("swal-diagnosis")?.value.trim() || "";
        const notes = document.getElementById("swal-notes")?.value.trim() || "";
        const prescribedSessions = Number(document.getElementById("swal-sessions")?.value ?? 0);

        if (!fullName) {
          Swal.showValidationMessage("El nombre es obligatorio.");
          return null;
        }

        if (Number.isNaN(prescribedSessions) || prescribedSessions < 0 || prescribedSessions > 120) {
          Swal.showValidationMessage("La cantidad de sesiones debe estar entre 0 y 120.");
          return null;
        }

        return {
          full_name: fullName,
          phone,
          email: email || null,
          diagnosis,
          notes,
          prescribed_sessions: prescribedSessions,
        };
      },
    });

    if (!formValues) {
      return;
    }

    setErrorMessage("");
    try {
      await updatePatient(patient.id, formValues);
      await loadPatients(patientSearch);
      await refreshAgendaAndHistory(patient.id);
      setSelectedPatientId(patient.id);
      await Swal.fire({
        title: "Paciente actualizado",
        icon: "success",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch (error) {
      setErrorMessage(error.message);
      await Swal.fire({
        title: "No se pudo guardar",
        text: error.message,
        icon: "error",
        confirmButtonText: "Cerrar",
      });
    }
  }

  async function handleStatusChange(appointment, status) {
    setErrorMessage("");
    try {
      await updateAppointment(appointment.id, { status });
      await refreshAgendaAndHistory(appointment.patient.id);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function handleAppointmentEditSubmit(event) {
    event.preventDefault();
    if (!selectedAppointmentId) {
      return;
    }

    setSavingEdition(true);
    setErrorMessage("");

    try {
      const validationError = validateAppointmentInput(editingForm);
      if (validationError) {
        throw new Error(validationError);
      }

      const updated = await updateAppointment(selectedAppointmentId, {
        ...editingForm,
        patient_id: Number(editingForm.patient_id),
        duration_minutes: Number(editingForm.duration_minutes),
      });
      setSelectedPatientId(updated.patient.id);
      await refreshAgendaAndHistory(updated.patient.id);
    } catch (error) {
      setErrorMessage(error.message);
      await Swal.fire({
        title: "No se pudo guardar el turno",
        text: error.message,
        icon: "error",
        confirmButtonText: "Cerrar",
      });
    } finally {
      setSavingEdition(false);
    }
  }

  async function handleDeleteAppointment() {
    if (!selectedAppointmentId) {
      return;
    }

    const appointment = appointments.find((item) => item.id === selectedAppointmentId);
    if (!appointment) {
      return;
    }

    const result = await Swal.fire({
      title: "¿Eliminar este turno?",
      text: "Esta accion no se puede deshacer.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
    });
    if (!result.isConfirmed) {
      return;
    }

    setDeletingAppointment(true);
    setErrorMessage("");

    try {
      await deleteAppointment(selectedAppointmentId);
      setSelectedAppointmentId(null);
      await refreshAgendaAndHistory(appointment.patient.id);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setDeletingAppointment(false);
    }
  }

  function openWhatsappReminder(appointment) {
    const phone = sanitizeWhatsappNumber(appointment.patient.phone);
    if (!phone) {
      setErrorMessage("El paciente no tiene un telefono valido para WhatsApp.");
      return;
    }

    const message = encodeURIComponent(buildWhatsappMessage(appointment));
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank", "noopener,noreferrer");
  }

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;

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
      {showReminders ? (
        <div className="modal-backdrop" onClick={() => setShowReminders(false)}>
          <section className="reminder-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Turnos de hoy</p>
                <h2>Recordatorios</h2>
              </div>
              <button type="button" className="ghost-button" onClick={() => setShowReminders(false)}>
                Cerrar
              </button>
            </div>

            <div className="reminder-list">
              {todayAppointments.map((appointment) => (
                <article key={appointment.id} className="reminder-item">
                  <div>
                    <strong>{appointment.patient.full_name}</strong>
                    <span>{formatClock(appointment.date, appointment.time)}</span>
                    <small>{appointment.patient.phone || "Sin telefono"}</small>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => openWhatsappReminder(appointment)}
                    disabled={!sanitizeWhatsappNumber(appointment.patient.phone)}
                  >
                    WhatsApp
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Turnos Historial App</p>
          <h1>Agenda y pacientes</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => setShowReminders(true)}>
            Turnos de hoy
          </button>
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
                        className={`appointment-item ${
                          selectedAppointmentId === appointment.id ? "appointment-item-active" : ""
                        }`}
                        onClick={() => {
                          setSelectedPatientId(appointment.patient.id);
                          setSelectedAppointmentId(appointment.id);
                        }}
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
                  <div className="patient-item-head">
                    <div>
                      <strong>{patient.full_name}</strong>
                      <span>{patient.diagnosis || "Sin diagnostico"}</span>
                      <small>{`${patient.completed_sessions}/${patient.prescribed_sessions} sesiones`}</small>
                    </div>
                    <span
                      className="text-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openPatientEditor(patient);
                      }}
                    >
                      Editar
                    </span>
                  </div>
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
                placeholder="Telefono con codigo pais"
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
              <input
                type="number"
                min="0"
                max="120"
                placeholder="Cantidad de sesiones"
                value={patientForm.prescribed_sessions}
                onChange={(event) =>
                  setPatientForm((current) => ({
                    ...current,
                    prescribed_sessions: Number(event.target.value),
                  }))
                }
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
                  min="08:00"
                  max="19:00"
                  step="1800"
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

          <section className="pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Editar turno</p>
                <h2>{selectedAppointment ? "Detalle" : "Seleccionar"}</h2>
              </div>
            </div>

            {selectedAppointment ? (
              <form className="stack-form" onSubmit={handleAppointmentEditSubmit}>
                <select
                  required
                  value={editingForm.patient_id}
                  onChange={(event) => setEditingForm((current) => ({ ...current, patient_id: event.target.value }))}
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
                    value={editingForm.date}
                    onChange={(event) => setEditingForm((current) => ({ ...current, date: event.target.value }))}
                  />
                  <input
                    required
                    type="time"
                    min="08:00"
                    max="19:00"
                    step="1800"
                    value={editingForm.time}
                    onChange={(event) => setEditingForm((current) => ({ ...current, time: event.target.value }))}
                  />
                </div>
                <select
                  value={editingForm.status}
                  onChange={(event) => setEditingForm((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="scheduled">Programado</option>
                  <option value="completed">Realizado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
                <input
                  placeholder="Motivo"
                  value={editingForm.reason}
                  onChange={(event) => setEditingForm((current) => ({ ...current, reason: event.target.value }))}
                />
                <textarea
                  rows="3"
                  placeholder="Evolucion"
                  value={editingForm.evolution_note}
                  onChange={(event) =>
                    setEditingForm((current) => ({ ...current, evolution_note: event.target.value }))
                  }
                />
                <div className="action-row">
                  <button className="primary-button" type="submit" disabled={savingEdition}>
                    {savingEdition ? "Guardando..." : "Guardar cambios"}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={handleDeleteAppointment}
                    disabled={deletingAppointment}
                  >
                    {deletingAppointment ? "Eliminando..." : "Eliminar"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty-history">Elegi un turno de la agenda para editarlo.</div>
            )}
          </section>

          <section className="pane history-pane">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Historial</p>
                <h2>{selectedPatient ? selectedPatient.full_name : "Sin seleccionar"}</h2>
              </div>
            </div>

            {selectedPatient ? (
              <div className="session-summary">
                <div>
                  <span>Plan</span>
                  <strong>{selectedPatient.prescribed_sessions}</strong>
                </div>
                <div>
                  <span>Realizadas</span>
                  <strong>{selectedPatient.completed_sessions}</strong>
                </div>
                <div>
                  <span>Restantes</span>
                  <strong>{selectedPatient.remaining_sessions}</strong>
                </div>
              </div>
            ) : null}

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
