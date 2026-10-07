# Pickle Time – court booking (with database)
Needs Node 22.5+. No npm install needed.

    ADMIN_PASSWORD=your-strong-password SESSION_SECRET=any-long-random-text node server.js

Open http://localhost:3000 (customers) and click **Admin** in the sidebar to log in.
Bookings live in `bookings.db` (SQLite). Back this file up. On a host like Render/Railway/Fly,
attach a persistent disk and set DB_PATH to a file on it (e.g. /data/bookings.db).
