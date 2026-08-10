/**
 * Umul Qura Learning Centre — Teacher Attendance backend.
 *
 * This is the reference copy of the Google Apps Script that backs
 * attendance.html. Paste it into the Apps Script editor attached to the
 * attendance spreadsheet and deploy it as a Web App.
 *
 * See docs/attendance-setup.md for the full setup walkthrough.
 *
 * No secrets belong in this file. The shared password lives in Script
 * Properties under the key ATTENDANCE_PASSWORD.
 */

var TEACHERS_SHEET = 'Teachers';
var STUDENTS_SHEET = 'Students';
var ATTENDANCE_SHEET = 'Attendance';

var CLASS_TYPES = ['weekend', 'evening_hifz', 'fulltime_hifz'];
var SESSIONS = ['morning', 'afternoon'];

// Attendance columns, in sheet order.
var ATT_DATE = 0, ATT_CLASS = 1, ATT_SESSION = 2, ATT_TEACHER = 3,
    ATT_STUDENT = 4, ATT_FIRST = 5, ATT_LAST = 6, ATT_PRESENT = 7,
    ATT_LESSON = 8, ATT_REVIEW = 9, ATT_SAVED = 10;
var ATT_WIDTH = 11;

// Students columns, in sheet order.
var STU_ID = 0, STU_FIRST = 1, STU_LAST = 2, STU_DOB = 3,
    STU_CLASS = 4, STU_SESSION = 5, STU_ACTIVE = 6, STU_CREATED = 7;
var STU_WIDTH = 8;

/* ---------- one-time setup ---------- */

var TEACHERS_HEADER = ['teacher_id', 'name', 'active'];
var STUDENTS_HEADER = ['student_id', 'first_name', 'last_name', 'dob',
                       'class_type', 'session', 'active', 'created_at'];
var ATTENDANCE_HEADER = ['date', 'class_type', 'session', 'teacher', 'student_id',
                         'first_name', 'last_name', 'present', 'lesson_passed',
                         'review_passed', 'saved_at'];

var SEED_TEACHERS = [
  ['T-001', 'Sheikh Nuh Aweis', true],
  ['T-002', 'Sheikh Zakariya Sheikh Hussein', true],
  ['T-003', 'Moalimah Z. Ahmed', true]
];

/**
 * Run this ONCE from the Apps Script editor after pasting this file in.
 *
 * It builds the three tabs with the right headers, seeds the teacher list and
 * formats the attendance date column as plain text (otherwise Sheets rewrites
 * "2026-08-09" into a locale date and the upsert stops matching).
 *
 * Safe to run again later — it never deletes data, only fills in what's
 * missing. It will not overwrite a header row that is already correct.
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var notes = [];

  var teachers = ensureSheet(ss, TEACHERS_SHEET, TEACHERS_HEADER, notes);
  var students = ensureSheet(ss, STUDENTS_SHEET, STUDENTS_HEADER, notes);
  var attendance = ensureSheet(ss, ATTENDANCE_SHEET, ATTENDANCE_HEADER, notes);

  // Keep dates as text so they always compare as "yyyy-MM-dd".
  attendance.getRange('A:A').setNumberFormat('@');
  students.getRange('D:D').setNumberFormat('@');

  if (teachers.getLastRow() < 2) {
    teachers.getRange(2, 1, SEED_TEACHERS.length, TEACHERS_HEADER.length).setValues(SEED_TEACHERS);
    notes.push('Seeded ' + SEED_TEACHERS.length + ' teachers — edit the names to match your staff.');
  }

  // Drop Google's default empty "Sheet1" if it is still there and unused.
  var leftover = ss.getSheetByName('Sheet1');
  if (leftover && ss.getSheets().length > 3 && leftover.getLastRow() === 0) {
    ss.deleteSheet(leftover);
    notes.push('Removed the empty default "Sheet1".');
  }

  var password = PropertiesService.getScriptProperties().getProperty('ATTENDANCE_PASSWORD');
  notes.push(password
    ? 'ATTENDANCE_PASSWORD is set.'
    : 'ATTENDANCE_PASSWORD is NOT set yet — add it under Project Settings → Script Properties.');

  Logger.log(notes.join('\n'));
  return notes.join('\n');
}

function ensureSheet(ss, name, header, notes) {
  var sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
    notes.push('Created tab "' + name + '".');
  }

  var current = sh.getLastColumn()
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join('|')
    : '';

  if (current !== header.join('|')) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    notes.push('Wrote the header row on "' + name + '".');
  }

  return sh;
}

/* ---------- request handling ---------- */

