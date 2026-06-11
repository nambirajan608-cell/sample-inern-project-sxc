# Backend for Type Speed Authentication System

This folder contains the Express + MongoDB backend that stores user authentication data.

## Setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Update `MONGO_URI` with your MongoDB Atlas connection string, including username and password.
   - Example: `mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority`
3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```

> If port 5000 is already in use, stop the existing backend process or change `PORT` in `backend/.env`.

## API Endpoints

- `POST /api/users/register`
- `POST /api/users/login`
- `GET /api/users/profile/:identifier`
- `PUT /api/users/:username/metadata`
- `POST /api/users/suspicious`
- `GET /api/admin/users`
- `POST /api/admin/migrate`

When an incorrect password is entered for a known user, the backend will send an unauthorized login alert email if SMTP is configured. The frontend also reports suspicious biometric mismatches to `POST /api/users/suspicious`.

The front-end is configured to call this backend at `http://localhost:5000/api`.
