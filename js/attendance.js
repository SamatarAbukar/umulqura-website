/**
 * Teacher attendance register.
 *
 * Talks to a Google Apps Script web app that writes into a private Google
 * Sheet. See docs/attendance-setup.md for how to create and deploy it, then
 * paste the deployment URL below.
 *
 * API_URL is not a secret — it is visible in the page source, and that is
 * fine. The shared password is what protects the data, and it is only ever
 * held in memory and sessionStorage, never written into this repository.
 */
var API_URL = 'https://script.google.com/macros/s/AKfycbxAsYFxrL2prk_8qSHTE88MxTxbozRd6FXqHyJZWkODYYb5xVVh2Ngknppzx2Eq7R481A/exec';

document.addEventListener('DOMContentLoaded', function () {
  var PASSWORD_KEY = 'uq-attendance-password';

  var loginView = document.getElementById('login-view');
  var sheetView = document.getElementById('sheet-view');
  var loginForm = document.getElementById('login-form');
  var loginSubmit = document.getElementById('login-submit');
  var loginError = document.getElementById('login-error');
  var passwordInput = document.getElementById('password');

  var teacherSelect = document.getElementById('teacher');
  var dateDisplay = document.getElementById('date-display');
  var sessionField = document.getElementById('session-field');
  var sessionSelect = document.getElementById('session');
  var classTypeInputs = document.querySelectorAll('input[name="class_type"]');

  var addBtn = document.getElementById('add-student');
  var addForm = document.getElementById('add-student-form');
  var addSave = document.getElementById('add-student-save');
  var addCancel = document.getElementById('add-student-cancel');
  var newFirst = document.getElementById('new-first');
  var newLast = document.getElementById('new-last');
  var newDob = document.getElementById('new-dob');

  var table = document.getElementById('roster-table');
  var tbody = document.getElementById('roster-body');
  var emptyMsg = document.getElementById('roster-empty');
  var saveBtn = document.getElementById('save');
  var saveStatus = document.getElementById('save-status');
  var logoutBtn = document.getElementById('logout');

  var viewHistoryBtn = document.getElementById('view-history');
  var rosterPanel = document.getElementById('roster-panel');
  var historyPanel = document.getElementById('history-panel');
  var historyCloseBtn = document.getElementById('history-close');
  var historyRangeInputs = document.querySelectorAll('input[name="history_range"]');
  var historyStartField = document.getElementById('history-start-field');
  var historyEndField = document.getElementById('history-end-field');
  var historyStartInput = document.getElementById('history-start');
  var historyEndInput = document.getElementById('history-end');
  var historyStudentSelect = document.getElementById('history-student');
  var historyPrintBtn = document.getElementById('history-print');
  var historySummary = document.getElementById('history-summary');
  var printMeta = document.getElementById('print-meta');
  var historyTable = document.getElementById('history-table');
  var historyBody = document.getElementById('history-body');
  var historyEmpty = document.getElementById('history-empty');
  var historyStatus = document.getElementById('history-status');

  var CLASS_TYPE_LABELS = { weekend: 'Weekend Class', evening_hifz: 'Evening Hifz', fulltime_hifz: 'Full-Time Hifz' };
  var SESSION_LABELS = { morning: 'Morning Class', afternoon: 'Afternoon Class' };

  var password = '';
  var students = [];     // roster currently on screen
  var dirty = false;     // unsaved edits, guards against navigating away
  var historyRows = null; // null = no query run yet; [] = query ran, no rows found

  /* ---------- transport ---------- */

  /**
   * Apps Script cannot answer a CORS preflight, so this has to stay a
   * "simple" request: text/plain, no custom headers. The body is still JSON,
   * and the script parses it out of postData.contents.
   */
  function api(action, payload) {
    var body = { action: action, password: password };
    for (var key in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) body[key] = payload[key];
    }

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('The attendance service returned an unexpected response.');
      }
      if (!data.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    });
  }

  /* ---------- current selection ---------- */

  function classType() {
    for (var i = 0; i < classTypeInputs.length; i++) {
      if (classTypeInputs[i].checked) return classTypeInputs[i].value;
    }
    return 'weekend';
  }

  // Only the weekend class runs a morning and an afternoon sitting.
  function session() {
    return classType() === 'weekend' ? sessionSelect.value : '';
  }

  function syncSessionVisibility() {
    sessionField.hidden = classType() !== 'weekend';
  }

  function isoDate(date) {
    var month = String(date.getMonth() + 1);
    var day = String(date.getDate());
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function todayIso() {
    return isoDate(new Date());
  }

  function todayReadable() {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  /* ---------- status messages ---------- */

  function status(el, message, kind) {
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('att-status--error', kind === 'error');
    el.classList.toggle('att-status--ok', kind === 'ok');
  }

  function clearSaveStatus() {
    status(saveStatus, '', null);
  }

  function markDirty() {
    dirty = true;
    clearSaveStatus();
  }

  /* ---------- roster rendering ---------- */

  function fullName(student) {
    return (student.first_name + ' ' + student.last_name).trim();
  }

  /** A two-option Present/Absent control for one student. */
  function attendanceCell(student, index) {
    var cell = document.createElement('td');
    cell.setAttribute('data-label', 'Attendance');

    var group = document.createElement('div');
    group.className = 'att-segmented';

    [['present', 'Present'], ['absent', 'Absent']].forEach(function (option) {
      var label = document.createElement('label');
      label.className = 'att-segmented__option att-segmented__option--' + option[0];

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'attendance-' + index;
      input.value = option[0];
      input.checked = option[0] === 'present' ? student.present : !student.present;
      input.addEventListener('change', function () {
        student.present = input.value === 'present';
        syncRowState(cell.parentNode, student);
        markDirty();
      });

      var text = document.createElement('span');
      text.textContent = option[1];

      label.appendChild(input);
      label.appendChild(text);
      group.appendChild(label);
    });

    cell.appendChild(group);
    return cell;
  }

  /** A "Passed" tick for either the lesson or the review. */
  function passCell(student, field, heading) {
    var cell = document.createElement('td');
    cell.setAttribute('data-label', heading);

    var label = document.createElement('label');
    label.className = 'att-pass';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!student[field];
    input.setAttribute('aria-label', heading + ' passed — ' + fullName(student));
    input.addEventListener('change', function () {
      student[field] = input.checked;
      markDirty();
    });

    var text = document.createElement('span');
    text.textContent = 'Passed';

    label.appendChild(input);
    label.appendChild(text);
    cell.appendChild(label);
    return cell;
  }

  /** An absent student has no lesson or review to pass. */
  function syncRowState(row, student) {
    if (!row) return;
    row.classList.toggle('is-absent', !student.present);
    row.querySelectorAll('.att-pass input').forEach(function (box) {
      box.disabled = !student.present;
    });
  }

  function buildRow(student, index) {
    var row = document.createElement('tr');

    var nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.setAttribute('data-label', 'Student');
    nameCell.textContent = fullName(student);
    row.appendChild(nameCell);

    var dobCell = document.createElement('td');
    dobCell.setAttribute('data-label', 'Date of birth');
    dobCell.textContent = student.dob || '—';
    row.appendChild(dobCell);

    row.appendChild(attendanceCell(student, index));
    row.appendChild(passCell(student, 'lesson_passed', 'Lesson'));
    row.appendChild(passCell(student, 'review_passed', 'Review'));

    var removeCell = document.createElement('td');
    removeCell.setAttribute('data-label', '');
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'att-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + fullName(student) + ' from this class');
    remove.addEventListener('click', function () {
      removeStudent(student, remove);
    });
    removeCell.appendChild(remove);
    row.appendChild(removeCell);

    syncRowState(row, student);
    return row;
  }

  function renderRoster() {
    tbody.innerHTML = '';
    students.forEach(function (student, index) {
      tbody.appendChild(buildRow(student, index));
    });
    table.hidden = students.length === 0;
    emptyMsg.hidden = students.length > 0;
    saveBtn.disabled = students.length === 0;
  }

  /* ---------- data loading ---------- */

  function loadRoster() {
    if (dirty && !confirm('You have unsaved attendance. Switching class will discard it. Continue?')) {
      return;
    }

    dirty = false;
    students = [];
    renderRoster();
    hideAddForm();

    if (!teacherSelect.value) {
      status(saveStatus, 'Select your name to see your class list.', null);
      return;
    }

    status(saveStatus, 'Loading class list…', null);

    var wanted = teacherSelect.value + '|' + classType() + '|' + session();

    api('roster', { teacher_id: teacherSelect.value, class_type: classType(), session: session() }).then(function (data) {
      // The teacher may have switched name or class again while this was in flight.
      if (teacherSelect.value + '|' + classType() + '|' + session() !== wanted) return;

      students = data.students.map(function (s) {
        return {
          student_id: s.student_id,
          first_name: s.first_name,
          last_name: s.last_name,
          dob: s.dob,
          present: true,          // start everyone present; absences are the exception
          lesson_passed: false,
          review_passed: false
        };
      });
      renderRoster();
      // The student filter is scoped to this roster; a switch of teacher,
      // class or session can invalidate the previous selection, so refresh
      // the options and, if the history panel is open, re-run its query too.
      populateHistoryStudents();
      if (!historyPanel.hidden) loadHistory();
      clearSaveStatus();
    }).catch(function (err) {
      status(saveStatus, err.message, 'error');
    });
  }

  /* ---------- history (read-only view of a date range) ---------- */

  function populateHistoryStudents() {
    var previous = historyStudentSelect.value;
    historyStudentSelect.innerHTML = '<option value="">All Students</option>';
    students.forEach(function (s) {
      var option = document.createElement('option');
      option.value = s.student_id;
      option.textContent = fullName(s);
      historyStudentSelect.appendChild(option);
    });
    if (previous && students.some(function (s) { return s.student_id === previous; })) {
      historyStudentSelect.value = previous;
    }
  }

  function historyRange() {
    for (var i = 0; i < historyRangeInputs.length; i++) {
      if (historyRangeInputs[i].checked) return historyRangeInputs[i].value;
    }
    return 'last_week';
  }

  function computeRange(preset) {
    if (preset === 'custom') {
      return { start: historyStartInput.value, end: historyEndInput.value };
    }
    var days = preset === 'last_month' ? 30 : 7;
    var end = new Date();
    var start = new Date();
    start.setDate(start.getDate() - (days - 1));
    return { start: isoDate(start), end: isoDate(end) };
  }

  function syncRangeVisibility() {
    var custom = historyRange() === 'custom';
    historyStartField.hidden = !custom;
    historyEndField.hidden = !custom;
  }

  function updatePrintHeader(range) {
    var teacherOpt = teacherSelect.options[teacherSelect.selectedIndex];
    var teacherName = teacherOpt ? teacherOpt.text : '';
    var classLabel = CLASS_TYPE_LABELS[classType()] || classType();
    var sessionLabel = session() ? (' — ' + (SESSION_LABELS[session()] || session())) : '';
    var studentOpt = historyStudentSelect.options[historyStudentSelect.selectedIndex];
    var studentLabel = historyStudentSelect.value ? (' — ' + studentOpt.text) : '';
    var parts = [
      teacherName,
      classLabel + sessionLabel + studentLabel,
      range.start + ' to ' + range.end,
      'Generated ' + todayReadable()
    ];
    printMeta.textContent = parts.filter(Boolean).join(' · ');
  }

  function buildHistoryRow(row) {
    var tr = document.createElement('tr');
    if (!row.present) tr.classList.add('is-absent');

    var dateCell = document.createElement('td');
    dateCell.setAttribute('data-label', 'Date');
    dateCell.textContent = row.date;
    tr.appendChild(dateCell);

    var nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.setAttribute('data-label', 'Student');
    nameCell.textContent = (row.first_name + ' ' + row.last_name).trim();
    tr.appendChild(nameCell);

    var attCell = document.createElement('td');
    attCell.setAttribute('data-label', 'Attendance');
    attCell.textContent = row.present ? 'Present' : 'Absent';
    tr.appendChild(attCell);

    var lessonCell = document.createElement('td');
    lessonCell.setAttribute('data-label', 'Lesson');
    lessonCell.textContent = row.present ? (row.lesson_passed ? 'Passed' : 'Not passed') : '—';
    tr.appendChild(lessonCell);

    var reviewCell = document.createElement('td');
    reviewCell.setAttribute('data-label', 'Review');
    reviewCell.textContent = row.present ? (row.review_passed ? 'Passed' : 'Not passed') : '—';
    tr.appendChild(reviewCell);

    return tr;
  }

  function renderHistorySummary(rows) {
    if (!historyStudentSelect.value || !rows.length) {
      status(historySummary, '', null);
      return;
    }
    var presentCount = rows.filter(function (r) { return r.present; }).length;
    status(historySummary, 'Present ' + presentCount + ' of ' + rows.length + ' recorded days.', null);
  }

  function renderHistory() {
    historyBody.innerHTML = '';
    var rows = historyRows || [];
    rows.forEach(function (row) { historyBody.appendChild(buildHistoryRow(row)); });
    historyTable.hidden = rows.length === 0;
    // Only claim "no attendance" once a query has actually completed.
    historyEmpty.hidden = historyRows === null || rows.length > 0;
    renderHistorySummary(rows);
  }

  function loadHistory() {
    historyRows = null;
    renderHistory();

    if (!teacherSelect.value) {
      status(historyStatus, 'Select your name to see past attendance.', null);
      return;
    }

    var range = computeRange(historyRange());
    if (!range.start || !range.end) {
      status(historyStatus, 'Choose a start and end date.', null);
      return;
    }
    if (range.start > range.end) {
      status(historyStatus, 'Start date must be on or before end date.', 'error');
      return;
    }

    status(historyStatus, 'Loading…', null);

    var wanted = teacherSelect.value + '|' + classType() + '|' + session() + '|' +
      range.start + '|' + range.end + '|' + historyStudentSelect.value;

    api('attendanceForRange', {
      teacher: teacherSelect.options[teacherSelect.selectedIndex].text,
      class_type: classType(),
      session: session(),
      start_date: range.start,
      end_date: range.end,
      student_id: historyStudentSelect.value
    }).then(function (data) {
      // Teacher/class/session/range/student may have changed again while this was in flight.
      var current = teacherSelect.value + '|' + classType() + '|' + session() + '|' +
        range.start + '|' + range.end + '|' + historyStudentSelect.value;
      if (current !== wanted) return;

      historyRows = data.rows;
      renderHistory();
      updatePrintHeader(range);
      status(historyStatus, '', null);
    }).catch(function (err) {
      status(historyStatus, err.message, 'error');
    });
  }

  function openHistory() {
    rosterPanel.hidden = true;
    historyPanel.hidden = false;
    populateHistoryStudents();
    if (!historyStartInput.value || !historyEndInput.value) {
      var initial = computeRange('last_week');
      historyStartInput.value = initial.start;
      historyEndInput.value = initial.end;
    }
    syncRangeVisibility();
    loadHistory();
  }

  function closeHistory() {
    historyPanel.hidden = true;
    rosterPanel.hidden = false;
  }

  /* ---------- actions ---------- */

  function showAddForm() {
    addForm.hidden = false;
    addBtn.hidden = true;
    newFirst.focus();
  }

  function hideAddForm() {
    addForm.hidden = true;
    addBtn.hidden = false;
    newFirst.value = '';
    newLast.value = '';
    newDob.value = '';
  }

  function addStudent(event) {
    event.preventDefault();

    if (!teacherSelect.value) {
      status(saveStatus, 'Please choose your name first.', 'error');
      teacherSelect.focus();
      return;
    }

    if (!newFirst.value.trim() && !newLast.value.trim()) {
      status(saveStatus, 'Please enter the student’s name.', 'error');
      newFirst.focus();
      return;
    }

    addSave.disabled = true;
    status(saveStatus, 'Adding student…', null);

    api('addStudent', {
      first_name: newFirst.value.trim(),
      last_name: newLast.value.trim(),
      dob: newDob.value,
      class_type: classType(),
      session: session(),
      teacher_id: teacherSelect.value
    }).then(function (data) {
      students.push({
        student_id: data.student.student_id,
        first_name: data.student.first_name,
        last_name: data.student.last_name,
        dob: data.student.dob,
        present: true,
        lesson_passed: false,
        review_passed: false
      });
      renderRoster();
      hideAddForm();
      status(saveStatus, data.student.first_name + ' was added to this class.', 'ok');
    }).catch(function (err) {
      status(saveStatus, err.message, 'error');
    }).finally(function () {
      addSave.disabled = false;
    });
  }

  /**
   * Removing a student only takes them off the class list from now on. Their
   * past attendance rows stay in the sheet untouched.
   */
  function removeStudent(student, button) {
    var name = fullName(student);
    if (!confirm('Remove ' + name + ' from this class list?\n\nTheir past attendance records are kept.')) {
      return;
    }

    button.disabled = true;
    status(saveStatus, 'Removing ' + name + '…', null);

    api('deactivateStudent', { student_id: student.student_id }).then(function () {
      students = students.filter(function (s) { return s.student_id !== student.student_id; });
      renderRoster();
      status(saveStatus, name + ' was removed from this class list.', 'ok');
    }).catch(function (err) {
      button.disabled = false;
      status(saveStatus, err.message, 'error');
    });
  }

  function saveAttendance() {
    if (!teacherSelect.value) {
      status(saveStatus, 'Please choose your name first.', 'error');
      teacherSelect.focus();
      return;
    }
    if (!students.length) {
      status(saveStatus, 'There are no students to save.', 'error');
      return;
    }

    saveBtn.disabled = true;
    status(saveStatus, 'Saving…', null);

    var today = todayIso();

    api('saveAttendance', {
      date: today,
      class_type: classType(),
      session: session(),
      teacher: teacherSelect.options[teacherSelect.selectedIndex].text,
      rows: students.map(function (s) {
        return {
          student_id: s.student_id,
          first_name: s.first_name,
          last_name: s.last_name,
          present: s.present,
          lesson_passed: s.lesson_passed,
          review_passed: s.review_passed
        };
      })
    }).then(function (data) {
      dirty = false;
      var count = data.appended + data.updated;
      status(saveStatus, 'Saved ' + count + ' student' + (count === 1 ? '' : 's') + ' for ' +
        today + '.', 'ok');
    }).catch(function (err) {
      status(saveStatus, err.message, 'error');
    }).finally(function () {
      // Left enabled on purpose: nothing is cleared, so a teacher can correct
      // a mistake and save again over the same rows.
      saveBtn.disabled = false;
    });
  }

  /* ---------- sign in / out ---------- */

  function showLogin(message) {
    loginView.hidden = false;
    sheetView.hidden = true;
    status(loginError, message || '', 'error');
    passwordInput.focus();
  }

  function signIn(candidate) {
    password = candidate;
    loginSubmit.disabled = true;
    status(loginError, '', null);

    return api('bootstrap').then(function (data) {
      try {
        sessionStorage.setItem(PASSWORD_KEY, candidate);
      } catch (err) {
        // Private browsing can refuse storage; signing in still works.
      }

      teacherSelect.innerHTML = '<option value="">Select your name…</option>';
      data.teachers.forEach(function (teacher) {
        var option = document.createElement('option');
        option.value = teacher.id;
        option.textContent = teacher.name;
        teacherSelect.appendChild(option);
      });

      loginView.hidden = true;
      sheetView.hidden = false;
      passwordInput.value = '';
      loadRoster();
    }).catch(function (err) {
      password = '';
      try { sessionStorage.removeItem(PASSWORD_KEY); } catch (e) { /* ignore */ }
      showLogin(err.message);
    }).finally(function () {
      loginSubmit.disabled = false;
    });
  }

  function signOut() {
    if (dirty && !confirm('You have unsaved attendance. Log out anyway?')) return;

    password = '';
    dirty = false;
    students = [];
    try { sessionStorage.removeItem(PASSWORD_KEY); } catch (e) { /* ignore */ }
    renderRoster();
    clearSaveStatus();
    historyRows = null;
    closeHistory();
    status(historyStatus, '', null);
    showLogin('');
  }

  /* ---------- wiring ---------- */

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!passwordInput.value) return;
    signIn(passwordInput.value);
  });

  logoutBtn.addEventListener('click', signOut);
  addBtn.addEventListener('click', showAddForm);
  addCancel.addEventListener('click', hideAddForm);
  addForm.addEventListener('submit', addStudent);
  saveBtn.addEventListener('click', saveAttendance);

  viewHistoryBtn.addEventListener('click', openHistory);
  historyCloseBtn.addEventListener('click', closeHistory);
  historyRangeInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      syncRangeVisibility();
      loadHistory();
    });
  });
  historyStartInput.addEventListener('change', loadHistory);
  historyEndInput.addEventListener('change', loadHistory);
  historyStudentSelect.addEventListener('change', loadHistory);
  historyPrintBtn.addEventListener('click', function () { window.print(); });

  classTypeInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      syncSessionVisibility();
      loadRoster();
      if (!historyPanel.hidden) loadHistory();
    });
  });
  sessionSelect.addEventListener('change', function () {
    loadRoster();
    if (!historyPanel.hidden) loadHistory();
  });

  // The roster is scoped to a teacher's own students, so switching teacher
  // reloads it just like switching class or session does.
  teacherSelect.addEventListener('change', function () {
    loadRoster();
    if (!historyPanel.hidden) loadHistory();
  });

  window.addEventListener('beforeunload', function (event) {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  /* ---------- start ---------- */

  dateDisplay.textContent = todayReadable();
  syncSessionVisibility();
  renderRoster();

  if (!API_URL) {
    showLogin('This page is not connected to the attendance service yet. ' +
      'Set API_URL in js/attendance.js — see docs/attendance-setup.md.');
    loginSubmit.disabled = true;
    return;
  }

  var saved = null;
  try { saved = sessionStorage.getItem(PASSWORD_KEY); } catch (e) { /* ignore */ }

  // Reveal the login view either way, so the page is never blank while the
  // stored password is being re-checked; signIn swaps it out on success.
  showLogin('');
  if (saved) signIn(saved);
});
