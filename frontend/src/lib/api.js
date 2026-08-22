import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// The JWT lives in an HttpOnly session cookie set by the server — it is never
// stored in localStorage or exposed to JavaScript. `withCredentials` makes
// the browser attach the cookie on every request.
const client = axios.create({ baseURL: API, withCredentials: true });

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}

export const api = {
  login: (role, username, passcode, club_id) =>
    client.post("/auth/login", { role, username, passcode, club_id }).then((r) => r.data),
  logout: () => client.post("/auth/logout").then((r) => r.data),
  changePasscode: (current_passcode, new_passcode) =>
    client.post("/auth/change-passcode", { current_passcode, new_passcode }).then((r) => r.data),
  forgotPassword: (club_id, email) => client.post("/auth/forgot", { club_id, email }).then((r) => r.data),
  resetPassword: (token, new_passcode) =>
    client.post("/auth/reset-password", { token, new_passcode }).then((r) => r.data),
  me: () => client.get("/auth/me").then((r) => r.data),

  getAudit: (params = {}) => client.get("/audit", { params }).then((r) => r.data),
  // Backup downloads use a real browser download (the session cookie is sent
  // automatically; the server names the file via Content-Disposition).
  downloadBackup: (club_id, admin = false) => {
    const base = admin ? "/admin/backup" : "/backup";
    const qs = club_id ? `?club_id=${encodeURIComponent(club_id)}` : "";
    const a = document.createElement("a");
    a.href = `${API}${base}${qs}`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  getClubs: () => client.get("/clubs").then((r) => r.data),
  getClubDirectory: (year) => client.get("/clubs/directory", { params: year ? { year } : {} }).then((r) => r.data),
  getSeasons: (club_id) => client.get("/seasons", { params: club_id ? { club_id } : {} }).then((r) => r.data),
  getClubsManage: () => client.get("/clubs/manage").then((r) => r.data),
  createClub: (d) => client.post("/clubs", d).then((r) => r.data),
  updateClub: (id, d) => client.put(`/clubs/${id}`, d).then((r) => r.data),
  deleteClub: (id) => client.delete(`/clubs/${id}`).then((r) => r.data),
  uploadClubIcon: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return client.put(`/clubs/${id}/icon`, fd).then((r) => r.data);
  },
  deleteClubIcon: (id) => client.delete(`/clubs/${id}/icon`).then((r) => r.data),

  getClasses: (params = {}) => client.get("/classes", { params }).then((r) => r.data),
  createClass: (d) => client.post("/classes", d).then((r) => r.data),
  updateClass: (id, d) => client.put(`/classes/${id}`, d).then((r) => r.data),
  deleteClass: (id) => client.delete(`/classes/${id}`).then((r) => r.data),

  getBoats: (params = {}) => client.get("/boats", { params }).then((r) => r.data),
  createBoat: (d) => client.post("/boats", d).then((r) => r.data),
  updateBoat: (id, d) => client.put(`/boats/${id}`, d).then((r) => r.data),
  deleteBoat: (id) => client.delete(`/boats/${id}`).then((r) => r.data),

  getSeries: (params = {}) => client.get("/series", { params }).then((r) => r.data),
  createSeries: (d) => client.post("/series", d).then((r) => r.data),
  updateSeries: (id, d) => client.put(`/series/${id}`, d).then((r) => r.data),
  deleteSeries: (id) => client.delete(`/series/${id}`).then((r) => r.data),
  generateSchedule: (id, body) => client.post(`/series/${id}/generate-schedule`, body).then((r) => r.data),
  scheduledRaces: (date) => client.get("/scheduled-races", { params: date ? { date } : {} }).then((r) => r.data),

  getRaces: (params = {}) => client.get("/races", { params }).then((r) => r.data),
  getRace: (id) => client.get(`/races/${id}`).then((r) => r.data),
  createRace: (d) => client.post("/races", d).then((r) => r.data),
  updateNotifications: (id, d) => client.put(`/races/${id}/notifications`, d).then((r) => r.data),
  selectBoats: (id, boat_ids) => client.post(`/races/${id}/select-boats`, { boat_ids }).then((r) => r.data),
  recordFinish: (id, boat_id, finish_time) => client.post(`/races/${id}/finish`, { boat_id, finish_time }).then((r) => r.data),
  undoFinish: (id, boat_id) => client.post(`/races/${id}/undo-finish`, { boat_id }).then((r) => r.data),
  startRace: (id, start_time) => client.post(`/races/${id}/start`, { start_time }).then((r) => r.data),
  adjustResult: (id, boat_id, d) => client.put(`/races/${id}/result/${boat_id}`, d).then((r) => r.data),
  setStatus: (id, status) => client.post(`/races/${id}/status/${status}`).then((r) => r.data),
  deleteRace: (id) => client.delete(`/races/${id}`).then((r) => r.data),

  getNotifications: (params = {}) => client.get("/notifications", { params }).then((r) => r.data),
  seriesStandings: (id, club_id) => client.get(`/standings/series/${id}`, { params: club_id ? { club_id } : {} }).then((r) => r.data),
  overallStandings: (class_id, year, club_id) => client.get("/standings/overall", { params: { class_id, year, ...(club_id ? { club_id } : {}) } }).then((r) => r.data),
  rrsCodes: () => client.get("/rrs-codes").then((r) => r.data),

  getUsers: (club_id) => client.get("/users", { params: club_id ? { club_id } : {} }).then((r) => r.data),
  createUser: (d) => client.post("/users", d).then((r) => r.data),
  updateUser: (id, d) => client.put(`/users/${id}`, d).then((r) => r.data),
  deleteUser: (id) => client.delete(`/users/${id}`).then((r) => r.data),

  getAdverts: () => client.get("/adverts").then((r) => r.data),
  getAdvertsManage: () => client.get("/adverts/manage").then((r) => r.data),
  createAdvert: (fd) => client.post("/adverts", fd).then((r) => r.data),
  updateAdvert: (id, d) => client.put(`/adverts/${id}`, d).then((r) => r.data),
  // Upload the per-shape images of an advert: pass an object like
  // { landscape: File, portrait: File|null, square: File|null }.
  uploadAdvertImages: (id, images) => {
    const fd = new FormData();
    Object.entries(images || {}).forEach(([shape, file]) => {
      if (file) fd.append(`file_${shape}`, file);
    });
    return client.put(`/adverts/${id}/images`, fd).then((r) => r.data);
  },
  deleteAdvert: (id) => client.delete(`/adverts/${id}`).then((r) => r.data),

  getEmailSettings: () => client.get("/admin/email-settings").then((r) => r.data),
  updateEmailSettings: (d) => client.put("/admin/email-settings", d).then((r) => r.data),
  testEmail: (to_email) => client.post("/admin/email-settings/test", { to_email }).then((r) => r.data),
};

export default client;
