const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const SESSION_STORAGE_KEY = "turnos-historial-session-token";

export function getStoredSessionToken() {
  return window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
}

export function setStoredSessionToken(token) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, token);
}

export function clearStoredSessionToken() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function resolveApiUrl(path) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${API_URL}${path}`;
}

async function request(path, options = {}) {
  const sessionToken = getStoredSessionToken();
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(sessionToken ? { "x-session-token": sessionToken } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload.detail;
    if (Array.isArray(detail)) {
      const message = detail
        .map((entry) => `${(entry.loc || []).join(" / ")}: ${entry.msg}`)
        .join(" | ");
      throw new Error(message || "No se pudo completar la solicitud.");
    }
    throw new Error(detail || "No se pudo completar la solicitud.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function fetchDashboard() {
  return request("/dashboard");
}

export function fetchAuthStatus() {
  return request("/auth/status");
}

export function setupAuth(payload) {
  return request("/auth/setup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return request("/auth/logout", {
    method: "POST",
  });
}

export function recoverAccess(payload) {
  return request("/auth/recover", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestRecoveryCode(payload) {
  return request("/auth/recovery-code", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchPatients(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request(`/patients${query}`);
}

export function createPatient(payload) {
  return request("/patients", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePatient(id, payload) {
  return request(`/patients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function uploadPatientPhoto(id, file) {
  const formData = new FormData();
  formData.append("photo", file);
  return request(`/patients/${id}/photo`, {
    method: "POST",
    body: formData,
  });
}

export function deletePatientPhoto(id) {
  return request(`/patients/${id}/photo`, {
    method: "DELETE",
  });
}

export function deletePatient(id) {
  return request(`/patients/${id}`, {
    method: "DELETE",
  });
}

export function fetchAppointments(start, end) {
  return request(`/appointments?start=${start}&end=${end}`);
}

export function createAppointment(payload) {
  return request("/appointments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAppointment(id, payload) {
  return request(`/appointments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAppointment(id) {
  return request(`/appointments/${id}`, {
    method: "DELETE",
  });
}

export function fetchPatientHistory(patientId) {
  return request(`/patients/${patientId}/history`);
}
