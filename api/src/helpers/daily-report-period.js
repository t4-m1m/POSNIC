'use strict';

const moment = require('moment-timezone');

/** Half-open daily windows: a noon sale belongs to lunch, never both meals. */
function dailyReportPeriod(query, timezone, dayparts = []) {
  const zone = moment.tz.zone(timezone) ? timezone : 'UTC';
  const parseDay = (value) => {
    const text = String(value || '').trim();
    // Date-range controls may send a date with a clock suffix (for example
    // "2026/11/15 12:00 AM"). Strip the time before strict parsing so locale
    // display text can never turn a valid historical day into Invalid Date.
    const prefix = text.match(/^(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/);
    const day = prefix ? prefix[1] : text;
    const formats = ['YYYY-MM-DD', 'YYYY/M/D', 'YYYY/MM/DD', 'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'D-M-YYYY', 'MM/DD/YYYY', 'M/D/YYYY'];
    const parsed = moment.tz(day, formats, true, zone);
    return parsed.isValid() ? parsed.startOf('day') : moment.invalid();
  };
  const first = parseDay(query.starting_date),
    last = parseDay(query.ending_date);
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  if (!first.isValid() || !last.isValid() || last.isBefore(first))
    fail('Select a valid date range.');
  const from = query.start_time,
    to = query.end_time;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((from || to) && (!time.test(from || '') || !time.test(to || '') || from === to)) {
    fail('Choose different valid start and end times.');
  }
  const selected = query.serving_period
    ? dayparts.find((p) => p.id === query.serving_period)
    : null;
  if (query.serving_period && (!selected || !selected.hours))
    fail('This serving period has no configured times. Check Restaurant settings.');
  if (selected && (from || to)) fail('Choose a serving period or custom times, not both.');
  const windows = [];
  if (selected) {
    if (last.diff(first, 'days') > 366) fail('Choose up to 367 days when filtering by session.');
    const clock = (n) =>
      String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
    for (const day = first.clone(); !day.isAfter(last); day.add(1, 'day')) {
      const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day.day()];
      for (const w of selected.hours[key] || []) {
        const endDay = day.clone().add(w.close < w.open ? 1 : 0, 'day');
        windows.push({
          start: moment
            .tz(day.format('YYYY-MM-DD') + ' ' + clock(w.open), 'YYYY-MM-DD HH:mm', zone)
            .toDate(),
          end: moment
            .tz(endDay.format('YYYY-MM-DD') + ' ' + clock(w.close), 'YYYY-MM-DD HH:mm', zone)
            .toDate(),
        });
      }
    }
  } else if (!from && !to)
    windows.push({ start: first.toDate(), end: last.clone().add(1, 'day').toDate() });
  else {
    if (last.diff(first, 'days') > 366) fail('Choose up to 367 days when filtering by time.');
    for (const day = first.clone(); !day.isAfter(last); day.add(1, 'day')) {
      const start = moment.tz(day.format('YYYY-MM-DD') + ' ' + from, 'YYYY-MM-DD HH:mm', zone);
      const endDay = day.clone().add(to < from ? 1 : 0, 'day');
      const end = moment.tz(endDay.format('YYYY-MM-DD') + ' ' + to, 'YYYY-MM-DD HH:mm', zone);
      windows.push({ start: start.toDate(), end: end.toDate() });
    }
  }
  const clock = (n) =>
    String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const schedules = selected
    ? [
        ...new Set(
          Object.values(selected.hours).map((day) =>
            day
              .map(
                (w) =>
                  clock(w.open) + ' to ' + clock(w.close) + (w.close < w.open ? ' (next day)' : '')
              )
              .join(', ')
          )
        ),
      ]
    : [];
  const scheduleLabel = schedules.length === 1 ? schedules[0] : 'times vary by day';
  return {
    start: windows.length ? windows[0].start : first.toDate(),
    end: windows.length ? windows[windows.length - 1].end : last.clone().add(1, 'day').toDate(),
    label: selected
      ? `${selected.name} · ${scheduleLabel} · ${zone}`
      : from
        ? `Custom time · ${from} to ${to}${to < from ? ' (next day)' : ''} · ${zone}`
        : `Full day · ${zone}`,
    // Keep the user's session permission as an intersection, never widen it to midnight.
    match(field, sessionStart) {
      return {
        $or: (windows.length ? windows : [{ start: first.toDate(), end: first.toDate() }]).map(
          (w) => ({
            [field]: {
              $gte: sessionStart && sessionStart > w.start ? sessionStart : w.start,
              $lt: w.end,
            },
          })
        ),
      };
    },
  };
}

module.exports = { dailyReportPeriod };
