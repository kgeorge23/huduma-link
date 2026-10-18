# HudumaLink — Public Service Request System

A full-stack, mini eCitizen-style public service request portal built with HTML, CSS, vanilla JavaScript, Node.js, Express and SQLite.

## Features

- Citizen registration and login with hashed passwords and signed sessions (JWT).
- Submit a request with category, location, description and an optional photo.
- Citizen-only request history and status tracking.
- Administrator dashboard with totals, category analytics, search and status updates.
- Status lifecycle: Pending → In Progress → Resolved.
- Responsive, polished UI for desktop and mobile.
- Server-side validation, upload size/type limits, and rate limiting on authentication routes.
- SQLite database is created automatically on first run.

## Requirements

- Node.js 20 or newer
- npm

## Run locally on Ubuntu

1. Extract the project ZIP and open a terminal in the `public-service-request-system` folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and set a unique `JWT_SECRET` and a strong `ADMIN_PASSWORD`. For a quick local demo, the defaults work, but change them before using real data.
5. Start the server:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000` in your browser.

## Demo administrator

The first startup creates the admin user using the values in `.env`.

- Email: `admin@ecitizen.local`
- Password: `ChangeMe123!` only when you have not changed `ADMIN_PASSWORD` in `.env`.

**Change the default credentials before deployment.** If the database already exists, changing `ADMIN_PASSWORD` does not update the existing admin account automatically. For a fresh demo database, stop the server and remove `data/services.db`, then start again. This deletes local demo records.

## Project structure

```text
public-service-request-system/
├── public/
│   ├── index.html       # Page layout and dialogs
│   ├── styles.css       # Responsive design system
│   └── app.js           # Frontend state and API calls
├── uploads/             # Uploaded evidence images
├── data/                # SQLite database (created at runtime)
├── server.js            # Express API, auth, validation, database
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create citizen account |
| POST | `/api/auth/login` | Public | Sign in |
| GET | `/api/me` | Signed in | Current account |
| GET | `/api/requests` | Signed in | Citizen's requests or all requests for admin |
| POST | `/api/requests` | Citizen | Submit request (`multipart/form-data`) |
| PATCH | `/api/requests/:id/status` | Admin | Update status and admin note |
| GET | `/api/analytics` | Admin | Request totals and category breakdown |
| GET | `/api/health` | Public | Basic health check |

## Notes for your submission

- This is an academic demonstration, not an official Kenyan government service.
- Do not use real citizen personal data in a public demo.
- For production deployment, add HTTPS, email verification/password reset, CSRF protection where applicable, audit logs, malware scanning for uploads, database backups, stronger operational logging and an appropriate privacy/data-protection review.
- Admin status updates use simple browser prompts to keep this starter project dependency-light; a dedicated edit dialog would be a useful next enhancement.
