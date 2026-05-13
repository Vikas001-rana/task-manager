# TaskFlow Project Management Portal

TaskFlow is a React + Vite project management portal for a team manager and team members. Managers can create member accounts, assign projects, assign tasks, track progress, and reply to complaints. Members can view assigned projects, accept work, finish projects, raise complaints, and manage their profile.

## Features

- Admin login from environment variables
- Member signup/login with Supabase Auth
- Team member profiles with name, skill, and display picture
- Multi-member project assignment
- Member-specific task visibility
- Project status flow: `To Do` -> `In Progress` -> `Done`
- Member project popup for newly assigned projects
- Date/deadline filters for `My Projects` and `To Do`
- Complaint box for in-progress projects
- Admin project detail with member progress and complaint replies
- Styled Supabase verification email template

## Tech Stack

- React
- Vite
- Supabase Auth
- Supabase Database
- Local Vite proxy for Supabase requests during development

## Project Files

- `src/App.jsx` - main application UI and logic
- `src/supabaseClient.js` - Supabase client setup
- `src/adminPortal.json` - admin portal labels/navigation fallback config
- `src/memberPortal.json` - member portal labels/navigation config
- `supabase-schema.sql` - database tables, trigger, and RLS policies
- `supabase-confirm-email-template.html` - styled verification email template
- `.env.example` - required environment variable example
- `vite.config.js` - Vite config and local Supabase proxy

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ADMIN_EMAIL=admin@taskflow.com
VITE_ADMIN_PASSWORD=admin123
```

Run the Supabase SQL from `supabase-schema.sql` inside the Supabase SQL Editor.

## Run The App

Run the main app:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Run admin-only mode:

```bash
npm run admin
```

Run member-only mode:

```bash
npm run member
```

## Admin Login

Admin credentials come from `.env`:

```env
VITE_ADMIN_EMAIL=admin@taskflow.com
VITE_ADMIN_PASSWORD=admin123
```

Change these values in `.env`, then restart the Vite server.

## Supabase Setup

1. Create a Supabase project.
2. Copy the project URL and anon key into `.env`.
3. Open Supabase SQL Editor.
4. Run all SQL from `supabase-schema.sql`.
5. For development, you can disable email confirmation in `Authentication` -> `Providers` -> `Email`.

## Verification Email Template

To use the styled verification email:

1. Open Supabase Dashboard.
2. Go to `Authentication` -> `Email Templates`.
3. Open `Confirm signup`.
4. Set subject to `Verify your TaskFlow account`.
5. Paste the HTML from `supabase-confirm-email-template.html`.
6. Save.

## Build

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Notes

- Do not share your real `.env` file publicly.
- The Supabase anon key is safe for frontend use, but database access should still be controlled with RLS policies.
- If browser requests to Supabase fail during local development, the Vite proxy in `vite.config.js` forwards `/supabase/...` requests to the configured Supabase URL.
