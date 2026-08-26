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

// Optimistic concurrency: the UI sends the version of the record it loaded
// (e.g. race.version); the server rejects the write with 409 if the record
// has since been changed by someone else, instead of silently overwriting it.
export const withVer = (body, version) => (version == null ? body : { ...body, expected_version: version });
export const verQuery = (version) => (version == null ? {} : { expected_version: version });
// Shown when the server returns 409 for a stale concurrent write.
export const STALE_VERSION_MSG = "This result has been changed by another user. Your version is out of date. Reload the latest results before making further changes.";

export const api = {
  login: (role, username, passcode, club_id) =>
    client.post("/auth/login", { role, username, passcode, club_id }).then((r) => r.data),
  // Two-step webmaster login: the passcode step answers { requires_2fa: true };
  // the code from an authenticator app (or emailed fallback) completes the login.
  login2fa: (method, code) => client.post("/auth/login/2fa", { method, code }).then((r) => r.data),
  sendEmailCode: () => client.post("/auth/2fa/send-email-code").then((r) => r.data),
  get2faStatus: () => client.get("/auth/2fa/status").then((r) => r.data),
  setup2fa: () => client.post("/auth/2fa/setup").then((r) => r.data),
  enable2fa: (code, email) => client.post("/auth/2fa/enable", { code, email }).then((r) => r.data),
  disable2fa: (current_passcode, code, method) =>
    client.post("/auth/2fa/disable", { current_passcode, code, method }).then((r) => r.data),
  update2faEmail: (current_passcode, email) =>
    client.post("/auth/2fa/email", { current_passcode, email }).then((r) => r.data),
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
  // Restore a backup ZIP. Webmaster only.
  restoreBackup: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return client.post("/admin/backup/restore", fd).then((r) => r.data);
  },

  getClubs: () => client.get("/clubs").then((r) => r.data),
  getClubDirectory: (year) => client.get("/clubs/directory", { params: year ? { year } : {} }).then((r) => r.data),
  getSeasons: (club_id) => client.get("/seasons", { params: club_id ? { club_id } : {} }).then((r) => r.data),
  getClubsManage: () => client.get("/clubs/manage").then((r) => r.data),
  createClub: (d) => client.post("/clubs", d).then((r) => r.data),
  updateClub: (id, d) => client.put(`/clubs/${id}`, d).then((r) => r.data),
  updateClubSettings: (id, d) => client.put(`/clubs/${id}/settings`, d).then((r) => r.data),
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
  updateBoat: (id, d, v) => client.put(`/boats/${id}`, withVer(d, v)).then((r) => r.data),
  deleteBoat: (id, v) => client.delete(`/boats/${id}`, { params: verQuery(v) }).then((r) => r.data),
  // Shared boat registry: one physical boat may race at several clubs or in
  // several classes; search groups its records under a single fleet identity.
  fleetSearch: (q) => client.get("/fleet/search", { params: { q } }).then((r) => r.data),
  fleetProfile: (id) => client.get(`/fleet/${id}`).then((r) => r.data),
  // Unified public search: clubs, classes, series and boats.
  siteSearch: (q) => client.get("/search", { params: { q } }).then((r) => r.data),

  getSeries: (params = {}) => client.get("/series", { params }).then((r) => r.data),
  createSeries: (d) => client.post("/series", d).then((r) => r.data),
  updateSeries: (id, d, v) => client.put(`/series/${id}`, withVer(d, v)).then((r) => r.data),
  deleteSeries: (id, v) => client.delete(`/series/${id}`, { params: verQuery(v) }).then((r) => r.data),
  generateSchedule: (id, body) => client.post(`/series/${id}/generate-schedule`, body).then((r) => r.data),
  splitMiniSeries: (id, d, v) => client.post(`/series/${id}/mini-split`, withVer(d, v)).then((r) => r.data),
  addMiniRace: (id, gi, d) => client.post(`/series/${id}/mini/${gi}/races`, d).then((r) => r.data),
  scheduledRaces: (date) => client.get("/scheduled-races", { params: date ? { date } : {} }).then((r) => r.data),
  lockSeries: (id, reason, v) => client.post(`/series/${id}/lock`, withVer({ confirm: true, reason }, v)).then((r) => r.data),
  unlockSeries: (id, reason, v) => client.post(`/series/${id}/unlock`, withVer({ confirm: true, reason }, v)).then((r) => r.data),
  archiveSeries: (id, reason, v) => client.post(`/series/${id}/archive`, withVer({ confirm: true, reason }, v)).then((r) => r.data),
  getSeriesSnapshots: (id, club_id) => client.get(`/series/${id}/snapshots`, { params: club_id ? { club_id } : {} }).then((r) => r.data),

  getRaces: (params = {}) => client.get("/races", { params }).then((r) => r.data),
  getRace: (id) => client.get(`/races/${id}`).then((r) => r.data),
  createRace: (d) => client.post("/races", d).then((r) => r.data),
  updateNotifications: (id, d, v) => client.put(`/races/${id}/notifications`, withVer(d, v)).then((r) => r.data),
  selectBoats: (id, boat_ids, v) => client.post(`/races/${id}/select-boats`, withVer({ boat_ids }, v)).then((r) => r.data),
  recordFinish: (id, boat_id, finish_time, v) => client.post(`/races/${id}/finish`, withVer({ boat_id, finish_time }, v)).then((r) => r.data),
  undoFinish: (id, boat_id, v) => client.post(`/races/${id}/undo-finish`, withVer({ boat_id }, v)).then((r) => r.data),
  startRace: (id, start_time, v) => client.post(`/races/${id}/start`, withVer({ start_time }, v)).then((r) => r.data),
  adjustResult: (id, boat_id, d, v) => client.put(`/races/${id}/result/${boat_id}`, withVer(d, v)).then((r) => r.data),
  validateRace: (id) => client.get(`/races/${id}/validation`).then((r) => r.data),
  setStatus: (id, status, v) => client.post(`/races/${id}/status/${status}`, null, { params: verQuery(v) }).then((r) => r.data),
  abandonRace: (id, abandoned, v) => client.post(`/races/${id}/abandon`, { abandoned }, { params: verQuery(v) }).then((r) => r.data),
  deleteRace: (id, v) => client.delete(`/races/${id}`, { params: verQuery(v) }).then((r) => r.data),

  getNotifications: (params = {}) => client.get("/notifications", { params }).then((r) => r.data),
  seriesStandings: (id, club_id, mini) => client.get(`/standings/series/${id}`, { params: { ...(club_id ? { club_id } : {}), ...(mini ? { mini } : {}) } }).then((r) => r.data),
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