/**
 * Apps Script cannot answer a CORS preflight, so the browser must send this
 * as a "simple" request: Content-Type text/plain with a JSON string body.
 * That means the payload arrives as postData.contents, not e.parameter.
 */
function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (!checkPassword(req.password)) {
      return json({ ok: false, error: 'Incorrect password.' });
    }

    switch (req.action) {
      case 'bootstrap':          return json(bootstrap());
      case 'roster':             return json(roster(req));
      case 'addStudent':         return json(addStudent(req));
      case 'deactivateStudent':  return json(deactivateStudent(req));
      case 'saveAttendance':     return json(saveAttendance(req));
      default:
        return json({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** A GET is only ever a human poking the URL — never the app. */
function doGet() {
  return json({ ok: true, service: 'Umul Qura attendance', note: 'POST only.' });
}

/* ---------- actions ---------- */

function bootstrap() {
  var rows = dataRows(sheet(TEACHERS_SHEET));
  var teachers = [];

  for (var i = 0; i < rows.length; i++) {
    if (!isTrue(rows[i][2])) continue;             // active
    var name = trim(rows[i][1]);
    if (name) teachers.push({ id: trim(rows[i][0]), name: name });
  }

  teachers.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { ok: true, teachers: teachers };
}

function roster(req) {
  var classType = requireClassType(req.class_type);
  var session = normaliseSession(classType, req.session);
  var rows = dataRows(sheet(STUDENTS_SHEET));
  var students = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!isTrue(r[STU_ACTIVE])) continue;
    if (trim(r[STU_CLASS]) !== classType) continue;
    if (trim(r[STU_SESSION]) !== session) continue;

    students.push({
      student_id: trim(r[STU_ID]),
      first_name: trim(r[STU_FIRST]),
      last_name: trim(r[STU_LAST]),
      dob: asDateString(r[STU_DOB])
    });
  }

  students.sort(function (a, b) {
    return (a.first_name + ' ' + a.last_name).localeCompare(b.first_name + ' ' + b.last_name);
  });
  return { ok: true, students: students };
}

function addStudent(req) {
  var first = trim(req.first_name);
  var last = trim(req.last_name);
  if (!first && !last) return { ok: false, error: 'A student needs at least a first or last name.' };

  var classType = requireClassType(req.class_type);
  var session = normaliseSession(classType, req.session);

  return withLock(function () {
    var sh = sheet(STUDENTS_SHEET);
    var id = nextStudentId(sh);
    var row = new Array(STU_WIDTH);

    row[STU_ID] = id;
    row[STU_FIRST] = first;
    row[STU_LAST] = last;
    row[STU_DOB] = trim(req.dob);
    row[STU_CLASS] = classType;
    row[STU_SESSION] = session;
    row[STU_ACTIVE] = true;
    row[STU_CREATED] = nowIso();

    sh.appendRow(row);
    return {
      ok: true,
      student: { student_id: id, first_name: first, last_name: last, dob: trim(req.dob) }
    };
  });
}

/**
 * Soft delete. The student stops appearing on the sheet but every attendance
 * row they already have is left exactly as it was, so history stays readable.
 */
function deactivateStudent(req) {
  var id = trim(req.student_id);
  if (!id) return { ok: false, error: 'Missing student_id.' };

  return withLock(function () {
    var sh = sheet(STUDENTS_SHEET);
    var rows = dataRows(sh);

    for (var i = 0; i < rows.length; i++) {
      if (trim(rows[i][STU_ID]) !== id) continue;
      sh.getRange(i + 2, STU_ACTIVE + 1).setValue(false);   // +2: 1-indexed, past header
      return { ok: true };
    }
    return { ok: false, error: 'Student not found: ' + id };
  });
}

/**
 * Upsert by (date, class_type, session, student_id). Saving the same day
 * twice corrects the existing rows instead of duplicating them, so a teacher
 * can fix a mistake and hit Save again.
 */
function saveAttendance(req) {
  var classType = requireClassType(req.class_type);
  var session = normaliseSession(classType, req.session);
  var date = trim(req.date);
  var teacher = trim(req.teacher);
  var incoming = req.rows || [];

  if (!date) return { ok: false, error: 'Missing date.' };
  if (!teacher) return { ok: false, error: 'Please choose a teacher.' };
  if (!incoming.length) return { ok: false, error: 'There are no students to save.' };

  return withLock(function () {
    var sh = sheet(ATTENDANCE_SHEET);
    var existing = dataRows(sh);
    var savedAt = nowIso();

    // Where each already-saved student sits, so we overwrite in place.
    var rowByStudent = {};
    for (var i = 0; i < existing.length; i++) {
      var e = existing[i];
      if (asDateString(e[ATT_DATE]) !== date) continue;
      if (trim(e[ATT_CLASS]) !== classType) continue;
      if (trim(e[ATT_SESSION]) !== session) continue;
      rowByStudent[trim(e[ATT_STUDENT])] = i + 2;
    }

    var appended = 0, updated = 0;

    for (var j = 0; j < incoming.length; j++) {
      var s = incoming[j];
      var present = !!s.present;
      var row = new Array(ATT_WIDTH);

      row[ATT_DATE] = date;
      row[ATT_CLASS] = classType;
      row[ATT_SESSION] = session;
      row[ATT_TEACHER] = teacher;
      row[ATT_STUDENT] = trim(s.student_id);
      row[ATT_FIRST] = trim(s.first_name);
      row[ATT_LAST] = trim(s.last_name);
      row[ATT_PRESENT] = present;
      // An absent student has no lesson or review to pass; leave both blank.
      row[ATT_LESSON] = present ? !!s.lesson_passed : '';
      row[ATT_REVIEW] = present ? !!s.review_passed : '';
      row[ATT_SAVED] = savedAt;

      var at = rowByStudent[trim(s.student_id)];
      if (at) {
        sh.getRange(at, 1, 1, ATT_WIDTH).setValues([row]);
        updated++;
      } else {
        sh.appendRow(row);
        appended++;
      }
    }

    return { ok: true, appended: appended, updated: updated, saved_at: savedAt };
  });
}

/* ---------- helpers ---------- */

function checkPassword(supplied) {
  var expected = PropertiesService.getScriptProperties().getProperty('ATTENDANCE_PASSWORD');
  if (!expected) throw new Error('ATTENDANCE_PASSWORD is not set in Script Properties.');
  return trim(supplied) === expected;
}

function sheet(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet tab: ' + name);
  return sh;
}

/** Everything below the header row, or [] when the tab holds only a header. */
function dataRows(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, error: 'The sheet is busy. Please try again in a moment.' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nextStudentId(sh) {
  var rows = dataRows(sh);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var m = /^S-(\d+)$/.exec(trim(rows[i][STU_ID]));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }

  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return 'S-' + n;
}

function requireClassType(value) {
  var v = trim(value);
  if (CLASS_TYPES.indexOf(v) === -1) throw new Error('Unknown class type: ' + v);
  return v;
}

/** Only the weekend class is split into sessions; the Hifz classes store ''. */
function normaliseSession(classType, value) {
  if (classType !== 'weekend') return '';
  var v = trim(value);
  if (SESSIONS.indexOf(v) === -1) throw new Error('Weekend class needs a morning or afternoon session.');
  return v;
}

function trim(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function isTrue(v) {
  if (v === true) return true;
  var s = trim(v).toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

/**
 * Sheets may hand back a real Date where we wrote a "YYYY-MM-DD" string,
 * depending on how the cell was formatted. Normalise both to the string form
 * so date comparisons in saveAttendance stay reliable.
 */
function asDateString(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return trim(v);
}

function nowIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
