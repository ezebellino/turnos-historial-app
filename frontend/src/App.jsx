import { startTransition, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  applyBulkPricing,
  createHoliday,
  clearStoredSessionToken,
  createAppointment,
  createPatient,
  deletePatient,
  deleteHoliday,
  deletePatientPhoto,
  deleteAppointment,
  fetchAppointments,
  fetchAuthStatus,
  fetchDashboard,
  fetchHolidays,
  fetchPatientHistory,
  fetchPatients,
  fetchPricingSettings,
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
  updatePricingSettings,
  updatePatient,
} from "./api";
import appLogo from "../logoTurnosHistorialAPP.png";

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
const CARE_MODE_LABELS = {
  institutional: "Institucional",
  domiciliary: "Domiciliario",
};
const PRICING_SCOPE_LABELS = {
  all: "Todos",
  institutional: "Institucional",
  domiciliary: "Domiciliario",
};

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Lunes" },
  { value: 1, label: "Martes" },
  { value: 2, label: "Miercoles" },
  { value: 3, label: "Jueves" },
  { value: 4, label: "Viernes" },
];
const MONTHLY_PATIENT_LIMIT = 20;

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

function toMonthInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function fromMonthInputValue(value) {
  return value ? `${value}-01` : null;
}

function parseDateString(value) {
  return new Date(`${value}T12:00:00`);
}

function getMonthRange(baseDate) {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  return { start, end };
}

function getMonthGrid(baseDate) {
  const { start, end } = getMonthRange(baseDate);
  const firstCell = new Date(start);
  const startOffset = firstCell.getDay() === 0 ? -6 : 1 - firstCell.getDay();
  firstCell.setDate(firstCell.getDate() + startOffset);

  return Array.from({ length: 35 }, (_, index) => {
    const day = new Date(firstCell);
    day.setDate(firstCell.getDate() + index);
    return day;
  });
}

