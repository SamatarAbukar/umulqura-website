# Teacher Attendance — setup guide

The attendance page (`attendance.html`) is a static page on GitHub Pages. All data lives in a
Google Sheet you own, written to by a Google Apps Script web app. Nothing in this repository
contains student data or the password.

You only need to do this once. Budget about 15 minutes.

---

## 1. Create the spreadsheet

Create a new Google Sheet named **Umul Qura Attendance**. Leave it empty — step 2 builds the tabs
for you by running `setupSheets()`.

For reference, this is the structure that function creates. You do not need to type any of it by
hand, but the names and column order matter, so check them if you ever edit the sheet manually.

### Tab: `Teachers`

| teacher_id | name | active |
| --- | --- | --- |
| T-001 | Sheikh Nuh Aweis | TRUE |
| T-002 | Sheikh Zakariya Sheikh Hussein | TRUE |
| T-003 | Moalimah Z. Ahmed | TRUE |

This is the dropdown teachers pick their name from. `setupSheets()` seeds these three names —
edit them to match your actual staff. Set `active` to `FALSE` to remove someone from the dropdown
without losing their history.

### Tab: `Students`

| student_id | first_name | last_name | dob | class_type | session | active | created_at |
| --- | --- | --- | --- | --- | --- | --- | --- |

Header only — teachers fill this in from the page using **Add Student**.

- `class_type` is one of `weekend`, `evening_hifz`, `fulltime_hifz`
- `session` is `morning` or `afternoon` for the weekend class, and **blank** for the two Hifz classes
- `active` is the soft-delete flag. **Delete Student** on the page sets it to `FALSE`; it never
  removes the row, and it never touches past attendance.

### Tab: `Attendance`

| date | class_type | session | teacher | student_id | first_name | last_name | present | lesson_passed | review_passed | saved_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Header only. One row is written per student per class day. Names are copied into each row so old
records still read correctly if a student is later renamed. `lesson_passed` and `review_passed`
are left blank for absent students.

`setupSheets()` formats the date columns as plain text. That stops Sheets rewriting `2026-08-09`
into a locale date — which would break the "same day" matching that lets a teacher re-save and
correct a mistake.

---

## 2. Add the script and build the tabs

1. In the spreadsheet, choose **Extensions → Apps Script**.
2. Delete the placeholder `myFunction` and paste in the entire contents of
   [`docs/apps-script/Code.gs`](apps-script/Code.gs).
3. Rename the project to *Umul Qura Attendance* and save (⌘S).
4. In the function dropdown at the top, pick **`setupSheets`** and click **Run**.
5. Google will ask for authorisation the first time. Choose your account, then
   **Advanced → Go to Umul Qura Attendance (unsafe)** — "unsafe" only means the script is your own
   and unreviewed by Google — then **Allow**.
6. Go back to the spreadsheet. The `Teachers`, `Students` and `Attendance` tabs now exist with
   their headers, and the teacher list is seeded.

Edit the `Teachers` tab now so the names match your staff.

`setupSheets()` is safe to run again at any time — it only fills in what is missing and never
deletes data.

## 3. Set the shared password

Still in the Apps Script editor:

1. **Project Settings** (the gear icon) → scroll to **Script Properties** → **Add script property**.
2. Property: `ATTENDANCE_PASSWORD`. Value: the password you want teachers to share.
3. Save.

Keep the password out of email and out of this repository. Change it here whenever staff change —
no code edit and no redeploy is needed.

## 4. Deploy as a web app

1. **Deploy → New deployment → ⚙ (Select type) → Web app**.
2. Description: *Attendance API*.
3. **Execute as:** *Me (your account)*.
4. **Who has access:** *Anyone*.
5. **Deploy**.
6. Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfy…/exec`.

"Anyone" means anyone who knows that URL can reach the script — it does **not** make your
spreadsheet public. The script still rejects every request that does not carry the correct
password.

## 5. Point the website at it

**Already done** — `API_URL` at the top of [`js/attendance.js`](../js/attendance.js) holds the
deployed web-app URL. You only need to touch it again if you ever create a brand-new deployment
(editing an existing one keeps the same URL):

```js
var API_URL = 'https://script.google.com/macros/s/AKfy…/exec';
```

Commit and push. GitHub Pages will publish it within a minute or two.

This URL is not a secret — it is visible in the page source, which is fine. The password is what
protects the data.

---

## Redeploying after a script change

Apps Script keeps serving the old code until you publish a new version:
**Deploy → Manage deployments → ✏ (edit) → Version: New version → Deploy**. The web app URL stays
the same, so nothing on the website needs changing.

---

## Checking it works

From a terminal:

```sh
curl -sL 'https://script.google.com/macros/s/AKfy…/exec' \
  -H 'Content-Type: text/plain' \
  --data '{"action":"bootstrap","password":"YOUR_PASSWORD"}'
```

You should get back your teacher list:

```json
{"ok":true,"teachers":[{"id":"T-001","name":"Sheikh Nuh Aweis"}, …]}
```

A wrong password returns `{"ok":false,"error":"Incorrect password."}`.

Two curl details matter here. `-L` is required because Apps Script answers with a redirect to a
`googleusercontent.com` host that carries the actual response. And do **not** add `-X POST` — that
forces the method onto the redirect too, which Google rejects with `HTTP 405` and an "unable to
open the file" page that looks like a broken deployment but is not. Use plain `--data`, which lets
curl switch to GET on the redirect as intended.

Browsers are unaffected by this; `fetch()` in `attendance.js` handles the redirect correctly.

---

## How teachers use it

Send them the URL `https://umulquralc.com/attendance.html` and the shared password. The page is
deliberately not linked from the site navigation and is marked `noindex`, so it will not turn up in
search results.

1. Enter the shared password.
2. Choose your name, the class type, the session (weekend only) and the date.
3. Mark each student Present or Absent, and tick whether they passed their lesson and review.
4. **Add Student** to put a new student on the class roster permanently.
5. **Save Attendance**.

Saving the same class and date twice updates those rows rather than duplicating them, so it is
always safe to correct a mistake and save again.

## What this does and does not protect

All teachers share one password, so the sheet cannot tell you *which* teacher signed in — only
which name they picked from the dropdown. That is fine for a class register. Do not put anything
confidential in this system, and change the password when someone leaves.
