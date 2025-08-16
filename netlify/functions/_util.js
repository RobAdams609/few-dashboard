function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function rangeForDays(days = 7) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Number(days || 7));
  return { startDate: ymd(start), endDate: ymd(end) };
}
module.exports = { ymd, rangeForDays };