function formatClock(dateString, timeString) {
  return timeFormatter.format(new Date(`${dateString}T${timeString}`));
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatMonthLabel(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function isSameMonth(dateString, monthDate) {
  if (!dateString) {
    return false;
  }
  const parsed = parseDateString(dateString);
  return (
    parsed.getFullYear() === monthDate.getFullYear() &&
    parsed.getMonth() === monthDate.getMonth()
  );
}

function sanitizeWhatsappNumber(phone) {
  return (phone || "").replace(/\D/g, "");
}

function buildWhatsappMessage(appointment) {
  const time = formatClock(appointment.date, appointment.time);
  return `Hola ${appointment.patient.full_name}, te recordamos tu turno de kinesiologia de hoy a las ${time}.`;
}

function buildWhatsappUrl(phone, message) {
  const sanitized = sanitizeWhatsappNumber(phone);
  if (!sanitized) {
    return "";
  }
  return `https://web.whatsapp.com/send?phone=${sanitized}&text=${encodeURIComponent(message)}`;
}

function isLastSessionAppointment(appointment) {
  return (
    Boolean(appointment?.session_number) &&
    Boolean(appointment?.patient?.prescribed_sessions) &&
    appointment.session_number === appointment.patient.prescribed_sessions
  );
}

function holidayLabel(holiday) {
  return holiday?.name || "Feriado";
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

function validateAppointmentInput({ patient_id, date, time }, { patients = [], holidayDates = new Set() } = {}) {
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

  const patient = patients.find((entry) => entry.id === Number(patient_id));
  if (holidayDates.has(date) && patient && patient.care_mode !== "domiciliary") {
    return "Ese dia esta marcado como feriado. Solo puedes cargar turnos domiciliarios.";
  }

  return null;
}

function selectedWeekdayValues(patient = {}) {
  const values = Array.isArray(patient.preferred_weekdays)
    ? patient.preferred_weekdays
    : typeof patient.preferred_weekdays === "string"
      ? patient.preferred_weekdays.split(",").filter(Boolean).map(Number)
      : [];
  return new Set(values);
}

function patientFormHtml(patient = {}, pricingSettings = { institutional_rate: 0, domiciliary_rate: 0 }) {
  const selectedWeekdays = selectedWeekdayValues(patient);
  const careMode = patient.care_mode || "institutional";
  const defaultPrice =
    careMode === "domiciliary" ? pricingSettings.domiciliary_rate : pricingSettings.institutional_rate;
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
      <div class="swal-section-label">Plan terapeutico</div>
      <select id="swal-care-mode" class="swal2-input">
        <option value="institutional" ${careMode === "institutional" ? "selected" : ""}>Institucional</option>
        <option value="domiciliary" ${careMode === "domiciliary" ? "selected" : ""}>Domiciliario</option>
      </select>
      <div class="swal-row">
        <input id="swal-start-date" class="swal2-input" type="date" value="${patient.treatment_start_date || toDateInputValue(getNextBusinessDate())}" />
        <input id="swal-session-price" class="swal2-input" type="number" min="0" step="100" placeholder="Valor por paciente" value="${patient.session_price ?? defaultPrice}" />
      </div>
      <div class="swal-row">
        <input id="swal-billing-month" class="swal2-input" type="month" value="${
          patient.billing_month ? patient.billing_month.slice(0, 7) : toMonthInputValue(getNextBusinessDate())
        }" />
        <input id="swal-preferred-time" class="swal2-input" type="time" min="08:00" max="19:00" step="1800" value="${patient.preferred_time ? patient.preferred_time.slice(0, 5) : "08:00"}" />
      </div>
      <div class="weekday-picker">
        ${WEEKDAY_OPTIONS.map(
          (option) => `
            <label class="weekday-chip">
              <input type="checkbox" id="swal-weekday-${option.value}" ${selectedWeekdays.has(option.value) ? "checked" : ""} />
              <span>${option.label}</span>
            </label>
          `,
        ).join("")}
      </div>
      <label class="swal-photo-remove">
        <input id="swal-auto-schedule" type="checkbox" ${patient.auto_schedule_enabled ? "checked" : ""} />
        Generar y mantener cronograma automatico
      </label>
      <textarea id="swal-notes" class="swal2-textarea" placeholder="Notas">${patient.notes || ""}</textarea>
    </div>
  `;
}

function setupPatientPricingAssistant(pricingSettings = { institutional_rate: 0, domiciliary_rate: 0 }) {
  const modeInput = document.getElementById("swal-care-mode");
  const priceInput = document.getElementById("swal-session-price");
  if (!modeInput || !priceInput) {
    return;
  }

  modeInput.addEventListener("change", (event) => {
    const nextMode = event.target.value;
    const nextPrice =
      nextMode === "domiciliary" ? pricingSettings.domiciliary_rate : pricingSettings.institutional_rate;
    if (!priceInput.value || Number(priceInput.value) === 0) {
      priceInput.value = String(nextPrice || 0);
    }
  });
}

function readPatientFormValues() {
  const fullName = document.getElementById("swal-full-name")?.value.trim();
  const phone = document.getElementById("swal-phone")?.value.trim() || "";
  const email = document.getElementById("swal-email")?.value.trim() || "";
  const diagnosis = document.getElementById("swal-diagnosis")?.value.trim() || "";
  const notes = document.getElementById("swal-notes")?.value.trim() || "";
  const prescribedSessions = Number(document.getElementById("swal-sessions")?.value ?? 0);
  const treatmentStartDate = document.getElementById("swal-start-date")?.value || null;
  const billingMonth = fromMonthInputValue(document.getElementById("swal-billing-month")?.value || "");
  const sessionPrice = Number(document.getElementById("swal-session-price")?.value ?? 0);
  const preferredTime = document.getElementById("swal-preferred-time")?.value || null;
  const preferredWeekdays = WEEKDAY_OPTIONS.filter((option) =>
    document.getElementById(`swal-weekday-${option.value}`)?.checked,
  ).map((option) => option.value);
  const autoScheduleEnabled = Boolean(document.getElementById("swal-auto-schedule")?.checked);
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

  if (Number.isNaN(sessionPrice) || sessionPrice < 0) {
    Swal.showValidationMessage("El valor por paciente no puede ser negativo.");
    return null;
  }

  if (autoScheduleEnabled && (!treatmentStartDate || !preferredTime || preferredWeekdays.length === 0)) {
    Swal.showValidationMessage("Para automatizar el cronograma completa fecha de inicio, hora y al menos un dia fijo.");
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
    care_mode: document.getElementById("swal-care-mode")?.value || "institutional",
    prescribed_sessions: prescribedSessions,
    treatment_start_date: treatmentStartDate,
    billing_month: billingMonth,
    session_price: sessionPrice,
    preferred_time: preferredTime,
    preferred_weekdays: preferredWeekdays,
    auto_schedule_enabled: autoScheduleEnabled,
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
      <div class="swal-section-label">Paciente y horario</div>
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
      <div class="swal-section-label">Programacion automatica</div>
      <label class="swal-photo-remove">
        <input id="swal-appointment-auto-schedule" type="checkbox" ${appointment.auto_schedule_enabled ? "checked" : ""} />
        Programar turnos fijos desde este turno
      </label>
      <div class="swal-row">
        <input id="swal-appointment-sessions" class="swal2-input" type="number" min="0" max="120" placeholder="Cantidad de sesiones" value="${appointment.prescribed_sessions ?? 0}" />
        <input id="swal-appointment-start-date" class="swal2-input" type="date" value="${appointment.date || ""}" />
      </div>
      <div class="weekday-picker weekday-picker-wide">
        ${WEEKDAY_OPTIONS.map(
          (option) => `
            <label class="weekday-chip weekday-chip-wide">
              <input type="checkbox" id="swal-appointment-weekday-${option.value}" ${appointment.preferred_weekdays?.includes(option.value) ? "checked" : ""} />
              <span>${option.label}</span>
            </label>
          `,
        ).join("")}
      </div>
      <small class="swal-helper-copy">Si activas esta opcion, la app guarda este horario como patron fijo del paciente.</small>
      <div class="swal-section-label">Detalle clinico</div>
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

function setupAppointmentAutomationAssistant(patients) {
  const patientSelect = document.getElementById("swal-patient-id");
  const autoScheduleInput = document.getElementById("swal-appointment-auto-schedule");
  const sessionInput = document.getElementById("swal-appointment-sessions");
  const startDateInput = document.getElementById("swal-appointment-start-date");

  if (!patientSelect || !autoScheduleInput || !sessionInput || !startDateInput) {
    return;
  }

  const applyPatientDefaults = () => {
    const patientId = Number(patientSelect.value || 0);
    const patient = patients.find((entry) => entry.id === patientId);
    if (!patient) {
      return;
    }

    if (!sessionInput.value || Number(sessionInput.value) === 0) {
      sessionInput.value = String(patient.prescribed_sessions ?? 0);
    }

    if (!startDateInput.value && patient.treatment_start_date) {
      startDateInput.value = patient.treatment_start_date;
    }

    WEEKDAY_OPTIONS.forEach((option) => {
      const checkbox = document.getElementById(`swal-appointment-weekday-${option.value}`);
      if (!checkbox) {
        return;
      }
      const preferred = Array.isArray(patient.preferred_weekdays) ? patient.preferred_weekdays : [];
      checkbox.checked = preferred.includes(option.value);
    });

    if (patient.auto_schedule_enabled && !autoScheduleInput.checked) {
      autoScheduleInput.checked = true;
    }
  };

  patientSelect.addEventListener("change", applyPatientDefaults);
  applyPatientDefaults();
}

function readAppointmentFormValues() {
  const autoScheduleEnabled = Boolean(document.getElementById("swal-appointment-auto-schedule")?.checked);
  const preferredWeekdays = WEEKDAY_OPTIONS.filter((option) =>
    document.getElementById(`swal-appointment-weekday-${option.value}`)?.checked,
  ).map((option) => option.value);
  const prescribedSessions = Number(document.getElementById("swal-appointment-sessions")?.value ?? 0);
  const payload = {
    patient_id: Number(document.getElementById("swal-patient-id")?.value || 0),
    date: document.getElementById("swal-date")?.value || "",
    time: document.getElementById("swal-time")?.value || "",
    duration_minutes: 60,
    status: document.getElementById("swal-status")?.value || "scheduled",
    reason: document.getElementById("swal-reason")?.value.trim() || "",
    evolution_note: document.getElementById("swal-evolution")?.value.trim() || "",
    auto_schedule_enabled: autoScheduleEnabled,
    preferred_weekdays: preferredWeekdays,
    treatment_start_date: document.getElementById("swal-appointment-start-date")?.value || null,
    prescribed_sessions: prescribedSessions,
  };

  if (!payload.patient_id) {
    Swal.showValidationMessage("Selecciona un paciente.");
    return null;
  }

  if (autoScheduleEnabled) {
    if (!payload.treatment_start_date || preferredWeekdays.length === 0) {
      Swal.showValidationMessage("Para programar automaticamente completa fecha de inicio y al menos un dia fijo.");
      return null;
    }
    if (Number.isNaN(prescribedSessions) || prescribedSessions <= 0) {
      Swal.showValidationMessage("La programacion automatica necesita una cantidad de sesiones mayor a 0.");
      return null;
    }
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

function appointmentAutomationPayload(formValues) {
  if (!formValues.auto_schedule_enabled) {
    return null;
  }

  return {
    prescribed_sessions: formValues.prescribed_sessions,
    treatment_start_date: formValues.treatment_start_date || formValues.date,
    preferred_time: formValues.time,
    preferred_weekdays: formValues.preferred_weekdays,
    auto_schedule_enabled: true,
  };
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
        <div className="auth-brand-header">
          <img src={appLogo} alt="Turnos Historial App" className="auth-logo" />
          <div>
            <h1>{mode === "setup" ? "Configurar acceso" : mode === "recover" ? "Recuperar acceso" : "Ingresar"}</h1>
            <p className="auth-tagline">Turnos, historial y acompanamiento.</p>
          </div>
        </div>
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
  const [agendaView, setAgendaView] = useState("week");
  const [dashboard, setDashboard] = useState(null);
  const [pricingSettings, setPricingSettings] = useState({
    institutional_rate: 0,
    domiciliary_rate: 0,
  });
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [showReminders, setShowReminders] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [history, setHistory] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sideSection, setSideSection] = useState("patients");
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(toDateInputValue(getNextBusinessDate()));
  const [historyOrder, setHistoryOrder] = useState("desc");

  const weekDates = useMemo(() => getWeekRange(weekAnchor), [weekAnchor]);
  const monthGrid = useMemo(() => getMonthGrid(weekAnchor), [weekAnchor]);
  const monthRange = useMemo(() => getMonthRange(weekAnchor), [weekAnchor]);
  const weekStart = toDateInputValue(weekDates[0]);
  const weekEnd = toDateInputValue(weekDates[4]);
  const rangeStart = toDateInputValue(monthRange.start);
  const rangeEnd = toDateInputValue(monthRange.end);
  const holidayByDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.date, holiday])),
    [holidays],
  );
  const holidayDates = useMemo(
    () => new Set(holidays.map((holiday) => holiday.date)),
    [holidays],
  );

  useEffect(() => {
    loadDashboard();
    loadPricingSettings();
    loadTodayAppointments(true);
    loadHolidays();
  }, []);

  useEffect(() => {
    loadPatients(patientSearch);
  }, [patientSearch]);

  useEffect(() => {
    loadAppointments(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd]);

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

  async function loadPricingSettings() {
    try {
      const data = await fetchPricingSettings();
      setPricingSettings(data);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function loadHolidays() {
    try {
      const data = await fetchHolidays();
      setHolidays(data);
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
      loadAppointments(rangeStart, rangeEnd),
      loadDashboard(),
      loadPricingSettings(),
      loadTodayAppointments(false),
      loadPatients(patientSearch),
      loadHolidays(),
      patientId ? fetchPatientHistory(patientId).then(setHistory) : Promise.resolve(),
    ]);
  }

  function jumpToCurrentWeek() {
    startTransition(() => {
      setWeekAnchor(new Date());
      setSelectedDayKey(toDateInputValue(getNextBusinessDate()));
    });
  }

  function shiftWeek(direction) {
    startTransition(() => {
      setWeekAnchor((current) => {
        const next = new Date(current);
        if (agendaView === "month") {
          next.setMonth(next.getMonth() + direction);
        } else {
          next.setDate(next.getDate() + direction * 7);
        }
        return next;
      });
    });
  }

  async function ensureMonthlyCapacity(formValues, currentPatient = null) {
    const monthValue = formValues.billing_month || toDateInputValue(new Date()).slice(0, 7) + "-01";
    const monthDate = parseDateString(monthValue);
    const currentMonth = new Date();
    const isCurrentMonth =
      monthDate.getFullYear() === currentMonth.getFullYear() &&
      monthDate.getMonth() === currentMonth.getMonth();
    const currentAssigned = currentPatient?.billing_month
      ? isSameMonth(currentPatient.billing_month, currentMonth)
      : false;

    if (!isCurrentMonth) {
      return formValues;
    }

    const projectedCount = dashboard?.current_month_new_patients ?? 0;
    if (projectedCount < MONTHLY_PATIENT_LIMIT || currentAssigned) {
      return formValues;
    }

    const nextMonthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    const result = await Swal.fire({
      title: "Cupo mensual completo",
      text: "Ya hay 20 pacientes asignados al mes actual. Puedes dejarlo para el proximo mes.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Pasar al proximo mes",
      cancelButtonText: "Mantener este mes",
    });

    if (result.isConfirmed) {
      return {
        ...formValues,
        billing_month: `${toMonthInputValue(nextMonthDate)}-01`,
      };
    }

    return formValues;
  }

  async function openHolidayManager() {
    const listHtml = holidays.length
      ? holidays
          .map(
            (holiday) => `
              <article class="swal-history-entry">
                <div class="swal-history-head">
                  <strong>${holiday.date}</strong>
                  <button type="button" class="text-button holiday-delete" data-holiday-id="${holiday.id}">Quitar</button>
                </div>
                <small>${holiday.name || "Feriado manual"}</small>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">Sin feriados cargados.</div>';

    const result = await Swal.fire({
      title: "Feriados",
      html: `
        <div class="swal-form-grid">
          <div class="swal-history-list">${listHtml}</div>
          <div class="swal-section-label">Agregar feriado</div>
          <div class="swal-row">
            <input id="swal-holiday-date" class="swal2-input" type="date" />
            <input id="swal-holiday-name" class="swal2-input" placeholder="Descripcion" />
          </div>
        </div>
      `,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cerrar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => {
        document.querySelectorAll(".holiday-delete").forEach((button) => {
          button.addEventListener("click", async () => {
            const holidayId = Number(button.dataset.holidayId);
            await deleteHoliday(holidayId);
            await refreshAgendaAndHistory();
            Swal.close();
            openHolidayManager();
          });
        });
      },
      preConfirm: () => {
        const holidayDate = document.getElementById("swal-holiday-date")?.value || "";
        const holidayName = document.getElementById("swal-holiday-name")?.value.trim() || "";
        if (!holidayDate) {
          return null;
        }
        return { date: holidayDate, name: holidayName || null };
      },
    });

    if (!result.value) {
      return;
    }

    try {
      await createHoliday(result.value);
      await refreshAgendaAndHistory();
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

  async function openPricingManager() {
    const { value } = await Swal.fire({
      title: "Precios",
      html: `
        <div class="swal-form-grid">
          <div class="swal-section-label">Valores por modo</div>
          <div class="swal-pricing-grid">
            <label class="swal-field-block">
              <span class="swal-field-label">Monto institucional</span>
              <input id="swal-institutional-rate" class="swal2-input" type="number" min="0" step="100" placeholder="Monto institucional" value="${pricingSettings.institutional_rate ?? 0}" />
            </label>
            <label class="swal-field-block">
              <span class="swal-field-label">Monto domiciliario</span>
              <input id="swal-domiciliary-rate" class="swal2-input" type="number" min="0" step="100" placeholder="Monto domiciliario" value="${pricingSettings.domiciliary_rate ?? 0}" />
            </label>
          </div>
          <div class="swal-section-label">Aplicar precio general</div>
          <div class="swal-row">
            <input id="swal-bulk-price" class="swal2-input" type="number" min="0" step="100" placeholder="Monto" />
            <select id="swal-bulk-scope" class="swal2-input">
              <option value="all">Todos</option>
              <option value="institutional">Institucional</option>
              <option value="domiciliary">Domiciliario</option>
            </select>
          </div>
        </div>
      `,
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      preConfirm: () => {
        const institutionalRate = Number(document.getElementById("swal-institutional-rate")?.value ?? 0);
        const domiciliaryRate = Number(document.getElementById("swal-domiciliary-rate")?.value ?? 0);
        const bulkAmountRaw = document.getElementById("swal-bulk-price")?.value ?? "";
        const bulkScope = document.getElementById("swal-bulk-scope")?.value || "all";

        if ([institutionalRate, domiciliaryRate].some((amount) => Number.isNaN(amount) || amount < 0)) {
          Swal.showValidationMessage("Los valores por modo deben ser numeros validos.");
          return null;
        }

        if (bulkAmountRaw !== "" && (Number.isNaN(Number(bulkAmountRaw)) || Number(bulkAmountRaw) < 0)) {
          Swal.showValidationMessage("El precio general debe ser un numero valido.");
          return null;
        }

        return {
          settings: {
            institutional_rate: institutionalRate,
            domiciliary_rate: domiciliaryRate,
          },
          bulkAmount: bulkAmountRaw === "" ? null : Number(bulkAmountRaw),
          bulkScope,
        };
      },
    });

    if (!value) {
      return;
    }

    try {
      await updatePricingSettings(value.settings);
      if (value.bulkAmount !== null) {
        await applyBulkPricing({
          amount: value.bulkAmount,
          scope: value.bulkScope,
        });
      }
      await refreshAgendaAndHistory();
      await Swal.fire({
        title: value.bulkAmount !== null ? `Precio aplicado a ${PRICING_SCOPE_LABELS[value.bulkScope]}` : "Precios actualizados",
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

  async function openNewPatientModal() {
    const { value: formValues } = await Swal.fire({
      title: "Nuevo paciente",
      html: patientFormHtml({}, pricingSettings),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => setupPatientPricingAssistant(pricingSettings),
      preConfirm: readPatientFormValues,
    });

    if (!formValues) {
      return;
    }

    try {
      const preparedValues = await ensureMonthlyCapacity(formValues);
      const created = await createPatient(patientPayload(preparedValues));
      await syncPatientPhoto(created.id, preparedValues);
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
    const { value: formValues, isDenied } = await Swal.fire({
      title: "Editar paciente",
      html: patientFormHtml(patient, pricingSettings),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      denyButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      showDenyButton: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => setupPatientPricingAssistant(pricingSettings),
      preConfirm: readPatientFormValues,
    });

    if (isDenied) {
      const confirmation = await Swal.fire({
        title: "Eliminar paciente",
        text: `Se borrara ${patient.full_name} con sus turnos e historial.`,
        icon: "warning",
        confirmButtonText: "Eliminar",
        cancelButtonText: "Cancelar",
        showCancelButton: true,
        confirmButtonColor: "#b14d5d",
      });

      if (!confirmation.isConfirmed) {
        return;
      }

      setErrorMessage("");
      try {
        await deletePatient(patient.id);
        const nextPatientId =
          patients.find((entry) => entry.id !== patient.id)?.id ?? null;
        setSelectedAppointmentId((current) =>
          appointments.some(
            (appointment) => appointment.id === current && appointment.patient.id !== patient.id,
          )
            ? current
            : null,
        );
        setSelectedPatientId(nextPatientId);
        setSideSection(nextPatientId ? "history" : "patients");
        await refreshAgendaAndHistory(nextPatientId);
        await Swal.fire({
          title: "Paciente eliminado",
          icon: "success",
          timer: 1200,
          showConfirmButton: false,
        });
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

    if (!formValues) {
      return;
    }

    setErrorMessage("");
    try {
      const preparedValues = await ensureMonthlyCapacity(formValues, patient);
      await updatePatient(patient.id, patientPayload(preparedValues));
      await syncPatientPhoto(patient.id, preparedValues);
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
    const defaultPatient = patients.find((patient) => patient.id === defaultPatientId) ?? null;
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
          auto_schedule_enabled: Boolean(defaultPatient?.auto_schedule_enabled),
          preferred_weekdays: Array.isArray(defaultPatient?.preferred_weekdays) ? defaultPatient.preferred_weekdays : [],
          prescribed_sessions: defaultPatient?.prescribed_sessions ?? 0,
        },
      }),
      focusConfirm: false,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      customClass: { popup: "swal-patient-modal" },
      didOpen: () => {
        setupPatientFilter(patients, defaultPatientId);
        setupAppointmentAutomationAssistant(patients);
      },
      preConfirm: () => {
        const values = readAppointmentFormValues();
        if (!values) {
          return null;
        }
        const validationError = validateAppointmentInput(values, { patients, holidayDates });
        if (validationError) {
          Swal.showValidationMessage(validationError);
          return null;
        }
        return values;
      },
    });

    if (!formValues) {
      return;
    }

    try {
      await createAppointment({
        patient_id: formValues.patient_id,
        date: formValues.date,
        time: formValues.time,
        duration_minutes: formValues.duration_minutes,
        status: formValues.status,
        reason: formValues.reason,
        evolution_note: formValues.evolution_note,
      });
      const automationPayload = appointmentAutomationPayload(formValues);
      if (automationPayload) {
        await updatePatient(formValues.patient_id, automationPayload);
      }
      setSelectedPatientId(formValues.patient_id);
      await refreshAgendaAndHistory(formValues.patient_id);
      await Swal.fire({
        title: automationPayload ? "Turno y cronograma creados" : "Turno creado",
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
      preConfirm: () => {
        const values = readAppointmentFormValues();
        if (!values) {
          return null;
        }
        const validationError = validateAppointmentInput(values, { patients, holidayDates });
        if (validationError) {
          Swal.showValidationMessage(validationError);
          return null;
        }
        return values;
      },
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
    const whatsappUrl = buildWhatsappUrl(appointment.patient.phone, buildWhatsappMessage(appointment));
    if (!whatsappUrl) {
      setErrorMessage("El paciente no tiene un telefono valido para WhatsApp.");
      return;
    }

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  async function openHistoryModal() {
    if (!selectedPatient || history.length === 0) {
      return;
    }

    const historyHtml = sortedHistory
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
      html: `
        <div class="swal-history-toolbar">
          <span>Orden actual: ${historyOrder === "desc" ? "Ultima a primera" : "Primera a ultima"}</span>
        </div>
        <div class="swal-history-list">${historyHtml}</div>
      `,
      width: 720,
      confirmButtonText: "Cerrar",
      customClass: { popup: "swal-patient-modal swal-history-modal" },
    });
  }

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const sortedHistory = useMemo(() => {
    const copy = [...history];
    copy.sort((left, right) => {
      const leftKey = `${left.date}T${left.time}`;
      const rightKey = `${right.date}T${right.time}`;
      return historyOrder === "desc"
        ? rightKey.localeCompare(leftKey)
        : leftKey.localeCompare(rightKey);
    });
    return copy;
  }, [history, historyOrder]);
  const historyPreview = sortedHistory.slice(0, 2);

  const appointmentsByDay = useMemo(() => {
    return weekDates.map((date) => {
      const key = toDateInputValue(date);
      const items = appointments
        .filter((appointment) => appointment.date === key)
        .sort((left, right) => {
          const timeDiff = left.time.localeCompare(right.time);
          if (timeDiff !== 0) {
            return timeDiff;
          }
          return left.patient.full_name.localeCompare(right.patient.full_name);
        });
      const grouped = Object.values(
        items.reduce((accumulator, appointment) => {
          const slotKey = appointment.time.slice(0, 5);
          if (!accumulator[slotKey]) {
            accumulator[slotKey] = {
              key: `${key}-${slotKey}`,
              time: slotKey,
              items: [],
            };
          }
          accumulator[slotKey].items.push(appointment);
          return accumulator;
        }, {}),
      ).sort((left, right) => left.time.localeCompare(right.time));

      return {
        key,
        label: weekdayFormatter.format(date),
        items,
        slots: grouped,
        holiday: holidayByDate.get(key) || null,
      };
    });
  }, [appointments, holidayByDate, weekDates]);

  const appointmentsByMonthDay = useMemo(() => {
    return monthGrid.map((date) => {
      const key = toDateInputValue(date);
      const items = appointments
        .filter((appointment) => appointment.date === key)
        .sort((left, right) => left.time.localeCompare(right.time));
      return {
        key,
        date,
        items,
        isCurrentMonth: date.getMonth() === weekAnchor.getMonth(),
        holiday: holidayByDate.get(key) || null,
      };
    });
  }, [appointments, holidayByDate, monthGrid, weekAnchor]);

  useEffect(() => {
    const validKeys = new Set(weekDates.map((date) => toDateInputValue(date)));
    if (!validKeys.has(selectedDayKey)) {
      setSelectedDayKey(weekStart);
    }
  }, [selectedDayKey, weekDates, weekStart]);

  const selectedDay = appointmentsByDay.find((day) => day.key === selectedDayKey) ?? appointmentsByDay[0];
  const selectedDaySummary = selectedDay
    ? `${selectedDay.items.length} ${selectedDay.items.length === 1 ? "turno" : "turnos"}`
    : "";
  const currentMonthRevenue = dashboard?.current_month_projected_revenue ?? 0;
  const currentMonthPatients = dashboard?.current_month_new_patients ?? 0;

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
                    WhatsApp Web
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
        <div className="brand-lockup">
          <img src={appLogo} alt="Turnos Historial App" className="brand-logo" />
          <div>
            <p className="eyebrow">Turnos Historial App</p>
            <h1>Agenda clinica</h1>
            <p className="session-user">{authUser.full_name}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={openPricingManager}>
            Precios
          </button>
          <button type="button" className="ghost-button" onClick={openHolidayManager}>
            Feriados
          </button>
          <button type="button" className="ghost-button" onClick={() => shiftWeek(-1)}>
            {agendaView === "month" ? "Mes anterior" : "Semana anterior"}
          </button>
          <button type="button" className="ghost-button" onClick={jumpToCurrentWeek}>
            Hoy
          </button>
          <button type="button" className="ghost-button" onClick={() => shiftWeek(1)}>
            {agendaView === "month" ? "Mes siguiente" : "Semana siguiente"}
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
          <div>
            <span>Nuevos del mes</span>
            <strong>{`${currentMonthPatients}/${dashboard.monthly_patient_limit}`}</strong>
          </div>
          <div>
            <span>PAMI estimado</span>
            <strong>{formatCurrency(currentMonthRevenue)}</strong>
          </div>
        </section>
      ) : null}

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <main className={`workspace ${sidebarHidden ? "workspace-sidebar-hidden" : ""}`}>
        {!sidebarHidden ? (
        <aside className="sidebar-shell">
          <section className="pane sidebar-pane">
            <div className="sidebar-actions">
              <button type="button" className="primary-button" onClick={openNewPatientModal}>
                Nuevo paciente
              </button>
              <button type="button" className="primary-button" onClick={() => openNewAppointmentModal()}>
                Nuevo turno
              </button>
              <button type="button" className="ghost-button" onClick={() => setShowReminders(true)}>
                Turnos de hoy
              </button>
            </div>

            <div className="sidebar-nav">
              <button
                type="button"
                className={`sidebar-tab ${sideSection === "patients" ? "sidebar-tab-active" : ""}`}
                onClick={() => setSideSection("patients")}
              >
                Pacientes
              </button>
              <button
                type="button"
                className={`sidebar-tab ${sideSection === "history" ? "sidebar-tab-active" : ""}`}
                onClick={() => setSideSection("history")}
                disabled={!selectedPatient}
              >
                Historial
              </button>
            </div>

            {sideSection === "patients" ? (
              <>
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

                <div className="patient-list patient-list-compact">
                  {patients.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className={`patient-item ${selectedPatientId === patient.id ? "patient-item-active" : ""}`}
                      onClick={() => {
                        setSelectedPatientId(patient.id);
                        setSideSection("history");
                      }}
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
              </>
            ) : (
              <>
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

                {selectedPatient ? (
                  <div className="history-plan-card">
                    <div>
                      <span>Modo</span>
                      <strong>{CARE_MODE_LABELS[selectedPatient.care_mode] || "Institucional"}</strong>
                    </div>
                    <div>
                      <span>Valor sesion</span>
                      <strong>{formatCurrency(selectedPatient.session_price)}</strong>
                    </div>
                    <div>
                      <span>Comienzo</span>
                      <strong>{selectedPatient.treatment_start_date || "Sin definir"}</strong>
                    </div>
                    <div>
                      <span>Final estimado</span>
                      <strong>{selectedPatient.treatment_end_date || "Pendiente"}</strong>
                    </div>
                    <div>
                      <span>Mes PAMI</span>
                      <strong>{selectedPatient.billing_month || "Sin definir"}</strong>
                    </div>
                    <div>
                      <span>Valor total</span>
                      <strong>{formatCurrency(selectedPatient.projected_revenue)}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="history-list">
                  {historyPreview.length === 0 ? (
                    <div className="empty-history">Todavia sin registros.</div>
                  ) : (
                    historyPreview.map((entry) => (
                      <article
                        key={entry.id}
                        className={`history-entry ${isLastSessionAppointment(entry) ? "history-entry-last" : ""}`}
                      >
                        <div className="history-head">
                          <strong>{entry.date}</strong>
                          <div className="history-head-badges">
                            {isLastSessionAppointment(entry) ? (
                              <span className="last-session-badge">Ultimo turno</span>
                            ) : null}
                            <span className={`status-chip ${STATUS_CLASS[entry.status]}`}>
                              {STATUS_LABELS[entry.status]}
                            </span>
                          </div>
                        </div>
                        <p>{entry.reason || "Sesion general"}</p>
                        <small>{entry.evolution_note || "Sin notas clinicas."}</small>
                      </article>
                    ))
                  )}
                </div>

                {history.length > 2 ? (
                  <div className="history-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setHistoryOrder((current) => (current === "desc" ? "asc" : "desc"))}
                    >
                      {historyOrder === "desc" ? "Primera sesion primero" : "Ultima sesion primero"}
                    </button>
                    <button type="button" className="ghost-button" onClick={openHistoryModal}>
                      Ver todo
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </aside>
        ) : null}

        <section className="agenda-panel agenda-panel-wide">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {agendaView === "week" ? "Agenda semanal" : agendaView === "day" ? "Agenda del dia" : "Agenda mensual"}
              </p>
              <h2>
                {agendaView === "week"
                  ? `${weekdayFormatter.format(weekDates[0])} - ${weekdayFormatter.format(weekDates[4])}`
                  : agendaView === "day"
                    ? selectedDay?.label || ""
                    : formatMonthLabel(weekAnchor)}
              </h2>
              {agendaView === "day" ? <p className="agenda-caption">{selectedDaySummary}</p> : null}
            </div>
            <div className="agenda-toolbar">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSidebarHidden((current) => !current)}
              >
                {sidebarHidden ? "Mostrar panel" : "Ocultar panel"}
              </button>
              <div className="view-switch">
                <button
                  type="button"
                  className={`view-switch-button ${agendaView === "week" ? "view-switch-button-active" : ""}`}
                  onClick={() => setAgendaView("week")}
                >
                  Semana
                </button>
                <button
                  type="button"
                  className={`view-switch-button ${agendaView === "day" ? "view-switch-button-active" : ""}`}
                  onClick={() => setAgendaView("day")}
                >
                  Dia
                </button>
                <button
                  type="button"
                  className={`view-switch-button ${agendaView === "month" ? "view-switch-button-active" : ""}`}
                  onClick={() => setAgendaView("month")}
                >
                  Mes
                </button>
              </div>
            </div>
          </div>

          {agendaView === "week" ? (
            <div className="week-grid week-grid-scroll">
              {appointmentsByDay.map((day) => (
                <article key={day.key} className={`day-column ${day.holiday ? "day-column-holiday" : ""}`}>
                  <header className="day-column-head">
                    <div className="day-column-title">
                      <span>{day.label}</span>
                      {day.holiday ? <small className="holiday-badge">{holidayLabel(day.holiday)}</small> : null}
                    </div>
                    <strong>{day.items.length}</strong>
                  </header>

                  <div className="day-slots">
                    {day.items.length === 0 ? (
                      <div className="empty-state">Libre</div>
                    ) : (
                      day.slots.map((slot) => (
                        <article key={slot.key} className="time-slot-group">
                          <header className="time-slot-head">
                            <span className="time-slot-hour">{formatClock(day.key, slot.time)}</span>
                            <strong>{slot.items.length}</strong>
                          </header>

                          <div className="time-slot-list">
                            {slot.items.map((appointment) => (
                              <button
                                key={appointment.id}
                                type="button"
                                className={`appointment-row ${isLastSessionAppointment(appointment) ? "appointment-row-last" : ""} ${
                                  selectedAppointmentId === appointment.id ? "appointment-row-active" : ""
                                }`}
                                onClick={() => {
                                  setSelectedPatientId(appointment.patient.id);
                                  openAppointmentEditor(appointment);
                                }}
                              >
                                <div className="appointment-row-main">
                                  <strong>{appointment.patient.full_name}</strong>
                                  <small>{appointment.reason || "Sesion general"}</small>
                                </div>
                                <div className="appointment-row-meta">
                                  {isLastSessionAppointment(appointment) ? (
                                    <span className="last-session-badge">Ultimo turno</span>
                                  ) : null}
                                  <span className={`status-chip ${STATUS_CLASS[appointment.status]}`}>
                                    {STATUS_LABELS[appointment.status]}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : agendaView === "day" ? (
            <div className="day-view">
              <div className="day-picker">
                {appointmentsByDay.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    className={`day-pill ${selectedDayKey === day.key ? "day-pill-active" : ""} ${day.holiday ? "day-pill-holiday" : ""}`}
                    onClick={() => setSelectedDayKey(day.key)}
                  >
                    <span>{day.label}</span>
                    <strong>{day.items.length}</strong>
                    {day.holiday ? <small className="holiday-badge">{holidayLabel(day.holiday)}</small> : null}
                  </button>
                ))}
              </div>

              <section className="day-focus">
                {selectedDay?.items.length ? (
                  selectedDay.slots.map((slot) => (
                    <article key={slot.key} className="time-slot-group time-slot-group-expanded">
                      <header className="time-slot-head">
                        <span className="time-slot-hour">{formatClock(selectedDay.key, slot.time)}</span>
                        <strong>{slot.items.length} pacientes</strong>
                      </header>

                      <div className="time-slot-list">
                        {slot.items.map((appointment) => (
                          <button
                            key={appointment.id}
                            type="button"
                            className={`appointment-row appointment-row-detailed ${isLastSessionAppointment(appointment) ? "appointment-row-last" : ""} ${
                              selectedAppointmentId === appointment.id ? "appointment-row-active" : ""
                            }`}
                            onClick={() => {
                              setSelectedPatientId(appointment.patient.id);
                              openAppointmentEditor(appointment);
                            }}
                          >
                            <div className="appointment-row-main">
                              <strong>{appointment.patient.full_name}</strong>
                              <small>{appointment.reason || "Sesion general"}</small>
                            </div>
                            <div className="appointment-row-meta">
                              {isLastSessionAppointment(appointment) ? (
                                <span className="last-session-badge">Ultimo turno</span>
                              ) : null}
                              <span className={`status-chip ${STATUS_CLASS[appointment.status]}`}>
                                {STATUS_LABELS[appointment.status]}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">Libre</div>
                )}
              </section>
            </div>
          ) : (
            <div className="month-grid">
              {appointmentsByMonthDay.map((day) => (
                <article
                  key={day.key}
                  className={`month-cell ${day.isCurrentMonth ? "" : "month-cell-muted"} ${day.holiday ? "month-cell-holiday" : ""}`}
                >
                  <header className="month-cell-head">
                    <div className="month-cell-title">
                      <span>{day.date.getDate()}</span>
                      {day.holiday ? <small className="holiday-badge">{holidayLabel(day.holiday)}</small> : null}
                    </div>
                    <strong>{day.items.length}</strong>
                  </header>
                  <div className="month-cell-list">
                    {day.items.slice(0, 3).map((appointment) => (
                      <button
                        key={appointment.id}
                        type="button"
                        className={`month-appointment ${isLastSessionAppointment(appointment) ? "month-appointment-last" : ""} ${
                          isSameMonth(appointment.patient.billing_month, weekAnchor) ? "month-appointment-new" : ""
                        }`}
                        onClick={() => {
                          setSelectedPatientId(appointment.patient.id);
                          openAppointmentEditor(appointment);
                        }}
                      >
                        {isLastSessionAppointment(appointment) ? (
                          <span className="month-appointment-flag">Ultimo turno</span>
                        ) : null}
                        <strong>{appointment.patient.full_name}</strong>
                        <small>{`${appointment.time.slice(0, 5)} · ${appointment.reason || "Sesion"}`}</small>
                      </button>
                    ))}
                    {day.items.length > 3 ? <small className="month-more">+{day.items.length - 3} mas</small> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
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

      const whatsappUrl = buildWhatsappUrl(setupForm.phone, buildRecoveryCodeMessage(response.recovery_code));

      await Swal.fire({
        title: "Codigo de recuperacion",
        html: `
          <div class="recovery-box">
            <strong>${response.recovery_code}</strong>
            <p>Guardalo o envialo a tu celular. Con este codigo podras crear una nueva contraseña.</p>
          </div>
        `,
        showCancelButton: Boolean(whatsappUrl),
        confirmButtonText: "Cerrar",
        cancelButtonText: "Abrir WhatsApp Web",
        reverseButtons: true,
      }).then((result) => {
        if (result.dismiss === Swal.DismissReason.cancel && whatsappUrl) {
          window.open(whatsappUrl, "_blank", "noopener,noreferrer");
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
      const whatsappUrl = buildWhatsappUrl(response.phone, buildRecoveryCodeMessage(response.recovery_code));
      if (!whatsappUrl) {
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

      window.open(whatsappUrl, "_blank", "noopener,noreferrer");

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
