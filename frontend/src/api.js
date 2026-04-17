const API_URL = "http://127.0.0.1:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "No se pudo completar la solicitud.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function fetchDashboard() {
  return request("/dashboard");
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
