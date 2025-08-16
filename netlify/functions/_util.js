// Produces UTC timestamps in the exact format Ringy expects: YYYY-MM-DD HH:mm:ss
function pad(n){ return String(n).padStart(2,'0'); }
function toUtcStamp(d){
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} `+
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
// Inclusive range for the last N days ending today (UTC)
function rangeForDays(days = 7){
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23,59,59));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - Number(days || 7) + 1);
  start.setUTCHours(0,0,0,0);
  return { startDate: toUtcStamp(start), endDate: toUtcStamp(end) };
}
module.exports = { toUtcStamp, rangeForDays };
