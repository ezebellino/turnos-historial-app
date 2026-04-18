import { startTransition, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  clearStoredSessionToken,
  createAppointment,
  createPatient,
  deletePatientPhoto,
  deleteAppointment,
  fetchAppointments,
  fetchAuthStatus,
  fetchDashboard,
  fetchPatientHistory,
  fetchPatients,
  getStoredSessionToken,
  login,
  logout,
  recoverAccess,
  requestRecoveryCode,
  resolveApiUrl,
  setStoredSessionToken,
  setupAuth,
  uploadPatientPhoto,
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

function getNextBusinessDate(baseDate = new Date()) {
  const current = new Date(baseDate);
  const weekday = current.getDay();

  if (weekday === 6) {
    current.setDate(current.getDate() + 2);
  } else if (weekday === 0) {
    current.setDate(current.getDate() + 1);
  }

  return current;
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

function buildRecoveryCodeMessage(code) {
  return `Tu codigo de recuperacion de Turnos Historial App es: ${code}`;
}

function patientPhotoUrl(patient) {
  return resolveApiUrl(patient?.photo_url);
}

function patientInitials(fullName) {
  return (fullName || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase())
    .join("") || "?";
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

function patientFormHtml(patient = {}) {
  return `
    <div class="swal-form-grid">
      <div class="swal-photo-field">
        ${
          patient.photo_url
            ? `<img src="${patientPhotoUrl(patient)}" alt="${patient.full_name || "Paciente"}" class="swal-photo-preview" />`
            : '<div class="swal-photo-placeholder">Sin foto</div>'
        }
        <input id="swal-photo" class="swal2-file" type="file" accept="image/png,image/jpeg,image/webp" />
        ${
          patient.photo_url
            ? '<label class="swal-photo-remove"><input id="swal-photo-remove" type="checkbox" /> Quitar foto actual</label>'
            : ""
        }
      </div>
      <input id="swal-full-name" class="swal2-input" placeholder="Nombre y apellido" value="${patient.full_name || ""}" />
      <input id="swal-phone" class="swal2-input" placeholder="Telefono con codigo pais" value="${patient.phone || ""}" />
      <input id="swal-email" class="swal2-input" placeholder="Email" value="${patient.email || ""}" />
      <input id="swal-diagnosis" class="swal2-input" placeholder="Diagnostico" value="${patient.diagnosis || ""}" />
      <input id="swal-sessions" class="swal2-input" type="number" min="0" max="120" placeholder="Cantidad de sesiones" value="${patient.prescribed_sessions ?? 10}" />
      <textarea id="swal-notes" class="swal2-textarea" placeholder="Notas">${patient.notes || ""}</textarea>
    </div>
  `;
}

function readPatientFormValues() {
  const fullName = document.getElementById("swal-full-name")?.value.trim();
  const phone = document.getElementById("swal-phone")?.value.trim() || "";
  const email = document.getElementById("swal-email")?.value.trim() || "";
  const diagnosis = document.getElementById("swal-diagnosis")?.value.trim() || "";
  const notes = document.getElementById("swal-notes")?.value.trim() || "";
  const prescribedSessions = Number(document.getElementById("swal-sessions")?.value ?? 0);
  const photoFile = document.getElementById("swal-photo")?.files?.[0] ?? null;
  const removePhoto = Boolean(document.getElementById("swal-photo-remove")?.checked);

  if (!fullName) {
    Swal.showValidationMessage("El nombre es obligatorio.");
    return null;
  }

  if (Number.isNaN(prescribedSessions) || prescribedSessions < 0 || prescribedSessions > 120) {
    Swal.showValidationMessage("La cantidad de sesiones debe estar entre 0 y 120.");
    return null;
  }

  if (photoFile) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
      Swal.showValidationMessage("La foto debe ser JPG, PNG o WEBP.");
      return null;
    }
    if (photoFile.size > 5 * 1024 * 1024) {
      Swal.showValidationMessage("La foto no puede superar los 5 MB.");
      return null;
    }
  }

  return {
    full_name: fullName,
    phone,
    email: email || null,
    diagnosis,
    notes,
    prescribed_sessions: prescribedSessions,
    photo_file: photoFile,
    remove_photo: removePhoto && !photoFile,
  };
}

function appointmentFormHtml({ patients, appointment }) {
  const patientOptions = patients
    .map(
      (patient) =>
        `<option value="${patient.id}" ${
          String(appointment.patient_id || "") === String(patient.id) ? "selected" : ""
        }>${patient.full_name}</option>`,
    )
    .join("");

  return `
    <div class="swal-form-grid">
      <input id="swal-patient-search" class="swal2-input" placeholder="Buscar paciente" value="" />
      <select id="swal-patient-id" class="swal2-input">
        <option value="">Seleccionar paciente</option>
        ${patientOptions}
      </select>
      <div class="swal-row">
        <input id="swal-date" class="swal2-input" type="date" value="${appointment.date || ""}" />
        <input id="swal-time" class="swal2-input" type="time" min="08:00" max="19:00" step="1800" value="${appointment.time || "08:00"}" />
      </div>
      <select id="swal-status" class="swal2-input">
        <option value="scheduled" ${appointment.status === "scheduled" ? "selected" : ""}>Programado</option>
        <option value="completed" ${appointment.status === "completed" ? "selected" : ""}>Realizado</option>
        <option value="cancelled" ${appointment.status === "cancelled" ? "selected" : ""}>Cancelado</option>
      </select>
      <input id="swal-reason" class="swal2-input" placeholder="Motivo" value="${appointment.reason || ""}" />
      <textarea id="swal-evolution" class="swal2-textarea" placeholder="Evolucion">${appointment.evolution_note || ""}</textarea>
    </div>
  `;
}

function renderPatientOptions(selectElement, patients, selectedId, search = "") {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredPatients = normalizedSearch
    ? patients.filter((patient) => patient.full_name.toLowerCase().includes(normalizedSearch))
    : patients;

  const options = [
    '<option value="">Seleccionar paciente</option>',
    ...filteredPatients.map(
      (patient) =>
        `<option value="${patient.id}" ${
          String(selectedId || "") === String(patient.id) ? "selected" : ""
        }>${patient.full_name}</option>`,
    ),
  ];

  selectElement.innerHTML = options.join("");
}

function setupPatientFilter(patients, selectedId) {
  const searchInput = document.getElementById("swal-patient-search");
  const selectElement = document.getElementById("swal-patient-id");
  if (!searchInput || !selectElement) {
    return;
  }

  renderPatientOptions(selectElement, patients, selectedId);
  searchInput.addEventListener("input", (event) => {
    renderPatientOptions(selectElement, patients, selectElement.value || selectedId, event.target.value);
  });
}

function readAppointmentFormValues() {
  const payload = {
    patient_id: Number(document.getElementById("swal-patient-id")?.value || 0),
    date: document.getElementById("swal-date")?.value || "",
    time: document.getElementById("swal-time")?.value || "",
    duration_minutes: 60,
    status: document.getElementById("swal-status")?.value || "scheduled",
    reason: document.getElementById("swal-reason")?.value.trim() || "",
    evolution_note: document.getElementById("swal-evolution")?.value.trim() || "",
  };

  if (!payload.patient_id) {
    Swal.showValidationMessage("Selecciona un paciente.");
    return null;
  }

  const validationError = validateAppointmentInput(payload);
  if (validationError) {
    Swal.showValidationMessage(validationError);
    return null;
  }

  return payload;
}

async function syncPatientPhoto(patientId, formValues) {
  if (formValues.photo_file) {
    return uploadPatientPhoto(patientId, formValues.photo_file);
  }
  if (formValues.remove_photo) {
    return deletePatientPhoto(patientId);
  }
  return null;
}

function patientPayload(formValues) {
  const { photo_file, remove_photo, ...payload } = formValues;
  return payload;
}

function buildAppointmentUpdatePayload(appointment, formValues) {
  const nextValues = {
    patient_id: formValues.patient_id,
    date: formValues.date,
    time: formValues.time,
    duration_minutes: formValues.duration_minutes,
    status: formValues.status,
    reason: formValues.reason || "",
    evolution_note: formValues.evolution_note || "",
  };

  const currentValues = {
    patient_id: appointment.patient.id,
    date: appointment.date,
    time: appointment.time.slice(0, 5),
    duration_minutes: appointment.duration_minutes,
    status: appointment.status,
    reason: appointment.reason || "",
    evolution_note: appointment.evolution_note || "",
  };

  return Object.fromEntries(
    Object.entries(nextValues).filter(([key, value]) => value !== currentValues[key]),
  );
}

function LoginScreen({
  mode,
  loginForm,
  setupForm,
  recoverForm,
  setMode,
  setLoginForm,
  setSetupForm,
  setRecoverForm,
  onLogin,
  onSetup,
  onRecover,
  onSendRecoveryCode,
  busy,
  errorMessage,
  hasRecoveryPhone,
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Turnos Historial App</p>
        <h1>{mode === "setup" ? "Configurar acceso" : mode === "recover" ? "Recuperar acceso" : "Ingresar"}</h1>
        <p className="auth-copy">
          {mode === "setup"
            ? "Crea el usuario local de esta PC. Despues podras entrar con username y contraseña."
            : mode === "recover"
              ? "Usa tu codigo de recuperacion para definir una nueva contraseña."
              : "Ingresa con tu username y contraseña para abrir la agenda."}
        </p>

        {errorMessage ? <div className="error-banner auth-error">{errorMessage}</div> : null}

        {mode === "setup" ? (
          <form className="auth-form" onSubmit={onSetup}>
            <input
              required
              placeholder="Nombre completo"
              value={setupForm.full_name}
              onChange={(event) => setSetupForm((current) => ({ ...current, full_name: event.target.value }))}
            />
            <input
              required
              placeholder="Username"
              value={setupForm.username}
              onChange={(event) => setSetupForm((current) => ({ ...current, username: event.target.value }))}
            />
            <input
              required
              type="password"
              placeholder="Contraseña"
              value={setupForm.password}
              onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
            />
            <input
              placeholder="Celular para enviarte el codigo"
              value={setupForm.phone}
              onChange={(event) => setSetupForm((current) => ({ ...current, phone: event.target.value }))}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Guardando..." : "Crear acceso"}
            </button>
          </form>
        ) : null}

        {mode === "login" ? (
          <form className="auth-form" onSubmit={onLogin}>
            <input
              required
              placeholder="Username"
              value={loginForm.username}
              onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
            />
            <input
              required
              type="password"
              placeholder="Contraseña"
              value={loginForm.password}
              onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
            />
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        ) : null}

        {mode === "recover" ? (
          <form className="auth-form" onSubmit={onRecover}>
            <input
              required
              placeholder="Username"
              value={recoverForm.username}
              onChange={(event) => setRecoverForm((current) => ({ ...current, username: event.target.value }))}
            />
            <input
              placeholder={hasRecoveryPhone ? "Celular guardado (opcional)" : "Celular para WhatsApp"}
              value={recoverForm.phone}
              onChange={(event) => setRecoverForm((current) => ({ ...current, phone: event.target.value }))}
            />
            <input
              required
              placeholder="Codigo de recuperacion"
              value={recoverForm.recovery_code}
              onChange={(event) =>
                setRecoverForm((current) => ({ ...current, recovery_code: event.target.value.toUpperCase() }))
              }
            />
            <input
              required
              type="password"
              placeholder="Nueva contraseña"
              value={recoverForm.new_password}
              onChange={(event) => setRecoverForm((current) => ({ ...current, new_password: event.target.value }))}
            />
            <p className="auth-note">
              {hasRecoveryPhone
                ? "Puedes pedir un nuevo codigo por WhatsApp o usar el que ya tenias."
                : "Si tu celular no habia quedado guardado, cargalo aca y te enviamos un nuevo codigo."}
            </p>
            <div className="auth-form-actions">
              <button className="ghost-button" type="button" onClick={onSendRecoveryCode} disabled={busy}>
                {busy ? "Enviando..." : "Enviar codigo por WhatsApp"}
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Guardando..." : "Actualizar contraseña"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="auth-links">
          {mode !== "login" ? (
            <button type="button" className="text-button" onClick={() => setMode("login")}>
              Ya tengo usuario
            </button>
          ) : null}
          {mode !== "setup" ? (
            <button type="button" className="text-button" onClick={() => setMode("setup")}>
              Configurar usuario
            </button>
          ) : null}
          {mode !== "recover" ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode("recover");
                setRecoverForm((current) => ({
                  ...current,
                  username: loginForm.username || current.username,
                }));
              }}
            >
              Recuperar acceso
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SchedulerApp({ authUser, onLogout }) {
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
  const [errorMessage, setErrorMessage] = useState("");

  const weekDates = useMemo(() => getWeekRange(weekAnchor), [weekAnchor]);
  const weekStart = toDateInputValue(weekDates[0]);
  const weekEnd = toDateInputValue(weekDates[4]);

  useEffect(() => {
    loadDashboard();
    loadTodayAppointments(true);
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

  async function loadTodayAppointments(autoOpen = false) {
    try {
      const today = toDateInputValue(new Date());
      const data = await fetchAppointments(today, today);
      setTodayAppointments(data);
      if (autoOpen && data.length > 0) {
        setShowReminders(true);
      }
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
      loadTodayAppointments(false),
      loadPatients(patientSearch),
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

  async function openNewPatientModal() {
    const { value: formValues } = await Swal.fire({
      title: "Alta rapida",
      html: patientFormHtml(),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      preConfirm: readPatientFormValues,
    });

    if (!formValues) {
      return;
    }

    try {
      const created = await createPatient(patientPayload(formValues));
      await syncPatientPhoto(created.id, formValues);
      setSelectedPatientId(created.id);
      await refreshAgendaAndHistory(created.id);
      await Swal.fire({
        title: "Paciente creado",
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

  async function openPatientEditor(patient) {
    const { value: formValues } = await Swal.fire({
      title: "Editar paciente",
      html: patientFormHtml(patient),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      preConfirm: readPatientFormValues,
    });

    if (!formValues) {
      return;
    }

    setErrorMessage("");
    try {
      await updatePatient(patient.id, patientPayload(formValues));
      await syncPatientPhoto(patient.id, formValues);
      setSelectedPatientId(patient.id);
      await refreshAgendaAndHistory(patient.id);
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

  async function openNewAppointmentModal(defaultPatientId = selectedPatientId) {
    const suggestedDate = toDateInputValue(getNextBusinessDate());
    const { value: formValues } = await Swal.fire({
      title: "Nuevo turno",
      html: appointmentFormHtml({
        patients,
        appointment: {
          patient_id: defaultPatientId ? String(defaultPatientId) : "",
          date: suggestedDate,
          time: "08:00",
          status: "scheduled",
          reason: "",
          evolution_note: "",
        },
      }),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => setupPatientFilter(patients, defaultPatientId),
      preConfirm: readAppointmentFormValues,
    });

    if (!formValues) {
      return;
    }

    try {
      await createAppointment(formValues);
      setSelectedPatientId(formValues.patient_id);
      await refreshAgendaAndHistory(formValues.patient_id);
      await Swal.fire({
        title: "Turno creado",
        icon: "success",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch (error) {
      setErrorMessage(error.message);
      await Swal.fire({
        title: "No se pudo guardar el turno",
        text: error.message,
        icon: "error",
        confirmButtonText: "Cerrar",
      });
    }
  }

  async function openAppointmentEditor(appointment) {
    setSelectedAppointmentId(appointment.id);
    setSelectedPatientId(appointment.patient.id);

    const result = await Swal.fire({
      title: "Editar turno",
      html: appointmentFormHtml({
        patients,
        appointment: {
          patient_id: String(appointment.patient.id),
          date: appointment.date,
          time: appointment.time.slice(0, 5),
          status: appointment.status,
          reason: appointment.reason || "",
          evolution_note: appointment.evolution_note || "",
        },
      }),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Eliminar",
      showCancelButton: true,
      showDenyButton: true,
      denyButtonText: "Cerrar",
      reverseButtons: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => setupPatientFilter(patients, appointment.patient.id),
      preConfirm: readAppointmentFormValues,
    });

    if (result.isDenied || result.dismiss === Swal.DismissReason.close) {
      return;
    }

    if (result.dismiss === Swal.DismissReason.cancel) {
      const confirmation = await Swal.fire({
        title: "Eliminar turno",
        text: "Esta accion no se puede deshacer.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Eliminar",
        cancelButtonText: "Volver",
      });

      if (!confirmation.isConfirmed) {
        return;
      }

      try {
        await deleteAppointment(appointment.id);
        setSelectedAppointmentId(null);
        await refreshAgendaAndHistory(appointment.patient.id);
      } catch (error) {
        setErrorMessage(error.message);
        await Swal.fire({
          title: "No se pudo eliminar",
          text: error.message,
          icon: "error",
          confirmButtonText: "Cerrar",
        });
      }
      return;
    }

    if (!result.value) {
      return;
    }

    try {
      const payload = buildAppointmentUpdatePayload(appointment, result.value);
      if (Object.keys(payload).length === 0) {
        return;
      }
      const updated = await updateAppointment(appointment.id, payload);
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

  function openWhatsappReminder(appointment) {
    const phone = sanitizeWhatsappNumber(appointment.patient.phone);
    if (!phone) {
      setErrorMessage("El paciente no tiene un telefono valido para WhatsApp.");
      return;
    }

    const message = encodeURIComponent(buildWhatsappMessage(appointment));
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank", "noopener,noreferrer");
  }

  async function openHistoryModal() {
    if (!selectedPatient || history.length === 0) {
      return;
    }

    const historyHtml = history
      .map(
        (entry) => `
          <article class="swal-history-entry">
            <div class="swal-history-head">
              <strong>${entry.date}</strong>
              <span>${STATUS_LABELS[entry.status]}</span>
            </div>
            <p>${entry.reason || "Sesion general"}</p>
            <small>${entry.evolution_note || "Sin notas clinicas."}</small>
          </article>
        `,
      )
      .join("");

    await Swal.fire({
      title: `Historial de ${selectedPatient.full_name}`,
      html: `<div class="swal-history-list">${historyHtml}</div>`,
      width: 720,
      confirmButtonText: "Cerrar",
      customClass: { popup: "swal-patient-modal swal-history-modal" },
    });
  }

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const historyPreview = history.slice(0, 2);

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
          <p className="session-user">{authUser.full_name}</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="primary-button" onClick={openNewPatientModal}>
            Alta rapida
          </button>
          <button type="button" className="primary-button" onClick={() => openNewAppointmentModal()}>
            Nuevo turno
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowReminders(true)}>
            Turnos de hoy
          </button>
          <button type="button" className="ghost-button" onClick={() => shiftWeek(-1)}>
            Semana anterior
          </button>
          <button type="button" className="ghost-button" onClick={() => setWeekAnchor(new Date())}>
            Hoy
          </button>
          <button type="button" className="ghost-button" onClick={() => shiftWeek(1)}>
            Semana siguiente
          </button>
          <button type="button" className="ghost-button" onClick={onLogout}>
            Salir
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
                <header className="day-column-head">
                  <span>{day.label}</span>
                  <strong>{day.items.length}</strong>
                </header>

                <div className="day-slots">
                  {day.items.length === 0 ? (
                    <div className="empty-state">Libre</div>
                  ) : (
                    day.items.map((appointment) => (
                      <article
                        key={appointment.id}
                        className={`appointment-card ${
                          selectedAppointmentId === appointment.id ? "appointment-card-active" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="appointment-card-main"
                          onClick={() => openAppointmentEditor(appointment)}
                        >
                          <div className="appointment-card-head">
                            <span className="appointment-time">{formatClock(appointment.date, appointment.time)}</span>
                            <span className={`status-chip ${STATUS_CLASS[appointment.status]}`}>
                              {STATUS_LABELS[appointment.status]}
                            </span>
                          </div>
                          <strong>{appointment.patient.full_name}</strong>
                          <small>{appointment.reason || "Sesion general"}</small>
                        </button>
                        <div className="appointment-card-footer">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setSelectedPatientId(appointment.patient.id);
                              openAppointmentEditor(appointment);
                            }}
                          >
                            Editar
                          </button>
                          <select
                            value={appointment.status}
                            onChange={(event) => handleStatusChange(appointment, event.target.value)}
                          >
                            <option value="scheduled">Programado</option>
                            <option value="completed">Realizado</option>
                            <option value="cancelled">Cancelado</option>
                          </select>
                        </div>
                      </article>
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
                  onClick={() => setSelectedPatientId(patient.id)}
                >
                  <div className="patient-item-head">
                    <div className="patient-avatar-wrap">
                      {patient.photo_url ? (
                        <img className="patient-avatar" src={patientPhotoUrl(patient)} alt={patient.full_name} />
                      ) : (
                        <div className="patient-avatar patient-avatar-fallback">{patientInitials(patient.full_name)}</div>
                      )}
                    </div>
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

          <section className="pane history-pane">
            <div className="section-heading">
              <div className="history-heading">
                {selectedPatient ? (
                  selectedPatient.photo_url ? (
                    <img
                      className="patient-avatar patient-avatar-large"
                      src={patientPhotoUrl(selectedPatient)}
                      alt={selectedPatient.full_name}
                    />
                  ) : (
                    <div className="patient-avatar patient-avatar-large patient-avatar-fallback">
                      {patientInitials(selectedPatient.full_name)}
                    </div>
                  )
                ) : null}
                <div>
                <p className="eyebrow">Historial</p>
                <h2>{selectedPatient ? selectedPatient.full_name : "Sin seleccionar"}</h2>
                </div>
              </div>
              {selectedPatient ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => openNewAppointmentModal(selectedPatient.id)}
                >
                  Nuevo turno
                </button>
              ) : null}
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
              {historyPreview.length === 0 ? (
                <div className="empty-history">Todavia sin registros.</div>
              ) : (
                historyPreview.map((entry) => (
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

            {history.length > 2 ? (
              <button type="button" className="ghost-button" onClick={openHistoryModal}>
                Ver todo
              </button>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authStatus, setAuthStatus] = useState({
    configured: false,
    authenticated: false,
    username: null,
    full_name: null,
    has_recovery_phone: false,
  });
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [setupForm, setSetupForm] = useState({ username: "", full_name: "", password: "", phone: "" });
  const [recoverForm, setRecoverForm] = useState({ username: "", phone: "", recovery_code: "", new_password: "" });

  useEffect(() => {
    loadAuthStatus();
  }, []);

  async function loadAuthStatus() {
    setBooting(true);
    try {
      const status = await fetchAuthStatus();
      setAuthStatus(status);
      setMode(status.configured ? "login" : "setup");
    } catch {
      clearStoredSessionToken();
      setAuthStatus({
        configured: false,
        authenticated: false,
        username: null,
        full_name: null,
        has_recovery_phone: false,
      });
      setMode("setup");
    } finally {
      setBooting(false);
    }
  }

  async function handleSetup(event) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");

    try {
      const payload = {
        username: setupForm.username.trim().toLowerCase(),
        full_name: setupForm.full_name.trim(),
        password: setupForm.password,
        phone: setupForm.phone.trim(),
      };
      const response = await setupAuth(payload);
      setStoredSessionToken(response.token);
      setAuthStatus({
        configured: true,
        authenticated: true,
        username: response.username,
        full_name: response.full_name,
        has_recovery_phone: Boolean(setupForm.phone.trim()),
      });

      const message = encodeURIComponent(buildRecoveryCodeMessage(response.recovery_code));
      const whatsappPhone = sanitizeWhatsappNumber(setupForm.phone);

      await Swal.fire({
        title: "Codigo de recuperacion",
        html: `
          <div class="recovery-box">
            <strong>${response.recovery_code}</strong>
            <p>Guardalo o envialo a tu celular. Con este codigo podras crear una nueva contraseña.</p>
          </div>
        `,
        showCancelButton: Boolean(whatsappPhone),
        confirmButtonText: "Cerrar",
        cancelButtonText: "Enviar a WhatsApp",
        reverseButtons: true,
      }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel && whatsappPhone) {
          window.open(`https://wa.me/${whatsappPhone}?text=${message}`, "_blank", "noopener,noreferrer");
        }
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");

    try {
      const response = await login({
        username: loginForm.username.trim().toLowerCase(),
        password: loginForm.password,
      });
      setStoredSessionToken(response.token);
      setAuthStatus({
        configured: true,
        authenticated: true,
        username: response.username,
        full_name: response.full_name,
        has_recovery_phone: authStatus.has_recovery_phone,
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRecover(event) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");

    try {
      const response = await recoverAccess({
        username: recoverForm.username.trim().toLowerCase(),
        recovery_code: recoverForm.recovery_code.trim().toUpperCase(),
        new_password: recoverForm.new_password,
      });
      setStoredSessionToken(response.token);
      setAuthStatus({
        configured: true,
        authenticated: true,
        username: response.username,
        full_name: response.full_name,
        has_recovery_phone: authStatus.has_recovery_phone || Boolean(recoverForm.phone.trim()),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendRecoveryCode() {
    const username = recoverForm.username.trim().toLowerCase();
    if (!username) {
      setErrorMessage("Carga el username para enviarte el codigo.");
      return;
    }

    setBusy(true);
    setErrorMessage("");

    try {
      const response = await requestRecoveryCode({
        username,
        phone: recoverForm.phone.trim() || null,
      });
      const whatsappPhone = sanitizeWhatsappNumber(response.phone);

      if (!whatsappPhone) {
        throw new Error("No hay un telefono valido para WhatsApp.");
      }

      setRecoverForm((current) => ({
        ...current,
        username,
        phone: response.phone,
        recovery_code: response.recovery_code,
      }));
      setAuthStatus((current) => ({
        ...current,
        has_recovery_phone: true,
      }));

      const message = encodeURIComponent(buildRecoveryCodeMessage(response.recovery_code));
      window.open(`https://wa.me/${whatsappPhone}?text=${message}`, "_blank", "noopener,noreferrer");

      await Swal.fire({
        title: "Codigo enviado",
        html: `
          <div class="recovery-box">
            <strong>${response.recovery_code}</strong>
            <p>Te abrimos WhatsApp con el mensaje listo. Si prefieres, puedes pegar este codigo manualmente.</p>
          </div>
        `,
        confirmButtonText: "Seguir",
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Ignore logout failures and clear local session anyway.
    }
    clearStoredSessionToken();
    setAuthStatus((current) => ({
      ...current,
      authenticated: false,
    }));
    setMode("login");
    setLoginForm({ username: authStatus.username || "", password: "" });
  }

  if (booting) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Turnos Historial App</p>
          <h1>Abriendo sistema</h1>
        </div>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <LoginScreen
        mode={mode}
        loginForm={loginForm}
        setupForm={setupForm}
        recoverForm={recoverForm}
        setMode={setMode}
        setLoginForm={setLoginForm}
        setSetupForm={setSetupForm}
        setRecoverForm={setRecoverForm}
        onLogin={handleLogin}
        onSetup={handleSetup}
        onRecover={handleRecover}
        onSendRecoveryCode={handleSendRecoveryCode}
        busy={busy}
        errorMessage={errorMessage}
        hasRecoveryPhone={authStatus.has_recovery_phone}
      />
    );
  }

  return <SchedulerApp authUser={authStatus} onLogout={handleLogout} />;
}
